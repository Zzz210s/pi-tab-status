// render.test.js - 渲染单测(视图 -> 标题字符串/OSC 序列/shell 标识探测/旋转帧)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderTitle,
  progressStateFor,
  progressSequence,
  shellTitle,
  spinnerFrame,
  GLYPH,
  SPINNER_FRAMES,
} from './render.ts';

const BASE = 'Windows PowerShell';
const SPIN = 120;

test('shellTitle:按启动环境探测"原来的"标识', () => {
  assert.equal(shellTitle({ MSYSTEM: 'MINGW64' }), 'Git Bash');
  assert.equal(shellTitle({ SHELL: '/bin/bash' }), 'bash');
  assert.equal(shellTitle({}), 'Windows PowerShell');
});

test('spinnerFrame 按挂钟轮换且覆盖全部帧', () => {
  const seen = new Set();
  for (let i = 0; i < SPINNER_FRAMES.length * 3; i++) {
    const f = spinnerFrame(i * SPIN, SPIN);
    seen.add(f);
    assert.ok(SPINNER_FRAMES.includes(f));
  }
  assert.equal(seen.size, SPINNER_FRAMES.length);
});

test('idle 标题:中点前缀', () => {
  assert.equal(renderTitle({ kind: 'idle' }, BASE, 0, SPIN), `· ${BASE}`);
});

test('working 标题:旋转帧轮换(动态)', () => {
  const now = 5 * SPIN; // 第 5 帧 -> index 5 % 4 = 1 -> ◓
  assert.equal(renderTitle({ kind: 'working' }, BASE, now, SPIN), `◓ ${BASE}`);
  const now2 = 2 * SPIN; // index 2 -> ◑
  assert.equal(renderTitle({ kind: 'working' }, BASE, now2, SPIN), `◑ ${BASE}`);
});

test('tool 标题:实心三角 ▸ + 工具名', () => {
  assert.equal(renderTitle({ kind: 'tool', tool: 'bash' }, BASE, 0, SPIN), `▸ ${BASE} (bash)`);
});

test('waiting 标题:双竖线 + 提示类型', () => {
  assert.equal(renderTitle({ kind: 'waiting', promptKind: 'confirm' }, BASE, 0, SPIN), `‖ ${BASE} (confirm)`);
});

test('stalled 标题:问号 + no activity,可带 HTTP 上下文', () => {
  assert.equal(renderTitle({ kind: 'stalled' }, BASE, 0, SPIN), `? ${BASE} (no activity)`);
  assert.equal(renderTitle({ kind: 'stalled', httpStatus: 429 }, BASE, 0, SPIN), `? ${BASE} (no activity, HTTP 429)`);
});

test('error 标题:乘号 + HTTP 状态', () => {
  assert.equal(renderTitle({ kind: 'error', httpStatus: 429 }, BASE, 0, SPIN), `× ${BASE} (HTTP 429)`);
});

test('progressStateFor 全映射', () => {
  assert.equal(progressStateFor({ kind: 'working' }), 3);
  assert.equal(progressStateFor({ kind: 'tool', tool: 'x' }), 3);
  assert.equal(progressStateFor({ kind: 'stalled' }), 3);
  assert.equal(progressStateFor({ kind: 'waiting', promptKind: 'x' }), 4);
  assert.equal(progressStateFor({ kind: 'error', httpStatus: 500 }), 2);
  assert.equal(progressStateFor({ kind: 'idle' }), 0);
});

test('progressSequence 与 pi-tui 内置写法一致(仅状态,不带百分比)', () => {
  assert.equal(progressSequence(3), '\x1b]9;4;3\x07');
  assert.equal(progressSequence(0), '\x1b]9;4;0\x07');
});

test('所有输出字形均非 emoji(等宽几何/标点)', () => {
  const glyphs = [...SPINNER_FRAMES, ...Object.values(GLYPH)];
  for (const g of glyphs) {
    for (const ch of g) {
      const cp = ch.codePointAt(0);
      const isEmoji =
        (cp >= 0x1f000 && cp <= 0x1ffff) ||
        (cp >= 0x2600 && cp <= 0x27bf) ||
        cp === 0xfe0f || cp === 0x200d;
      assert.ok(!isEmoji, `字形 U+${cp.toString(16)} 不应落入 emoji 区`);
    }
  }
});
