// smoke.mjs - 扩展入口端到端冒烟:强制 isTTY,mock pi 宿主,走完整事件周期。
// 验证:标题 = 字形 + 会话名(命名固定;字形随状态动),进度按状态切换。
// 运行:node scripts/smoke.mjs(退出码非 0 = 失败)
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

process.env.PI_TAB_STATUS_STALL_MS = '1500'; // 卡住阈值压短
process.env.PI_TAB_STATUS_SPINNER_MS = '120';

Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

const oscWrites = [];
const titles = [];
const origWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk) => {
  const s = String(chunk);
  if (s.startsWith('\x1b]9;4')) oscWrites.push(s);
  else if (s.startsWith('\x1b]0;')) titles.push(s.slice(4).replace(/\x07$/, ''));
  else origWrite(s);
  return true;
};

const extPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../extensions/tab-status.ts');
const mod = await import(pathToFileURL(extPath).href);

let sessionName = 'my-session';
const handlers = {};
const mockPi = {
  on: (ev, h) => { (handlers[ev] ??= []).push(h); },
  getSessionName: () => sessionName,
};
mod.default(mockPi);
console.log('注册事件数:', Object.keys(handlers).length);

const ctx = {};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fire = async (ev, event = {}) => {
  for (const h of handlers[ev] ?? []) await h(event, ctx);
  await wait(150); // 超过 tick 周期(120ms),保证渲染最新一帧
};
const last = () => titles[titles.length - 1] ?? '(无)';
let fail = false;
const check = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) fail = true;
};
const hasSessionName = (t) => t.includes('my-session');

// --- 生命周期 ---
await fire('session_start');
console.log('\n[1] session_start ->', JSON.stringify(last()));
check(hasSessionName(last()), '标题含会话名(命名)' + JSON.stringify(last()));

await fire('agent_start');
await fire('message_update', {});
console.log('[2] 生成中(多帧采集)->', titles.slice(-4).map((t) => t.slice(0, 2)).join(' '));
const genFrames = titles.slice(-4).filter((t) => t.includes('my-session'));
check(genFrames.length >= 3 && new Set(genFrames.map((t) => t[0])).size > 1, 'working 旋转帧变化');
check(genFrames.every(hasSessionName), '旋转期间命名保持不变');

await fire('tool_execution_start', { toolCallId: '1', toolName: 'bash', args: {} });
console.log('[3] 工具执行 ->', JSON.stringify(last()));
check(last() === `▸ my-session (bash)`, '工具态 ▸ + 会话名');

await wait(2000); // 超过 1.5s 卡住阈值
console.log('[4] 静默超阈值(卡住)->', JSON.stringify(last()));
check(last().startsWith('?') && last().includes('no activity'), '卡住态 ? + no activity');

await fire('after_provider_response', { status: 429 });
console.log('[5] HTTP 429(卡住附带上下文)->', JSON.stringify(last()));
check(last().includes('HTTP 429'), '卡住附带 HTTP 上下文');

await fire('ui_prompt_start', { type: 'ui_prompt_start', reason: 'ui_prompt', kind: 'confirm', title: '允许?' });
console.log('[6] 等待用户确认 ->', JSON.stringify(last()));
check(last().startsWith('_') && last().includes('(confirm)'), '等待态 _ 闪烁 + confirm');

await fire('ui_prompt_end', { type: 'ui_prompt_end', reason: 'ui_prompt', kind: 'confirm' });
await fire('after_provider_response', { status: 200 });
await fire('message_update', { message: {} });
console.log('[7] 恢复 ->', JSON.stringify(last()));

await fire('agent_end', { messages: [] });
await fire('agent_settled', {});
console.log('[8] 完成(idle)->', JSON.stringify(last()));
check(last() === `· my-session`, '完成态 · + 会话名');

// 更名:命名部分更新
await fire('session_info_changed', { name: 'renamed' });
console.log('[9] 更名 ->', JSON.stringify(last()));
check(last().includes('renamed') && !hasSessionName(last()), '更名后命名更新(· renamed)');

await fire('session_shutdown', {});
console.log('[10] 退出 ->', JSON.stringify(last()));

const set = [...new Set(oscWrites)];
console.log('\nOSC 进度序列(去重):', set.length, '种');
check(set.includes('\x1b]9;4;3\x1b\\'), '有 indeterminate(3)');
check(set.includes('\x1b]9;4;4\x1b\\'), '有 paused(4)');
check(set.includes('\x1b]9;4;0\x1b\\'), '有 clear(0)');

console.log(fail ? '\n冒烟失败' : '\n冒烟通过');
process.exit(fail ? 1 : 0);
