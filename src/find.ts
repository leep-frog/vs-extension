import * as vscode from 'vscode';
import { ColorMode, ModeColor } from './color_mode';
import { TypeHandler } from './handler';
import { CursorMove, DeleteCommand, setGroogContext } from './interfaces';
import { Recorder } from './record';
import { GlobalBoolTracker } from './emacs';

function findColor(opacity?: number): string{
  return `rgba(200, 120, 0, ${opacity ?? 1})`;
}

const allMatchDecorationType = vscode.window.createTextEditorDecorationType({
  overviewRulerColor: findColor(),
  backgroundColor: findColor(0.3),
});

const currentMatchDecorationType = vscode.window.createTextEditorDecorationType({
  overviewRulerColor: findColor(),
  backgroundColor: findColor(0.7),
});

// This import was causing problems in `npm test`, so I just copied the function from: https://www.npmjs.com/package/escape-string-regexp?activeTab=code
// import escapeStringRegexp from 'escape-string-regexp';
function escapeStringRegexp(s: string) {
  // Escape characters with special meaning either inside or outside character sets.
  // Use a simple backslash escape when it’s always valid, and a `\xnn` escape when the simpler form would be disallowed by Unicode patterns’ stricter grammar.
  return s
    .replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')
    .replace(/-/g, '\\x2d');
}

// _sorted because the type-wrapped functions below should be used
const _sorted = require('sorted-array-functions');
// This just type wraps sorted.gte (since sorted.gte is in javascript)
function sortedGTE<T>(list: T[], value: T, cmp?: (a: T, b: T) => number) : number {
  return _sorted.gte(list, value, cmp);
}


const maxFindCacheSize : number = 100;

interface FindContext {
  modified : boolean;
  findText : string;
  replaceText : string;
}

interface DocumentMatchProps {
  queryText: string;
  caseInsensitive: boolean;
  regex: boolean;
  wholeWord: boolean;
}

interface Match {
  range: vscode.Range;
  text: string;
  pattern: RegExp;
}

export class Document {
  documentText: string;
  caseInsensitiveDocumentText: string;

  // The indices of all newline characters;
  newlineIndices: number[];

  constructor(documentText: string) {
    this.documentText = documentText;
    this.caseInsensitiveDocumentText = documentText.toLowerCase();
    this.newlineIndices = [];
    for (let i = 0; i < this.documentText.length; i++) {
      if (this.documentText.charAt(i) === "\n") {
        this.newlineIndices.push(i);
      }
    }
    this.newlineIndices.push(this.documentText.length);
  }

  private createRegex(s: string): [RegExp, string | undefined] {
    try {
      return [new RegExp(s, "gm"), undefined];
    } catch (error) {
      return [new RegExp("."), (error as SyntaxError).message];
    }
  }

  public matches(props: DocumentMatchProps): [Match[], string | undefined] {
    if (props.queryText.length === 0) {
      return [[], undefined];
    }

    const text = props.caseInsensitive ? this.caseInsensitiveDocumentText : this.documentText;

    if (props.caseInsensitive) {
      props.queryText = props.queryText.toLowerCase();
    }
    // "g" is the global flag which is required here.
    const rgxTxt = props.regex ? props.queryText : escapeStringRegexp(props.queryText);
    const [rgx, err] = this.createRegex(rgxTxt);
    if (err) {
      return [[], err];
    }

    const matches = Array.from(text.matchAll(rgx));
    return [matches
      .map(m => {
        return {
          startIndex: m.index!,
          // Note: end index is exclusive
          endIndex: m.index! + m[0].length,
          text: m[0],
        };
      })
      .filter(m => {
        if (!props.wholeWord) {
          return true;
        }

        // If this element is a word character than the preceding one must not be.
        if (WORD_PARTS.test(this.documentText[m.startIndex])) {
          if (m.startIndex > 0 && WORD_PARTS.test(this.documentText[m.startIndex - 1])) {
            return false;
          }
        }

        if (WORD_PARTS.test(this.documentText[m.endIndex-1])) {
          if (m.endIndex < this.documentText.length && WORD_PARTS.test(this.documentText[m.endIndex])) {
            return false;
          }
        }

        return true;
      })
      .map(m => {
        return {
          text: m.text,
          range: new vscode.Range(
            this.posFromIndex(m.startIndex),
            this.posFromIndex(m.endIndex),
          ),
          pattern: rgx,
        };
      }
    ), undefined];
  }

