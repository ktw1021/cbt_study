import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAppServer, listen, TEST_ALPHA_PLANNER } from './lib/server.mjs';
import { loadChromium, browserExecutable } from './lib/playwright.mjs';
import { passAlphaGate, fixture } from './navigation-ui.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = createAppServer(root, 4185);
await listen(server, 4185);
const browser = await (await loadChromium()).launch({ headless: true, executablePath: browserExecutable() });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
const dialogs = [];
let cancel = true;
page.on('dialog', async d => {
  dialogs.push(d.type());
  try { if (cancel && d.type() === 'confirm') await d.dismiss(); else await d.accept(); } catch {}
});
const read = () => page.evaluate(async () => {
  const { editorVisibleText, getEditorSelectionOffsets } = await import('/js/ui/chip-editor.js');
  const { getEditorMeta } = await import('/js/ui/editor-surface.js');
  const el = document.getElementById('explanationTemplate');
  const range = getSelection().rangeCount ? getSelection().getRangeAt(0) : null;
  return { text: editorVisibleText(el), caret: getEditorSelectionOffsets(el.id),
    caretX: range?.getBoundingClientRect().left,
    domCaret: { node: getSelection().anchorNode?.nodeName, parent: getSelection().anchorNode?.parentElement?.className, offset: getSelection().anchorOffset },
    notes: getEditorMeta(el.id).footnotes, markers: el.querySelectorAll('.tm-fn').length };
});
try {
  await page.goto('http://127.0.0.1:4185/index.html#/manage');
  await passAlphaGate(page, TEST_ALPHA_PLANNER); await fixture(page, 'seedPrimaryUser');
  await page.evaluate(async () => {
    const { store } = await import('/js/core/store.js');
    const card = store.data.cards.find(c => c.title === '카드A');
    card.displayText = '문제 본문';
    card.explanationText = '가나다라마바사아자차\n\n둘째 문단에 [[BLANK1]]이 있습니다.\n' + '긴 한글 원문을 자동 줄바꿈하여 표시합니다. '.repeat(30);
    card.blanks = [{ id: 'b-note', order: 1, answer: '빈칸', aliases: [] }];
    card.textMarks = { explanation: [{ type: 'align', value: 'justify', start: 0, end: 800 }] };
    card.footnotes = [
      { id: 'n1', field: 'explanation', start: 4, end: 4, body: '첫 각주 내용\n<img src=x onerror=alert(1)> & 원문' },
      { id: 'n2', field: 'explanation', start: 20, end: 20, body: '둘째 각주 내용' },
      { id: 'p1', field: 'display', start: 2, end: 2, body: '문제 각주 내용' },
    ];
  });
  await page.locator('#cardList .list-item', { hasText: '카드A' }).locator('.item-title').click();
  await page.locator('#manageDetail [data-action="edit-card"]').click();
  const ed = page.locator('#explanationTemplate');
  const original = (await read()).text;
  await ed.click(); await page.keyboard.press('Control+Home');
  const moves = [];
  for (let i = 0; i < 8; i++) { await page.keyboard.press('ArrowRight'); const s = await read(); moves.push({ offset: s.caret.end, x: s.caretX, dom: s.domCaret }); }
  console.log('ArrowRight offsets across marker:', moves.map(m => m.offset));
  assert.deepEqual(moves.map(m => m.offset), [1, 2, 3, 4, 4, 5, 6, 7], 'one step for the number, no phantom stops');
  assert.ok(moves[4].x > moves[3].x && moves[4].x - moves[3].x < 20, 'marker step crosses only the visible number width');
  // End of the first paragraph, then left to the DOM side just after its marker.
  await page.keyboard.press('Control+Home');
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  dialogs.length = 0;
  await page.keyboard.press('Backspace');
  console.log('Backspace marker confirmation:', dialogs);
  assert.ok(dialogs.includes('confirm'), 'keyboard marker deletion also needs confirmation');
  assert.equal((await read()).text, original);
  assert.equal((await read()).markers, 2);
  cancel = false;
  await page.keyboard.press('Backspace');
  assert.equal((await read()).markers, 1);
  assert.equal((await read()).notes.length, 1);
  assert.equal((await read()).text, original);
  await page.keyboard.press('Control+z');
  assert.equal((await read()).markers, 2);
  await page.keyboard.press('Control+Home');
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  cancel = true; dialogs.length = 0;
  await page.keyboard.press('Delete');
  assert.ok(dialogs.includes('confirm'));
  assert.equal((await read()).markers, 2);
  await page.keyboard.press('Shift+ArrowRight');
  dialogs.length = 0;
  await page.keyboard.press('Delete');
  assert.ok(dialogs.includes('confirm'), 'selecting only a marker must also ask');
  assert.equal((await read()).markers, 2);
  cancel = false;
  console.log('OK keyboard delete confirmation, cancel, accept and undo');

  await page.locator('#createSection .create-head [data-action="save-card"]').click();
  await page.waitForFunction(async () => !!(await import('/js/core/store.js')).store.data.ui.lastSavedAt);
  await page.locator('#createSection [data-action="create-study-nav"]').click();
  await page.waitForFunction(async () => (await import('/js/core/store.js')).store.currentSection === 'study-play');
  const marker = page.locator('#studyExplanation .tm-fn').first();
  await marker.hover();
  const tip = page.locator('#footnoteHover');
  await tip.waitFor({ state: 'visible' });
  assert.match(await tip.innerText(), /첫 각주 내용/);
  assert.equal(await tip.locator('img').count(), 0);
  const tb = await tip.boundingBox();
  assert.ok(tb.x >= 0 && tb.x + tb.width <= 1400 && tb.y >= 0 && tb.y + tb.height <= 950);
  await page.screenshot({ path: join(tmpdir(), 'cbt-footnote-hover.png'), fullPage: false });
  await marker.click();
  const item = page.locator('#notesList [data-note-id="n1"]');
  assert.ok(await item.locator('.study-fn-heading').evaluate(n => n.classList.contains('note-pulse')));
  assert.equal(await tip.isVisible(), false);
  await item.locator('.study-fn-toggle').click();
  await item.locator('.study-fn-jump').click();
  assert.ok(await marker.evaluate(n => n.classList.contains('note-pulse')));
  assert.equal(await item.locator('.study-fn-body').count(), 0, 'jump must not toggle disclosure');
  await page.waitForTimeout(1600);
  assert.equal(await marker.evaluate(n => n.classList.contains('note-pulse')), false);
  await page.locator('[data-action="notes-field-tab"][data-field="display"]').click();
  await page.getByRole('button', { name: '가리기', exact: true }).click();
  assert.equal(await page.evaluate(() => document.body.classList.contains('study-prompt-collapsed')), true);
  await page.locator('#notesList .study-fn-jump').click();
  assert.equal(await page.evaluate(() => document.body.classList.contains('study-prompt-collapsed')), false);
  assert.ok(await page.locator('#studyPrompt .tm-fn').evaluate(n => n.classList.contains('note-pulse')));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#studyPrompt .tm-fn').hover();
  await tip.waitFor({ state: 'visible' });
  const narrow = await tip.boundingBox();
  assert.ok(narrow.x >= 0 && narrow.x + narrow.width <= 390 && narrow.y >= 0 && narrow.y + narrow.height <= 844);
  await page.screenshot({ path: join(tmpdir(), 'cbt-footnote-interaction.png'), fullPage: false });
  console.log('OK study hover, safe text, bidirectional reveal and temporary highlight');
} finally { await browser.close(); server.close(); }
