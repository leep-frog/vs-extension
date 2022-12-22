
export enum CursorMove {
  move = "cursorMove",
  up = "cursorUp",
  down = "cursorDown",
  left = "cursorLeft",
  right = "cursorRight",
  home = "cursorHome",
  end = "cursorEnd",
  wordLeft = "cursorWordLeft",
  wordRight = "cursorWordRight",
  top = "cursorTop",
  bottom = "cursorBottom",
};

export enum CtrlGCommand {
  cancelSelection = "cancelSelection",
  closeFindWidget = "closeFindWidget",
  closeParameterHints = "closeParameterHints",
  removeSecondaryCursors = "removeSecondaryCursors",
  notificationsclearAll = "notifications.clearAll",
  workbenchActionTerminalHideFind = "workbench.action.terminal.hideFind",
  closeReferenceSearch = "closeReferenceSearch",
}

export enum DeleteCommand {
  left = "deleteLeft",
  right = "deleteRight",
  wordLeft = "deleteWordLeft",
  wordRight = "deleteWordRight",
}
