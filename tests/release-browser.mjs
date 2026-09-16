import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createAppServer, listen, TEST_ALPHA_PLANNER } from './lib/server.mjs';
import { loadChromium, browserExecutable } from './lib/playwright.mjs';
import { passAlphaGate, fixture } from './navigation-ui.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const version = JSON.parse(readFileSync(new URL('../version.json', import.meta.url))).v;
const server = createAppServer(root);
await listen(server, 4186);
const browser = await (await loadChromium()).launch({
  headless: true, executablePath: browserExecutable(),
  args: ['--host-resolver-rules=MAP release.localhost 127.0.0.1'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => d.accept());
try {
  // .localhost is a trustworthy loopback origin but is not the app's dev bypass.
  await page.goto('http://release.localhost:4186/index.html#/manage');
  await passAlphaGate(page, TEST_ALPHA_PLANNER);
  await fixture(page, 'seedPrimaryUser');
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  assert.equal(await page.evaluate(() => localStorage.getItem('cbt-app-v')), version);
  const original = '첫째 문단\n둘째 문단\n셋째 문단';
  await page.evaluate(async text => {
    const { store } = await import('/js/core/store.js');
    const c = store.data.cards.find(c => c.title === '카드A');
    c.explanationText = text; c.blanks = []; c.footnotes = [];
    c.textMarks = { display: [], explanation: [{ type: 'align', value: 'center', start: 0, end: text.length }] };
  }, original);
  await page.locator('#cardList .list-item', { hasText: '카드A' }).locator('.item-title').click();
  await page.locator('#manageDetail [data-action="edit-card"]').click();
  await page.locator('#explanationTemplate').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+b');
  const afterBlank = await page.evaluate(async () => {
    const { editorVisibleText, readChipEditor } = await import('/js/ui/chip-editor.js');
    return { text: editorVisibleText(document.getElementById('explanationTemplate')), ...readChipEditor('explanationTemplate') };
  });
  assert.equal(afterBlank.text, original, 'making a blank across aligned paragraphs preserves newlines');
  assert.equal(afterBlank.blanks[0]?.answer, original);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+Home');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  for (let i = 0; i < 8; i++) await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Control+b');
  assert.equal(await page.evaluate(async () => (await import('/js/ui/chip-editor.js')).editorVisibleText(document.getElementById('explanationTemplate'))), original,
    'partial selection across paragraph boundaries also preserves source');
  await page.keyboard.press('Control+z');
  await page.locator('#createSection .create-head [data-action="save-card"]').click();
  const beforeReload = await page.evaluate(async () => JSON.stringify((await import('/js/core/store.js')).store.data.cards));
  await page.evaluate(() => localStorage.setItem('cbt-app-v', 'old-release-fixture'));
  await page.reload();
  await page.waitForFunction(v => localStorage.getItem('cbt-app-v') === v, version);
  await page.waitForFunction(() => document.getElementById('currentUserName')?.textContent);
  assert.equal(await page.evaluate(async () => JSON.stringify((await import('/js/core/store.js')).store.data.cards)), beforeReload,
    'version-triggered reload preserves saved cards and account data');
  await page.locator('#navPatch').click();
  await page.locator('#patchNotesBody .patch-entry').first().waitFor();
  assert.match(await page.locator('#patchNotesBody .patch-entry').first().innerText(), new RegExp(version));
  assert.equal(await page.locator('#patchNotesBody .patch-entry').first().getAttribute('open'), '');
  // Imported ids are data, not CSS selectors.
  await page.evaluate(async () => {
    const { store } = await import('/js/core/store.js');
    const c = store.data.cards.find(c => c.title === '카드A');
    c.footnotes = [{ id: 'note"[]', field: 'explanation', start: 1, end: 1, body: '가져온 각주' }];
    store.data.ui.createDraft = null;
    await (await import('/js/core/storage.js')).persist();
  });
  await page.goto('http://release.localhost:4186/index.html#/manage');
  await page.locator('#cardList .list-item', { hasText: '카드A' }).locator('.item-title').click();
  await page.locator('#manageDetail [data-action="edit-card"]').click();
  await page.locator('[data-fn-edit]').fill('수정한 각주');
  await page.locator('[data-action="save-note-fn"]').click();
  assert.equal(await page.evaluate(async () => (await import('/js/ui/editor-surface.js')).getEditorMeta('explanationTemplate').footnotes[0].body), '수정한 각주');
  await page.evaluate(async () => {
    const { store } = await import('/js/core/store.js');
    const c = store.data.cards.find(c => c.title === '카드A');
    c.explanationText = '첫 [[BLANK1]] 다음';
    c.blanks = [{ id: 'stable-blank', order: 1, answer: '정답', aliases: [] }];
    c.footnotes = []; c.textMarks = { display: [], explanation: [] };
    store.data.ui.createDraft = null;
    await (await import('/js/core/storage.js')).persist();
  });
  await page.goto('http://release.localhost:4186/index.html?case=study-edit#/manage');
  await page.locator('#cardList .list-item', { hasText: '카드A' }).locator('.item-title').click();
  await page.locator('#manageDetail [data-action="study-one"]').click();
  await page.locator('#blankWrap1').click();
  await page.keyboard.type('입력중');
  await page.locator('[data-action="edit-study-card"]').click();
  await page.locator('#explanationTemplate').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' 새답');
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Control+b');
  await page.locator('#createSection .create-head [data-action="save-card"]').click();
  await page.locator('#createStudyNavBtn').click();
  assert.equal(await page.locator('.study-blank-nav-item').count(), 2, 'resume after editing refreshes blank navigation');
  const resumed = await page.evaluate(async () => (await import('/js/core/store.js')).store.currentBlankStatuses);
  assert.equal(resumed.length, 2, 'new blank gets its own grading state');
  assert.equal(resumed[0].user, '입력중', 'existing blank input survives editing');
  assert.deepEqual(errors, []);
  console.log('PASS release: multiline blank, imported note id, edited study blanks, service worker, version reload, saved data, latest patch page');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
