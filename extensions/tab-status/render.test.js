// render.test.js — 渲染层单测(shell 标识探测 + OSC 9;4 进度状态/序列)。
import { test } from "node:test";
import assert from "node:assert/strict";
import { shellTitle, progressStateFor, progressSequence } from "./render.ts";

const BASE = "Windows PowerShell";

test('shellTitle:按启动环境探测(Git Bash > bash > PowerShell)', () => {
  assert.equal(shellTitle({ MSYSTEM: "MINGW64" }), "Git Bash");
  assert.equal(shellTitle({ MSYSTEM: "MINGW64", SHELL: "/usr/bin/bash" }), "Git Bash");
  assert.equal(shellTitle({ SHELL: "/usr/bin/bash" }), "bash");
  assert.equal(shellTitle({}), "Windows PowerShell");
  assert.equal(shellTitle({ PSModulePath: "C:\\Modules" }), "Windows PowerShell");
});

test('progressStateFor:idle -> 0,waiting -> 4,error -> 2,其余 -> 3', () => {
  assert.equal(progressStateFor({ kind: "idle" }), 0);
  assert.equal(progressStateFor({ kind: "waiting" }), 4);
  assert.equal(progressStateFor({ kind: "error", httpStatus: 429 }), 2);
  assert.equal(progressStateFor({ kind: "working", since: 0 }), 3);
  assert.equal(progressStateFor({ kind: "tool", tool: "bash" }), 3);
  assert.equal(progressStateFor({ kind: "stalled", silentFor: 1000 }), 3);
});

test('progressSequence:4 种状态各输出对应 OSC 9;4 序列', () => {
  assert.equal(progressSequence(0), '\x1b]9;4;0\x1b\\');
  assert.equal(progressSequence(2), '\x1b]9;4;2\x1b\\');
  assert.equal(progressSequence(3), '\x1b]9;4;3\x1b\\');
  assert.equal(progressSequence(4), '\x1b]9;4;4\x1b\\');
});

test('BASE 常量仅用于人类阅读(无逻辑依赖)', () => {
  assert.equal(typeof BASE, "string");
  assert.ok(BASE.length > 0);
});
