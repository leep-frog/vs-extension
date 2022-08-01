import * as vscode from 'vscode';
import { ColorizedHandler, ColorMode, Mode } from './color_mode';
import { TypeHandler } from './interfaces';

export class Recorder extends ColorizedHandler implements TypeHandler {
  // baseCommand ensures we don't infinite loop a command. For example,
  // if groog.CommandOne calls groog.CommandTwo, then we would record
  // both of them. But in the replay we would call groog.CommandOne (which would
  // call groog.CommandTwo) and then call groog.CommandTwo ourselves. Therefore,
  // groog.CommandTwo would be executed twice in the replay even though it only
  // happened once during recording.
  private baseCommand: boolean;
  active: boolean; // aka "recording"
  private recordBook: Record[];
  private lastFind: FindNextRecord | undefined;
  // TODO: Would we ever want these in persistent memory?
  //       Don't think so unless we made package public.
  //       Otherwise, any recording I'd want public I could
  //       just create an equivalent vscode function.
  private namedRecordings: Map<string, Record[]>;

  constructor(cm: ColorMode) {
    super(cm);
    this.baseCommand = true;
    this.active = false;
    this.recordBook = [];
    this.namedRecordings = new Map<string, Record[]>();
  }

  register(context: vscode.ExtensionContext, recorder: Recorder) {
    recorder.registerCommand(context, "record.startRecording", () => recorder.startRecording());
    recorder.registerCommand(context, "record.endRecording", () => recorder.endRecording());
    recorder.registerCommand(context, "record.saveRecordingAs", () => recorder.saveRecordingAs());
    recorder.registerCommand(context, "record.playRecording", () => recorder.playback());
    recorder.registerCommand(context, "record.playNamedRecording", () => recorder.playbackNamedRecording());
    recorder.registerCommand(context, "record.find", () => recorder.find());
    recorder.registerCommand(context, "record.findNext", () => recorder.findNext());
  }

  registerCommand(context: vscode.ExtensionContext, commandName: string, callback: (...args: any[]) => Thenable<any>) {
    context.subscriptions.push(vscode.commands.registerCommand("groog." + commandName, async (...args: any) => {
      await this.execute("groog." + commandName, args, callback);
    }));
  }

  registerUnrecordableCommand(context: vscode.ExtensionContext, commandName: string, callback: (...args: any[]) => any) {
    context.subscriptions.push(vscode.commands.registerCommand("groog." + commandName, callback));
  }

  async execute(command: string, args: any[], callback: (...args: any[]) => any) {
    if (command.includes("groog.record") || !this.active || !this.baseCommand) {
      await callback(...args);
      return;
    }
    await this.addRecord(new CommandRecord(command, args));
    this.baseCommand = false;
    await callback(...args);
    this.baseCommand = true;
  }

  // TODO: findPrev
  async findNext() {
    if (!this.lastFind) {
      vscode.window.showErrorMessage("No find text has been set yet");
      return;
    }
    await this.lastFind.playback();
    this.addRecord(this.lastFind);
  }

  async find() {
    vscode.window.showInformationMessage("inputting");
    const searchQuery = await vscode.window.showInputBox({
      placeHolder: "Search query",
      prompt: "Search text",
      //value: selectedText
    });
    vscode.window.showInformationMessage("got: " + searchQuery);
    if (searchQuery) {
      this.lastFind = new FindNextRecord(searchQuery);
      await this.findNext();
    }
  }

  async startRecording() {
    if (this.active) {
      vscode.window.showInformationMessage("Already recording!");
    } else {
      this.activate();
      this.recordBook = [];
      vscode.window.showInformationMessage("Recording started!");
    }
  }

