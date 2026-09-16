import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addMark,
  applyTextEdit,
  clampRange,
  contentFingerprint,
  expandRangeToAtoms,
  lineRange,
  markAlignAt,
  mergeMarks,
  normalizeCardTextMeta,
  normalizeFootnotes,
  normalizeMarks,
  paragraphSpans,
  selectionEffectiveAlign,
  remapFootnotes,
  remapMarks,
  semanticFingerprint,
  footnoteNumbers,
  snapUtf16,
  toggleMark,
  visibleFromTemplate,
} from '../js/domain/text-marks.js';
import { renderMarkedHtml, renderTemplateHtml } from '../js/ui/mark-render.js';
import { migrateState } from '../js/domain/migrate.js';
import { migrateBlankAnswer } from '../js/domain/blank.js';

test('normalize drops invalid/missing metadata', () => {
  const text = 'abc';
  assert.deepEqual(normalizeMarks(undefined, text), []);
  assert.deepEqual(normalizeMarks([{ type: 'italic', start: 0, end: 1 }], text), []);
  assert.deepEqual(normalizeMarks([{ type: 'color', value: 'purple', start: 0, end: 2 }], text), []);
  assert.deepEqual(normalizeMarks([{ type: 'bold', start: 2, end: 1 }], text), [
    { type: 'bold', start: 1, end: 2 },
  ]);
  assert.deepEqual(normalizeMarks([{ type: 'bold', start: -4, end: 99 }], text), [
    { type: 'bold', start: 0, end: 3 },
  ]);
  const card = normalizeCardTextMeta({ displayText: 'x' });
  assert.deepEqual(card.textMarks, { display: [], explanation: [] });
  assert.deepEqual(card.footnotes, []);
});

test('UTF-16 combining letter is not NFC-shifted', () => {
  const text = 'e\u0301X'; // 3 code units; NFC would be 2
  assert.equal(text.length, 3);
  const marks = normalizeMarks([{ type: 'bold', start: 0, end: 2 }], text);
  assert.deepEqual(marks, [{ type: 'bold', start: 0, end: 2 }]);
  assert.equal(text.slice(marks[0].start, marks[0].end), 'e\u0301');
});

test('surrogate pair is not split', () => {
  const text = 'A😀B'; // 😀 = 2 units, length 4
  assert.equal(text.length, 4);
  assert.equal(snapUtf16(text, 2, 'start'), 1);
  assert.equal(snapUtf16(text, 2, 'end'), 3);
  const marks = normalizeMarks([{ type: 'hl', start: 2, end: 3 }], text);
  assert.equal(text.slice(marks[0].start, marks[0].end), '😀');
});

test('korean repeats, newlines, and clamp', () => {
  const text = '가나가나\n가나';
  const r = clampRange(2, 6, text.length);
  assert.equal(text.slice(r.start, r.end), '가나\n가');
  const bold = addMark([], { type: 'bold', start: 0, end: 2 }, { text });
  assert.deepEqual(bold, [{ type: 'bold', start: 0, end: 2 }]);
  assert.equal(text.slice(0, 2), '가나');
});

test('overlapping styles merge; colors last-wins', () => {
  const text = 'abcdefghij';
  const marks = mergeMarks([
    { type: 'bold', start: 0, end: 6 },
    { type: 'bold', start: 4, end: 8 },
    { type: 'hl', start: 2, end: 5 },
    { type: 'color', value: 'k', start: 0, end: 6 },
    { type: 'color', value: 'r', start: 3, end: 9 },
  ]);
  assert.deepEqual(marks.find((m) => m.type === 'bold'), { type: 'bold', start: 0, end: 8 });
  const red = marks.filter((m) => m.type === 'color');
  assert.equal(red.some((m) => m.value === 'r' && m.start === 3), true);
  assert.equal(red.every((m) => m.start < m.end), true);
});

test('toggle bold on/off and align snaps to lines', () => {
  const text = 'aa\nbb\ncc';
  const on = toggleMark([], { type: 'bold', start: 0, end: 2 }, { text });
  const off = toggleMark(on, { type: 'bold', start: 0, end: 2 }, { text });
  assert.deepEqual(off, []);
  const aligned = toggleMark([], { type: 'align', value: 'center', start: 3, end: 4 }, { text });
  assert.deepEqual(aligned, [{ type: 'align', start: 3, end: 5, value: 'center' }]);
  assert.equal(text.slice(3, 5), 'bb');
  assert.deepEqual(lineRange(text, 0, 1), { start: 0, end: 2 });
  assert.deepEqual(lineRange(text, 3, 3), { start: 3, end: 5 });
  assert.deepEqual(lineRange(text, 0, 3), { start: 0, end: 2 });
});

