// render.ts — tab-status 渲染:shell 标识探测 + OSC 9;4 进度序列。
// 标题策略(静态):会话名优先,无则回退 shell 标识——由入口决定,这里只提供
// 基础文本与进度编码。纯函数,无副作用,node --test 单测。

export type { EffectiveView } from "./view.ts";

/**
 * 探测"启动 shell 的标识",作为无会话名时的标题回退(以及退出恢复文本)。
 * 判定优先级:MSYSTEM(Git Bash 环境) > SHELL(类 unix shell) > PowerShell。
 * 可用 PI_TAB_STATUS_BASE 环境变量整体覆盖(入口处理)。
 */
export function shellTitle(env: Record<string, string | undefined>): string {
  if (env.MSYSTEM) return "Git Bash";
  if (env.SHELL) return "bash";
  return "Windows PowerShell";
}

/**
 * 视图 -> OSC 9;4 进度状态(ConEmu 协议):
 * 0=清除 / 2=error(红) / 3=indeterminate(滚动) / 4=paused(暂停)。
 * waiting 最高优先:弹确认框时任务栏停住等用户;error 其次(请求失败变红);
 * 卡住/工具/生成中都是 indeterminate(持续滚动)。
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

/** OSC 9;4 序列:进度状态写入(ConEmu 标题栏横条 + Windows 任务栏)。 */
export function progressSequence(state: 0 | 2 | 3 | 4): string {
  return `\x1b]9;4;${state}\x1b\\`;
}
