/**
 * pi-tab-status:pi 会话标签页标题 + 任务栏进度扩展。
 *
 * 标题 = {状态字形} {会话名}:命名固定为会话名(/name 设置,未命名回退 shell
 * 标识),状态字形随会话内状态切换(字形动画是唯一的标题变化源):
 *   生成中 旋转帧 ◐◓◑◒ 轮换 / 等待用户 _ 闪烁 / 执行工具 ▸ + 工具名 /
 *   疑似卡住 ? / 请求出错 × / 空闲完成 ·。
 * 字形均为非 emoji 等宽字符,轮换帧同宽不抖。
 *
 * 会话名变化(/name、RPC setSessionName)时同步更新标题主文本,其余时机
 * 只有字形部分随状态动——"命名"本身静态可读。
 *
 * 进度(OSC 9;4,ConEmu 协议):Cmder 标题栏横条 + Windows 任务栏进度,
 * 状态切换时写序列,工作/工具/卡住滚动、等待暂停、出错变红、完成清除。
 *
 * 通道:标题/进度均直写 process.stdout(与 pi-tui Terminal.setTitle 同路径);
 * tick 与事件处理全程 try/catch,异常记入调试日志,绝不中断。
 * 状态机:tab-status/state.ts;有效视图:tab-status/view.ts;渲染:tab-status/render.ts。
 *
 * 环境守卫:非 TTY(RPC/SDK/管道)不激活;Warp 终端让位给 pi-warp;PI_TAB_STATUS=0 关闭。
 *
 * 配置(环境变量):
 * - PI_TAB_STATUS_STALL_MS    卡住判定阈值,默认 15000(15 秒)
 * - PI_TAB_STATUS_SPINNER_MS  旋转帧间隔,默认 120(状态检查周期同步为其值)
 * - PI_TAB_STATUS_BLINK_MS    等待态闪烁帧间隔,默认 600
 * - PI_TAB_STATUS_BASE        无会话名时的标题主文本(默认自动探测 shell 标识)
 * - PI_TAB_STATUS_PROGRESS=0  关闭 OSC 进度写入(仅保留标题)
 *
 * 调试:touch ~/.pi/agent/tab-status-debug 开启文件日志(详见 tab-status/debug.ts)。
 *
 * 部署:`~/.pi/agent/extensions/tab-status.ts` + `tab-status/` 模块,热重载 /reload 生效。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { TabStatusMachine } from "./tab-status/state.ts";
import { effectiveView } from "./tab-status/view.ts";
import { renderTitle, progressStateFor, progressSequence, shellTitle } from "./tab-status/render.ts";
import { debugEnabled, debugLog } from "./tab-status/debug.ts";

const STALL_MS = numEnv("PI_TAB_STATUS_STALL_MS", 15_000);
const SPINNER_MS = numEnv("PI_TAB_STATUS_SPINNER_MS", 120);
const BLINK_MS = numEnv("PI_TAB_STATUS_BLINK_MS", 600);
const PROGRESS_ENABLED = process.env.PI_TAB_STATUS_PROGRESS !== "0";
const DEBUG = debugEnabled();

function numEnv(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** 是否在 Warp 终端(由 pi-warp 扩展接管,避免双重写标题)。 */
function isWarp(): boolean {
  const tp = process.env.TERM_PROGRAM ?? "";
  return tp === "WarpTerminal" || tp === "Warp" || !!process.env.WARP_IS_LOCAL_SHELL_SESSION;
}