test('align addMark sets selected value and does not clear on repeat', () => {
  const text = 'aa\nbb';
  const a = addMark([], { type: 'align', value: 'center', start: 0, end: 1 }, { text });
  const b = addMark(a, { type: 'align', value: 'center', start: 0, end: 1 }, { text });
  assert.deepEqual(b, [{ type: 'align', start: 0, end: 2, value: 'center' }]);
  const c = addMark(b, { type: 'align', value: 'right', start: 0, end: 1 }, { text });
  assert.equal(c.find((m) => m.type === 'align')?.value, 'right');
  const two = addMark(c, { type: 'align', value: 'center', start: 3, end: 4 }, { text });
  const aligns = two.filter((m) => m.type === 'align');
  assert.equal(aligns.find((m) => m.value === 'right')?.end, 2);
  assert.equal(aligns.find((m) => m.value === 'center')?.start, 3);
});

test('effective align is left by default; mixed is empty; exclusive end stays on earlier paragraph', () => {
  const text = 'aa\nbb\ncc';
  assert.equal(markAlignAt([], 0, 'left'), 'left');
  assert.equal(selectionEffectiveAlign([], text, 0, 0), 'left');
  assert.equal(selectionEffectiveAlign([], text, 0, 8), 'left');
  const leftMark = [{ type: 'align', start: 0, end: 2, value: 'left' }];
  assert.equal(selectionEffectiveAlign(leftMark, text, 0, 2), 'left');
  assert.equal(selectionEffectiveAlign(leftMark, text, 0, 8), 'left');
  const mixed = [
    { type: 'align', start: 0, end: 2, value: 'center' },
    { type: 'align', start: 3, end: 5, value: 'right' },
  ];
  assert.equal(selectionEffectiveAlign(mixed, text, 0, 5), '');
  assert.equal(selectionEffectiveAlign(mixed, text, 0, 3), 'center');
  assert.deepEqual(lineRange(text, 0, 3), { start: 0, end: 2 });
});

test('paragraphSpans keeps empty and trailing lines; chips do not split', () => {
  assert.deepEqual(paragraphSpans('a\n\nc'), [[0, 1], [2, 2], [3, 4]]);
  assert.deepEqual(paragraphSpans('a\n'), [[0, 1], [2, 2]]);
  assert.deepEqual(paragraphSpans('앞가\n나뒤', [{ start: 1, end: 4 }]), [[0, 5]]);
});

test('typing after newline continues previous paragraph align', () => {
  const text = 'hello\n';
  const marks = [{ type: 'align', start: 0, end: 5, value: 'center' }];
  const next = applyTextEdit(text, { marks, footnotes: [] }, { start: 6, end: 6, inserted: 'x' }, { inherit: true });
  const al = next.marks.filter((m) => m.type === 'align' && m.value === 'center');
  assert.equal(al.some((m) => m.start <= 6 && m.end >= 7), true);
});

test('insert/delete remap keeps later offsets; insert splits marks', () => {
  const text = 'abcdefghij';
  const marks = [{ type: 'bold', start: 0, end: 10 }];
  const ins = applyTextEdit(text, { marks, footnotes: [] }, { start: 4, end: 4, inserted: 'XY' });
  assert.equal(ins.text, 'abcdXYefghij');
  assert.deepEqual(ins.marks, [
    { type: 'bold', start: 0, end: 4 },
    { type: 'bold', start: 6, end: 12 },
  ]);
  const del = applyTextEdit(text, { marks, footnotes: [] }, { start: 3, end: 7, inserted: '' });
  assert.equal(del.text, 'abchij');
  assert.deepEqual(del.marks, [{ type: 'bold', start: 0, end: 6 }]);
});

test('blank wrap does not go through remap (visible offsets stay)', () => {
  const visible = '하나 둘 셋';
  const marks = normalizeMarks([{ type: 'color', value: 'b', start: 3, end: 4 }], visible);
  const { visible: vis, tokens } = visibleFromTemplate('하나 [[BLANK1]] 셋', [
    { order: 1, answer: '둘' },
  ]);
  assert.equal(vis, visible);
  assert.equal(tokens[0].visStart, 3);
  assert.equal(tokens[0].visEnd, 4);
  assert.deepEqual(marks, [{ type: 'color', start: 3, end: 4, value: 'b' }]);
});

