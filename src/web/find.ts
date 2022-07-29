import * as vscode from 'vscode';
import { Recorder } from './record';
import { TypeHandler } from './interfaces';

export class FindHandler implements TypeHandler {
  active: boolean;
  findText: string;
  cursorStack: CursorStack;

  constructor() {
    this.active = false;
    this.findText = "";
    this.cursorStack = new CursorStack();
  }

  async nextMatch() {
    // Then find next match
    await vscode.commands.executeCommand("editor.action.nextMatchFindAction");
  }

  async prevMatch() {
    await vscode.commands.executeCommand("editor.action.previousMatchFindAction");
  }

  register(context: vscode.ExtensionContext, recorder: Recorder) {
    recorder.registerCommand(context, 'find', async () => {
      if (this.active) {
        await this.nextMatch();
      } else {
        await this.activate();
      }
    });
    recorder.registerCommand(context, 'reverseFind', async () => {
      if (this.active) {
        await this.prevMatch();
      } else {
        await this.activate();
      }
    });
    vscode.window.onDidChangeActiveTextEditor(async () => {
      await this.deactivate();
    });
  }

  async activate() {
    this.active = true;
    await vscode.commands.executeCommand('setContext', 'groog.findMode', true);
    await this.findWithArgs();
  }

  async deactivate() {
    this.active = false;
    await vscode.commands.executeCommand('setContext', 'groog.findMode', false);
    // TODO: make text clearing optional? Differentiate in activate maybe?
    this.findText = "";
    this.cursorStack.clear();
    await vscode.commands.executeCommand("cancelSelection");
    await vscode.commands.executeCommand("closeFindWidget");
  }

  async findWithArgs() {
    let txt = this.findText;
    if (this.findText.length === 0) {
      txt = "ENTER" + "_TEXT";
    }
    await vscode.commands.executeCommand("editor.actions.findWithArgs", { "searchString": txt }).then(async () => {
      await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
    }, async () => {
      await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
    }
    );
    await cursorToFront();
    await this.nextMatch();
  }

  async ctrlG() {
    await this.deactivate();
  }

   async textHandler(s: string): Promise<boolean> {
    // Enter, shift+enter, ctrl+n, ctrl+p taken care of in package.json
    this.findText = this.findText.concat(s);
    this.cursorStack.push();
    await this.findWithArgs();
    return false;
  }

  async moveHandler(s: string): Promise<boolean> {
    await this.deactivate();
    return true;
  }

  async delHandler(s: string): Promise<boolean> {
    switch (s) {
      case "deleteLeft":
        if (this.findText.length > 0) {
          this.findText = this.findText.slice(0, this.findText.length - 1);
          this.cursorStack.popAndSet();
          await this.findWithArgs();
        }
        break;
      default:
        vscode.window.showInformationMessage("Unsupported find command: " + s);
    }
    return false;
  }

  // TODO: do something like error message or deactivate
  async onYank(s: string | undefined) { }
  async alwaysOnYank(): Promise<boolean> { return false; }
  async onKill(s: string | undefined) { }
  async alwaysOnKill(): Promise<boolean> { return false; }
}

class CursorStack {
  selections: vscode.Position[];

  constructor() {
    this.selections = [];
  }

  push() {
    let editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage("Couldn't find active editor");
      this.selections.push(new vscode.Position(0, 0));
      return;
    }
    this.selections.push(new vscode.Position(editor.selection.start.line, editor.selection.start.character));
  }

  popAndSet() {
    let p = this.selections.pop();
    if (!p) {
      // No longer error here since we can run out of cursor positions if
      // we start a search with a non-empty findText.
      // vscode.window.showErrorMessage("Ran out of cursor positions");
      return;
    }
    let editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage("Undefined editor");
      return;
    }
    // https://github.com/microsoft/vscode/issues/111#issuecomment-157998910
    editor.selection = new vscode.Selection(p, p);
  }

  clear() {
    this.selections = [];
  }
}

export function cursorToFront() {
    // Move cursor to beginning of selection
    let editor = vscode.window.activeTextEditor;
    if (editor) {
      let startPos = editor.selection.start;
      editor.selection = new vscode.Selection(startPos, startPos);
    }
  }
