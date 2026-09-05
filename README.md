# pi-tab-status

**English | [简体中文](./README.zh-CN.md)**

A terminal extension for the [pi coding agent](https://github.com/earendil-works/pi-coding-agent) that pins the tab title to the **current session name** (static — no per-state flicker) and mirrors activity to the Windows taskbar via OSC 9;4 progress.

## Contents

- [Background](#background)
- [Install](#install)
- [Usage](#usage)
- [Configuration](#configuration)
- [Status Reference](#status-reference)
- [Architecture](#architecture)
- [Development](#development)

## Background

When running several pi sessions in Windows terminals (Cmder / Windows Terminal), you want to tell at a glance which tab is which session. This extension pins the tab title to the **session name** (set via `/name`; unnamed sessions fall back to the launching shell's label, e.g. `Windows PowerShell`). The title stays static for the whole session — it only changes when you rename the session — which also sidesteps high-frequency title writes (Cmder tab rendering occasionally freezes under them; a restart recovers) and eliminates flicker.

Activity still gets surfaced through the **Windows taskbar progress** (OSC 9;4, ConEmu protocol): scrolling while generating / running a tool / possibly stalled, paused while waiting for you, red on request error, cleared when idle — full visibility without touching the title.

## Install

Requirements: Node >= 24 (extension loading and unit tests rely on native TS type stripping) and the [pi coding agent](https://github.com/earendil-works/pi-coding-agent) installed.

```bash
git clone https://github.com/Zzz210s/pi-tab-status.git ~/pi-tab-status
bash ~/pi-tab-status/setup.sh
```

Restart pi (or run `/reload` inside pi) to activate. If you manage pi extensions via your own dotfiles/config repo, call this repo's `setup.sh` from your deploy script (idempotent).

## Usage

The extension activates automatically. **Tab title = current session name** (falls back to the shell label when unnamed):

1. Name the session: run `/name <name>` in pi (or `setSessionName` via the API) — the title updates immediately and then stays fixed
2. Watch the taskbar for activity: scrolling while working, paused while waiting for you, red on error, cleared when idle
3. On pi exit the title reverts to the shell label

> The session name also appears in pi's session selector, replacing the first message.

## Configuration

All via environment variables, no config file:

| Variable | Default | Description |
|---|---|---|
| `PI_TAB_STATUS_BASE` | auto | Title text when the session has no name (detected from the launching shell: Windows PowerShell / Git Bash / bash) |
| `PI_TAB_STATUS_STALL_MS` | `15000` | Stall threshold: no events for this long while working/tooling marks progress as "possibly stalled" (still scrolling) |
| `PI_TAB_STATUS_PROGRESS` | `on` | `0` disables OSC progress writes, keeping only the title |
| `PI_TAB_STATUS` | `on` | `0` disables the extension entirely |
| `PI_TAB_STATUS_DEBUG` | `off` | `1` (or `touch ~/.pi/agent/tab-status-debug`) enables a file log for troubleshooting |

## Status Reference

| State | Trigger (pi event) | Tab title | Taskbar progress (OSC 9;4) |
|---|---|---|---|
| idle / done | agent_settled / session_start | unchanged (session name) | clear (0) |
| generating | agent_start / message_* | unchanged (session name) | indeterminate (3) scrolling |
| tool running | tool_execution_* | unchanged (session name) | indeterminate (3) scrolling |
| waiting for user | ui_prompt_start | unchanged (session name) | paused (4) |
| possibly stalled | no events past threshold (derived) | unchanged (session name) | indeterminate (3) scrolling |
| request error | after_provider_response >= 400 | unchanged (session name) | error (2) red |
| session renamed | /name, RPC, or setSessionName | **updates to the new name** (the only change) | unchanged |

Progress priority: waiting > error > stalled > tool > working > idle.

## Architecture

Five modules, pure logic separated from side effects:

- `extensions/tab-status.ts` — entry: environment guards (non-TTY / Warp / explicit off), title writes (only on `session_start` and `session_info_changed`), event wiring driving the progress state machine; title/progress write straight to stdout (same channel as pi-tui), every handler wrapped in try/catch
- `extensions/tab-status/state.ts` — pure state machine: reduces pi events into idle/working/tool/waiting phases, tracks activity timestamps and error context (zero pi dependencies, unit-testable)
- `extensions/tab-status/view.ts` — effective-view derivation: stalled is derived from activity time (a new event recovers automatically); owns priority resolution
- `extensions/tab-status/render.ts` — pure rendering: shell-label detection + OSC 9;4 progress sequences (no glyphs, no animation — the static title is the point)
- `extensions/tab-status/debug.ts` — file-based debug log (toggle: `touch ~/.pi/agent/tab-status-debug`)

Design trade-offs:
- **Static title + dynamic taskbar**: avoids Cmder's rendering freeze under high-frequency title updates (measured; recovery = terminal restart) without losing activity visibility
- **Session name as identity**: in multi-window setups you recognize windows by name, sharing the same naming scheme as pi's session selector
- The state machine still tracks stall/error context for progress semantics and future use

## Development

```bash
npm test                 # node --test: state + render unit tests
npm run smoke            # end-to-end smoke: mock pi walks a full lifecycle, asserts static title + progress transitions
bash setup.sh --test     # deploy to ~/.pi/agent/extensions/ after tests pass
```

Deployment targets: `~/.pi/agent/extensions/tab-status.ts` (entry) and `~/.pi/agent/extensions/tab-status/` (modules). After changes, `/reload` hot-reloads.

Troubleshooting "the title is wrong": `touch ~/.pi/agent/tab-status-debug`, reload, reproduce, then read `~/.pi/agent/tab-status-debug.log` (every title/progress write and exception is logged; if the log is writing but the tab does not move, it is terminal-side rendering — restart the tab).