test('multiline blank answer is one visible atom', () => {
  const { visible, tokens } = visibleFromTemplate('앞[[BLANK1]]뒤', [
    { order: 1, answer: '가\n나' },
  ]);
  assert.equal(visible, '앞가\n나뒤');
  assert.equal(visible.length, 5);
  assert.deepEqual(tokens[0], {
    order: 1,
    tmplStart: 1,
    tmplEnd: 11,
    visStart: 1,
    visEnd: 4,
  });
});

test('partial range on chip expands to full atom', () => {
  const atoms = [{ start: 2, end: 6, order: 1 }];
  assert.deepEqual(expandRangeToAtoms(3, 4, atoms), { start: 2, end: 6 });
  const text = 'xxYYYY';
  const marks = toggleMark([], { type: 'hl', start: 3, end: 4 }, { text, atoms });
  assert.deepEqual(marks, [{ type: 'hl', start: 2, end: 6 }]);
});

test('footnote full delete pins body; partial shrinks; insert inside expands', () => {
  const fns = [{ id: 'n1', field: 'display', start: 2, end: 8, body: '이유' }];
  const gone = remapFootnotes(fns, { start: 2, end: 8, inserted: '' });
  assert.deepEqual(gone, [{ id: 'n1', field: 'display', start: 2, end: 2, body: '이유' }]);
  const shrink = remapFootnotes(fns, { start: 4, end: 6, inserted: '' });
  assert.equal(shrink[0].start, 2);
  assert.equal(shrink[0].end, 6);
  assert.equal(shrink[0].body, '이유');
  const grow = remapFootnotes(fns, { start: 5, end: 5, inserted: 'ZZ' });
  assert.deepEqual(grow[0], { id: 'n1', field: 'display', start: 2, end: 10, body: '이유' });
  const wiped = remapFootnotes(fns, { start: 0, end: 20, inserted: '' });
  assert.equal(wiped[0].start, 0);
  assert.equal(wiped[0].end, 0);
  assert.equal(wiped[0].body, '이유');
});

test('semantic fingerprint matches content when no meta; includes marks/fn without ids', () => {
  const card = {
    title: '제목',
    displayText: '문제',
    explanationText: '해설 [[BLANK1]]',
    blanks: [{ order: 1, answer: '답', aliases: ['동의', '답'] }],
  };
  assert.equal(semanticFingerprint(card), contentFingerprint(card));
  const withMeta = {
    ...card,
    textMarks: { display: [{ type: 'bold', start: 0, end: 2, id: 'ignore-me' }] },
    footnotes: [{ id: 'aaa', field: 'display', start: 0, end: 2, body: '메모아님' }],
  };
  const a = semanticFingerprint(withMeta);
  const b = semanticFingerprint({
    ...withMeta,
    footnotes: [{ id: 'zzz', field: 'display', start: 0, end: 2, body: '메모아님' }],
  });
  assert.equal(a, b);
  assert.notEqual(a, contentFingerprint(card));
});

test('escape malicious text; default atom/fn omit answers', () => {
  const evil = '<img src=x onerror="alert(1)">&"';
  const html = renderMarkedHtml(evil, { marks: [{ type: 'bold', start: 0, end: evil.length }] });
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('&lt;img'), true);
  assert.equal(html.includes('&quot;'), true);
  const secret = 'SECRET_ANSWER';
  const out = renderTemplateHtml(`보기 [[BLANK1]] 끝`, [{ order: 1, answer: secret }], {
    marks: [{ type: 'color', value: 'r', start: 3, end: 3 + secret.length }],
    footnotes: [{ field: 'explanation', start: 3, end: 3 + secret.length, body: '해설메모' }],
  });
  assert.equal(out.includes(secret), false);
  assert.equal(out.includes('title='), false);
  assert.match(out, /aria-label="각주 1"/);
  assert.match(out, /data-blank-order="1"/);
});

