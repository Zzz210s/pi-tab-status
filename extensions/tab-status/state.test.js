// state.test.js - 状态机 + 有效视图单测(事件序列 -> 快照 -> 视图)。
// 运行:node --test(Node >= 24:原生 TS 类型剥离,.js 直接 import .ts)
// 视图不含耗时(按需求移除);时间戳的功能用途(卡住检测)通过
// lastActivityAt 与视图 kind 变化来断言。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TabStatusMachine } from './state.ts';
import { effectiveView } from './view.ts';

const STALL = 10_000; // 测试用卡住阈值 10s(需大于各测试的活动间隔)
let t;
let m;

beforeEach(() => {
  t = 10_000; // 虚拟时钟起点
  m = new TabStatusMachine(t);
});

const tick = (ms) => (t += ms);
const view = () => effectiveView(m.snapshot(), t, STALL);

test('初始为 idle', () => {
  assert.deepEqual(view(), { kind: 'idle' });
});

test('agent_start -> working;活动时间戳随之刷新', () => {
  m.agentStart(t);
  assert.equal(view().kind, 'working');
  assert.equal(m.lastActivityAt, t);
  tick(5_000);
  m.messageActivity(t);
  assert.equal(m.lastActivityAt, t);
  assert.equal(view().kind, 'working');
});

test('tool 全周期:tool_start -> tool,tool_end -> working', () => {
  m.agentStart(t);
  tick(1_000);
  m.toolStart('bash', t);
  assert.equal(view().kind, 'tool');
  assert.equal(view().tool, 'bash');
  m.toolEnd(t);
  assert.equal(view().kind, 'working');
});

test('working 静默超阈值 -> stalled,新事件自动恢复', () => {
  m.agentStart(t);
  tick(500);
  m.messageActivity(t);
  assert.equal(view().kind, 'working');
  tick(STALL + 1);
  assert.equal(view().kind, 'stalled');
  m.messageActivity(t);
  assert.equal(view().kind, 'working');
});

test('tool 静默超阈值 -> stalled(tool_activity 可续命)', () => {
  m.agentStart(t);
  m.toolStart('bash', t);
  tick(8_000);
  m.toolActivity(t);
  assert.equal(view().kind, 'tool');
  tick(STALL + 1);
  assert.equal(view().kind, 'stalled');
});

test('heartbeat 刷新活动但不清错误态(重试退避窗口)', () => {
  m.agentStart(t);
  m.providerStatus(429, t);
  assert.equal(view().kind, 'error');
  tick(500);
  m.heartbeat(t); // 新请求已发出
  assert.equal(view().kind, 'error'); // 仍显示 429,直到 2xx/流式
});

test('ui_prompt 覆盖一切相位,end 后恢复 working;idle 期间 prompt 恢复 idle', () => {
  m.agentStart(t);
  m.toolStart('bash', t);
  m.promptStart('confirm', t);
  tick(3_000);
  let v = view();
  assert.equal(v.kind, 'waiting');
  assert.equal(v.promptKind, 'confirm');
  m.promptEnd(t);
  assert.equal(view().kind, 'working');

  m.settled(t);
  m.promptStart('select', t);
  assert.equal(view().kind, 'waiting');
  m.promptEnd(t);
  assert.equal(view().kind, 'idle');
});

test('嵌套 prompt 只认最外层,end 一次不退出 waiting', () => {
  m.agentStart(t);
  m.promptStart('select', t);
  m.promptStart('input', t);
  assert.equal(view().kind, 'waiting');
  m.promptEnd(t);
  assert.equal(view().kind, 'waiting');
  m.promptEnd(t);
  assert.equal(view().kind, 'working');
});

test('HTTP >= 400 -> error;成功流式活动清除;agent_start/settled 清除', () => {
  m.agentStart(t);
  m.providerStatus(429, t);
  tick(500);
  let v = view();
  assert.equal(v.kind, 'error');
  assert.equal(v.httpStatus, 429);
  m.messageActivity(t);
  assert.equal(view().kind, 'working');
  m.providerStatus(500, t);
  assert.equal(view().kind, 'error');
  m.settled(t);
  assert.equal(view().kind, 'idle');
});

test('2xx 响应清除 error 态', () => {
  m.agentStart(t);
  m.providerStatus(503, t);
  assert.equal(view().kind, 'error');
  m.providerStatus(200, t);
  assert.equal(view().kind, 'working');
});

test('错误后长静默:stalled 盖过 error 并保留 HTTP 上下文', () => {
  m.agentStart(t);
  m.providerStatus(429, t);
  tick(STALL + 1);
  const v = view();
  assert.equal(v.kind, 'stalled');
  assert.equal(v.httpStatus, 429);
});

test('优先级:waiting > stalled > error > tool > working > idle', () => {
  m.agentStart(t);
  m.providerStatus(429, t);
  m.toolStart('bash', t);
  assert.equal(view().kind, 'error');
  m.promptStart('confirm', t);
  assert.equal(view().kind, 'waiting');
  m.promptEnd(t);
  assert.equal(view().kind, 'error');
  tick(STALL + 1);
  assert.equal(view().kind, 'stalled');
});

test('agent_end 不回 idle(可能自动重试),agent_settled 才回', () => {
  m.agentStart(t);
  m.agentEnd(t);
  assert.equal(view().kind, 'working');
  m.settled(t);
  assert.equal(view().kind, 'idle');
});

test('reset(session_start)全清', () => {
  m.agentStart(t);
  m.toolStart('bash', t);
  m.providerStatus(500, t);
  m.reset(t);
  assert.deepEqual(view(), { kind: 'idle' });
});
