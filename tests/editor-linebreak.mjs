/**
 * 빠른 줄바꿈 회귀 — 전체 editor-browser 전에 실행.
 */
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createAppServer, listen, TEST_ALPHA_PLANNER } from './lib/server.mjs';
import { loadChromium, browserExecutable } from './lib/playwright.mjs';
import { passAlphaGate, fixture, waitObserve } from './navigation-ui.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PORT = Number(process.env.CBT_LINE_TEST_PORT || 4175);
const BASE = `http://127.0.0.1:${PORT}`;

async function readVis(page, editorId) {
  return page.evaluate(async (id) => {
    const { editorVisibleText, readChipEditor, getEditorSelectionOffsets } = await import('/js/ui/chip-editor.js');
    const el = document.getElementById(id);
    return {
      vis: editorVisibleText(el),
      tmpl: readChipEditor(id).template,
      html: el?.innerHTML || '',
      sel: getEditorSelectionOffsets(id),
    };
  }, editorId);
}

async function selectOffsets(page, editorId, start, end) {
  await page.locator(`#${editorId}`).click();
  await page.evaluate(async ({ editorId, start, end }) => {
    const { setVisibleSelection } = await import('/js/ui/chip-editor.js');
    const el = document.getElementById(editorId);
    el.focus();
    setVisibleSelection(el, start, end);
  }, { editorId, start, end });
}

