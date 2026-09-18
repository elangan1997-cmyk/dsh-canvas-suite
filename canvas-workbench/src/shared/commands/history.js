// History Manager（执行文档 §8.1）：undo/redo 双栈。新命令入栈时清空 redo 栈；超过上限丢弃最早记录。
export function createHistoryManager({ limit = 100 } = {}) {
  const undoStack = [];
  const redoStack = [];
  return {
    push(entry) {
      undoStack.push(entry);
      redoStack.length = 0;
      while (undoStack.length > limit) undoStack.shift();
      return entry;
    },
    async undo() {
      const entry = undoStack.pop();
      if (!entry) return false;
      try { await entry.command.undo(entry.ctx); }
      catch (err) { undoStack.push(entry); throw err; }
      redoStack.push(entry);
      return true;
    },
    async redo() {
      const entry = redoStack.pop();
      if (!entry) return false;
      try { await entry.command.redo(entry.ctx); }
      catch (err) { redoStack.push(entry); throw err; }
      undoStack.push(entry);
      return true;
    },
    canUndo() { return undoStack.length > 0; },
    canRedo() { return redoStack.length > 0; },
    size() { return { undo: undoStack.length, redo: redoStack.length }; },
    peek() { return undoStack[undoStack.length - 1] || null; },
    clear() { undoStack.length = 0; redoStack.length = 0; }
  };
}