  async saveRecordingAs() {
    if (!this.active) {
      vscode.window.showInformationMessage("Not recording!");
      return;
    }

    const searchQuery = await vscode.window.showInputBox({
      placeHolder: "Recording name",
      prompt: "Save recording as...",
      title: "Save recording as:",
    });

    // Save recording as if a name was provided.
    if (searchQuery) {
      this.namedRecordings.set(searchQuery, this.recordBook);
      vscode.window.showInformationMessage(`Recording saved as "${searchQuery}"!`);
    } else {
      vscode.window.showErrorMessage("No recording name provided");
    }
    this.deactivate();
    vscode.window.showInformationMessage("Recording ended!");
  }

  async endRecording() {
    if (!this.active) {
      vscode.window.showInformationMessage("Not recording!");
    } else {
      this.deactivate();
      vscode.window.showInformationMessage("Recording ended!");
    }
  }

  async playbackNamedRecording() {
    if (this.active) {
      vscode.window.showInformationMessage("Still recording!");
      return;
    }
    const result = await vscode.window.showQuickPick(
      [...this.namedRecordings.keys()].sort((a: string, b: string): number => {
        return a < b ? -1 : 1;
      }),
      {
        placeHolder: "Recording name",
        title: "Choose Recording to play",
      },
    );
    if (!result) {
      vscode.window.showErrorMessage("No recording chosen");
      return;
    }
    let nr = this.namedRecordings.get(result);
    if (!nr) {
      vscode.window.showErrorMessage(`Unknown recording "${result}"`);
      return;
    }
    vscode.window.showInformationMessage(`Playing back "${result}"`);
    for (var r of nr) {
      await r.playback();
    }
  }

  async playback() {
    if (this.active) {
      vscode.window.showInformationMessage("Still recording!");
      return;
    }
    vscode.window.showInformationMessage("Playing recording!");
    for (var r of this.recordBook) {
      await r.playback();
    }
    // TODO: not sure if this is identical
    // this.recordBook.map(async (r) => await r.playback());
  }

  async colorActivate() {
    this.active = true;
    await vscode.commands.executeCommand('setContext', 'groog.recording', true);
  }

  async colorDeactivate() {
    this.active = false;
    this.lastFind = undefined;
    await vscode.commands.executeCommand('setContext', 'groog.recording', false);
    await vscode.commands.executeCommand("closeFindWidget");
  }

  mode(): Mode {
    return Mode.RECORD;
  }

  addRecord(r: Record) {
    this.recordBook = this.recordBook.concat(r);
  }

  async textHandler(s: string): Promise<boolean> {
    this.addRecord(new TypeRecord(s));
    return true;
  }

  // All these functions are associated with a "groog.*" command so these are
  // already added to the record book via the "type" command handling
  async onKill(s: string | undefined) { }
  async alwaysOnKill(): Promise<boolean> { return false; }
  async ctrlG() { }
  async onYank(s: string | undefined) { }
  async alwaysOnYank(): Promise<boolean> { return false; }
  async delHandler(s: string): Promise<boolean> {
    return true;
  }
  async moveHandler(vsCommand: string, ...rest: any[]): Promise<boolean> {
    return true;
  }
}

interface Record {
  name(): string;
  playback(): Promise<void>;
}

class TypeRecord implements Record {
  text: string;

  constructor(text: string) {
    this.text = text;
  }

  async playback(): Promise<void> {
    await vscode.commands.executeCommand("type", { "text": this.text });
  }

  name(): string {
    return "TR: " + this.text;
  }
}

class CommandRecord implements Record {
  command: string;
  args: any[];

  constructor(command: string, args: any[]) {
    this.command = command;
    this.args = args;
  }

  async playback(): Promise<void> {
    await vscode.commands.executeCommand(this.command, ...this.args);
  }

  name(): string {
    return "CR: " + this.command;
  }
}

class FindNextRecord implements Record {
  findText: string;

  constructor(findText: string) {
    this.findText = findText;
  }

  async playback(): Promise<void> {
    await vscode.commands.executeCommand("editor.actions.findWithArgs", { "searchString": this.findText });
    await vscode.commands.executeCommand("editor.action.nextMatchFindAction");
    await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
  }

  name(): string {
    return "FNR: " + this.findText;
  }
}