  private posFromIndex(index: number): vscode.Position {
    const line = sortedGTE(this.newlineIndices, index);
    const lineStartIndex = line === 0 ? 0 : this.newlineIndices[line-1] + 1;
    const char = index - lineStartIndex;
    return new vscode.Position(line, char);
  }
}

interface RefreshMatchesProps extends DocumentMatchProps {
  prevMatchOnChange: boolean;
}

// WORD_PARTS is the set of characters that constituted part of a word
// (and the inverse set is the set of characters that end a word for whole word toggle).
const WORD_PARTS = new RegExp("[a-zA-Z0-9]");

interface MatchInfo {
  matches: Match[];
  match?: Match;
  matchIdx?: number;
  matchError?: string;
}

class MatchTracker {
  private matches: Match[];
  private matchIdx?: number;
  private editor?: vscode.TextEditor;
  private lastCursorPos?: vscode.Position;
  private matchError?: string;

  constructor() {
    this.matches = [];
  }

  public setNewEditor(editor: vscode.TextEditor) {
    this.editor = editor;
    this.lastCursorPos = editor.selection.start;
  }

  public setMatchIndex(idx: number) {
    if (idx < 0 || idx >= this.matches.length) {
      return;
    }
    this.matchIdx = idx;
  }

  public getMatchInfo(): MatchInfo {
    return {
      matches: this.matches,
      match: this.matchIdx === undefined ? undefined : this.matches[this.matchIdx],
      matchIdx: this.matchIdx,
      matchError: this.matchError,
    };
  }

  public nextMatch() {
    if (this.matchIdx !== undefined) {
      this.matchIdx = (this.matchIdx + 1) % this.matches.length;
    }
  }

  public prevMatch() {
    if (this.matchIdx !== undefined) {
      this.matchIdx = (this.matchIdx + this.matches.length - 1) % this.matches.length;
    }
  }

  public refreshMatches(props: RefreshMatchesProps): void {
    // The first check implies the second, but include here so we don't need an exclamation point throughout the
    // rest of the function.
    if (!this.editor || !this.lastCursorPos) {
      vscode.window.showErrorMessage(`Cannot refresh find matches when not in an editor`);
      return;
    }

    [this.matches, this.matchError] = new Document(this.editor.document.getText()).matches(props);

    // Update the matchIdx
    this.matchIdx = this.matches.length === 0 ? undefined : sortedGTE(this.matches.map(m => m.range), new vscode.Range(this.lastCursorPos, this.lastCursorPos), (a: vscode.Range, b: vscode.Range) => {
      if (a.start.isEqual(b.start)) {
        return 0;
      }
      return a.start.isBeforeOrEqual(b.start) ? -1 : 1;
    });

    // If (potentially) no matches, just stay where we are (also check undefined so we don't need exclamation point in 'this.matchIdx!' after this if block)
    if (this.matchIdx === -1 || this.matchIdx === undefined) {
      // No match at all
      if (this.matches.length === 0) {
        this.matchIdx = undefined;
        return;
      }

      // Otherwise, cursor was after the last match, in which case we just need to wrap
      // around to the top of the file.
      this.matchIdx = 0;
    }

    const matchToFocus = this.matches[this.matchIdx];
    // We're at the same match, so don't do anything
    if (this.lastCursorPos.isEqual(matchToFocus.range.start)) {
      return;
    }

    // We're at a different match.
    if (props.prevMatchOnChange) {
      // Decrement the match
      this.matchIdx = (this.matchIdx + this.matches.length - 1) % this.matches.length;
    }

    // Update the beginning of this match.
    this.lastCursorPos = this.matches[this.matchIdx].range.start;
  }
}

class FindContextCache implements vscode.InlineCompletionItemProvider {
  private cache: FindContext[];
  private cacheIdx: number;
  private cursorStack: CursorStack;
  private replaceMode: boolean;
  private findPrevOnType: boolean;
  private regexToggle: boolean;
  private caseToggle: boolean;
  private wholeWordToggle: boolean;
  private active: boolean;
  private matchTracker: MatchTracker;

