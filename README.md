# pi-tab-status

**English | [简体中文](./README.zh-CN.md)**

A terminal tab-status extension for the [pi coding agent](https://github.com/earendil-works/pi-coding-agent): prepends a status glyph to your "original" tab title (generating / running a tool / waiting for confirmation / possibly stalled / error / idle) and mirrors progress to the Windows taskbar.

## Contents

- [Background](#background)
- [Install](#install)
- [Usage](#usage)
- [Configuration](#configuration)
- [Status Reference](#status-reference)
- [Architecture](#architecture)
- [Development](#development)

## Background

Running multiple pi sessions in Windows terminals (Cmder / Windows Terminal), you cannot tell from the tab strip what each session is doing: running, waiting for confirmation, retrying after an error, or done. This extension prefixes the tab title with a status glyph while leaving the rest of the title as-is (the launching shell's label, e.g. Windows PowerShell).

The generating state uses fixed-width rotating frames (◐◓◑◒, Claude Code style) to convey "thinking". If your terminal's tab rendering misbehaves under high-frequency title updates (Cmder occasionally freezes; restarting the terminal recovers), raise the frame interval via `PI_TAB_STATUS_SPINNER_MS`.

## Install

Requirements: Node >= 24 (extension loading and unit tests rely on native TS type stripping) and the [pi coding agent](https://github.com/earendil-works/pi-coding-agent) installed.

```bash
git clone https://github.com/Zzz210s/pi-tab-status.git ~/pi-tab-status
bash ~/pi-tab-status/setup.sh
```

Restart pi (or run /reload inside pi) to activate. If you manage pi extensions via your own dotfiles/config repo, call this repo's `setup.sh` from your deploy script (idempotent).

## Usage

The extension activates automatically. Tab title = status glyph + shell label (PowerShell example):

- `· Windows PowerShell`: idle (fresh session/reload, visible immediately)
- Rotating half-circle glyphs (`◐◓◑◒`) + `Windows PowerShell`: model generating; taskbar progress scrolls in sync
- A blinking underscore (`_` flashing on/off, terminal-cursor style) + `Windows PowerShell (confirm)`: waiting for user confirmation/input (e.g. permission-gate dialogs)
- `▸ Windows PowerShell (bash)`: a tool is executing (triangle = "executing", distinct from the spinner)
- `? Windows PowerShell (no activity)`: possibly stalled (no events beyond a threshold; may append `, HTTP 429`)
- `× Windows PowerShell (HTTP 429)`: provider request failed; taskbar progress turns red
- On pi exit the title reverts to the plain shell label

Also:

- Cmder (ConEmu) title bar and Windows Terminal taskbar show progress: indeterminate while working, paused while waiting for the user, red on error, cleared when idle
- In Warp the extension steps aside automatically ([pi-warp](https://github.com/capyup/pi-warp) takes over); pipe/RPC mode (non-TTY) never activates

## Configuration

All via environment variables, no config file:

| Variable | Default | Description |
| --- | --- | --- |
| `PI_TAB_STATUS_STALL_MS` | `15000` | Stall threshold: no events for this long while working/tooling shows `?` |
| `PI_TAB_STATUS_BASE` | auto | Base title text; detected from the launching environment (Windows PowerShell / Git Bash / bash) |
| `PI_TAB_STATUS_SPINNER_MS` | `120` | Spinner frame interval (ms); also the status-check period |
| `PI_TAB_STATUS_BLINK_MS` | `600` | Waiting-state blink interval (underscore/space alternate, same width) |
| `PI_TAB_STATUS_PROGRESS` | on | `0` disables OSC progress writes, keeping only the title |
| `PI_TAB_STATUS` | on | `0` disables the extension entirely |
| `PI_TAB_STATUS_DEBUG` | off | `1` (or touch `~/.pi/agent/tab-status-debug`) enables a file log for troubleshooting |

Note: keep pi's built-in `terminal.showTerminalProgress` off (default) - this extension owns the progress sequences and double writes must be avoided.

## Status Reference

| State | Trigger (pi event) | Title glyph | OSC progress |
| --- | --- | --- | --- |
| idle / done | `agent_settled` / `session_start` | `·` | clear (0) |
| generating | `agent_start` / `message_update` | `◐◓◑◒` spin | indeterminate (3) |
| tool running | `tool_execution_start` | `▸` + tool name | indeterminate (3) |
| waiting for user | `ui_prompt_start` / `ui_prompt_end` | `_` blinking (alternates with a space) | paused (4) |
| possibly stalled | no events past threshold (derived) | `?` | indeterminate (3) |
| request error | `after_provider_response` status >= 400 | `×` + status code | error (2) |

Priority: waiting for user > stalled > error > tool running > generating > idle. Stalled and error can combine (`? ... (no activity, HTTP 429)`).

## Architecture

Five modules, pure logic separated from side effects (same style as the chrome-dev / codegraph extensions):

- `extensions/tab-status/state.ts` - pure state machine: reduces pi events into phases (idle/working/tool/waiting), tracks activity timestamps and error context. Zero pi dependencies, unit-testable.
- `extensions/tab-status/view.ts` - effective-view derivation: phase + time -> render view; the stalled state is derived from activity time (not stored in the machine) so a new event recovers automatically; owns priority resolution.
- `extensions/tab-status/render.ts` - pure rendering: view -> title string, spinner frames, blink frames, shell-label detection, OSC progress sequences. All glyphs are non-emoji monospace characters.
- `extensions/tab-status/debug.ts` - file-based debug log (toggle: touch `~/.pi/agent/tab-status-debug`).
- `extensions/tab-status.ts` - entry: environment guards (non-TTY/Warp/explicit off), event wiring, a single ticker (title written only when the string changes, progress only on state switches); title/progress write straight to stdout (same channel as pi-tui, bypassing the ctx.ui chain); every tick wrapped in try/catch.

Key trade-offs (from surveying and testing similar open-source projects):

- **No task summary, no external watcher**: the title stays "original shell label + status glyph"; external watchers (herdr/tmux approaches) have no API to read tab titles in Windows Terminal or Cmder, so in-process driving is the only viable path.
- **No rotating animation** (in the committed render): under sustained high-frequency OSC 0 writes, Cmder (ConEmu) tab rendering can freeze (recovery = restart); static title + taskbar animation is the safe combo. Claude-style animation is fine on modern terminals (WT/Ghostty); switching render is easy if your main terminal changes.
- **Stall detection uses in-process event timestamps** rather than polling session files (tmux-plugin style): zero latency, zero IO; `before_provider_request` counts as activity (waiting for first byte is not a stall), and the error display persists during provider retry backoff.

## Development

```bash
npm test          # node --test, 24 cases (state machine + view + render)
npm run smoke     # end-to-end entry smoke: mock pi walks a full event cycle, prints the title timeline
bash setup.sh --test   # deploy to ~/.pi/agent/extensions/ after tests pass
```

Deployment targets: `~/.pi/agent/extensions/tab-status.ts` (entry) and `~/.pi/agent/extensions/tab-status/` (modules). After changes, /reload hot-reloads.

Troubleshooting "the title never changes": touch `~/.pi/agent/tab-status-debug`, reload, reproduce, then read `~/.pi/agent/tab-status-debug.log` (every title write/exception is logged; if the log is writing but the tab does not move, it is terminal-side rendering - restart the tab).

Raising the threshold example: for compile-heavy projects, raise the stall threshold to 10 minutes:

```bash
export PI_TAB_STATUS_STALL_MS=600000
```

## License

[MIT](LICENSE)
