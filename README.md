# pi-tab-status

**English | [简体中文](./README.zh-CN.md)**

A terminal extension for the [pi coding agent](https://github.com/earendil-works/pi-coding-agent): the tab title shows **a status glyph + the session name** (glyph tracks activity, the name stays readable), with activity mirrored to the Windows taskbar via OSC 9;4 progress.

## Contents

- [Background](#background)
- [Install](#install)
- [Usage](#usage)
- [Configuration](#configuration)
- [Status Reference](#status-reference)
- [Architecture](#architecture)
- [Development](#development)

## Background

When running several pi sessions in Windows terminals (Cmder / Windows Terminal), you want to tell at a glance which tab is which session. This extension titles the tab with the **session name** (set via `/name`; unnamed sessions fall back to the launching shell's label, e.g. `Windows PowerShell`) prefixed by a **status glyph**:

- generating: rotating frames ◐◓◑◒ (120 ms, Claude Code style)
- waiting for you: blinking `_` (alternates with a space — terminal-cursor style)
- tool running: `▸` + tool name
- possibly stalled: `?` (no events past the threshold)
- request error: `×` (with HTTP status)
- idle / done: `·`

All glyphs are non-emoji monospace characters; rotating frames are equal width (no jitter). **The name part is fixed for the whole session** (it only changes when you rename) — recognize windows by name in multi-window setups, and let the glyph + taskbar carry the state.

If your terminal's tab rendering misbehaves under high-frequency title updates (Cmder occasionally freezes; restart recovers), raise `PI_TAB_STATUS_SPINNER_MS`.

## Install

Requirements: Node >= 24 (extension loading and unit tests rely on native TS type stripping) and the [pi coding agent](https://github.com/earendil-works/pi-coding-agent) installed.

```bash
git clone https://github.com/Zzz210s/pi-tab-status.git ~/pi-tab-status
bash ~/pi-tab-status/setup.sh
```

Restart pi (or run `/reload` inside pi) to activate. If you manage pi extensions via your own dotfiles/config repo, call this repo's `setup.sh` from your deploy script (idempotent).

## Usage

The extension activates automatically. **Tab title = {status glyph} session name** (unnamed sessions fall back to the shell label):

1. Name the session: run `/name <name>` in pi (or `setSessionName` via the API) — the title text updates immediately (glyph keeps tracking state)
2. Read the state at a glance: spinning while generating, `▸` while a tool runs, blinking `_` while waiting for you, `?` when possibly stalled, `×` on request error
3. Windows taskbar: scrolling while working, paused while waiting for you, red on error, cleared when idle
4. On pi exit the title reverts to the shell label

> The session name also appears in pi's session selector, replacing the first message.

## Configuration

All via environment variables, no config file:

| Variable | Default | Description |
|---|---|---|
| `PI_TAB_STATUS_BASE` | auto | Title text when the session has no name (detected from the launching shell: Windows PowerShell / Git Bash / bash) |
| `PI_TAB_STATUS_STALL_MS` | `15000` | Stall threshold: no events for this long while working/tooling shows `?` |
| `PI_TAB_STATUS_SPINNER_MS` | `120` | Spinner frame interval (ms); also the status-check period. Raise it if a terminal renders badly under fast title updates |
| `PI_TAB_STATUS_BLINK_MS` | `600` | Waiting-state blink interval (underscore/space alternate, same width) |
| `PI_TAB_STATUS_PROGRESS` | `on` | `0` disables OSC progress writes, keeping only the title |
| `PI_TAB_STATUS` | `on` | `0` disables the extension entirely |
| `PI_TAB_STATUS_DEBUG` | `off` | `1` (or `touch ~/.pi/agent/tab-status-debug`) enables a file log for troubleshooting |

## Status Reference

| State | Trigger (pi event) | Tab title | Taskbar progress (OSC 9;4) |
|---|---|---|---|
| idle / done | agent_settled / session_start | `· session-name` | clear (0) |
| generating | agent_start / message_* | `◐◓◑◒` spin + session-name | indeterminate (3) scrolling |
| tool running | tool_execution_* | `▸ session-name (tool)` | indeterminate (3) scrolling |
| waiting for user | ui_prompt_start | blinking `_` + session-name (confirm) | paused (4) |
| possibly stalled | no events past threshold (derived) | `? session-name (no activity)` | indeterminate (3) scrolling |
| request error | after_provider_response >= 400 | `× session-name (HTTP 429)` | error (2) red |
| session renamed | /name, RPC, or setSessionName | **title text updates to the new name** | unchanged |

Progress priority: waiting > error > stalled > tool > working > idle.

## Architecture

Five modules, pure logic separated from side effects:

- `extensions/tab-status.ts` — entry: environment guards (non-TTY / Warp / explicit off), title-render ticker (writes only when the title changes), event wiring driving the state machine and progress; title/progress write straight to stdout (same channel as pi-tui), tick and handlers wrapped in try/catch
- `extensions/tab-status/state.ts` — pure state machine: reduces pi events into idle/working/tool/waiting phases, tracks activity timestamps and error context (zero pi dependencies, unit-testable)
- `extensions/tab-status/view.ts` — effective-view derivation: stalled is derived from activity time (a new event recovers automatically); owns priority resolution
- `extensions/tab-status/render.ts` — pure rendering: glyphs (spinner frames / blink frames / status glyphs), shell-label detection, OSC 9;4 progress sequences
- `extensions/tab-status/debug.ts` — file-based debug log (toggle: `touch ~/.pi/agent/tab-status-debug`)

Design trade-offs:
- **Dynamic glyph + static name**: the status glyph tracks session activity; the name part stays fixed as the session name — recognize windows by name in multi-window setups without losing animation
- **Session name as identity**: title text is the session name, sharing the naming scheme with pi's session selector
- The state machine keeps stall/error context for glyph and progress semantics

## Development

```bash
npm test                 # node --test: state + render unit tests
npm run smoke            # end-to-end smoke: mock pi walks a full lifecycle, asserts glyph transitions + fixed name
bash setup.sh --test     # deploy to ~/.pi/agent/extensions/ after tests pass
```

Deployment targets: `~/.pi/agent/extensions/tab-status.ts` (entry) and `~/.pi/agent/extensions/tab-status/` (modules). After changes, `/reload` hot-reloads.

Troubleshooting "the title is wrong": `touch ~/.pi/agent/tab-status-debug`, reload, reproduce, then read `~/.pi/agent/tab-status-debug.log` (every title/progress write and exception is logged; if the log is writing but the tab does not move, it is terminal-side rendering — restart the tab).