  constructor() {
    this.cache = [];
    this.cacheIdx = 0;
    this.cursorStack = new CursorStack();
    this.replaceMode = false;
    this.findPrevOnType = false;
    this.regexToggle = false;
    this.caseToggle = false;
    this.wholeWordToggle = false;
    this.active = false;
    this.matchTracker = new MatchTracker();
  }

  public toggleRegex() {
    this.regexToggle = !this.regexToggle;
    if (this.active) {
      this.refreshMatches();
      this.focusMatch();
    }
  }

  public toggleCase() {
    this.caseToggle = !this.caseToggle;
    if (this.active) {
      this.refreshMatches();
      this.focusMatch();
    }
  }

  public toggleWholeWord() {
    this.wholeWordToggle = !this.wholeWordToggle;
    if (this.active) {
      this.refreshMatches();
      this.focusMatch();
    }
  }

  public async toggleReplaceMode() {
    this.replaceMode = !this.replaceMode;
    if (this.active) {
      this.refreshMatches();
      this.focusMatch();
    }
  }

  public async replace(all: boolean) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage(`Cannot replace matches from outside an editor`);
      return;
    }

    const matchInfo = this.matchTracker.getMatchInfo();
    const m = matchInfo.match;
    const toReplace = all ? matchInfo.matches : (m ? [m] : []);
    return editor.edit(eb => {
      toReplace.forEach((r) => {
        // If regex mode, than replace using string.replace so that
        // group replacements are made.
        const ctx = this.currentContext();
        eb.replace(r.range, this.regexToggle ? r.text.replace(r.pattern, ctx.replaceText) : ctx.replaceText);
      });
    }).then(() => {
      this.refreshMatches();
      return this.focusMatch();
    });
  }

  public async startNew(findPrevOnType: boolean, initText?: string) : Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage(`Cannot activate find mode from outside an editor`);
      return;
    }
    this.matchTracker.setNewEditor(editor);

    this.active = true;
    this.cursorStack.clear();
    this.cache.push({
      modified: !!initText,
      findText: initText || "",
      replaceText: "",
    });
    if (this.cache.length > maxFindCacheSize) {
      this.cache = this.cache.slice(1);
    }
    this.cacheIdx = this.cache.length-1;
    this.findPrevOnType = findPrevOnType;
    this.refreshMatches();
    return this.focusMatch();
  }

  public async end(): Promise<void> {
    // Focus on the last match (if relevant)
    const match = this.matchTracker.getMatchInfo().match;
    if (match) {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage(`Cannot select text from outside the editor.`);
      } else {
        editor.selection = new vscode.Selection(match.range.start, match.range.end);
      }
    }
    this.active = false;
    let lastCtx = this.cache.at(-1);
    if (lastCtx && lastCtx.findText.length === 0 && lastCtx.replaceText.length === 0) {
      this.cache.pop();
    }

    for (let [lastCtx, secondLastCtx] = [this.cache.at(-1), this.cache.at(-2)]; lastCtx && secondLastCtx && lastCtx.findText === secondLastCtx.findText && lastCtx.replaceText === secondLastCtx.replaceText; [lastCtx, secondLastCtx] = [this.cache.at(-1), this.cache.at(-2)]) {
      this.cache.pop();
    }
    this.replaceMode = false;
  }

  // This function is called by the registerInlineCompletionItemProvider handler.
  // It is not responsible for moving the cursor and instead will simply add the inline insertions
  // at the cursor's current position.
  async provideInlineCompletionItems(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.InlineCompletionList> {
    if (!this.active) {
      return { items: [] };
    }

    // Same order as find widget
    const codes = [];
    if (this.caseToggle) { codes.push("C"); }
    if (this.wholeWordToggle) { codes.push("W"); }
    if (this.regexToggle) { codes.push("R"); }

    const matchInfo = this.matchTracker.getMatchInfo();
    const ms = matchInfo.matches;
    const m = matchInfo.match;
    const whitespaceJoin = "\n" + (m ? document.getText(new vscode.Range(new vscode.Position(m.range.start.line, 0), new vscode.Position(m.range.start.line, m.range.start.character))).replace(/[^\t]/g, " ") : "");

    const matchText = ms.length === 0 ? `No results` : `${matchInfo.matchIdx! + 1} of ${ms.length}`;

    let ctx = this.currentContext();
    const txtParts = [
      ``,
      matchText,
      `Flags: [${codes.join("")}]`,
      `Text: ${ctx.findText}`,
    ];
    if (this.replaceMode) {
      txtParts.push(`Repl: ${ctx.replaceText}`);
    }
    const it = txtParts.join(whitespaceJoin);
    console.log(`it:\n${it}`);
    return { items: [
      {
        insertText: it,
        range: new vscode.Range(position, position),
      }
    ]};
  }

  private currentContext() : FindContext {
    return this.cache[this.cacheIdx ?? this.cache.length-1];
  }

  public async nextContext(): Promise<void> {
    if (this.cacheIdx >= this.cache.length-1) {
      vscode.window.showInformationMessage("End of find cache");
      return;
    }
    this.cacheIdx++;
    this.cursorStack.clear();
    this.refreshMatches();
    return this.focusMatch();
  }

  public async prevContext(): Promise<void> {
    if (this.cacheIdx <= 0) {
      vscode.window.showInformationMessage("No earlier find contexts available");
      return;
    }
    this.cacheIdx--;
    this.cursorStack.clear();
    this.refreshMatches();
    return this.focusMatch();
  }

  public async insertText(s: string): Promise<void> {
    let ctx = this.currentContext();
    ctx.modified = true;
    if (this.replaceMode) {
      ctx.replaceText = ctx.replaceText.concat(s);
      // Don't need to refreshMatches because the matches don't change
      // when the replaceText is modified
    } else {
      ctx.findText = ctx.findText.concat(s);
      // Only refreshMatches when updating find text
      this.refreshMatches();
      this.cursorStack.push(this.matchTracker.getMatchInfo().matchIdx);
    }
    return this.focusMatch();
  }

  public async deleteLeft(): Promise<void> {
    let ctx = this.currentContext();
    if (this.replaceMode) {
      if (ctx.replaceText.length > 0) {
        ctx.modified = true;
        ctx.replaceText = ctx.replaceText.slice(0, ctx.replaceText.length - 1);
        // Don't need to refreshMatches because the matches don't change
        // when the replaceText is modified
      }
    } else {
      if (ctx.findText.length > 0) {
        ctx.modified = true;
        ctx.findText = ctx.findText.slice(0, ctx.findText.length - 1);

        this.refreshMatches();
        const popIdx = this.cursorStack.pop();
        if (popIdx !== undefined) {
          this.matchTracker.setMatchIndex(popIdx);
        }
      }
    }
    // Always focusMatch because that regenerates the inline text.
    return this.focusMatch();
  }

  private refreshMatches() {
    this.matchTracker.refreshMatches({
      queryText: this.currentContext().findText,
      caseInsensitive: !this.caseToggle,
      regex: this.regexToggle,
      wholeWord: this.wholeWordToggle,
      prevMatchOnChange: this.findPrevOnType,
    });
  }


  /**
   * appendVerticalLine appends a `|` character if the string ends with a space.
   * Note: not relevant if the string ends with newline, tab, etc. as those are
   * expected to be irrelevant for quick pick.
   *
   * @param s the
   */
  private appendVerticalLine(s: string): string {
    return s.endsWith(" ") ? s + "|" : s;
  }

  private async focusMatch(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage(`Editor must have focus for find`);
      return;
    }

    const matchInfo = this.matchTracker.getMatchInfo();
    const match = matchInfo.match;
    const matches = matchInfo.matches;
    const matchIndex = matchInfo.matchIdx;
    const matchError = matchInfo.matchError;

    // Update the decorations (always want these changes to be applied, hence why we do this first).
    editor.setDecorations(allMatchDecorationType, matches.filter((m) => !match || !m.range.isEqual(match.range)).map(m => new vscode.Selection(m.range.start, m.range.end)));
    editor.setDecorations(currentMatchDecorationType, match ? [match] : []);

    // Move the cursor if necessary
    if (match) {
      // Put cursor at the end of the line that the match range ends at.
      const endLine = match.range.end.line;
      const newCursorPos = new vscode.Position(endLine, editor.document.lineAt(endLine).range.end.character);
      editor.selection = new vscode.Selection(newCursorPos, newCursorPos);

      // Update the editor focus
      editor.revealRange(match.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }

    // Regardless of cursor move, update the find display.

    // Set codes
    const codes = [];
    if (this.caseToggle) { codes.push("C"); }
    if (this.wholeWordToggle) { codes.push("W"); }
    if (this.regexToggle) { codes.push("R"); }

    // Create items (find info)
    const matchText = matches.length === 0 ? `No results` : `${matchIndex! + 1} of ${matches.length}`;
    const ctx = this.currentContext();
    const detail = this.replaceMode ? (ctx.replaceText.length === 0 ? "No replace text set" : this.appendVerticalLine(ctx.replaceText)) : undefined;
    const items: vscode.QuickPickItem[] = [
      {
        label: this.appendVerticalLine(ctx.findText) || " ",
        detail: detail,
        description: matchError ? matchError : undefined,
      },
      {
        label: `Flags: [${codes.join("")}]`,
      },
      {
        label: matchText,
      },
    ];

    // Display the find info
    vscode.window.showQuickPick(items);
  }

  async prevMatch() {
    return this.nextOrPrevMatch(true);
  }

  async nextMatch() {
    return this.nextOrPrevMatch(false);
  }

  private async nextOrPrevMatch(prev: boolean) {
    // Most recent one will be empty
    const prevCache = this.cache.at(-2);
    const curCache = this.cache.at(-1);
    if (curCache && prevCache && !curCache.modified) {
      this.cache.pop();
      this.cacheIdx--;
      this.refreshMatches();
      return this.focusMatch();
    }

    if (prev) {
      this.matchTracker.prevMatch();
    } else {
      this.matchTracker.nextMatch();
    };
    this.focusMatch();
  }
}


