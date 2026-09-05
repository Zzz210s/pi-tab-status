// smoke.mjs - 扩展入口端到端冒烟:强制 isTTY,mock pi 宿主,走完整事件周期。
// 验证:标题静态(启动=会话名,更名才变,事件不改变标题),进度按状态切换写出。
// 运行:node scripts/smoke.mjs(退出码非 0 = 失败)
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

process.env.PI_TAB_STATUS_STALL_MS = '1500'; // 卡住阈值压短,让 stalled 进度语义可见

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

// mock pi 宿主:会话名 "my-session"
let sessionName = 'my-session';
const handlers = {};
const mockPi = {
  on: (ev, h) => { (handlers[ev] ??= []).push(h); },
  getSessionName: () => sessionName,
};
mod.default(mockPi);
console.log('注册事件数:', Object.keys(handlers).length, '(期望含 session_info_changed)');

const ctx = {};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fire = async (ev, event = {}) => {
  for (const h of handlers[ev] ?? []) await h(event, ctx);
  await wait(60);
};
const last = () => titles[titles.length - 1] ?? '(无)';
let fail = false;
const check = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) fail = true;
};

// --- 生命周期:标题必须静态,只随会话名变化 ---
await fire('session_start');
check(last() === 'my-session', `[1] session_start -> "${last()}"(显示会话名)`);

await fire('agent_start');
await fire('message_update', {});
await fire('tool_execution_start', { toolCallId: '1', toolName: 'bash', args: {} });
await wait(2000); // 超卡住阈值
await fire('ui_prompt_start', { type: 'ui_prompt_start', reason: 'ui_prompt', kind: 'confirm', title: '允许?' });
console.log('[2] 跑完工作/工具/卡住/等待事件后,标题仍未变 ->', JSON.stringify(last()));
check(last() === 'my-session', '标题不随会话内事件变化(静态)');

await fire('session_info_changed', { name: 'renamed-session' });
check(last() === 'renamed-session', `[3] session_info_changed 后 -> "${last()}"(更名生效)`);

await fire('agent_settled', {});
await fire('agent_end', {});
console.log('[4] 工作完成后标题保持 ->', JSON.stringify(last()));
check(last() === 'renamed-session', '完成态不改变标题');

// 无会话名回退 = shell 标识(按运行环境探测;冒烟在 Git Bash 下为 "Git Bash")
const SHELL_EXPECT = process.env.MSYSTEM ? 'Git Bash' : process.env.SHELL ? 'bash' : 'Windows PowerShell';

await fire('session_info_changed', { name: undefined });
check(last() === SHELL_EXPECT, `[5] 清除会话名后回退 shell 标识 -> "${last()}"`);

await fire('session_shutdown', {});
check(last() === SHELL_EXPECT, `[6] 退出恢复 shell 标识 -> "${last()}"`);

// --- 进度:状态切换时写出,含 3/4/2/0 ---
const set = [...new Set(oscWrites)];
console.log('\nOSC 进度序列(去重):', set.join(' '));
check(set.includes('\x1b]9;4;3\x1b\\'), '有 indeterminate(工作/卡住)');
check(set.includes('\x1b]9;4;4\x1b\\'), '有 paused(等待用户)');
check(set.includes('\x1b]9;4;0\x1b\\'), '有 clear(完成/退出)');

console.log(fail ? '\n冒烟失败' : '\n冒烟通过');
process.exit(fail ? 1 : 0);
