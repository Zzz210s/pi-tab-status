// render.ts — 渲染:标题(字形 + 会话名)与 OSC 9;4 进度。
// 标题主文本(会话名/shell 标识)由入口决定传入 base;字形随视图状态变化。
// 纯函数,无副作用,node --test 单测。

export type { EffectiveView } from "./view.ts";

/** 生成中旋转帧(固定宽度半圆,Claude Code 同风格;非 emoji 等宽)。 */
export const SPINNER_FRAMES = ["◐", "◓", "◑", "◒"] as const;

/** 等待用户:下划线闪烁(与空格同宽交替,终端光标式)。 */
export const BLINK_FRAMES = ["_", " "] as const;

/** 状态字形(非 emoji 等宽):生成中旋转 / 等待 _ / 工具 ▸ / 卡住 ? / 出错 × / 空闲 · */
export const GLYPH = {
  tool: "▸",
  stalled: "?",
  error: "×",
  idle: "·",
} as const;

/** 按挂钟取旋转帧(ms -> 帧索引),保证跨 tick 平滑。 */
export function spinnerFrame(now: number, intervalMs: number): string {
  const i = Math.floor(now / Math.max(1, intervalMs)) % SPINNER_FRAMES.length;
  return SPINNER_FRAMES[i];
}

/** 按挂钟取闪烁帧(下划线/空格交替,同宽 1 列,标签不抖)。 */
export function blinkFrame(now: number, intervalMs: number): string {
  return Math.floor(now / Math.max(1, intervalMs)) % 2 === 0 ? BLINK_FRAMES[0] : BLINK_FRAMES[1];
}

/**
 * 探测"启动 shell 的标识"(无会话名时的标题回退 + 退出恢复文本)。
 * 判定优先级:MSYSTEM(Git Bash) > SHELL > PowerShell。可用 PI_TAB_STATUS_BASE 覆盖。
 */
export function shellTitle(env: Record<string, string | undefined>): string {
  if (env.MSYSTEM) return "Git Bash";
  if (env.SHELL) return "bash";
  return "Windows PowerShell";
}

/**
 * 渲染标题:{状态字形} {base}[ 详情]。
 * base = 会话名(命名不变)——由入口决定;字形随状态切换:
 * 生成中 旋转帧轮换 / 等待 _ 闪烁 / 工具 ▸ + 工具名 /
 * 卡住 ? / 出错 × / 空闲 ·。
 */
export function renderTitle(
  view: EffectiveView,
  base: string,
  now: number,
  spinnerIntervalMs: number,
  blinkIntervalMs: number,
): string {
  switch (view.kind) {
    case "idle":
      return `${GLYPH.idle} ${base}`;
    case "working":
      return `${spinnerFrame(now, spinnerIntervalMs)} ${base}`;
    case "tool":
      return `${GLYPH.tool} ${base} (${view.tool})`;
    case "waiting":
      return `${blinkFrame(now, blinkIntervalMs)} ${base} (${view.promptKind})`;
    case "stalled": {
      const ctx = view.httpStatus !== undefined ? `, HTTP ${view.httpStatus}` : "";
      return `${GLYPH.stalled} ${base} (no activity${ctx})`;
    }
    case "error":
      return `${GLYPH.error} ${base} (HTTP ${view.httpStatus})`;
  }
}

/**
 * 视图 -> OSC 9;4 进度状态(ConEmu 协议):0=清除 / 2=error(红) /
 * 3=indeterminate(滚动) / 4=paused(暂停)。waiting 最高优先。
 */
export function progressStateFor(view: EffectiveView): 0 | 2 | 3 | 4 {
  switch (view.kind) {
    case "idle":
      return 0;
    case "waiting":
      return 4;
    case "error":
      return 2;
    default: // working / tool / stalled
      return 3;
  }
}

/** OSC 9;4 序列:进度状态写入(Cmder 标题栏横条 + Windows 任务栏)。 */
export function progressSequence(state: 0 | 2 | 3 | 4): string {
  return `\x1b]9;4;${state}\x1b\\`;
}
