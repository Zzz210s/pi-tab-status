// render.test.js - 渲染单测(视图 -> 标题字符串/OSC 序列/shell 标识探测)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTitle, progressStateFor, progressSequence, shellTitle, GLYPH } from './render.ts';

const BASE = 'Windows PowerShell';

test('shellTitle:按启动环境探测"原来的"标识', () => {
  assert.equal(shellTitle({ MSYSTEM: 'MINGW64' }), 'Git Bash');
  assert.equal(shellTitle({ SHELL: '/bin/bash' }), 'bash');
  assert.equal(shellTitle({}), 'Windows PowerShell');
});

test('idle 标题:中点前缀', () => {
  assert.equal(renderTitle({ kind: 'idle' }, BASE), `· ${BASE}`);
});

test('working 标题:固定 ◑,静态不动画', () => {
  assert.equal(renderTitle({ kind: 'working' }, BASE), `◑ ${BASE}`);
});

test('tool 标题:实心圆 + 工具名', () => {
  assert.equal(renderTitle({ kind: 'tool', tool: 'bash' }, BASE), `● ${BASE} (bash)`);
});

test('waiting 标题:双竖线 + 提示类型', () => {
  assert.equal(renderTitle({ kind: 'waiting', promptKind: 'confirm' }, BASE), `‖ ${BASE} (confirm)`);
});

test('stalled 标题:问号 + no activity,可带 HTTP 上下文', () => {
  assert.equal(renderTitle({ kind: 'stalled' }, BASE), `? ${BASE} (no activity)`);
  assert.equal(renderTitle({ kind: 'stalled', httpStatus: 429 }, BASE), `? ${BASE} (no activity, HTTP 429)`);
});

test('error 标题:乘号 + HTTP 状态', () => {
  assert.equal(renderTitle({ kind: 'error', httpStatus: 429 }, BASE), `× ${BASE} (HTTP 429)`);
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
  for (const g of Object.values(GLYPH)) {
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
