// state.ts - pi-tab-status 纯状态机:pi 扩展事件 -> 会话相位。
//
// 设计(调研结论,见 README):
// - pi 事件已足够还原状态:agent_start/message_update/tool_execution_*/
//   ui_prompt_start/end(等待用户)/after_provider_response(HTTP 状态)
// - "疑似卡住"不在本模块判定(见 view.ts:按 lastActivity 派生,新事件自动恢复)
//
// 本模块零副作用、零 pi 依赖:所有事件方法接收可选 now 时间戳,便于单测。
// 时间戳仅保留有功能用途的:lastActivity(卡住检测)、lastError.at
// (stalled 附加 HTTP 上下文的窗口判定)。

/** 底层相位(pi 事件直接驱动)。 */
export type Phase = "idle" | "working" | "tool" | "waiting";

/** 机器内部快照(供 view.ts 派生有效视图,避免泄漏可变状态)。 */
export interface MachineSnapshot {
  phase: Phase;
  /** 嵌套 ui_prompt 结束后要恢复的相位。 */
  prevPhase: Phase;
  toolName: string | null;
  promptKind: string | null;
  promptDepth: number;
  /** 最近一次任何活动(事件)的时间戳,卡住检测的基准(功能用,不展示)。 */
  lastActivity: number;
  /** 最近一次 provider HTTP >= 400(at 用于 stalled 附加上下文的窗口判定)。 */
  lastError: { status: number; at: number } | null;
  /** 错误视图是否激活(有 >= 400 且尚未被成功活动清除)。 */
  errorActive: boolean;
}

export class TabStatusMachine {
  private s: MachineSnapshot;

  constructor(now: number = Date.now()) {
    this.s = this.fresh(now);
  }

  // ---------- 事件输入(与 pi 扩展事件一一对应) ----------

  /** session_start:完全重置。 */
  reset(now: number = Date.now()): void {
    this.s = this.fresh(now);
  }

  /** agent_start:新一轮 agent run 开始。 */
  agentStart(now: number = Date.now()): void {
    this.s.phase = "working";
    this.s.errorActive = false;
    this.activity(now);
  }

  /** message_*:模型流式输出/消息落盘;流恢复即清除错误态。 */
  messageActivity(now: number = Date.now()): void {
    if (this.s.errorActive) this.s.errorActive = false;
    this.activity(now);
  }

  /** 仅刷新活动时间戳(不清错误态):请求已发出、等待首字节的窗口。 */
  heartbeat(now: number = Date.now()): void {
    this.activity(now);
  }

  /** tool_execution_start。 */
  toolStart(toolName: string, now: number = Date.now()): void {
    this.s.toolName = toolName;
    this.s.phase = "tool";
    this.activity(now);
  }

  /** tool_execution_update:工具持续输出。 */
  toolActivity(now: number = Date.now()): void {
    this.activity(now);
  }

  /** tool_execution_end / tool_result:回到模型生成。 */
  toolEnd(now: number = Date.now()): void {
    this.s.toolName = null;
    if (this.s.phase === "tool") this.s.phase = "working";
    this.activity(now);
  }

  /** ui_prompt_start:阻塞等待用户(确认框/选择框等),覆盖其他相位。 */
  promptStart(promptKind: string, now: number = Date.now()): void {
    if (this.s.promptDepth === 0) {
      this.s.prevPhase = this.s.phase;
      this.s.promptKind = promptKind;
      this.s.phase = "waiting";
    }
    this.s.promptDepth++;
    this.activity(now);
  }

  /** ui_prompt_end:恢复进入等待前的相位(idle 恢复 idle,其余恢复 working)。 */
  promptEnd(now: number = Date.now()): void {
    this.s.promptDepth = Math.max(0, this.s.promptDepth - 1);
    if (this.s.promptDepth === 0) {
      this.s.promptKind = null;
      this.s.phase = this.s.prevPhase === "idle" ? "idle" : "working";
    }
    this.activity(now);
  }

  /** after_provider_response:status >= 400 激活错误态;2xx 清除。 */
  providerStatus(status: number, now: number = Date.now()): void {
    if (status >= 400) {
      this.s.lastError = { status, at: now };
      this.s.errorActive = true;
    } else if (status >= 200 && status < 300) {
      this.s.errorActive = false;
    }
    this.activity(now);
  }

  /** agent_end:底层 run 结束,可能自动重试/续跑,不回 idle(等 agent_settled)。 */
  agentEnd(now: number = Date.now()): void {
    this.activity(now);
  }

  /** agent_settled:彻底空闲。 */
  settled(now: number = Date.now()): void {
    this.s.errorActive = false;
    this.s.phase = "idle";
    this.activity(now);
  }

  // ---------- 查询 ----------

  get phase(): Phase {
    return this.s.phase;
  }

  get lastActivityAt(): number {
    return this.s.lastActivity;
  }

  snapshot(): Readonly<MachineSnapshot> {
    return this.s;
  }

  // ---------- 内部 ----------

  private fresh(now: number): MachineSnapshot {
    return {
      phase: "idle",
      prevPhase: "idle",
      toolName: null,
      promptKind: null,
      promptDepth: 0,
      lastActivity: now,
      lastError: null,
      errorActive: false,
    };
  }

  private activity(now: number): void {
    this.s.lastActivity = now;
  }
}
