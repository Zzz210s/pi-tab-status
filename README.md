# pi-tab-status

[pi coding agent](https://github.com/earendil-works/pi-coding-agent) 的终端标签页状态扩展:在"原来的"标签标识前加状态字形(生成中/执行工具/等待确认/疑似卡住/出错/空闲),并同步 Windows 任务栏进度。

## 目录

- [背景](#背景)
- [安装](#安装)
- [使用](#使用)
- [配置](#配置)
- [状态一览](#状态一览)
- [架构](#架构)
- [开发](#开发)

## 背景

在 Windows 终端(Cmder / Windows Terminal)里跑多个 pi 会话时,无法从标签页一眼判断每个会话的状态:是在跑、在等确认、出错重试,还是已经完成。本扩展在标签标题前加状态字形,状态一目了然;标题其余部分保持"原来的样子"(启动 shell 的标识,如 Windows PowerShell)。

设计上刻意**不做旋转动画**:标题完全静态,仅在状态切换时写入——高频重写标题(如 Claude Code 的 80-120ms 旋转帧)在 Cmder(ConEmu)实际测试中会触发标签渲染冻结,重启终端才能恢复。工作状态的视觉信号由任务栏进度(OSC 9;4 不确定态动画,ConEmu 原生渲染)承担。

## 安装

依赖:Node >= 24(pi 扩展加载与单测依赖原生 TS 类型剥离),[pi coding agent](https://github.com/earendil-works/pi-coding-agent) 已安装。

```bash
git clone https://github.com/Zzz210s/pi-tab-status.git ~/pi-tab-status
bash ~/pi-tab-status/setup.sh
```

重启 pi(或在 pi 内执行 /reload)后生效。若你用自己的 dotfiles/配置仓库管理 pi 扩展,也可以在部署脚本里调用本仓库的 `setup.sh`(幂等)。

## 使用

扩展自动激活,无需任何操作。标签页标题 = 状态字形 + shell 标识(以 PowerShell 启动为例):

- `· Windows PowerShell`:空闲(会话刚启动/重载,立即可见)
- `◑ Windows PowerShell`:模型生成中(静态字形;任务栏进度条滚动)
- `● Windows PowerShell (bash)`:正在执行工具
- `‖ Windows PowerShell (confirm)`:等待用户确认/输入(permission-gate 等扩展弹框时)
- `? Windows PowerShell (no activity)`:疑似卡住(超过阈值无任何事件;可附 `, HTTP 429`)
- `× Windows PowerShell (HTTP 429)`:provider 请求失败,任务栏进度变红
- 退出 pi 时恢复纯标识 `Windows PowerShell`

同时:

- Cmder(ConEmu)标题栏与 Windows Terminal 任务栏显示进度:工作时不确定态滚动、等待用户暂停、出错变红、空闲清除
- 在 Warp 终端中本扩展自动让位(由 [pi-warp](https://github.com/capyup/pi-warp) 接管);管道/RPC 模式(非 TTY)不激活

## 配置

全部通过环境变量,无需配置文件:

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PI_TAB_STATUS_STALL_MS` | `15000`(15 秒) | 卡住判定阈值:工作/工具态下超过该时长无任何事件即显示 `?` |
| `PI_TAB_STATUS_BASE` | 自动探测 | 标题基础文本;默认按启动环境探测(Windows PowerShell / Git Bash / bash) |
| `PI_TAB_STATUS_TICK_MS` | `250` | 状态检查周期(仅影响状态切换延迟,不影响写入频率) |
| `PI_TAB_STATUS_PROGRESS` | 启用 | 设为 `0` 关闭 OSC 进度写入,仅保留标题 |
| `PI_TAB_STATUS` | 启用 | 设为 `0` 完全关闭扩展 |
| `PI_TAB_STATUS_DEBUG` | 关闭 | 设为 `1`(或 touch `~/.pi/agent/tab-status-debug`)开启文件日志排查问题 |

注意:请保持 pi 内置设置 `terminal.showTerminalProgress` 为关闭(默认即关),进度序列由本扩展全权管理,避免双重写入。

## 状态一览

| 状态 | 触发(pi 事件) | 标题字形 | OSC 进度 |
| --- | --- | --- | --- |
| 空闲/完成 | `agent_settled` / `session_start` | `·` | 清除(0) |
| 生成中 | `agent_start` / `message_update` | `◑`(静态) | 不确定(3) |
| 执行工具 | `tool_execution_start` | `●` + 工具名 | 不确定(3) |
| 等待用户 | `ui_prompt_start` / `ui_prompt_end` | `‖` + 提示类型 | 暂停(4) |
| 疑似卡住 | 超阈值无事件(派生) | `?` | 不确定(3) |
| 请求出错 | `after_provider_response` status >= 400 | `×` + 状态码 | 错误(2) |

优先级:等待用户 > 疑似卡住 > 出错 > 执行工具 > 生成中 > 空闲。卡住与出错可以叠加显示(`? ... (no activity, HTTP 429)`)。

## 架构

五个模块,纯逻辑与副作用分离(与 chrome-dev / codegraph 扩展同风格):

- `extensions/tab-status/state.ts` — 纯状态机:pi 事件归约为相位(idle/working/tool/waiting),维护活动时间戳与错误上下文。零 pi 依赖,可单测。
- `extensions/tab-status/view.ts` — 有效视图派生:相位 + 时间 -> 渲染视图;卡住态不落状态机、按活动时间派生,新事件到来自动恢复;含优先级判定。
- `extensions/tab-status/render.ts` — 纯渲染:视图转标题字符串、shell 标识探测、OSC 进度序列。字形全部为非 emoji 等宽字符,无动画。
- `extensions/tab-status/debug.ts` — 文件式调试日志(开关:touch `~/.pi/agent/tab-status-debug`)。
- `extensions/tab-status.ts` — 入口:环境守卫(非 TTY/Warp/显式关闭)、事件接线、单一低频 ticker(标题字符串变化才写,进度仅状态切换时写);标题/进度直写 stdout(与 pi-tui 同路径,不经过 ctx.ui 链);tick 全程 try/catch。

关键取舍(基于对同类开源项目的调研与实测):

- **复刻 Claude Code 的 OSC 0 标题驱动**,而非外部监视(herdr/tmux 方案):Windows Terminal 与 Cmder 均无外部读取标签页标题的 API,进程内驱动是 Windows 上唯一可行路径。
- **不做旋转动画**:实测 Cmder(ConEmu)在持续高频 OSC 0 下标签渲染会冻结(重启才恢复),静态标题 + 任务栏进度动画是稳妥组合;Claude 的动画在 WT/Ghostty 等现代终端无此问题,若主力终端切换可恢复动画(改 render 即可)。
- **卡住检测用进程内事件时间戳**而非轮询会话文件(tmux 插件方案):零延迟零 IO;`before_provider_request` 计为活动(请求等待首字节不算卡),provider 重试退避期间保留错误显示。
- **权限等待直接用 pi 的 `ui_prompt_start` 事件**:无需桥接或修改 permission-gate 等扩展,任何扩展弹框都会触发。

## 开发

```bash
npm test          # node --test,24 个用例(状态机 + 视图 + 渲染)
npm run smoke     # 入口端到端冒烟:mock pi 走完整事件周期,打印标题时间线
bash setup.sh --test   # 单测通过后部署到 ~/.pi/agent/extensions/
```

部署目标:`~/.pi/agent/extensions/tab-status.ts`(入口)与 `~/.pi/agent/extensions/tab-status/`(模块)。修改后 `/reload` 即可热加载。

排查"标题无变化":touch `~/.pi/agent/tab-status-debug` 后重载,复现问题,读 `~/.pi/agent/tab-status-debug.log`(每次标题写入/异常都有记录;若日志在写而标签不动,是终端侧渲染问题,重启终端标签)。

调整阈值示例:长编译较多的项目里把卡住阈值放大到 10 分钟:

```bash
export PI_TAB_STATUS_STALL_MS=600000
```

## License

[MIT](LICENSE)
