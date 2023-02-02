import * as vscode from 'vscode';
import { ColorMode } from './color_mode';
import { commands } from './commands';
import { FindHandler } from './find';
import { Registerable, TypeHandler } from './handler';
import { CtrlGCommand, CursorMove, DeleteCommand, setGroogContext } from './interfaces';
import { TypoFixer } from './internal-typos';
import { MarkHandler } from './mark';
import { infoMessage, multiCommand } from './misc-command';
import { Recorder } from './record';
import { Settings } from './settings';
import { TerminalFindHandler } from './terminal-find';

const jumpDist = 10;

const qmkKey = "groog.keys.qmkState";

class GlobalStateTracker<T> {
  private key: string;

  constructor(key: string) {
    this.key = key;
  }

  get(context: vscode.ExtensionContext): T | undefined {
    return context.globalState.get<T>(this.key);
  }

  async update(context: vscode.ExtensionContext, t: T) {
    await context.globalState.update(this.key, t);
  }
}

export class Emacs {
  private qmk: GlobalStateTracker<boolean>;
  recorder: Recorder;
  typeHandlers: TypeHandler[];
  cm: ColorMode;
  typoFixer: TypoFixer;

  constructor() {
    this.cm = new ColorMode();
    this.qmk = new GlobalStateTracker<boolean>(qmkKey);
    this.recorder = new Recorder(this.cm);
    this.typoFixer = new TypoFixer();
    this.typeHandlers = [
      new FindHandler(this.cm),
      new MarkHandler(this.cm),
      new TerminalFindHandler(this.cm),
      this.recorder,
    ];
  }

  private static registerables(): Registerable[] {
    return [
      new Settings(),
    ];
  }

  register(context: vscode.ExtensionContext) {
    for (var move of Object.values(CursorMove)) {
      const m = move;
      this.recorder.registerCommand(context, move, () => this.move(m));
    }
    for (var dc of Object.values(DeleteCommand)) {
      const d = dc;
      this.recorder.registerCommand(context, d, () => this.delCommand(d));
    }

    context.subscriptions.push(vscode.commands.registerCommand('groog.type', async (arg: TypeArg) => await this.type(arg)));

    this.recorder.registerCommand(context, 'jump', () => this.jump());
    this.recorder.registerCommand(context, 'fall', () => this.fall());
    this.recorder.registerCommand(context, 'format', () => this.format());

    this.recorder.registerCommand(context, 'toggleQMK', () => this.toggleQMK(context));
    this.recorder.registerCommand(context, 'yank', () => this.yank());
    this.recorder.registerCommand(context, 'kill', () => this.kill());
    this.recorder.registerCommand(context, 'ctrlG', () => this.ctrlG());

    // This needs to be a groog command so it can be recorded.
    this.recorder.registerCommand(context, 'undo', () => vscode.commands.executeCommand("undo"));

    for (var th of this.typeHandlers) {
      th.register(context, this.recorder);
    }

    for (var r of Emacs.registerables()) {
      r.register(context, this.recorder);
    }

    this.recorder.registerCommand(context, "multiCommand.execute", multiCommand);
    this.recorder.registerCommand(context, "message.info", infoMessage);

    // Register one-off commands.
    commands.forEach((value: () => Thenable<any>, key: string) => {
      this.recorder.registerCommand(context, key, value);
    });

    // After all commands have been registered, check persistent data for qmk setting.
    this.setQMK(context, this.qmk.get(context));
  }

  async runHandlers(thCallback: (th: TypeHandler) => Thenable<boolean>, applyCallback: () => Thenable<any>) {
    let apply = true;
    for (var th of this.typeHandlers) {
      if (th.isActive()) {
        if (!(await thCallback(th))) {
          // Note, we can't do "apply &&= th.textHandler" because
          // if apply is set to false at some point, then later
          // handlers won't run
          apply = false;
        }
      }
    }
    if (apply) {
      await applyCallback();
    }
  }

  async type(arg: TypeArg) {
    let s = arg.text;
    await this.runHandlers(
      async (th: TypeHandler): Promise<boolean> => { return await th.textHandler(s); },
      async () => {
        // Before typing, check our dictionary.
        if (!(await this.typoFixer.check(s))) {
          await vscode.commands.executeCommand("default:type", arg);
        }

      },
    );
  }

  async delCommand(d: DeleteCommand) {
    await this.runHandlers(
      async (th: TypeHandler): Promise<boolean> => { return await th.delHandler(d); },
      async () => { await vscode.commands.executeCommand(d); },
    );
  }

  async toggleQMK(context: vscode.ExtensionContext) {
    await this.setQMK(context, !this.qmk.get(context));
  }

  async setQMK(context: vscode.ExtensionContext, bu: boolean | undefined) {
    let b = bu || false;
    if (b) {
      vscode.window.showInformationMessage('QMK keyboard mode activated');
    } else {
      vscode.window.showInformationMessage('Basic keyboard mode activated');
    }
    await this.qmk.update(context, b);
    await setGroogContext('qmk', b);
  }

  async yank() {
    let range = vscode.window.activeTextEditor?.selection;
    let maybe = vscode.window.activeTextEditor?.document.getText(range);
    if (maybe) {
      await vscode.window.activeTextEditor?.edit(editBuilder => {
        if (range) {
          editBuilder.delete(range);
        }
      });
    }

    for (var th of this.typeHandlers) {
      if (th.isActive() || await th.alwaysOnYank) {
        await th.onYank(maybe);
      }
    }
  }

  async ctrlG() {
    for (var th of this.typeHandlers) {
      if (th.isActive()) {
        await th.ctrlG();
      }
    }
    for (var cmd of Object.values(CtrlGCommand)) {
      await vscode.commands.executeCommand(cmd);
    }
  }

  async kill() {
    let editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    let startPos = editor.selection.active;
    let endPos = editor.document.lineAt(startPos.line).range.end;
    let range = new vscode.Range(startPos, endPos);
    let text = editor.document.getText(range);
    // Do nothing here so that "Undo" command doesn't undo nothing.
    if (text.length === 0) {
      return;
    }
    // No longer pull next line because we would just do that with ctrl+d
    /*if (text.trim().length === 0) {
      range = new vscode.Range(startPos, new vscode.Position(startPos.line + 1, 0));
    }*/
    for (var th of this.typeHandlers) {
      if (th.isActive() || await th.alwaysOnKill) {
        th.onKill(text);
      }
    }
    await vscode.window.activeTextEditor?.edit(editBuilder => {
      editBuilder.delete(range);
    });
  }

  // C-l
  async jump() {
    await this.move(CursorMove.move, { "to": "up", "by": "line", "value": jumpDist });
  }

  // C-v
  async fall() {
    await this.move(CursorMove.move, { "to": "down", "by": "line", "value": jumpDist });
  }

  async move(vsCommand: CursorMove, ...rest: any[]) {
    await this.runHandlers(
      async (th: TypeHandler): Promise<boolean> => { return await th.moveHandler(vsCommand, ...rest); },
      async () => { await vscode.commands.executeCommand(vsCommand, ...rest); },
    );
  }

  async format() {
    let editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    if (editor.selection.isEmpty) {
      await vscode.commands.executeCommand("editor.action.formatDocument");
      await vscode.commands.executeCommand("editor.action.trimTrailingWhitespace");
      await vscode.commands.executeCommand("editor.action.organizeImports");
    } else {
      await vscode.commands.executeCommand("editor.action.formatSelection");
    }
  }
}

interface TypeArg {
  text: string;
}
