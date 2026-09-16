// Command Bus（执行文档 §8）：所有用户级操作尽可能走 Command；Provider/Feature 不直接改全局状态。
// Command 约定：execute(ctx) → 业务结果；undo(ctx) 可选；redo(ctx) 缺省重放 execute。
export class Command {
  constructor(fields = {}) { Object.assign(this, fields); }
  get name() { return this.constructor.name; }
  async execute() { throw new Error('Command 未实现 execute()'); }
  async undo() {}
  async redo(ctx) { return this.execute(ctx); }
}

export function createCommandBus({ history = null, onError = null } = {}) {
  return {
    history,
    /** 执行命令并登记历史；execute 抛错时不入栈并原样抛出。 */
    async execute(command, ctx) {
      const result = await command.execute(ctx);
      if (history) history.push({ command, ctx });
      return result;
    },
    async undo() { return history ? history.undo() : false; },
    async redo() { return history ? history.redo() : false; },
    canUndo() { return history ? history.canUndo() : false; },
    canRedo() { return history ? history.canRedo() : false; }
  };
}