export class FindHandler extends TypeHandler {
  readonly whenContext: string = "find";
  cache : FindContextCache;
  // If true, go to the previous match when typing
  findPrevOnType : boolean;
  // If true, we have a simpler find interaction (specifically, don't
  // refreshMatches on every type).
  simpleModeTracker : GlobalBoolTracker;

  constructor(cm: ColorMode) {
    super(cm, ModeColor.find);
    this.cache = new FindContextCache();
    this.findPrevOnType = false;
    this.simpleModeTracker = new GlobalBoolTracker("find.simpleMode", () => {
      vscode.window.showInformationMessage(`Simple Find Mode activated`);
      return setGroogContext("find.simple", true);
    }, () => {
      vscode.window.showInformationMessage(`Regular Find Mode activated`);
      return setGroogContext("find.simple", false);
    });
  }

  register(context: vscode.ExtensionContext, recorder: Recorder) {
    context.subscriptions.push(vscode.languages.registerInlineCompletionItemProvider({ scheme: 'file' }, this.cache));
    recorder.registerCommand(context, 'find', () => {
      if (this.isActive()) {
        return this.cache.nextMatch();
      }
      return this.activate();
    });
    recorder.registerCommand(context, 'reverseFind', () => {
      if (this.isActive()) {
        return this.cache.prevMatch();
      }
      this.findPrevOnType = true;
      return this.activate();
    });

    recorder.registerCommand(context, 'find.replaceOne', async () => {
      if (!this.isActive()) {
        vscode.window.showErrorMessage(`Cannot replace matches when not in groog.find mode`);
        return;
      }
      return this.cache.replace(false);
    });
    recorder.registerCommand(context, 'find.replaceAll', async () => {
      if (!this.isActive()) {
        vscode.window.showErrorMessage(`Cannot replace matches when not in groog.find mode`);
        return;
      }
      return this.cache.replace(true);
    });

    recorder.registerCommand(context, 'find.toggleReplaceMode', async (): Promise<void> => {
      if (!this.isActive()) {
        vscode.window.showInformationMessage("groog.find.toggleReplaceMode can only be executed in find mode");
        return;
      }
      return this.cache.toggleReplaceMode();
    });

    // Goes to previous find context
    recorder.registerCommand(context, 'find.previous', async (): Promise<void> => {
      if (!this.isActive()) {
        vscode.window.showInformationMessage("groog.find.previous can only be executed in find mode");
        return;
      }
      return this.cache.prevContext();
    });
    // Goes to next find context
    recorder.registerCommand(context, 'find.next', async () => {
      if (!this.isActive()) {
        vscode.window.showInformationMessage("groog.find.next can only be executed in find mode");
        return;
      }
      return this.cache.nextContext();
    });

    recorder.registerCommand(context, 'focusNextEditor', async () => {
      return this.deactivateCommands().then(() => vscode.commands.executeCommand("workbench.action.focusNextGroup"));
    });
    recorder.registerCommand(context, 'focusPreviousEditor', async () => {
      return this.deactivateCommands().then(() => vscode.commands.executeCommand("workbench.action.focusPreviousGroup"));
    });
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(async () => {
      await this.deactivate();
    }));

