// smoke.mjs - 扩展入口端到端冒烟:强制 isTTY,mock pi 对象,走完事件周期,
// 打印标题时间线与 OSC 写出。无需真实 pi,用于部署前验证扩展可加载、可工作。
// 运行:node scripts/smoke.mjs(退出码非 0 = 冒烟失败)
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

// 卡住阈值压到 1.5s,让 stalled 态在冒烟里可见(须在扩展加载前设置)
process.env.PI_TAB_STATUS_STALL_MS = '1500';

Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

const oscWrites = [];
const titles = [];
const origWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk) => {
  const s = String(chunk);
  if (s.startsWith('\x1b]9;4')) oscWrites.push(s);
  else if (s.startsWith('\x1b]0;')) titles.push(s.slice(4).replace(/\x07$/, ''));
  else origWrite(s); // 其余转发,保持 console.log 可见
  return true;
};

const extPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../extensions/tab-status.ts');
const mod = await import(pathToFileURL(extPath).href);

// mock pi 扩展宿主(入口已不依赖 ctx,标题由 stdout 捕获)
const handlers = {};
const mockPi = {
  on: (ev, h) => { (handlers[ev] ??= []).push(h); },
  getSessionName: () => 'smoke',
};
mod.default(mockPi);
console.log('注册事件数:', Object.keys(handlers).length);

const ctx = {};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fire = async (ev, event = {}) => {
  for (const h of handlers[ev] ?? []) await h(event, ctx);
  await wait(300); // 等 ticker(250ms)刷新一帧,保证打印的是最新标题
};
const last = () => titles[titles.length - 1] ?? '(无)';

// --- 生命周期演练 ---
console.log('\n[1] session_start ->', (await fire('session_start'), last()));
await fire('before_agent_start', {});
await fire('agent_start');
console.log('[2] agent_start(工作态 ◑ 静态)->', last());
await fire('message_update', {});
console.log('[3] 流式中 ->', last());

await fire('tool_execution_start', { toolCallId: '1', toolName: 'bash', args: {} });
console.log('[4] 工具执行 ->', last());

console.log('[5] 工具静默 2s(超过 1.5s 阈值)->');
await wait(2000);
console.log('    疑似卡住 ->', last());

await fire('tool_execution_update', {});
await fire('tool_execution_end', {});
console.log('[6] 工具恢复输出 ->', last());

await fire('after_provider_response', { status: 429, headers: {} });
console.log('[7] HTTP 429 ->', last());

await fire('ui_prompt_start', { type: 'ui_prompt_start', reason: 'ui_prompt', kind: 'confirm', title: '允许?' });
console.log('[8] 等待用户确认 ->', last());
await fire('ui_prompt_end', { type: 'ui_prompt_end', reason: 'ui_prompt', kind: 'confirm' });

await fire('after_provider_response', { status: 200, headers: {} });
await fire('message_update', { message: {} });
console.log('[9] 2xx 恢复 ->', last());

await fire('agent_end', { messages: [] });
await fire('agent_settled', {});
console.log('[10] 完成(idle)->', last());

await fire('session_shutdown', {});
console.log('[11] 退出(恢复 shell 标识)->', last());

console.log('\nOSC 进度写出(去重):', [...new Set(oscWrites)].join(' '));
const fail = titles.length === 0 || oscWrites.length === 0;
console.log(fail ? '\n冒烟失败:无标题或无进度写出' : '\n冒烟通过');
process.exit(fail ? 1 : 0);
