// debug.ts - pi-tab-status 文件式调试日志。
// 开启:touch ~/.pi/agent/tab-status-debug(删除即关闭);或 env PI_TAB_STATUS_DEBUG=1。
// 日志:~/.pi/agent/tab-status-debug.log,每次 tick 的状态/标题/异常,
// 超 256KB 自动截断。排查"标题冻结/无变化"类问题的第一手证据。
import { existsSync, appendFileSync, statSync, truncateSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const DEBUG_FLAG = path.join(homedir(), ".pi", "agent", "tab-status-debug");
export const DEBUG_LOG = path.join(homedir(), ".pi", "agent", "tab-status-debug.log");

/** 调试是否开启(env 或文件触发)。 */
export function debugEnabled(): boolean {
  return process.env.PI_TAB_STATUS_DEBUG === "1" || existsSync(DEBUG_FLAG);
}

/** 追加一行日志;日志本身失败不影响主流程。 */
export function debugLog(msg: string): void {
  try {
    try {
      if (statSync(DEBUG_LOG).size > 256 * 1024) truncateSync(DEBUG_LOG);
    } catch {
      /* 首次无文件,正常 */
    }
    appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* 忽略 */
  }
}