export default function tabStatus(pi: ExtensionAPI) {
  if (process.env.PI_TAB_STATUS === "0") return;
  if (!process.stdout.isTTY) return;
  if (isWarp()) return;

  const machine = new TabStatusMachine();
  const SHELL_BASE = process.env.PI_TAB_STATUS_BASE || shellTitle(process.env);
  let base = SHELL_BASE; // 标题主文本:会话名优先,随 session_info_changed 更新
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastTitle = "";
  let lastProgress: number | null = null;

  if (DEBUG) {
    debugLog(`loaded stallMs=${STALL_MS} spinnerMs=${SPINNER_MS} blinkMs=${BLINK_MS} base="${SHELL_BASE}" progress=${PROGRESS_ENABLED} pid=${process.pid}`);
  }

  // ---------- 输出出口(直写 stdout) ----------

  function setTitleRaw(title: string): void {
    process.stdout.write(`\x1b]0;${title}\x07`);
    if (DEBUG) debugLog(`write [${title}]`);
  }

  function writeProgress(state: 0 | 2 | 3 | 4): void {
    if (!PROGRESS_ENABLED || state === lastProgress) return;
    lastProgress = state;
    process.stdout.write(progressSequence(state));
  }

  /** 统一 tick:渲染标题(字形随状态) + 进度,标题变化才写。 */
  function tick(): void {
    try {
      const now = Date.now();
      const view = effectiveView(machine.snapshot(), now, STALL_MS);
      const title = renderTitle(view, base, now, SPINNER_MS, BLINK_MS);
      if (title !== lastTitle) {
        lastTitle = title;
        setTitleRaw(title);
      }
      writeProgress(progressStateFor(view));
    } catch (err) {
      if (DEBUG) debugLog(`tick-error: ${err instanceof Error ? err.stack : String(err)}`);
    }
  }

  function startTicker(): void {
    if (timer) return;
    timer = setInterval(tick, SPINNER_MS);
  }

  function stopTicker(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  // ---------- 事件接线 ----------

  pi.on("session_start", async () => {
    machine.reset();
    base = pickBase();
    lastTitle = "";
    lastProgress = null;
    startTicker();
    tick(); // 立即写 idle 标题:reload/启动后马上可见
  });

  // 会话名变化(/name、RPC setSessionName):更新标题主文本,命名保持可读
  pi.on("session_info_changed", async (event) => {
    if (DEBUG) debugLog(`session_info_changed name="${event.name ?? ""}"`);
    base = event.name && event.name.trim() ? event.name : SHELL_BASE;
    lastTitle = ""; // 强制下一 tick 重写(字形可能相同但 base 变了)
    tick();
  });

  pi.on("before_agent_start", async () => tick()); // 即时刷一帧

  pi.on("agent_start", async () => {
    machine.agentStart();
    startTicker();
  });

  pi.on("message_start", async () => machine.messageActivity());
  pi.on("message_update", async () => machine.messageActivity());
  pi.on("message_end", async () => machine.messageActivity());
  pi.on("turn_start", async () => machine.messageActivity());
  pi.on("turn_end", async () => machine.messageActivity());

  pi.on("tool_execution_start", async (e) => machine.toolStart(e.toolName));
  pi.on("tool_execution_update", async () => machine.toolActivity());
  pi.on("tool_execution_end", async () => machine.toolEnd());
  pi.on("tool_result", async () => machine.toolEnd());

  pi.on("ui_prompt_start", async (e) => machine.promptStart(e.kind));
  pi.on("ui_prompt_end", async () => machine.promptEnd());

  pi.on("before_provider_request", async () => machine.heartbeat());
  pi.on("after_provider_response", async (e) => machine.providerStatus(e.status));

  pi.on("agent_end", async () => machine.agentEnd());

  pi.on("agent_settled", async () => {
    machine.settled();
    tick(); // 立即落到 idle 标题(· 会话名)并清除进度
  });

  pi.on("session_shutdown", async () => {
    stopTicker();
    machine.reset();
    setTitleRaw(SHELL_BASE); // 退出恢复纯 shell 标识标题("原来的样子")
    writeProgress(0);
    lastTitle = "";
    if (DEBUG) debugLog("shutdown, ticker stopped");
  });

  function pickBase(): string {
    const name = pi.getSessionName();
    return name && name.trim() ? name : SHELL_BASE;
  }
}
