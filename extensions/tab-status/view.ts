// view.ts - 从状态机快照派生渲染用有效视图(卡住判定 + 优先级)。
//
// "疑似卡住"不落状态机:按 lastActivity 派生,新事件到来自动恢复。
// 优先级:waiting > stalled > error > tool > working > idle
// - waiting 是用户阻塞,永远最高
// - stalled 覆盖 error:静默超阈值后"卡住"是用户最关心的事实,
//   最近一次 HTTP 错误作为附加上下文保留在视图里(stall 窗口 2 倍以内)
// 视图不携带耗时数据(按需求已移除耗时显示;卡住检测本身保留,仅不展示)。
import type { MachineSnapshot } from "./state.ts";

/** 渲染用有效视图。 */
export type EffectiveView =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "tool"; tool: string }
  | { kind: "waiting"; promptKind: string }
  | { kind: "stalled"; httpStatus?: number }
  | { kind: "error"; httpStatus: number };

export function effectiveView(s: MachineSnapshot, now: number, stallMs: number): EffectiveView {
  if (s.phase === "waiting") {
    return { kind: "waiting", promptKind: s.promptKind ?? "prompt" };
  }
  if ((s.phase === "working" || s.phase === "tool") && now - s.lastActivity > stallMs) {
    const recent = s.lastError && now - s.lastError.at <= stallMs * 2 ? s.lastError.status : undefined;
    return { kind: "stalled", httpStatus: recent };
  }
  if (s.errorActive && s.lastError) {
    return { kind: "error", httpStatus: s.lastError.status };
  }
  if (s.phase === "tool") {
    return { kind: "tool", tool: s.toolName ?? "tool" };
  }
  if (s.phase === "working") {
    return { kind: "working" };
  }
  return { kind: "idle" };
}