    recorder.registerCommand(context, 'find.toggleSimpleMode', async () => {
      this.simpleModeTracker.toggle(context);
    });

    recorder.registerCommand(context, 'find.toggleRegex', () => {
      this.cache.toggleRegex();
      return vscode.commands.executeCommand("toggleSearchEditorRegex");
    });
    recorder.registerCommand(context, 'find.toggleCaseSensitive', () => {
      this.cache.toggleCase();
      return vscode.commands.executeCommand("toggleSearchEditorCaseSensitive");
    });
    recorder.registerCommand(context, 'find.toggleWholeWord', () => {
      this.cache.toggleWholeWord();
      return vscode.commands.executeCommand("toggleSearchEditorWholeWord");
    });
  }

  async handleActivation() {
    if (this.simpleModeTracker.get()) {
      const searchQuery = await vscode.window.showInputBox({
        placeHolder: "Search query",
        prompt: "Search text",
      });
      await this.cache.startNew(this.findPrevOnType, searchQuery);
    } else {
      await this.cache.startNew(this.findPrevOnType);
    }

  }

  async deactivateCommands() {
    // Don't `cancelSelection` as we select the previously matched text.
    await vscode.commands.executeCommand("editor.action.inlineSuggest.hide");
    vscode.window.activeTextEditor?.setDecorations(allMatchDecorationType, []);
    vscode.window.activeTextEditor?.setDecorations(currentMatchDecorationType, []);
  }

  async handleDeactivation() {
    await this.cache.end();
    await this.deactivateCommands();
    this.findPrevOnType = false;
  }

  async ctrlG() {
    await this.deactivate();
  }

  async textHandler(s: string): Promise<boolean> {
    // Enter, shift+enter, ctrl+n, ctrl+p taken care of in package.json
    return this.cache.insertText(s).then(() => false);
  }

  async moveHandler(cmd: CursorMove): Promise<boolean> {
    return this.deactivate().then(() => true);
  }

  async delHandler(s: DeleteCommand): Promise<boolean> {
    if (s === DeleteCommand.left) {
      return this.cache.deleteLeft().then(() => false);
    }
    vscode.window.showInformationMessage("Unsupported find command: " + s);
    return false;
  }

  // TODO: do something like error message or deactivate
  async onYank() { }
  alwaysOnYank: boolean = false;
  async onKill(s: string | undefined) { }
  alwaysOnKill: boolean = false;
}

class CursorStack {
  matchIndexes: (number | undefined)[];

  constructor() {
    this.matchIndexes = [];
  }

  // Note: using the matchIdx as the way to get cursor position isn't perfect
  // because if we replace a value, then when we backspace, it'll go to the wrong
  // spot. However, it beats the alternative where we use cursor, but a multi-line
  // replacement happens, and then we just go to some random spot in the code.
  push(matchIdx?: number) {
    this.matchIndexes.push(matchIdx);
  }

  pop(): number | undefined {
    return this.matchIndexes.pop();
  }

  clear() {
    this.matchIndexes = [];
  }
}
