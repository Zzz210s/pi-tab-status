# pi-tab-status

**[English](./README.md) | 简体中文**

[pi coding agent](https://github.com/earendil-works/pi-coding-agent) 的标签页标题 + 任务栏进度扩展:标题 = **状态字形 + 会话名**(字形随状态切换,命名固定可读),活动状态同步 Windows 任务栏进度。

## 目录

- [背景](#背景)
- [安装](#安装)
- [使用](#使用)
- [配置](#配置)
- [状态一览](#状态一览)
- [架构](#架构)
- [开发](#开发)

## 背景

在 Windows 终端(Cmder / Windows Terminal)里跑多个 pi 会话时,需要能一眼认出"这个标签是哪个会话"。本扩展让标签页标题**显示会话名**(用 `/name` 起名,未命名则显示启动 shell 的标识),前面带**状态字形**:

- 生成中:旋转帧 ◐◓◑◒ 轮换(120ms,Claude Code 同风格)
- 等待用户:`_` 闪烁(与空格同宽交替,终端光标式)
- 执行工具:`▸` + 工具名
- 疑似卡住:`?`(超阈值无事件)
- 请求出错:`×`(附 HTTP 状态)
- 空闲/完成:`·`

字形均为非 emoji 等宽字符,轮换同宽不抖;**命名部分全程固定**(仅重命名时更新)——多开窗口按名认会话,状态由字形 + 任务栏双通道呈现。

若终端标签渲染在高频标题更新下异常(实测 Cmder 偶发冻结,重启终端即恢复),调大 `PI_TAB_STATUS_SPINNER_MS` 帧间隔即可缓解。

## 安装

依赖:Node >= 24(pi 扩展加载与单测依赖原生 TS 类型剥离),[pi coding agent](https://github.com/earendil-works/pi-coding-agent) 已安装。

```bash
git clone https://github.com/Zzz210s/pi-tab-status.git ~/pi-tab-status
bash ~/pi-tab-status/setup.sh
```

重启 pi(或 pi 内 `/reload`)后生效。若你用自己的 dotfiles/配置仓库统一管理 pi 扩展,可在部署脚本里调用本仓库的 `setup.sh`(幂等)。

## 使用

扩展自动激活。**标签页标题 = {状态字形} 会话名**(未命名会话回退启动 shell 标识,如 `Windows PowerShell`):

1. 给会话起名:pi 内执行 `/name 会话名`(或扩展 API `setSessionName`)——标题主文本立即更新为该名(字形仍随状态动)
2. 状态一眼可见:生成中字形旋转、工具执行 `▸`、等确认 `_` 闪烁、卡住 `?`、出错 `×`
3. Windows 任务栏:工作滚动、等你确认暂停、出错红、空闲清除
4. 退出 pi:标题恢复 shell 标识

> 会话名也会显示在 pi 的会话选择器里,替代首条消息。

## 配置

全部环境变量,无配置文件:

| 变量 | 默认 | 说明 |
|---|---|---|
| `PI_TAB_STATUS_BASE` | 自动探测 | 无会话名时的标题主文本(默认按启动环境:Windows PowerShell / Git Bash / bash) |
| `PI_TAB_STATUS_STALL_MS` | `15000` | 卡住判定阈值:工作/工具期间超过此时长无事件,标题显 `?` |
| `PI_TAB_STATUS_SPINNER_MS` | `120` | 旋转帧间隔(也是状态检查周期);标签渲染异常时调大 |
| `PI_TAB_STATUS_BLINK_MS` | `600` | 等待态闪烁帧间隔(下划线/空格交替,同宽) |
| `PI_TAB_STATUS_PROGRESS` | `on` | `0` 关闭 OSC 进度写入(仅保留标题) |
| `PI_TAB_STATUS` | `on` | `0` 整体关闭扩展 |
| `PI_TAB_STATUS_DEBUG` | `off` | `1`(或 touch `~/.pi/agent/tab-status-debug`)开启文件日志排查 |

## 状态一览

| 状态 | 触发(pi 事件) | 标签页标题 | 任务栏进度(OSC 9;4) |
|---|---|---|---|
| 空闲/完成 | agent_settled / session_start | `· 会话名` | 清除(0) |
| 生成中 | agent_start / message_* | `◐◓◑◒` 轮换 + 会话名 | indeterminate(3)滚动 |
| 工具执行 | tool_execution_* | `▸ 会话名 (工具名)` | indeterminate(3)滚动 |
| 等待用户 | ui_prompt_start | `_` 闪烁 + 会话名 (confirm) | paused(4)暂停 |
| 疑似卡住 | 超阈值无事件(派生) | `? 会话名 (no activity)` | indeterminate(3)滚动 |
| 请求出错 | after_provider_response >= 400 | `× 会话名 (HTTP 429)` | error(2)变红 |
| 会话更名 | /name、RPC 或 setSessionName | **主文本更新为新会话名** | 不变 |

进度优先级:waiting > error > stalled > tool > working > idle。

## 架构

五个模块,纯逻辑与副作用分离:

- `extensions/tab-status.ts` — 入口:环境守卫(非 TTY/Warp/显式关闭)、标题渲染 ticker(仅标题变化才写)、事件接线驱动状态机与进度;标题/进度直写 stdout(与 pi-tui 同路径),tick 与事件全程 try/catch
- `extensions/tab-status/state.ts` — 纯状态机:pi 事件归约为 idle/working/tool/waiting 相位,跟踪活动时间戳与错误上下文(零 pi 依赖,可单测)
- `extensions/tab-status/view.ts` — 有效视图派生:卡住由活动时间派生(新事件自动恢复),优先级归约
- `extensions/tab-status/render.ts` — 纯渲染:字形(旋转帧/闪烁帧/状态字形)、shell 标识探测、OSC 9;4 进度序列
- `extensions/tab-status/debug.ts` — 文件式调试日志(touch `~/.pi/agent/tab-status-debug`)

设计取舍:
- **字形动态 + 命名静态**:状态字形随会话内状态切换,命名部分固定为会话名——多开认窗口不迷路,动画不丢
- **会话名即身份**:标题主文本为会话名,与 pi 会话选择器共用同一名字体系
- 状态机保留卡住/错误上下文,供字形与进度语义使用

## 开发

```bash
npm test                 # node --test:state + render 单测
npm run smoke            # 端到端冒烟:mock pi 走完整生命周期,断言字形切换 + 命名固定
bash setup.sh --test     # 测试通过后部署到 ~/.pi/agent/extensions/
```

部署目标:`~/.pi/agent/extensions/tab-status.ts`(入口)+ `tab-status/`(模块)。修改后 `/reload` 热加载。

排查"标题不对":touch `~/.pi/agent/tab-status-debug` → reload → 复现 → 读 `~/.pi/agent/tab-status-debug.log`(每次标题/进度写入与异常都记录;若日志在写但标签不动,是终端侧渲染问题,重启标签)。
