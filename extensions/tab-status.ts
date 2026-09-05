/**
 * pi-tab-status:pi 会话标签页标题 + 任务栏进度扩展。
 *
 * 标题策略(静态,不随会话内状态变化):
 *   {会话名}  —— 通过 /name 或 pi.setSessionName() 设置后,标签页固定显示会话名,
 *                便于多开窗口区分("哪个会话在做啥看名字即可")。
 *   {shell 标识} —— 未命名会话回退:按启动环境探测(Windows PowerShell / Git Bash),
 *                可用 PI_TAB_STATUS_BASE 覆盖。
 *   标题只在 session_start 与 session_info_changed(更名)时写入,之后不再变化。
 *
 * 进度(OSC 9;4,ConEmu 协议):Cmder 标题栏横条 + Windows 任务栏进度。
 * 状态机事件驱动,只在状态切换时写序列,不影响标签页名字:
 *   生成/工具/疑似卡住 -> indeterminate(滚动);等待用户 -> paused(停住);
 *   请求出错(HTTP>=400) -> error(红);空闲/完成 -> 清除。
 *
 * 通道:标题/进度均直写 process.stdout(与 pi-tui Terminal.setTitle 同一路径)。
 * 状态机:tab-status/state.ts;有效视图:tab-status/view.ts;渲染:tab-status/render.ts。
 *
 * 环境守卫:非 TTY(RPC/SDK/管道)不激活;Warp 终端让位给 pi-warp;PI_TAB_STATUS=0 关闭。
 *
 * 配置(环境变量):
 * - PI_TAB_STATUS_STALL_MS    卡住判定阈值(仅影响进度语义),默认 15000
 * - PI_TAB_STATUS_BASE        无会话名时的标题文本(默认自动探测 shell 标识)
 * - PI_TAB_STATUS_PROGRESS=0  关闭 OSC 进度写入(仅保留标题)
 *
 * 调试:touch ~/.pi/agent/tab-status-debug 开启文件日志(详见 tab-status/debug.ts)。
 *
 * 部署:`~/.pi/agent/extensions/tab-status.ts` + `tab-status/` 模块,热重载 /reload 生效。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { TabStatusMachine } from "./tab-status/state.ts";
import { effectiveView } from "./tab-status/view.ts";
import { progressStateFor, progressSequence, shellTitle } from "./tab-status/render.ts";
import { debugEnabled, debugLog } from "./tab-status/debug.ts";

const STALL_MS = numEnv("PI_TAB_STATUS_STALL_MS", 15_000);
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
  let lastProgress: number | null = null;

  if (DEBUG) {
    debugLog(`loaded stallMs=${STALL_MS} base="${SHELL_BASE}" progress=${PROGRESS_ENABLED} pid=${process.pid}`);
  }

  // ---------- 输出出口(直写 stdout) ----------

  /** 静态标题:会话名优先,无则回退 shell 标识。 */
  function currentTitle(): string {
    const name = pi.getSessionName();
    return name && name.trim() ? name : SHELL_BASE;
  }

  function setTitleRaw(title: string): void {
    process.stdout.write(`\x1b]0;${title}\x07`);
    if (DEBUG) debugLog(`write title "${title}"`);
  }

  /** 进度写入:仅状态切换时(有变化才写),不触碰标题。 */
  function updateProgress(): void {
    if (!PROGRESS_ENABLED) return;
    const view = effectiveView(machine.snapshot(), Date.now(), STALL_MS);
    const state = progressStateFor(view);
    if (state !== lastProgress) {
      lastProgress = state;
      process.stdout.write(progressSequence(state));
    }
  }

  function pushEvent(fn: (event: any) => void): (event: any) => Promise<void> {
    return async (event) => {
      try {
        fn(event);
        updateProgress();
      } catch (err) {
        if (DEBUG) debugLog(`event-error: ${err instanceof Error ? err.stack : String(err)}`);
      }
    };
  }

  // ---------- 标题写入(仅两次:启动 + 更名) ----------

  pi.on("session_start", async () => {
    machine.reset();
    lastProgress = null;
    setTitleRaw(currentTitle()); // 立即显示会话名(或 shell 标识)
  });

  // 会话名变化(/name、RPC setSessionName)时重写标题——这是标题唯一会变的时机
  pi.on("session_info_changed", async (event) => {
    if (DEBUG) debugLog(`session_info_changed name="${event.name ?? ""}"`);
    setTitleRaw(event.name && event.name.trim() ? event.name : SHELL_BASE);
  });

  // ---------- 事件 -> 状态机 -> 进度(不影响标题) ----------

  pi.on("agent_start", pushEvent(() => machine.agentStart()));
  pi.on("message_start", pushEvent(() => machine.messageActivity()));
  pi.on("message_update", pushEvent(() => machine.messageActivity()));
  pi.on("message_end", pushEvent(() => machine.messageActivity()));
  pi.on("turn_start", pushEvent(() => machine.messageActivity()));
  pi.on("turn_end", pushEvent(() => machine.messageActivity()));

  pi.on("tool_execution_start", pushEvent((e) => machine.toolStart(e.toolName)));
  pi.on("tool_execution_update", pushEvent(() => machine.toolActivity()));
  pi.on("tool_execution_end", pushEvent(() => machine.toolEnd()));
  pi.on("tool_result", pushEvent(() => machine.toolEnd()));

  pi.on("ui_prompt_start", pushEvent((e) => machine.promptStart(e.kind)));
  pi.on("ui_prompt_end", pushEvent(() => machine.promptEnd()));

  pi.on("before_provider_request", pushEvent(() => machine.heartbeat()));
  pi.on("after_provider_response", pushEvent((e) => machine.providerStatus(e.status)));

  pi.on("agent_end", pushEvent(() => machine.agentEnd()));
  pi.on("agent_settled", pushEvent(() => machine.settled()));

  pi.on("session_shutdown", async () => {
    machine.reset();
    if (PROGRESS_ENABLED) {
      lastProgress = null;
      process.stdout.write(progressSequence(0));
    }
    setTitleRaw(SHELL_BASE); // 退出恢复 shell 标识标题("原来的样子")
    if (DEBUG) debugLog("shutdown");
  });
}