test('inline marks across empty paragraph keep both newlines', () => {
  const text = '가나다\n\n라마바';
  const html = renderMarkedHtml(text, {
    marks: [
      { type: 'bold', start: 0, end: 8 },
      { type: 'color', value: 'r', start: 0, end: 8 },
      { type: 'hl', start: 0, end: 8 },
    ],
  });
  const plain = html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
  assert.equal(plain, text);
  assert.equal((html.match(/<br/g) || []).length, 2);
  assert.equal(html.includes('tm-bold'), true);
  const aligned = renderMarkedHtml(text, {
    marks: [
      { type: 'bold', start: 0, end: 8 },
      { type: 'align', value: 'center', start: 0, end: 8 },
    ],
  });
  assert.equal((aligned.match(/tm-line/g) || []).length, 3);
  assert.equal(aligned.includes('<br'), false);
  assert.doesNotMatch(aligned, /tm-bold[^>]*><span class="tm-line/);
});

test('stacked bold+highlight render and align line wrap', () => {
  const text = '하나\n둘';
  const html = renderMarkedHtml(text, {
    marks: [
      { type: 'bold', start: 0, end: 2 },
      { type: 'hl', start: 0, end: 2 },
      { type: 'align', value: 'right', start: 0, end: 2 },
    ],
  });
  assert.match(html, /tm-bold/);
  assert.match(html, /tm-hl/);
  assert.match(html, /text-align:right/);
  assert.match(html, /tm-line/);
  const leftPara = renderMarkedHtml('하나\n둘', {
    marks: [{ type: 'align', value: 'right', start: 0, end: 2 }],
  });
  assert.match(leftPara, /tm-align-right/);
  assert.match(leftPara, /tm-align-left/);
});

test('atomic multiline blank is not split by line renderer', () => {
  let calls = 0;
  const html = renderTemplateHtml('앞[[BLANK1]]뒤', [{ order: 1, answer: '가\n나' }], {
    renderAtom: (atom) => {
      calls += 1;
      assert.equal(atom.order, 1);
      return '<span class="blank-wrap" data-blank-order="1"></span>';
    },
  });
  assert.equal(calls, 1);
  assert.equal((html.match(/blank-wrap/g) || []).length, 1);
  assert.equal(html.includes('가'), false);
});

test('invalid footnotes dropped; pin without body dropped', () => {
  const text = 'abcd';
  assert.deepEqual(normalizeFootnotes([{ field: 'prompt', start: 0, end: 1, body: 'x' }], text), []);
  assert.deepEqual(normalizeFootnotes([{ field: 'display', start: 1, end: 1, body: '' }], text), []);
  const kept = normalizeFootnotes([{ field: 'display', start: 9, end: 1, body: 'ok' }], text);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].start, 1);
  assert.equal(kept[0].end, 4);
  assert.equal(kept[0].id, 'n1');
});

test('remapMarks replace leaves a hole; later ranges shift', () => {
  const marks = remapMarks(
    [{ type: 'hl', start: 0, end: 4 }, { type: 'hl', start: 8, end: 10 }],
    { start: 2, end: 6, inserted: 'Z' },
  );
  assert.deepEqual(marks, [
    { type: 'hl', start: 0, end: 2 },
    { type: 'hl', start: 5, end: 7 },
  ]);
});

test('footnote remap after mid-string emoji insert uses UTF-16 length', () => {
  const text = 'ab';
  const fns = [{ id: 'n1', field: 'display', start: 0, end: 2, body: 'n' }];
  const next = applyTextEdit(text, { marks: [], footnotes: fns }, { start: 1, end: 1, inserted: '😀' });
  assert.equal(next.text.length, 4);
  assert.equal(next.footnotes[0].end, 4);
});

test('addMark last command wins overlapping color', () => {
  const text = 'abcdef';
  const first = addMark([], { type: 'color', value: 'b', start: 2, end: 4 }, { text });
  const next = addMark(first, { type: 'color', value: 'r', start: 0, end: 6 }, { text });
  const colors = next.filter((m) => m.type === 'color');
  assert.equal(colors.length, 1);
  assert.deepEqual(colors[0], { type: 'color', start: 0, end: 6, value: 'r' });
});

test('inherit remap continues style inside a run', () => {
  const text = 'abcdef';
  const marks = [{ type: 'bold', start: 0, end: 6 }];
  const ins = applyTextEdit(text, { marks, footnotes: [] }, { start: 2, end: 2, inserted: 'XY' }, { inherit: true });
  assert.deepEqual(ins.marks, [{ type: 'bold', start: 0, end: 8 }]);
});

test('footnote marker at text end is rendered once', () => {
  const html = renderMarkedHtml('abc', {
    footnotes: [{ field: 'display', start: 0, end: 3, body: '이유' }],
    field: 'display',
  });
  assert.equal((html.match(/class="tm-fn"/g) || []).length, 1);
});

test('footnote inside blank atom is shown once outside without answer', () => {
  const html = renderTemplateHtml('[[BLANK1]]', [{ order: 1, answer: 'abcdef' }], {
    footnotes: [{ field: 'explanation', start: 1, end: 3, body: '취지' }],
  });
  assert.equal(html.includes('abcdef'), false);
  assert.equal((html.match(/class="tm-fn"/g) || []).length, 1);
  assert.match(html, /data-blank-order="1"/);
});

