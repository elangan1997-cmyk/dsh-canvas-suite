import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Command, createCommandBus } from '../../src/shared/commands/command-bus.js';
import { createHistoryManager } from '../../src/shared/commands/history.js';

class SetValue extends Command {
  async execute(ctx) { this.prev = ctx.state.value; ctx.state.value = this.value; return ctx.state.value; }
  async undo(ctx) { ctx.state.value = this.prev; }
}
class Boom extends Command { async execute() { throw new Error('boom'); } }
class UndoFails extends Command { async execute(ctx) { ctx.state.value = 'x'; } async undo() { throw new Error('undo boom'); } }

test('Command 基类：未实现 execute 抛错；redo 缺省重放 execute', async () => {
  await assert.rejects(new Command().execute(), /未实现 execute/);
  const c = new SetValue({ value: 7 }); const ctx = { state: { value: 0 } };
  await c.redo(ctx); assert.equal(ctx.state.value, 7);
  assert.equal(c.name, 'SetValue');
});

test('CommandBus + History：执行入栈、undo/redo、新命令清空 redo 栈', async () => {
  const history = createHistoryManager({ limit: 10 });
  const bus = createCommandBus({ history });
  const ctx = { state: { value: 0 } };
  assert.equal(await bus.execute(new SetValue({ value: 1 }), ctx), 1);
  await bus.execute(new SetValue({ value: 2 }), ctx);
  assert.equal(ctx.state.value, 2);
  assert.ok(bus.canUndo() && !bus.canRedo());
  assert.equal(await bus.undo(), true); assert.equal(ctx.state.value, 1);
  assert.equal(await bus.undo(), true); assert.equal(ctx.state.value, 0);
  assert.equal(await bus.undo(), false, '空栈返回 false');
  assert.equal(await bus.redo(), true); assert.equal(ctx.state.value, 1);
  assert.ok(bus.canRedo());
  await bus.execute(new SetValue({ value: 9 }), ctx);
  assert.equal(bus.canRedo(), false, '新命令清空 redo');
  assert.deepEqual(history.size(), { undo: 2, redo: 0 });
});

test('execute 抛错不入栈；undo 抛错时条目回栈', async () => {
  const history = createHistoryManager();
  const bus = createCommandBus({ history });
  const ctx = { state: { value: 0 } };
  await assert.rejects(bus.execute(new Boom(), ctx), /boom/);
  assert.equal(history.canUndo(), false);
  await bus.execute(new UndoFails(), ctx);
  await assert.rejects(bus.undo(), /undo boom/);
  assert.equal(history.canUndo(), true, '失败的 undo 不丢条目');
});

test('History 上限丢弃最早记录；peek/clear', async () => {
  const history = createHistoryManager({ limit: 2 });
  history.push({ command: new SetValue({ value: 1 }), ctx: {} });
  history.push({ command: new SetValue({ value: 2 }), ctx: {} });
  history.push({ command: new SetValue({ value: 3 }), ctx: {} });
  assert.equal(history.size().undo, 2);
  assert.equal(history.peek().command.value, 3);
  history.clear();
  assert.deepEqual(history.size(), { undo: 0, redo: 0 });
  assert.equal(history.peek(), null);
});

test('无 history 的 bus：undo/redo 返回 false', async () => {
  const bus = createCommandBus();
  await bus.execute(new SetValue({ value: 1 }), { state: {} });
  assert.equal(await bus.undo(), false);
  assert.equal(bus.canUndo(), false);
});