async function run() {
  const server = createAppServer(ROOT, PORT);
  await listen(server, PORT);
  const chromium = await loadChromium();
  const browser = await chromium.launch({ headless: true, executablePath: browserExecutable() });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let ok = 0;
  const pass = (name) => { ok += 1; console.log(`OK ${name}`); };
  const fail = (msg) => { console.error(`FAIL ${msg}`); process.exitCode = 1; };

  try {
    await page.goto(`${BASE}/index.html#/manage`);
    await passAlphaGate(page, TEST_ALPHA_PLANNER);
    await page.waitForFunction(() => {
      const auth = document.getElementById('authOverlay');
      const hasCards = !!document.querySelector('#cardList [data-drag-card]');
      return hasCards || (auth && !auth.classList.contains('hidden'));
    }, { timeout: 15000 });
    const meta = await fixture(page, 'seedPrimaryUser');
    await waitObserve(page, (s) => s.listTitles.includes('카드A') && s.section === 'manage', 10000, 'seed');

    await page.evaluate(async (userId) => {
      const { store } = await import('/js/core/store.js');
      const { persist } = await import('/js/core/storage.js');
      const { uid } = await import('/js/utils/text.js');
      const { migrateCard } = await import('/js/domain/migrate.js');
      const { renderAll } = await import('/js/ui/render.js');
      const plain = migrateCard({
        id: uid('c'),
        userId,
        title: '줄바꿈',
        displayText: '시작',
        explanationText: '해설',
        blanks: [],
      });
      store.data.cards.unshift(plain);
      await persist();
      renderAll();
    }, meta.userId);

    await page.locator('#cardList .list-item', { hasText: '줄바꿈' }).locator('.item-title').click();
    await page.locator('#manageDetail [data-action="edit-card"]').click();
    await page.waitForSelector('#createSection:not(.hidden) #promptTemplate');

    const typeSeq = async (editorId, a, b) => {
      await page.locator(`#${editorId}`).click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Delete');
      await page.keyboard.type(a);
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await page.keyboard.type(b);
    };

    await typeSeq('promptTemplate', 'A', 'B');
    let st = await readVis(page, 'promptTemplate');
    if (st.vis !== 'A\n\nB' || st.tmpl !== 'A\n\nB') {
      fail(`plain A\\n\\nB got ${JSON.stringify(st)}`);
      return;
    }
    pass('plain double Enter');

    await page.locator('#promptTemplate').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.keyboard.type('A');
    await page.keyboard.press('Enter');
    await page.keyboard.type('B');
    st = await readVis(page, 'promptTemplate');
    if (st.vis !== 'A\nB') fail(`plain A\\nB got ${JSON.stringify(st)}`);
    else pass('plain single Enter');

    await page.locator('#promptTemplate').click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    st = await readVis(page, 'promptTemplate');
    if (st.vis !== 'A\nB\n' || st.tmpl !== 'A\nB\n') fail(`trailing Enter ${JSON.stringify(st)}`);
    else pass('trailing Enter');

    await page.locator('#promptTemplate').press('Control+z');
    st = await readVis(page, 'promptTemplate');
    if (st.vis !== 'A\nB') {
      fail(`undo trailing must restore exact text: ${JSON.stringify(st)}`);
    } else pass('undo newline');

    await page.locator('#promptTemplate').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.keyboard.type('X');
    await selectOffsets(page, 'promptTemplate', 0, 1);
    await page.locator('[data-action="fmt-align"][data-editor="promptTemplate"][data-align="center"]').click();
    await page.locator('#promptTemplate').click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Y');
    st = await readVis(page, 'promptTemplate');
    if (st.vis !== 'X\n\nY' || st.tmpl !== 'X\n\nY') {
      fail(`aligned double Enter text ${JSON.stringify(st)}`);
      return;
    }
    const alignGeom = await page.evaluate(() => {
      const lines = [...document.querySelectorAll('#promptTemplate .tm-line')];
      return lines.map((el) => getComputedStyle(el).textAlign);
    });
    if (!alignGeom.includes('center')) {
      fail(`aligned paragraph not center ${JSON.stringify(alignGeom)}`);
      return;
    }
    await page.locator('#promptTemplate').press('Control+z');
    st = await readVis(page, 'promptTemplate');
    if (st.vis !== 'X\n\n') fail(`aligned undo 1 ${JSON.stringify(st)}`);
    await page.locator('#promptTemplate').press('Control+Shift+z');
    st = await readVis(page, 'promptTemplate');
    if (st.vis !== 'X\n\nY') fail(`aligned redo ${JSON.stringify(st)}`);
    pass('aligned double Enter + undo/redo');

    await page.locator('#explanationTemplate').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('앞AB');
    await page.evaluate(async () => {
      const { setVisibleSelection } = await import('/js/ui/chip-editor.js');
      setVisibleSelection(document.getElementById('explanationTemplate'), 1, 3);
    });
    await page.keyboard.press('Control+b');
    await page.locator('#explanationTemplate .cz-chip').waitFor();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    st = await readVis(page, 'explanationTemplate');
    if (st.vis !== '앞AB\n' || st.tmpl !== '앞[[BLANK1]]\n') {
      fail(`newline after blank ${JSON.stringify(st)}`);
      return;
    }
    pass('newline after blank stays outside answer');
    // Select the canonical trailing newline too; native Select All may omit it.
    await page.evaluate(async () => {
      const { setVisibleSelection, editorVisibleText } = await import('/js/ui/chip-editor.js');
      const el = document.getElementById('explanationTemplate');
      setVisibleSelection(el, 0, editorVisibleText(el).length);
    });
    await page.keyboard.press('Enter');
    st = await readVis(page, 'explanationTemplate');
    if (st.vis !== '\n' || st.tmpl !== '\n' || await page.locator('#explanationTemplate .cz-chip').count()) {
      fail(`Enter replacing selected blank ${JSON.stringify(st)}`);
      return;
    }
    pass('Enter replaces selection including blank');

    const longText = Array.from({ length: 80 }, (_, i) => String(i).padStart(2, '0')).join('\n');
    await page.locator('#promptTemplate').click();
    const moved = await page.evaluate(async (text) => {
      const {
        setChipEditorContent,
        setVisibleSelection,
        getEditorSelectionOffsets,
        editorVisibleText,
        moveChipEditorByVisualLine,
      } = await import('/js/ui/chip-editor.js');
      const { loadEditorMeta } = await import('/js/ui/editor-surface.js');
      setChipEditorContent('promptTemplate', text, [], { resetHistory: false });
      loadEditorMeta('promptTemplate', {}, { field: 'display', paint: true, reset: false });
      const el = document.getElementById('promptTemplate');
      el.focus();
      setVisibleSelection(el, 0, 0);
      const steps = [];
      for (let i = 0; i < 20; i += 1) {
        steps.push(moveChipEditorByVisualLine(el, 1, {}));
      }
      return {
        sel: getEditorSelectionOffsets('promptTemplate'),
        len: editorVisibleText(el).length,
        movedCount: steps.filter(Boolean).length,
        first: steps[0],
        last: steps[steps.length - 1],
      };
    }, longText);
    if (!(moved.sel.start >= 45 && moved.sel.start <= 80 && moved.sel.start < moved.len - 40)) {
      fail(`ArrowDown 20 should move ~20 short lines, got ${JSON.stringify(moved)}`);
      return;
    }
    pass('ArrowDown 20 does not jump to end');

    await page.evaluate(async () => {
      const { setVisibleSelection } = await import('/js/ui/chip-editor.js');
      const el = document.getElementById('promptTemplate');
      el.focus();
      setVisibleSelection(el, 0, 0);
      for (let i = 0; i < 30; i += 1) {
        el.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'ArrowDown', bubbles: true, cancelable: true, repeat: i > 0,
        }));
      }
    });
    let nav = await page.evaluate(async () => {
      const { getEditorSelectionOffsets, editorVisibleText } = await import('/js/ui/chip-editor.js');
      return {
        sel: getEditorSelectionOffsets('promptTemplate'),
        len: editorVisibleText(document.getElementById('promptTemplate')).length,
      };
    });
    if (!(nav.sel.start >= 70 && nav.sel.start <= 120 && nav.sel.start < nav.len - 40)) {
      fail(`ArrowDown repeat should move ~30 short lines, got ${JSON.stringify(nav)}`);
      return;
    }
    pass('ArrowDown keyrepeat does not jump to end');

    await page.evaluate(async (text) => {
      const { setVisibleSelection, editorVisibleText } = await import('/js/ui/chip-editor.js');
      const { applyFormat } = await import('/js/ui/editor-surface.js');
      const el = document.getElementById('promptTemplate');
      el.focus();
      const len = editorVisibleText(el).length || text.length;
      setVisibleSelection(el, 0, len);
      applyFormat('promptTemplate', { type: 'align', value: 'center', toggle: false });
      setVisibleSelection(el, 0, 0);
    }, longText);
    await page.locator('#promptTemplate').click();
    await page.evaluate(async () => {
      const { setVisibleSelection } = await import('/js/ui/chip-editor.js');
      setVisibleSelection(document.getElementById('promptTemplate'), 0, 0);
    });
    for (let i = 0; i < 18; i += 1) await page.keyboard.press('ArrowDown');
    nav = await page.evaluate(async () => {
      const { getEditorSelectionOffsets, editorVisibleText } = await import('/js/ui/chip-editor.js');
      const el = document.getElementById('promptTemplate');
      return {
        sel: getEditorSelectionOffsets('promptTemplate'),
        len: editorVisibleText(el).length,
        lines: el.querySelectorAll('.tm-line').length,
      };
    });
    if (nav.lines < 40) {
      fail(`aligned ArrowDown missing tm-line ${JSON.stringify(nav)}`);
      return;
    }
    if (!(nav.sel.start >= 40 && nav.sel.start <= 80 && nav.sel.start < nav.len - 40)) {
      fail(`aligned ArrowDown should move ~18 short lines, got ${JSON.stringify(nav)}`);
      return;
    }
    pass('aligned ArrowDown does not jump to end');

    const ime = await page.evaluate(async () => {
      const { setVisibleSelection, getEditorSelectionOffsets } = await import('/js/ui/chip-editor.js');
      const el = document.getElementById('promptTemplate');
      el.focus();
      setVisibleSelection(el, 0, 0);
      const before = getEditorSelectionOffsets('promptTemplate');
      const composingEv = new KeyboardEvent('keydown', {
        key: 'ArrowDown', bubbles: true, cancelable: true, isComposing: true,
      });
      const composingFlag = composingEv.isComposing;
      const composingPrevented = !el.dispatchEvent(composingEv);
      const afterComposing = getEditorSelectionOffsets('promptTemplate');
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
      const duringEv = new KeyboardEvent('keydown', {
        key: 'ArrowDown', bubbles: true, cancelable: true, isComposing: false,
      });
      const duringPrevented = !el.dispatchEvent(duringEv);
      const afterDuring = getEditorSelectionOffsets('promptTemplate');
      el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }));
      return {
        composingFlag,
        composingPrevented,
        duringPrevented,
        before: before.start,
        afterComposing: afterComposing.start,
        afterDuring: afterDuring.start,
      };
    });
    if (!ime.composingFlag) {
      fail(`KeyboardEvent isComposing not honored in this browser ${JSON.stringify(ime)}`);
      return;
    }
    if (ime.composingPrevented || ime.afterComposing !== ime.before) {
      fail(`ArrowDown during isComposing must not be intercepted (synthetic, not OS IME) ${JSON.stringify(ime)}`);
      return;
    }
    pass('synthetic isComposing ArrowDown not intercepted');
    if (ime.duringPrevented || ime.afterDuring !== ime.before) {
      fail(`ArrowDown after compositionstart must not steal IME even if isComposing=false (synthetic) ${JSON.stringify(ime)}`);
      return;
    }
    pass('synthetic compositionstart blocks ArrowDown intercept');

    console.log(`linebreak harness: ${ok} OK`);
  } catch (e) {
    fail(e.message || String(e));
  } finally {
    await browser.close();
    server.close();
  }
}

run();
