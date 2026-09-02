// render.ts - pi-tab-status 纯渲染:有效视图 -> 终端标题字符串。
//
// 标题格式:{状态字形} {shell 标识} [{状态详情}]。
// - working(模型生成中)用旋转帧 ◐◓◑◒(120ms 级轮换,与 Claude Code 同风格);
//   字形为固定宽度几何字符(U+25D0-25D3),避免宽度抖动
// - tool(执行工具)用 ▸(U+25B8):方向感对应"执行",与旋转帧区分
// - 其余状态静态字形,标题仅状态切换时变化
// - shell 标识恢复"原来的样子":按启动环境探测(Windows PowerShell /
//   Git Bash),可用 PI_TAB_STATUS_BASE 覆盖
// - 字形全部非 emoji 等宽几何/标点字符
export type { EffectiveView } from "./view.ts";

/** 旋转帧:固定宽度几何字符(working 态轮换)。 */
export const SPINNER_FRAMES = ["◐", "◓", "◑", "◒"] as const;

/** 各状态前缀字形(非 emoji)。 */
export const GLYPH = {
  idle: "·",
  tool: "▸",
  waiting: "‖",
  stalled: "?",
  error: "×",
} as const;

/** 按挂钟时间取当前旋转帧(无需内部计数器,天然连续)。 */
export function spinnerFrame(now: number, intervalMs: number): string {
  const i = Math.floor(now / Math.max(1, intervalMs)) % SPINNER_FRAMES.length;
  return SPINNER_FRAMES[i];
}

/** 按扩展进程环境(pi 从哪个 shell 启动)探测"原来的"标签标识。 */
export function shellTitle(env: Record<string, string | undefined>): string {
  if (env.MSYSTEM) return "Git Bash";
  if (env.SHELL) return "bash";
  return "Windows PowerShell";
}

/** 组装标题。base 由入口提供(shell 标识或自定义)。 */
export function renderTitle(
  view: EffectiveView,
  base: string,
  now: number,
  spinnerIntervalMs: number
): string {
  switch (view.kind) {
    case "idle":
      return `${GLYPH.idle} ${base}`;
    case "working":
      return `${spinnerFrame(now, spinnerIntervalMs)} ${base}`;
    case "tool":
      return `${GLYPH.tool} ${base} (${view.tool})`;
    case "waiting":
      return `${GLYPH.waiting} ${base} (${view.promptKind})`;
    case "stalled": {
      const ctx = view.httpStatus !== undefined ? `, HTTP ${view.httpStatus}` : "";
      return `${GLYPH.stalled} ${base} (no activity${ctx})`;
    }
    case "error":
      return `${GLYPH.error} ${base} (HTTP ${view.httpStatus})`;
  }
}

/**
 * OSC 进度状态码(ConEmu 协议,Windows Terminal/Cmder(ConEmu) 原生支持):
 * 3=不确定态(转圈/横条) 4=暂停 2=错误(任务栏红) 0=清除。
 * stalled 保持 3(仍在工作,只是静默)。
 */
export function progressStateFor(view: EffectiveView): 0 | 2 | 3 | 4 {
  switch (view.kind) {
    case "working":
    case "tool":
    case "stalled":
      return 3;
    case "waiting":
      return 4;
    case "error":
      return 2;
    case "idle":
      return 0;
  }
}

/** OSC 进度序列(仅状态,不带百分比;与 pi-tui 内置写法一致)。 */
export function progressSequence(state: 0 | 2 | 3 | 4): string {
  return `\x1b]9;4;${state}\x07`;
}
