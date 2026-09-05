# pi-tab-status

**[English](./README.md) | 简体中文**

[pi coding agent](https://github.com/earendil-works/pi-coding-agent) 的标签页标题 + 任务栏进度扩展:**标签标题固定显示当前会话名**(不再随状态跳动),活动状态经 Windows 任务栏进度呈现。

## 目录

- [背景](#背景)
- [安装](#安装)
- [使用](#使用)
- [配置](#配置)
- [状态一览](#状态一览)
- [架构](#架构)
- [开发](#开发)

## 背景

在 Windows 终端(Cmder / Windows Terminal)里跑多个 pi 会话时,需要能一眼认出"这个标签是哪个会话"。本扩展让标签页标题**静态显示会话名**(用 `/name` 起名,未命名则显示启动 shell 的标识),标题在整个会话中不随内部状态变化——只有重命名时才更新,彻底规避高频标题写入(实测 Cmder 偶发渲染冻结)与状态闪烁。

活动状态交给 **Windows 任务栏进度**(OSC 9;4,ConEmu 协议):生成/执行工具/疑似卡住时滚动,等你确认时暂停,请求出错变红,完成清除——不占用标签页标题,信息不丢。

## 安装

依赖:Node >= 24(pi 扩展加载与单测依赖原生 TS 类型剥离),[pi coding agent](https://github.com/earendil-works/pi-coding-agent) 已安装。

```bash
git clone https://github.com/Zzz210s/pi-tab-status.git ~/pi-tab-status
bash ~/pi-tab-status/setup.sh
```

重启 pi(或 pi 内 `/reload`)后生效。若你用自己的 dotfiles/配置仓库统一管理 pi 扩展,可在部署脚本里调用本仓库的 `setup.sh`(幂等)。

## 使用

扩展自动激活。**标签页标题 = 当前会话名**(未命名则回退启动 shell 标识,如 `Windows PowerShell`):

1. 给会话起名:pi 内执行 `/name 会话名`(或扩展 API `setSessionName`)——**标题立即更新为该名**,此后不再变化
2. 活动状态看任务栏:工作滚动、等你确认暂停、出错红、空闲清除
3. 退出 pi:标题恢复 shell 标识

> 会话名也会显示在 pi 的会话选择器里,替代首条消息。

## 配置

全部环境变量,无配置文件:

| 变量 | 默认 | 说明 |
|---|---|---|
| `PI_TAB_STATUS_BASE` | 自动探测 | 无会话名时的标题文本(默认按启动环境:Windows PowerShell / Git Bash / bash) |
| `PI_TAB_STATUS_STALL_MS` | `15000` | 卡住判定阈值:工作/工具期间超过此时长无事件,进度按"疑似卡住"(仍滚动)处理 |
| `PI_TAB_STATUS_PROGRESS` | `on` | `0` 关闭 OSC 进度写入(仅保留标题) |
| `PI_TAB_STATUS` | `on` | `0` 整体关闭扩展 |
| `PI_TAB_STATUS_DEBUG` | `off` | `1`(或 touch `~/.pi/agent/tab-status-debug`)开启文件日志排查 |

## 状态一览

| 状态 | 触发(pi 事件) | 标签页标题 | 任务栏进度(OSC 9;4) |
|---|---|---|---|
| 空闲/完成 | agent_settled / session_start | 不变(会话名) | 清除(0) |
| 生成中 | agent_start / message_* | 不变(会话名) | indeterminate(3)滚动 |
| 工具执行 | tool_execution_* | 不变(会话名) | indeterminate(3)滚动 |
| 等待用户 | ui_prompt_start | 不变(会话名) | paused(4)暂停 |
| 疑似卡住 | 超阈值无事件(派生) | 不变(会话名) | indeterminate(3)滚动 |
| 请求出错 | after_provider_response >= 400 | 不变(会话名) | error(2)变红 |
| 会话更名 | /name、RPC 或 setSessionName | **更新为新会话名**(唯一变化时机) | 不变 |

优先级(进度判定):waiting > error > stalled > tool > working > idle。

## 架构

五个模块,纯逻辑与副作用分离:

- `extensions/tab-status.ts` — 入口:环境守卫(非 TTY/Warp/显式关闭)、标题写入(仅 session_start / session_info_changed 两次)、事件接线(状态机驱动进度);标题/进度直写 stdout(与 pi-tui 同路径),事件处理全程 try/catch
- `extensions/tab-status/state.ts` — 纯状态机:pi 事件归约为 idle/working/tool/waiting 相位,跟踪活动时间戳与错误上下文(零 pi 依赖,可单测)
- `extensions/tab-status/view.ts` — 有效视图派生:卡住由活动时间派生(新事件自动恢复),优先级归约
- `extensions/tab-status/render.ts` — 纯渲染:shell 标识探测 + OSC 9;4 进度序列(无字形/无动画——标题静态是本设计的核心)
- `extensions/tab-status/debug.ts` — 文件式调试日志(touch `~/.pi/agent/tab-status-debug`)

设计取舍:
- **标题静态 + 任务栏动态**:避免 Cmder 在高频标题更新下的渲染冻结(实测重启恢复);同时不丢失活动可视性
- **会话名即身份**:多开场景按名认窗口,与 pi 会话选择器共用同一名字体系
- 状态机仍保留卡住/错误上下文,供进度语义与未来扩展用

## 开发

```bash
npm test                 # node --test:state + render 单测
npm run smoke            # 端到端冒烟:mock pi 走完整生命周期,断言标题静态与进度切换
bash setup.sh --test     # 测试通过后部署到 ~/.pi/agent/extensions/
```

部署目标:`~/.pi/agent/extensions/tab-status.ts`(入口)+ `tab-status/`(模块)。修改后 `/reload` 热加载。

排查"标题不对":touch `~/.pi/agent/tab-status-debug` → reload → 复现 → 读 `~/.pi/agent/tab-status-debug.log`(每次标题/进度写入与异常都记录;若日志在写但标签不动,是终端侧渲染问题,重启标签)。
