// render.test.js — 渲染层单测(字形/旋转帧/闪烁帧/标题渲染 + 进度)。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderTitle, spinnerFrame, blinkFrame, shellTitle, progressStateFor, progressSequence,
  SPINNER_FRAMES, BLINK_FRAMES, GLYPH,
} from "./render.ts";

const BASE = "my-session"; // 标题主文本 = 会话名(命名固定)
const SPIN = 120;
const BLINK = 600;

test('shellTitle:按启动环境探测(Git Bash > bash > PowerShell)', () => {
  assert.equal(shellTitle({ MSYSTEM: "MINGW64" }), "Git Bash");
  assert.equal(shellTitle({ SHELL: "/usr/bin/bash" }), "bash");
  assert.equal(shellTitle({}), "Windows PowerShell");
});

test('spinnerFrame 按挂钟轮换且覆盖全部帧', () => {
  const seen = new Set();
  for (let i = 0; i < SPINNER_FRAMES.length * 3; i++) {
    const f = spinnerFrame(i * SPIN, SPIN);
    assert.ok(SPINNER_FRAMES.includes(f));
    seen.add(f);
  }
  assert.equal(seen.size, SPINNER_FRAMES.length);
});

test('blinkFrame 按挂钟交替下划线/空格(同宽不抖)', () => {
  assert.equal(blinkFrame(0, BLINK), '_');
  assert.equal(blinkFrame(BLINK, BLINK), ' ');
  assert.equal(blinkFrame(BLINK * 2, BLINK), '_');
});

test('renderTitle:idle/tool/stalled/error 字形 + 会话名', () => {
  assert.equal(renderTitle({ kind: 'idle' }, BASE, 0, SPIN, BLINK), `· ${BASE}`);
  assert.equal(renderTitle({ kind: 'tool', tool: 'bash' }, BASE, 0, SPIN, BLINK), `▸ ${BASE} (bash)`);
  assert.equal(renderTitle({ kind: 'stalled' }, BASE, 0, SPIN, BLINK), `? ${BASE} (no activity)`);
  assert.equal(renderTitle({ kind: 'stalled', httpStatus: 429 }, BASE, 0, SPIN, BLINK), `? ${BASE} (no activity, HTTP 429)`);
  assert.equal(renderTitle({ kind: 'error', httpStatus: 429 }, BASE, 0, SPIN, BLINK), `× ${BASE} (HTTP 429)`);
});

test('renderTitle:working 按时刻轮换帧,waiting 按时刻闪烁', () => {
  const a = renderTitle({ kind: 'working' }, BASE, 0, SPIN, BLINK);
  const b = renderTitle({ kind: 'working' }, BASE, SPIN * 2, SPIN, BLINK); // 前进 2 帧
  assert.ok(a.startsWith('◐') || a.startsWith('◓') || a.startsWith('◑') || a.startsWith('◒'));
  assert.notEqual(a, b); // 不同时刻帧不同(标题会动)
  assert.ok(a.endsWith(BASE)); // 命名部分固定不变

  const w1 = renderTitle({ kind: 'waiting', promptKind: 'confirm' }, BASE, 0, SPIN, BLINK);
  const w2 = renderTitle({ kind: 'waiting', promptKind: 'confirm' }, BASE, BLINK, SPIN, BLINK);
  assert.equal(w1, `_ ${BASE} (confirm)`);
  assert.equal(w2, `  ${BASE} (confirm)`);
});

test('字形为非 emoji 等宽字符(视觉干净)', () => {
  const all = [...SPINNER_FRAMES, ...BLINK_FRAMES, GLYPH.tool, GLYPH.stalled, GLYPH.error, GLYPH.idle].join('');
  assert.ok(!/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(all), '不应含 emoji');
});

test('progressStateFor:idle->0,waiting->4,error->2,其余->3', () => {
  assert.equal(progressStateFor({ kind: 'idle' }), 0);
  assert.equal(progressStateFor({ kind: 'waiting', promptKind: 'confirm' }), 4);
  assert.equal(progressStateFor({ kind: 'error', httpStatus: 429 }), 2);
  assert.equal(progressStateFor({ kind: 'working' }), 3);
  assert.equal(progressStateFor({ kind: 'tool', tool: 'bash' }), 3);
  assert.equal(progressStateFor({ kind: 'stalled' }), 3);
});

test('progressSequence:4 种状态各输出对应 OSC 9;4 序列', () => {
  assert.equal(progressSequence(0), '\x1b]9;4;0\x1b\\');
  assert.equal(progressSequence(2), '\x1b]9;4;2\x1b\\');
  assert.equal(progressSequence(3), '\x1b]9;4;3\x1b\\');
  assert.equal(progressSequence(4), '\x1b]9;4;4\x1b\\');
});
