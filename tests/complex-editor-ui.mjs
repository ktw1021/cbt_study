import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAppServer, listen, TEST_ALPHA_PLANNER } from './lib/server.mjs';
import { loadChromium, browserExecutable } from './lib/playwright.mjs';
import { passAlphaGate, fixture } from './navigation-ui.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = createAppServer(root, 4183);
await listen(server, 4183);
const browser = await (await loadChromium()).launch({ headless: true, executablePath: browserExecutable() });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
let promptText = '각주 취지';
let acceptDelete = true;
const dialogs = [];
page.on('dialog', async d => {
  dialogs.push({ type: d.type(), message: d.message() });
  try {
    if (d.type() === 'prompt') await d.accept(promptText);
    else if (d.type() === 'confirm' && !acceptDelete) await d.dismiss();
    else await d.accept();
  } catch (e) { if (!page.isClosed()) errors.push(e.message); }
});
const editorId = 'explanationTemplate';
const ed = page.locator(`#${editorId}`);
const align = value => page.locator(`[data-action="fmt-align"][data-editor="${editorId}"][data-align="${value}"]`).click();
async function read() {
  return page.evaluate(async id => {
    const chip = await import('/js/ui/chip-editor.js');
    const surface = await import('/js/ui/editor-surface.js');
    const el = document.getElementById(id);
    const model = chip.readChipEditor(id);
    const s = window.getSelection();
    return { ...model, visible: chip.editorVisibleText(el), meta: surface.getEditorMeta(id),
      selection: s.rangeCount && el.contains(s.anchorNode) ? chip.rangeToVisibleOffsets(el, s.getRangeAt(0)) : null,
      html: el.innerHTML, lines: el.querySelectorAll('.tm-line').length,
      paragraphTexts: [...el.querySelectorAll('.tm-line')].map(line => [...line.childNodes].map(n => n.nodeType === 3 ? n.data : (n.classList.contains('cz-chip') ? n.dataset.answer : n.textContent)).join('')),
      nested: el.querySelectorAll('.tm-line .tm-line').length,
      markers: [...el.querySelectorAll('.tm-fn')].map(n => ({ id: n.dataset.fnId,
        number: Number(n.dataset.fnIndex),
        offset: chip.visibleOffsetFromPoint(el, n.parentNode, [...n.parentNode.childNodes].indexOf(n)) })) };
  }, editorId);
}
async function selectAll() { await ed.click(); await page.keyboard.press('Control+A'); }
async function clickText(text, index = 1) {
  const pt = await page.evaluate(({ id, text, index }) => {
    const el = document.getElementById(id);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (n.parentElement.closest('.cz-chip, .tm-fn')) continue;
      const at = n.data.indexOf(text);
      if (at < 0) continue;
      n.parentElement.scrollIntoView({ block: 'center' });
      const r = document.createRange(); r.setStart(n, at + index); r.setEnd(n, at + index + 1);
      const b = r.getBoundingClientRect();
      return { x: b.left + 1, y: b.top + b.height / 2 };
    }
  }, { id: editorId, text, index });
  assert.ok(pt, `text exists: ${text}`);
  await page.mouse.click(pt.x, pt.y);
}
function sameText(a, b, label) {
  assert.equal(b.template, a.template, `${label}: template`);
  assert.equal(b.visible, a.visible, `${label}: visible`);
  assert.deepEqual(b.blanks, a.blanks, `${label}: blank metadata`);
}
try {
  await page.goto('http://127.0.0.1:4183/index.html#/manage');
  await passAlphaGate(page, TEST_ALPHA_PLANNER);
  await fixture(page, 'seedPrimaryUser');
  // Seed a realistic saved card; all editing below uses the user interface.
  await page.evaluate(async () => {
    const { store } = await import('/js/core/store.js');
    const c = store.data.cards.find(c => c.title === '카드A');
    c.explanationText = 'Ⅰ. [[BLANK1]]\n\n1. [[BLANK2]], 2. [[BLANK3]]\n\nⅡ. [[BLANK4]] [행정법]\n1. 문제점\n거부처분에 대한 집행정지를 인정하지 않는다면 민사법상 가처분을 활용할 수 있는지\n\n2. 학설\n검토대상 [[BLANK5]] 뒤의 문장 끝\n' + Array.from({ length: 12 }, (_, i) => `${i + 3}. 추가 문단의 본문을 줄바꿈과 함께 그대로 보존합니다.`).join('\n') + '\n\n마지막 문단';
    c.blanks = ['쟁점의 정리', '가처분 준용 여부', '거부처분과 집행정지', '가처분 준용 여부', '여러 줄\n정답'].map((answer, i) => ({ id: `complex-b${i}`, order: i + 1, answer, aliases: ['동의어'], lastInput: '이전입력', lastResult: false, manualResult: null }));
    c.textMarks = { display: [], explanation: [] }; c.footnotes = [];
  });
  await page.locator('#cardList .list-item', { hasText: '카드A' }).locator('.item-title').click();
  await page.locator('#manageDetail [data-action="edit-card"]').click();
  await ed.waitFor();
  const initial = await read();
  const expectedParas = initial.template.split('\n').map(s => s.replace(/\[\[BLANK(\d+)\]\]/g, (_, n) => initial.blanks[Number(n)-1].answer));
  await selectAll();
  await page.locator(`[data-action="fmt-bold"][data-editor="${editorId}"]`).click();
  for (const value of ['center', 'right', 'justify', 'left', 'center']) {
    await selectAll(); await align(value);
    const now = await read();
    sameText(initial, now, value);
    assert.equal(now.lines, initial.template.split('\n').length, 'one wrapper per explicit paragraph, excluding newline inside chip');
    assert.equal((now.html.match(/class="cz-chip"/g) || []).length, 5);
    assert.equal(now.nested, 0, 'paragraphs must never nest');
    assert.deepEqual(now.paragraphTexts.map(s => s.replace(/×/g, '')), expectedParas, 'visible DOM paragraph contents');
  }
  console.log('OK complex chip paragraphs: repeated four alignments preserve original model');
  await clickText('거부처분에 대한', 3);
  const caret = (await read()).selection;
  assert.ok(caret && caret.start === caret.end);
  assert.equal(caret.end, initial.visible.indexOf('거부처분에 대한') + 3, 'caret offset independent of editor mapper');
  await page.locator(`[data-action="fmt-footnote"][data-editor="${editorId}"]`).click();
  let now = await read();
  sameText(initial, now, 'footnote at caret');
  assert.equal(now.meta.footnotes[0].end, caret.end);
  assert.equal(now.markers[0].offset, caret.end, 'marker must be at the captured source offset');
  await page.screenshot({ path: join(tmpdir(), 'cbt-complex-editor-fixed.png'), fullPage: true });
  // Marker now opens/highlights its list row; deletion is explicit in that row.
  promptText = ''; acceptDelete = false; dialogs.length = 0;
  await ed.locator('.tm-fn').click();
  assert.equal(await page.locator('#notesList .study-fn-heading.note-pulse').count(), 1);
  await page.locator('#notesList [data-action="delete-note-fn"]').click();
  assert.ok(dialogs.some(d => d.type === 'confirm'), 'marker deletion asks confirmation');
  assert.equal((await read()).meta.footnotes.length, 1);
  acceptDelete = true; dialogs.length = 0;
  await page.locator('#notesList [data-action="delete-note-fn"]').click();
  assert.ok(dialogs.some(d => d.type === 'confirm'));
  now = await read(); sameText(initial, now, 'delete marker');
  assert.equal(now.meta.footnotes.length, 0);
  assert.equal(now.markers.length, 0);
  assert.equal(await page.locator('#explanationPreview .tm-fn').count(), 0);
  console.log('OK marker deletion: confirm cancel/accept, immediate preview, original text preserved');

  // A wide selected range was numbered before earlier markers despite appearing last.
  promptText = '전체 범위';
  await selectAll();
  await page.locator(`[data-action="fmt-footnote"][data-editor="${editorId}"]`).click();
  for (const text of ['14. 추가', '검토대상', '거부처분에 대한', '1. 문제점']) {
    await clickText(text, 1);
    promptText = text;
    await page.locator(`[data-action="fmt-footnote"][data-editor="${editorId}"]`).click();
  }
  now = await read();
  sameText(initial, now, 'overlapping and reverse-created footnotes');
  assert.deepEqual(now.markers.map(n => n.number), [1, 2, 3, 4, 5]);
  await page.locator('[data-action="notes-field-tab"][data-field="explanation"]').click();
  const jumps = page.locator('#notesList .study-fn-jump');
  assert.deepEqual(await jumps.allInnerTexts(), [1, 2, 3, 4, 5].map(n => `각주 ${n} · 해설`));
  const firstId = now.markers[0].id;
  const firstEnd = now.meta.footnotes.find(f => f.id === firstId).end;
  const count = await page.locator('#notesList .study-fn-body').count();
  // Click title while the editor is scrolled away; moving must not collapse the note.
  await ed.click(); await page.keyboard.press('Control+End');
  await jumps.first().click();
  assert.equal((await read()).selection.end, firstEnd);
  assert.equal(await ed.evaluate(el => document.activeElement === el), true);
  assert.equal(await page.locator('#notesList .study-fn-body').count(), count);
  const heading = page.locator('#notesList .study-fn-heading').first();
  const headingBox = await heading.boundingBox();
  const toggleBox = await heading.locator('.study-fn-toggle').boundingBox();
  assert.ok(Math.abs(headingBox.x + headingBox.width - toggleBox.x - toggleBox.width) < 2);
  await heading.locator('.study-fn-toggle').click();
  assert.equal(await page.locator('#notesList .study-fn-body').count(), count - 1);
  await heading.locator('.study-fn-toggle').click();
  assert.equal(await page.locator('#notesList .study-fn-body').count(), count);
  // Delete a middle item using the list path and check renumbering immediately.
  dialogs.length = 0;
  await page.locator('#notesList [data-action="delete-note-fn"]').nth(1).click();
  await page.waitForFunction(() => document.querySelectorAll('#explanationTemplate .tm-fn').length === 4);
  assert.ok(dialogs.some(d => d.type === 'confirm'));
  assert.deepEqual((await read()).markers.map(n => n.number), [1, 2, 3, 4]);
  assert.deepEqual(await jumps.allInnerTexts(), [1, 2, 3, 4].map(n => `각주 ${n} · 해설`));
  // Problem notes get their own numbering and must not change explanation numbers.
  await page.locator('#promptTemplate').click(); await page.keyboard.press('Control+Home');
  promptText = '문제별도';
  await page.locator('[data-action="fmt-footnote"][data-editor="promptTemplate"]').click();
  await page.locator('#promptTemplate .tm-fn').waitFor();
  assert.equal(await page.locator('#promptTemplate .tm-fn').getAttribute('data-fn-index'), '1');
  assert.deepEqual((await read()).markers.map(n => n.number), [1, 2, 3, 4]);
  await page.locator('[data-action="notes-field-tab"][data-field="explanation"]').click();
  await page.locator('[data-action="open-explanation-focus"]').click();
  await jumps.first().click();
  assert.equal(await page.evaluate(() => document.body.classList.contains('create-explanation-focus')), true);
  assert.equal((await read()).selection.end, firstEnd);
  await page.screenshot({ path: join(tmpdir(), 'cbt-complex-editor-focus.png'), fullPage: false });
  await page.locator('[data-action="close-explanation-focus"]').click();
  const saved = await read();
  await page.locator('#createSection .create-head [data-action="save-card"]').click();
  await page.waitForFunction(async () => {
    const { store } = await import('/js/core/store.js');
    return !!store.data.ui.lastSavedAt;
  });
  await page.waitForTimeout(100);
  await page.reload();
  await passAlphaGate(page, TEST_ALPHA_PLANNER);
  // The saved card is restored through the normal page route.
  await ed.waitFor({ state: 'visible' });
  sameText(initial, await read(), 'save/reload');
  assert.deepEqual((await read()).meta.footnotes, saved.meta.footnotes);
  console.log('OK numbering, overlapping ranges, jump vs collapse, focus editing, save/reload');
  // No preceding text node: Home must stay before the first atomic blank.
  await page.locator('#createSection .create-head [data-action="new-card"]').click();
  await ed.click(); await page.keyboard.type('맨앞칩');
  await page.keyboard.press('Control+A'); await page.keyboard.press('Control+b');
  await page.keyboard.press('Control+Home');
  promptText = '칩 앞';
  await page.locator(`[data-action="fmt-footnote"][data-editor="${editorId}"]`).click();
  now = await read();
  assert.equal(now.meta.footnotes[0].end, 0);
  assert.equal(now.markers[0].offset, 0);
  assert.equal(now.selection.end, 0, 'restoring caret must not jump over first chip');
  const blankId = now.blanks[0].id;
  await page.keyboard.type('앞');
  now = await read();
  assert.equal(now.visible, '앞맨앞칩');
  assert.equal(now.blanks[0].id, blankId);
  console.log('OK footnote and typing before a first-position blank');
  assert.deepEqual(errors, []);
} finally {
  await browser.close(); server.close();
}