test('display field does not coerce explanation footnotes', () => {
  const html = renderMarkedHtml('abc', {
    field: 'display',
    footnotes: [
      { field: 'explanation', start: 0, end: 3, body: '해설각주' },
      { field: 'display', start: 0, end: 1, body: '문제각주' },
    ],
  });
  assert.equal((html.match(/class="tm-fn"/g) || []).length, 1);
});

test('footnote numbers are per field starting at 1', () => {
  const fns = [
    { id: 'n1', field: 'explanation', start: 0, end: 1, body: '해설' },
    { id: 'n2', field: 'display', start: 0, end: 2, body: '문제' },
    { id: 'n3', field: 'display', start: 2, end: 3, body: '문제2' },
  ];
  const nums = footnoteNumbers(fns);
  assert.equal(nums.get('n2'), 1);
  assert.equal(nums.get('n3'), 2);
  assert.equal(nums.get('n1'), 1);
  const html = renderMarkedHtml('xyz', {
    field: 'explanation',
    footnotes: fns,
  });
  assert.match(html, /data-fn-index="1"/);
  assert.match(html, /data-fn-id="n1"/);
});

test('overlapping footnotes follow marker position, not range start or creation id', () => {
  const fns = [
    { id: 'n1', field: 'display', start: 0, end: 8, body: '넓은 범위' },
    { id: 'n2', field: 'display', start: 3, end: 3, body: '앞에 보이는 번호' },
    { id: 'n3', field: 'explanation', start: 0, end: 2, body: '별도 1' },
  ];
  const nums = footnoteNumbers(fns);
  assert.equal(nums.get('n2'), 1);
  assert.equal(nums.get('n1'), 2);
  assert.equal(nums.get('n3'), 1);
  const html = renderMarkedHtml('123456789', { field: 'display', footnotes: fns });
  assert.deepEqual([...html.matchAll(/data-fn-index="(\d+)"/g)].map(m => +m[1]), [1, 2]);
});

test('footnote range starting at a blank still anchors at its actual end', () => {
  const html = renderMarkedHtml('앞정답뒤문장끝', {
    atoms: [{ start: 1, end: 3, order: 1 }],
    renderAtom: () => '<span>정답</span>',
    footnotes: [{ id: 'n1', field: 'explanation', start: 3, end: 7, body: '범위' }],
    field: 'explanation',
  });
  assert.match(html, /뒤문장끝<button/);
});

test('loading two accounts preserves multiline answers and following footnote offsets', () => {
  const answer = '첫 줄\n둘째 줄';
  const offset = answer.length + 2;
  const raw = { users: [{ id: 'u1', name: 'A' }, { id: 'u2', name: 'B' }], cards: ['u1', 'u2'].map(userId => ({
    id: `c-${userId}`, userId, displayText: '문제', explanationText: '[[BLANK1]] 끝',
    blanks: [{ id: `b-${userId}`, order: 1, answer, aliases: ['별도 동의어'], lastInput: '답', lastResult: false }],
    footnotes: [{ id: 'n1', field: 'explanation', start: offset, end: offset, body: '끝 각주' }],
  })) };
  const result = migrateState(migrateState(raw));
  result.cards.forEach((c, i) => {
    assert.equal(c.userId, raw.cards[i].userId);
    assert.equal(c.blanks[0].answer, answer);
    assert.deepEqual(c.blanks[0].aliases, ['별도 동의어']);
    assert.equal(c.blanks[0].lastInput, '답');
    assert.equal(c.blanks[0].lastResult, false);
    assert.equal(c.footnotes[0].end, offset);
  });
  const legacy = migrateBlankAnswer({ answer: '정답 || 옛 동의어', aliases: [] });
  assert.equal(legacy.answer, '정답');
  assert.deepEqual(legacy.aliases, ['옛 동의어']);
});

test('empty answer still renders a zero-length chip', () => {
  const html = renderTemplateHtml('앞[[BLANK1]]뒤', [{ order: 1, answer: '' }], {
    renderAtom: (atom) => `<span class="zero-chip" data-blank-order="${atom.order}"></span>`,
  });
  assert.match(html, /zero-chip/);
  assert.match(html, /data-blank-order="1"/);
});

test('align wrap uses span so chip read-back does not add extra breaks', () => {
  const html = renderMarkedHtml('문제X이후', {
    marks: [{ type: 'align', value: 'center', start: 0, end: 6 }],
    atoms: [{ start: 2, end: 3, order: 1 }],
    renderAtom: () => '<span class="cz-chip" data-answer="X">X</span>',
  });
  assert.equal(html.includes('<div'), false);
  assert.match(html, /tm-line/);
  const plain = html
    .replace(/<button[\s\S]*?<\/button>/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  assert.equal(plain, '문제X이후');
});
