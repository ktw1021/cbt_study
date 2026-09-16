import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleTextDiff, remapVisiblePoint } from '../js/ui/chip-editor.js';

test('visibleTextDiff finds residual cur→next insert', () => {
  const patch = visibleTextDiff('abXcd', 'ab\nXcd');
  assert.equal(patch.start, 2);
  assert.equal(patch.end, 2);
  assert.equal(patch.inserted, '\n');
});

test('atom offsets remap once via cur→next diff (not stacked edit)', () => {
  const cur = 'abXcd';
  const next = 'ab\nXcd';
  const patch = visibleTextDiff(cur, next);
  const atom = { start: 2, end: 3 };
  const start = remapVisiblePoint(atom.start, patch.start, patch.end, patch.inserted.length);
  const end = remapVisiblePoint(atom.end, patch.start, patch.end, patch.inserted.length);
  assert.equal(start, 3);
  assert.equal(end, 4);
  let template = next;
  template = `${template.slice(0, start)}[[BLANK1]]${template.slice(end)}`;
  assert.equal(template, 'ab\n[[BLANK1]]cd');
});

test('visibleTextDiff noop when already canonical', () => {
  const patch = visibleTextDiff('가나다\n\n라', '가나다\n\n라');
  assert.equal(patch.inserted, '');
});

test('newline after a blank stays outside its answer', () => {
  const patch = visibleTextDiff('앞AB', '앞AB\n');
  const start = remapVisiblePoint(1, patch.start, patch.end, patch.inserted.length);
  const end = remapVisiblePoint(3, patch.start, patch.end, patch.inserted.length, 'left');
  const next = '앞AB\n';
  assert.equal(`${next.slice(0, start)}[[BLANK1]]${next.slice(end)}`, '앞[[BLANK1]]\n');
});
