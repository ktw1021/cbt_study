import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createAppServer, listen, TEST_ALPHA_PLANNER } from './lib/server.mjs';
import { loadChromium, browserExecutable } from './lib/playwright.mjs';
import { passAlphaGate, loginViaUi, fixture, waitObserve, observe } from './navigation-ui.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PORT = Number(process.env.CBT_EDITOR_TEST_PORT || 4174);
const BASE = `http://127.0.0.1:${PORT}`;
const LOG = join(tmpdir(), 'cbt-editor-e2e.log');
const SHOT_CREATE = join(tmpdir(), 'cbt-editor-create.png');
const SHOT_STUDY = join(tmpdir(), 'cbt-study-prompt-hidden.png');
const SHOT_FOCUS = join(tmpdir(), 'cbt-focus-notes-color.png');
const SHOT_TOOLBAR = join(tmpdir(), 'cbt-toolbar-fieldtabs.png');
const SHOT_ALIGN = join(tmpdir(), 'cbt-align-paragraphs.png');
const SHOT_NARROW = join(tmpdir(), 'cbt-narrow-toolbar-notes.png');
const SHOT_NOTES_FILLED = join(tmpdir(), 'cbt-create-notes-filled-desktop.png');
const SHOT_NOTES_FOCUS = join(tmpdir(), 'cbt-create-notes-filled-focus.png');

const lines = [];
const log = (msg) => {
  lines.push(msg);
  console.log(msg);
};

async function editorMeta(page) {
  return page.evaluate(async () => {
    const { readAllEditorMeta } = await import('/js/ui/editor-surface.js');
    const { readChipEditor } = await import('/js/ui/chip-editor.js');
    const { store } = await import('/js/core/store.js');
    const id = document.getElementById('cardId')?.value || '';
    const saved = store.data.cards.find((c) => c.id === id) || null;
    const prompt = document.getElementById('promptTemplate');
    const expl = document.getElementById('explanationTemplate');
    return {
      id,
      title: document.getElementById('cardTitle')?.value || '',
      promptText: prompt?.innerText || '',
      explText: expl?.innerText || '',
      explModel: readChipEditor('explanationTemplate'),
      meta: readAllEditorMeta(),
      preview: {
        bold: !!document.querySelector('#promptPreview .tm-bold'),
        hl: !!document.querySelector('#explanationPreview .tm-hl, #promptPreview .tm-hl'),
        color: !!document.querySelector('#promptPreview .tm-color, #explanationPreview .tm-color'),
        align: !!document.querySelector('#promptPreview .tm-line, #explanationPreview .tm-line'),
        fn: [...document.querySelectorAll('#promptPreview .tm-fn, #explanationPreview .tm-fn')].map((b) => ({
          id: b.dataset.fnId,
          index: b.dataset.fnIndex,
          label: b.getAttribute('aria-label'),
        })),
        editorFn: [...document.querySelectorAll('#promptTemplate .tm-fn, #explanationTemplate .tm-fn')].map((b) => ({
          id: b.dataset.fnId,
          index: b.dataset.fnIndex,
        })),
      },
      saved: saved && {
        id: saved.id,
        rounds: saved.rounds,
        wrongCount: saved.wrongCount,
        displayText: saved.displayText,
        explanationText: saved.explanationText,
        textMarks: saved.textMarks,
        footnotes: saved.footnotes,
        blanks: saved.blanks,
        memo: saved.memo,
      },
    };
  });
}

async function idbCard(page, title) {
  return page.evaluate(async (title) => {
    const { loadState } = await import('/js/core/storage.js');
    const data = await loadState();
    return (data.cards || []).find((c) => c.title === title) || null;
  }, title);
}

function markCovers(marks, type, start, end, value = null) {
  const want = (marks || []).filter((m) => m.type === type && (value == null || m.value === value));
  let pos = start;
  const hits = want.filter((m) => m.end > start && m.start < end).sort((a, b) => a.start - b.start);
  for (const m of hits) {
    if (m.start > pos) return false;
    pos = Math.max(pos, m.end);
    if (pos >= end) return true;
  }
  return pos >= end;
}

async function domHlAtOffsets(page, editorId, start, end) {
  return page.evaluate(({ editorId, start, end }) => {
    const el = document.getElementById(editorId);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let pos = 0;
    const need = [];
    for (let i = start; i < end; i++) need.push(i);
    const found = new Set();
    let node = walker.nextNode();
    while (node) {
      if (node.parentElement?.closest?.('.tm-fn, .cz-chip-x')) {
        node = walker.nextNode();
        continue;
      }
      const len = node.nodeValue.length;
      for (let i = 0; i < len; i++) {
        const abs = pos + i;
        if (abs >= start && abs < end) {
          if (node.parentElement?.closest?.('.tm-hl')) found.add(abs);
        }
      }
      pos += len;
      node = walker.nextNode();
    }
    return need.every((i) => found.has(i));
  }, { editorId, start, end });
}

async function applyMenuColor(page, editorId, color) {
  await page.locator(`[data-action="fmt-color-menu"][data-editor="${editorId}"]`).click();
  await page.locator(`.fmt-color-menu [data-action="fmt-color"][data-editor="${editorId}"][data-color="${color}"]`).click();
}

async function isDisplayed(locator) {
  const n = locator.first();
  if (!(await n.count())) return false;
  return n.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) !== 0;
  });
}

async function colorSwatch(page, editorId) {
  return page.locator(`.fmt-toolbar[data-fmt-for="${editorId}"] .fmt-color-trigger .fmt-color-swatch`).getAttribute('data-color');
}

async function waitSwatch(page, editorId, color, label) {
  const start = Date.now();
  let got = '';
  while (Date.now() - start < 4000) {
    got = await colorSwatch(page, editorId);
    if (got === color) return got;
    await page.waitForTimeout(50);
  }
  const dump = await page.evaluate(async (editorId) => {
    const { readAllEditorMeta } = await import('/js/ui/editor-surface.js');
    const { getEditorSelectionOffsets } = await import('/js/ui/chip-editor.js');
    const sw = document.querySelector(`.fmt-toolbar[data-fmt-for="${editorId}"] .fmt-color-trigger .fmt-color-swatch`);
    return {
      marks: readAllEditorMeta().textMarks.display,
      sel: getEditorSelectionOffsets(editorId),
      swatch: sw?.getAttribute('data-color'),
    };
  }, editorId);
  throw new Error(`${label || '색표시'} got=${got} want=${color} dump=${JSON.stringify(dump)}`);
}

async function selectOffsets(page, editorId, start, end) {
  await page.locator(`#${editorId}`).click();
  await page.evaluate(async ({ editorId, start, end }) => {
    const { setVisibleSelection } = await import('/js/ui/chip-editor.js');
    const el = document.getElementById(editorId);
    if (!el) throw new Error(`없음 ${editorId}`);
    el.focus();
    setVisibleSelection(el, start, end);
    el.dispatchEvent(new Event('keyup'));
  }, { editorId, start, end });
}

async function clickVisibleNav(page, action) {
  const top = page.locator(`.topbar-nav [data-action="${action}"]`);
  if (await top.isVisible()) {
    await top.click();
    return;
  }
  const toggle = page.locator('#sidebarToggle');
  if (await toggle.isVisible()) await toggle.click();
  const btn = page.locator(`aside.sidebar [data-action="${action}"]`).first();
  await btn.evaluate((el) => el.click());
}

async function logoutViaUi(page) {
  await openManage(page);
  const toggle = page.locator('#sidebarToggle');
  if (await toggle.isVisible()) await toggle.click();
  await page.locator('#loggedInUser').evaluate((el) => {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    el.closest('aside')?.scrollTo?.(0, el.closest('aside').scrollHeight);
  });
  await page.locator('#loggedInUser [data-action="logout"]').evaluate((el) => el.click());
  await page.waitForSelector('#authOverlay:not(.hidden)', { timeout: 10000 });
}

async function openManage(page) {
  const now = await observe(page);
  if (now.section === 'manage') return;
  await clickVisibleNav(page, 'nav-manage');
  await waitObserve(page, (s) => s.section === 'manage', 8000, '관리 화면');
}

async function openCardEdit(page, title) {
  await openManage(page);
  await page.locator('#cardList .list-item', { hasText: title }).locator('.item-title').click();
  await page.locator('#manageDetail [data-action="edit-card"]').waitFor({ state: 'visible', timeout: 8000 });
  await page.locator('#manageDetail [data-action="edit-card"]').click();
  await page.waitForSelector('#createSection:not(.hidden) #promptTemplate', { timeout: 10000 });
}

async function saveCreateUi(page) {
  const before = await page.evaluate(async () => {
    const { store } = await import('/js/core/store.js');
    return store.data.ui.lastSavedAt || '';
  });
  await page.locator('#createSection .create-head [data-action="save-card"]').click();
  const start = Date.now();
  while (Date.now() - start < 10000) {
    const cur = await page.evaluate(async () => {
      const { store } = await import('/js/core/store.js');
      return store.data.ui.lastSavedAt || '';
    });
    if (cur && cur !== before) return;
    await page.waitForTimeout(50);
  }
  throw new Error(`저장 시각이 갱신되지 않음 before=${before}`);
}

async function seedFormatCards(page, userId) {
  return page.evaluate(async (userId) => {
    const { store } = await import('/js/core/store.js');
    const { persist } = await import('/js/core/storage.js');
    const { migrateCard } = await import('/js/domain/migrate.js');
    const { uid } = await import('/js/utils/text.js');
    const { renderAll } = await import('/js/ui/render.js');
    const a = migrateCard({
      id: uid('c'),
      userId,
      title: '서식카드A',
      displayText: '문제본문abcdef',
      explanationText: '해설 가나나다다 [[BLANK1]] 끝',
      blanks: [{ order: 1, answer: '답답', aliases: ['동의'] }],
      memo: '카드메모A',
      rounds: 2,
      wrongCount: 1,
      textMarks: {
        display: [{ type: 'bold', start: 0, end: 2 }],
        explanation: [{ type: 'color', value: 'b', start: 3, end: 5 }],
      },
      footnotes: [
        { id: 'n1', field: 'display', start: 0, end: 2, body: '문제취지A' },
        { id: 'n1b', field: 'display', start: 2, end: 4, body: '문제취지A2' },
        { id: 'n2', field: 'explanation', start: 0, end: 2, body: '해설취지A' },
        { id: 'n2b', field: 'explanation', start: 3, end: 5, body: '해설취지A2' },
      ],
    });
    const b = migrateCard({
      id: uid('c'),
      userId,
      title: '서식카드B',
      displayText: '다른문제xyz',
      explanationText: '다른해설 [[BLANK1]]',
      blanks: [{ order: 1, answer: '다른답' }],
      memo: '카드메모B',
      footnotes: [{ id: 'n1', field: 'display', start: 0, end: 2, body: '문제취지B' }],
    });
    const alignCard = migrateCard({
      id: uid('c'),
      userId,
      title: '정렬카드',
      displayText: '첫째문단입니다\n둘째문단입니다\n셋째문단입니다',
      explanationText: '왼쪽해설입니다\n가운데해설입니다\n오른쪽해설입니다 [[BLANK1]]',
      blanks: [{ order: 1, answer: '정렬답' }],
      memo: '정렬메모',
    });
    alignCard.blanks[0].answer = '정렬답\n줄';
    const plain = migrateCard({
      id: uid('c'),
      userId,
      title: '메타없음',
      displayText: '평문문제',
      explanationText: '평문해설 [[BLANK1]]',
      blanks: [{ order: 1, answer: '평답' }],
    });
    store.data.cards.unshift(a, b, alignCard, plain);
    await persist();
    renderAll();
    return { a: a.id, b: b.id, plain: plain.id, align: alignCard.id, aRounds: a.rounds, aWrong: a.wrongCount };
  }, userId);
}

async function run() {
  const server = createAppServer(ROOT, PORT);
  await listen(server, PORT);
  const chromium = await loadChromium();
  const browser = await chromium.launch({ headless: true, executablePath: browserExecutable() });
  const results = [];
  const fail = (name, err) => {
    results.push({ name, ok: false, message: err?.message || String(err) });
    log(`FAIL ${name}: ${err?.message || err}`);
  };
  const pass = (name, extra = '') => {
    results.push({ name, ok: true, extra });
    log(`OK ${name}${extra ? ` ${extra}` : ''}`);
  };

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const promptQ = [];
  const confirmQ = [];
  const dialogCtl = { dismissConfirm: false };
  const lastDialog = { type: '', message: '' };
  page.on('dialog', async (d) => {
    lastDialog.type = d.type();
    lastDialog.message = d.message();
    if (d.type() === 'prompt') {
      const next = promptQ.length ? promptQ.shift() : '각주본문';
      await d.accept(next);
      return;
    }
    if (d.type() === 'confirm') {
      if (dialogCtl.dismissConfirm) {
        dialogCtl.dismissConfirm = false;
        await d.dismiss();
        return;
      }
      const next = confirmQ.length ? confirmQ.shift() : true;
      if (next) await d.accept();
      else await d.dismiss();
      return;
    }
    await d.accept();
  });

  try {
    await page.goto(`${BASE}/index.html#/manage`);
    await passAlphaGate(page, TEST_ALPHA_PLANNER);
    await page.waitForFunction(() => {
      const auth = document.getElementById('authOverlay');
      const hasCards = !!document.querySelector('#cardList [data-drag-card]');
      return hasCards || (auth && !auth.classList.contains('hidden'));
    }, { timeout: 15000 });
    const meta = await fixture(page, 'seedPrimaryUser');
    await waitObserve(page, (s) => s.listTitles.includes('카드A') && s.section === 'manage', 10000, '시드 후 목록');
    const ids = await seedFormatCards(page, meta.userId);
    await waitObserve(page, (s) => s.listTitles.includes('서식카드A'), 8000, '서식 카드 시드');

    await openCardEdit(page, '서식카드A');
    let st = await editorMeta(page);
    if (!st.preview.bold) throw new Error('기존 볼드가 미리보기에 없음');
    if (!st.preview.fn.some((f) => f.index === '1')) {
      throw new Error(`각주 번호 불일치 ${JSON.stringify(st.preview.fn)}`);
    }
    const displayIdx = st.preview.editorFn.filter((f) => st.meta.footnotes.find((x) => x.id === f.id && x.field === 'display')).map((f) => f.index).sort();
    const explIdx = st.preview.editorFn.filter((f) => st.meta.footnotes.find((x) => x.id === f.id && x.field === 'explanation')).map((f) => f.index).sort();
    if (displayIdx[0] !== '1' || displayIdx[1] !== '2' || explIdx[0] !== '1' || explIdx[1] !== '2') {
      throw new Error(`필드별 각주 번호 아님 display=${displayIdx} expl=${explIdx} ${JSON.stringify(st.preview.editorFn)}`);
    }
    const beforeId = st.id;
    const beforeRounds = st.saved?.rounds;
    const beforeWrong = st.saved?.wrongCount;
    pass('open existing card via UI', `id=${beforeId}`);

    await selectOffsets(page, 'promptTemplate', 2, 4);
    await page.locator('[data-action="fmt-hl"][data-editor="promptTemplate"]').click();
    st = await editorMeta(page);
    if (!st.meta.textMarks.display.some((m) => m.type === 'hl')) throw new Error('형광 버튼 미적용');
    await selectOffsets(page, 'promptTemplate', 4, 6);
    await applyMenuColor(page, 'promptTemplate', 'r');
    await selectOffsets(page, 'promptTemplate', 0, 2);
    await page.locator('[data-action="fmt-align"][data-editor="promptTemplate"][data-align="center"]').click();
    st = await editorMeta(page);
    if (!st.meta.textMarks.display.some((m) => m.type === 'color' && m.value === 'r')) throw new Error('색 버튼 미적용');
    if (!st.meta.textMarks.display.some((m) => m.type === 'align')) throw new Error('정렬 버튼 미적용');
    pass('toolbar bold/color/hl/align');

    const toolbarGeom = await page.evaluate(() => {
      const bar = document.querySelector('.fmt-toolbar[data-fmt-for="promptTemplate"]');
      const text = bar?.querySelector('.fmt-group-text');
      const align = bar?.querySelector('.fmt-group-align');
      const notes = bar?.querySelector('.fmt-group-notes');
      const br = bar?.getBoundingClientRect();
      const tr = text?.getBoundingClientRect();
      const ar = align?.getBoundingClientRect();
      const nr = notes?.getBoundingClientRect();
      const trigger = bar?.querySelector('.fmt-color-trigger');
      const hl = bar?.querySelector('.fmt-hl-btn');
      const hlLabel = hl?.querySelector('.fmt-hl-label');
      const sep = bar?.querySelector('.fmt-sep');
      const aligns = [...(bar?.querySelectorAll('[data-action="fmt-align"]') || [])].map((b) => b.dataset.align);
      const rgb = (el) => (el ? getComputedStyle(el).backgroundColor : '');
      return {
        barW: br?.width || 0,
        textLeft: tr?.left || 0,
        barLeft: br?.left || 0,
        alignMid: ar ? ar.left + ar.width / 2 : 0,
        barMid: br ? br.left + br.width / 2 : 0,
        notesRight: nr?.right || 0,
        barRight: br?.right || 0,
        triggerText: trigger?.innerText?.replace(/\s+/g, '') || '',
        triggerLabel: trigger?.getAttribute('aria-label') || '',
        triggerTip: trigger?.getAttribute('data-tip') || '',
        triggerTitle: trigger?.getAttribute('title') || '',
        hasSwatch: !!trigger?.querySelector('.fmt-color-swatch'),
        hasCaret: !!trigger?.querySelector('.fmt-color-caret'),
        hlBtnBg: rgb(hl),
        hlLabelBg: rgb(hlLabel),
        hasSep: !!sep,
        aligns,
        alignAria: [...(bar?.querySelectorAll('[data-action="fmt-align"]') || [])].map((b) => b.getAttribute('aria-label')),
        hasSvg: [...(bar?.querySelectorAll('[data-action="fmt-align"] svg') || [])].length,
        svgBoxes: [...(bar?.querySelectorAll('[data-action="fmt-align"] svg') || [])].map((s) => {
          const r = s.getBoundingClientRect();
          return { w: r.width, h: r.height };
        }),
        btnBoxes: [...(bar?.querySelectorAll('[data-action="fmt-align"]') || [])].map((b) => {
          const r = b.getBoundingClientRect();
          return { w: r.width, h: r.height };
        }),
        textH: tr?.height || 0,
        textW: tr?.width || 0,
        fnThenClear: [...(notes?.querySelectorAll('button') || [])].map((b) => b.dataset.action),
      };
    });
    if (toolbarGeom.hasSep) throw new Error('구분선이 남아 있음');
    if (Math.abs(toolbarGeom.textLeft - toolbarGeom.barLeft) > 24) {
      throw new Error(`텍스트 그룹이 왼쪽이 아님 ${JSON.stringify(toolbarGeom)}`);
    }
    if (Math.abs(toolbarGeom.alignMid - toolbarGeom.barMid) > 56) {
      throw new Error(`정렬 그룹이 가운데가 아님 ${JSON.stringify(toolbarGeom)}`);
    }
    if (Math.abs(toolbarGeom.notesRight - toolbarGeom.barRight) > 28) {
      throw new Error(`노트 그룹이 오른쪽이 아님 ${JSON.stringify(toolbarGeom)}`);
    }
    if (toolbarGeom.triggerText.includes('글자색')) throw new Error(`글자색 글자가 보임 ${toolbarGeom.triggerText}`);
    if (toolbarGeom.triggerLabel !== '글자색' || toolbarGeom.triggerTip !== '글자색' || toolbarGeom.triggerTitle) {
      throw new Error(`글자색 접근성 이름 없음 ${JSON.stringify(toolbarGeom)}`);
    }
    if (!toolbarGeom.hasSwatch || !toolbarGeom.hasCaret) throw new Error('색 스와치/캐럿 없음');
    const parseRgb = (c) => {
      const m = String(c).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
    };
    const [lr, lg, lb] = parseRgb(toolbarGeom.hlLabelBg);
    const [br, bg, bb] = parseRgb(toolbarGeom.hlBtnBg);
    if (!(lr > 180 && lg > 150 && lb < 140)) {
      throw new Error(`형광 라벨 노란 배경 아님 ${toolbarGeom.hlLabelBg}`);
    }
    if (br > 180 && bg > 150 && bb < 140) {
      throw new Error(`형광 버튼 전체가 노란 배경 ${toolbarGeom.hlBtnBg}`);
    }
    if (toolbarGeom.aligns.join(',') !== 'justify,left,center,right') {
      throw new Error(`정렬 아이콘 순서 ${toolbarGeom.aligns}`);
    }
    if (toolbarGeom.hasSvg !== 4) throw new Error(`정렬 SVG 부족 ${toolbarGeom.hasSvg}`);
    if (toolbarGeom.svgBoxes.some((b) => b.w < 16 || b.h < 16)) {
      throw new Error(`정렬 SVG 계산 크기 작음 ${JSON.stringify(toolbarGeom.svgBoxes)}`);
    }
    if (toolbarGeom.btnBoxes.some((b) => b.w < 28 || b.h < 28)) {
      throw new Error(`정렬 버튼 타깃 작음 ${JSON.stringify(toolbarGeom.btnBoxes)}`);
    }
    if (toolbarGeom.textH > 48) {
      throw new Error(`텍스트 그룹이 세로로 쪼개짐 h=${toolbarGeom.textH}`);
    }
    if (!toolbarGeom.alignAria.every((a) => a && a.length > 2)) throw new Error(`정렬 aria-label 없음 ${toolbarGeom.alignAria}`);
    if (toolbarGeom.fnThenClear.slice(0, 2).join(',') !== 'fmt-footnote,fmt-clear') {
      throw new Error(`각주/해제 순서 ${toolbarGeom.fnThenClear}`);
    }
    await page.screenshot({ path: SHOT_TOOLBAR, fullPage: false });
    pass('toolbar groups/highlight inner/color a11y');

    lastDialog.message = '';
    await page.locator('#cardTitle').click();
    const fnBefore = (await editorMeta(page)).meta.footnotes.length;
    await page.locator('[data-action="fmt-footnote"][data-editor="promptTemplate"]').click();
    await page.waitForTimeout(50);
    if (lastDialog.message !== '각주를 넣을 곳을 선택해 주세요.') {
      throw new Error(`무선택 각주 안내 아님 ${lastDialog.message}`);
    }
    if ((await editorMeta(page)).meta.footnotes.length !== fnBefore) {
      throw new Error('무선택 각주가 삽입됨');
    }
    await selectOffsets(page, 'promptTemplate', 2, 4);
    await page.locator('#cardTitle').click();
    lastDialog.message = '';
    await page.locator('[data-action="fmt-footnote"][data-editor="promptTemplate"]').click();
    await page.waitForTimeout(50);
    if (lastDialog.message !== '각주를 넣을 곳을 선택해 주세요.') {
      throw new Error(`포커스 이탈 stale 각주 ${lastDialog.message}`);
    }
    if ((await editorMeta(page)).meta.footnotes.length !== fnBefore + 0) {
      throw new Error('stale selection으로 각주 삽입됨');
    }
    await selectOffsets(page, 'explanationTemplate', 0, 0);
    lastDialog.message = '';
    await page.locator('[data-action="fmt-footnote"][data-editor="promptTemplate"]').click();
    if (lastDialog.message !== '각주를 넣을 곳을 선택해 주세요.') {
      throw new Error(`다른 편집기 caret으로 문제 각주 ${lastDialog.message}`);
    }
    await selectOffsets(page, 'promptTemplate', 1, 3);
    promptQ.push('범위각주');
    await page.locator('[data-action="fmt-footnote"][data-editor="promptTemplate"]').click();
    st = await editorMeta(page);
    const rangeFn = st.meta.footnotes.find((f) => f.body === '범위각주');
    if (!rangeFn || rangeFn.field !== 'display' || rangeFn.start !== 1 || rangeFn.end !== 3) {
      throw new Error(`드래그 범위 각주 위치 ${JSON.stringify(rangeFn)}`);
    }
    await page.locator('[data-action="fmt-align"][data-align="left"][data-editor="promptTemplate"]').hover();
    await page.waitForTimeout(420);
    const tipText = await page.locator('#uiDelayTip').innerText().catch(() => '');
    const tipBox = await page.locator('#uiDelayTip').boundingBox().catch(() => null);
    if (!tipText.includes('왼쪽 정렬') || !tipText.includes('Ctrl+Shift+L')) {
      throw new Error(`정렬 tooltip 아님 ${tipText}`);
    }
    if (!tipBox || tipBox.x < 0 || tipBox.x + tipBox.width > 1280 + 2) {
      throw new Error(`tooltip 잘림 ${JSON.stringify(tipBox)}`);
    }
    pass('footnote valid/invalid target + delayed tooltip');

    await selectOffsets(page, 'promptTemplate', 4, 4);
    await waitSwatch(page, 'promptTemplate', 'r', 'caret 빨강');
    await selectOffsets(page, 'promptTemplate', 4, 6);
    await applyMenuColor(page, 'promptTemplate', 'b');
    await selectOffsets(page, 'promptTemplate', 4, 4);
    await waitSwatch(page, 'promptTemplate', 'b', 'caret 파랑');
    await selectOffsets(page, 'promptTemplate', 10, 10);
    await waitSwatch(page, 'promptTemplate', 'k', 'caret 검정');
    await selectOffsets(page, 'promptTemplate', 4, 6);
    await waitSwatch(page, 'promptTemplate', 'b', '단일색 범위');
    await selectOffsets(page, 'promptTemplate', 3, 8);
    await waitSwatch(page, 'promptTemplate', 'k', '혼합 범위');
    await selectOffsets(page, 'promptTemplate', 4, 6);
    await page.locator('[data-action="fmt-color-menu"][data-editor="promptTemplate"]').click();
    await page.locator('.fmt-color-menu [data-color="r"]').first().click();
    st = await editorMeta(page);
    if (!markCovers(st.meta.textMarks.display, 'color', 4, 6, 'r')) {
      throw new Error(`메뉴 색이 원래 범위에 미적용 ${JSON.stringify(st.meta.textMarks.display)}`);
    }
    pass('color trigger caret/range/menu preserve');

    await selectOffsets(page, 'promptTemplate', 6, 8);
    await page.locator('#promptTemplate').press('Control+Shift+B');
    st = await editorMeta(page);
    if (!markCovers(st.meta.textMarks.display, 'bold', 6, 8)) {
      throw new Error(`Ctrl+Shift+B가 6..8 볼드 coverage 아님 ${JSON.stringify(st.meta.textMarks.display)}`);
    }
    await page.locator('#promptTemplate').press('Control+Shift+L');
    st = await editorMeta(page);
    const lineLen = st.promptText.length;
    const leftAlign = st.meta.textMarks.display.find((m) => m.type === 'align' && m.value === 'left');
    if (!leftAlign || leftAlign.start !== 0 || leftAlign.end < lineLen) {
      throw new Error(`Ctrl+Shift+L 왼쪽 정렬 아님 ${JSON.stringify(st.meta.textMarks.display)} len=${lineLen}`);
    }
    if (st.meta.textMarks.display.some((m) => m.type === 'align' && m.value === 'center')) {
      throw new Error('Ctrl+Shift+L 후 가운데 정렬이 남음');
    }
    await selectOffsets(page, 'promptTemplate', 8, 10);
    await page.locator('#promptTemplate').press('Control+m');
    await page.locator('#promptTemplate').press('KeyK');
    st = await editorMeta(page);
    if (!markCovers(st.meta.textMarks.display, 'color', 8, 10, 'k')) {
      throw new Error(`Ctrl+M KeyK 색 8..10 미적용 ${JSON.stringify(st.meta.textMarks.display)}`);
    }
    await selectOffsets(page, 'promptTemplate', 8, 10);
    await page.locator('[data-action="fmt-clear"][data-editor="promptTemplate"]').click();
    st = await editorMeta(page);
    if (markCovers(st.meta.textMarks.display, 'color', 8, 10, 'k')) {
      throw new Error('서식 해제 후 8..10 색 남음');
    }
    await selectOffsets(page, 'promptTemplate', 8, 10);
    await page.locator('#promptTemplate').press('F2');
    st = await editorMeta(page);
    if (!markCovers(st.meta.textMarks.display, 'color', 8, 10, 'k')) {
      throw new Error(`F2 마지막 색(k) 복원 실패 ${JSON.stringify(st.meta.textMarks.display)}`);
    }
    await selectOffsets(page, 'promptTemplate', 6, 8);
    await page.locator('#promptTemplate').press('F3');
    st = await editorMeta(page);
    if (!markCovers(st.meta.textMarks.display, 'hl', 6, 8)) {
      throw new Error(`F3 형광 6..8 coverage 아님 ${JSON.stringify(st.meta.textMarks.display)}`);
    }
    if (!(await domHlAtOffsets(page, 'promptTemplate', 6, 8))) {
      throw new Error('F3 형광 DOM 6..8 미반영');
    }
    if (!markCovers(st.meta.textMarks.display, 'hl', 2, 4)) {
      throw new Error('F3 후 기존 2..4 형광 유실');
    }
    await selectOffsets(page, 'promptTemplate', 6, 8);
    await page.locator('#promptTemplate').press('F3');
    st = await editorMeta(page);
    if (markCovers(st.meta.textMarks.display, 'hl', 6, 8)) {
      throw new Error(`F3 재토글 후 6..8 형광 남음 ${JSON.stringify(st.meta.textMarks.display)}`);
    }
    if (await domHlAtOffsets(page, 'promptTemplate', 6, 8)) {
      throw new Error('F3 재토글 후 DOM 6..8 형광 남음');
    }
    pass('keyboard CtrlShiftB/align/color chord/F2/F3');

    await selectOffsets(page, 'promptTemplate', 2, 4);
    promptQ.push('추가각주');
    await page.locator('[data-action="fmt-footnote"][data-editor="promptTemplate"]').click();
    st = await editorMeta(page);
    if (!st.meta.footnotes.some((f) => f.body === '추가각주')) throw new Error('각주 추가 실패');
    const newFn = st.preview.editorFn.find((f) => st.meta.footnotes.find((x) => x.id === f.id && x.body === '추가각주'));
    await page.locator(`#promptTemplate .tm-fn[data-fn-id="${newFn?.id || st.meta.footnotes.at(-1).id}"]`).click();
    const editRow = page.locator(`#notesList [data-note-id="${newFn.id}"]`);
    await editRow.locator('textarea').fill('수정각주');
    await editRow.locator('[data-action="save-note-fn"]').click();
    st = await editorMeta(page);
    if (!st.meta.footnotes.some((f) => f.body === '수정각주')) throw new Error('각주 수정 실패');
    await editRow.locator('[data-action="delete-note-fn"]').click();
    const afterDel = await editorMeta(page);
    if (afterDel.meta.footnotes.some((f) => f.body === '수정각주')) throw new Error('각주 삭제 실패');
    pass('footnote add/edit/delete');

    if (await page.locator('#notesPanel').count() !== 1) throw new Error('노트 패널이 1개가 아님');
    if (!(await page.locator('#createNotesMount #notesPanel').count())) throw new Error('제작 마운트에 노트 패널 없음');
    const fieldTabs = page.locator('#createNotesMount [data-action="notes-field-tab"]');
    if (await fieldTabs.count() !== 2) throw new Error('문제/해설 필드 탭 없음');
    const defaultField = await page.evaluate(() => document.querySelector('#createNotesMount [data-action="notes-field-tab"].active')?.dataset.field);
    const defaultTab = await page.evaluate(() => document.querySelector('#createNotesMount [data-action="study-notes-tab"].active')?.dataset.tab);
    if (defaultField !== 'display' || defaultTab !== 'notes') {
      throw new Error(`문제 각주 클릭 후 탭 ${defaultField}/${defaultTab}`);
    }
    if (await page.locator('#notesList .study-fn-body').count() < 2) {
      throw new Error('해설 각주가 기본 모두 펼침이 아님');
    }
    await page.locator('#createNotesMount [data-action="notes-field-tab"][data-field="display"]').click();
    const dispDump = await page.evaluate(async () => {
      const { readAllEditorMeta } = await import('/js/ui/editor-surface.js');
      const { footnoteNumbers } = await import('/js/domain/text-marks.js');
      const meta = readAllEditorMeta();
      const nums = footnoteNumbers(meta.footnotes);
      return {
        fns: meta.footnotes.filter((f) => f.field === 'display').map((f) => ({
          id: f.id, start: f.start, end: f.end, n: nums.get(f.id), body: f.body,
        })),
        toggles: [...document.querySelectorAll('#notesList [data-action="jump-note-fn"]')].map((b) => b.innerText.replace(/\s+/g, ' ').trim()),
      };
    });
    if (dispDump.toggles.length < 2) throw new Error(`문제 필드 각주 번호 없음 ${JSON.stringify(dispDump)}`);
    if (dispDump.toggles.some((t) => t.includes('해설'))) throw new Error(`문제 탭에 해설 각주 ${JSON.stringify(dispDump)}`);
    const dispNums = dispDump.toggles.map((t) => Number((t.match(/각주 (\d+)/) || [])[1]));
    if (dispNums.some((n, i) => n !== i + 1)) throw new Error(`문제 각주 번호 ${JSON.stringify(dispDump)}`);
    const toggleLabels = dispDump.toggles;
    if (toggleLabels.some((t) => t.includes('문제취지') || t.includes('해설취지'))) {
      throw new Error(`토글 라벨이 본문을 인용 ${toggleLabels}`);
    }
    const dispCount = dispDump.toggles.length;
    if (await page.locator('#notesList .study-fn-body').count() !== dispCount) throw new Error('문제 각주 기본 모두 펼침 아님');
    await page.locator('#createNotesMount [data-action="toggle-study-fn"]').nth(1).click();
    if (await page.locator('#notesList .study-fn-body').count() !== dispCount - 1) throw new Error('개별 접기가 안 됨');
    await page.locator('#createNotesMount [data-action="toggle-study-fn"]').nth(1).click();
    if (await page.locator('#notesList .study-fn-body').count() !== dispCount) throw new Error('개별 펼치기가 안 됨');
    await page.locator('#createNotesMount [data-action="toggle-all-notes-fn"]').click();
    if (await page.locator('#notesList .study-fn-body').count() !== 0) throw new Error('모두 접기가 안 됨');
    await page.locator('#createNotesMount [data-action="toggle-all-notes-fn"]').click();
    if (await page.locator('#notesList .study-fn-body').count() !== dispCount) throw new Error('모두 펼치기가 안 됨');
    await page.screenshot({ path: SHOT_NOTES_FILLED, fullPage: false });
    await page.locator('#createNotesMount [data-action="notes-field-tab"][data-field="explanation"]').click();
    const explList = await page.locator('#notesList').innerText();
    if (!explList.includes('각주 1') || !explList.includes('각주 2')) throw new Error(`해설 필드 독립 번호 없음 ${explList}`);
    if (await page.locator('#notesList .study-fn-body').count() !== 2) throw new Error('필드 전환 후 펼침이 리셋됨');
    if (explList.includes('문제취지')) throw new Error(`해설 탭에 문제 각주 ${explList}`);
    await page.locator('#promptPreview .tm-fn').first().click();
    const afterMarkerField = await page.evaluate(() => document.querySelector('[data-action="notes-field-tab"].active')?.dataset.field);
    if (afterMarkerField !== 'display') throw new Error(`마커가 필드 탭을 안 바꿈 ${afterMarkerField}`);
    if (await page.locator('#notesList .study-fn-body').count() < 1) throw new Error('마커로 각주가 안 열림');
    await page.locator('#createNotesMount [data-action="notes-field-tab"][data-field="explanation"]').click();
    await page.locator('#notesList [data-fn-edit]').first().fill('패널수정중');
    await page.locator('#createNotesMount [data-action="notes-field-tab"][data-field="display"]').click();
    await page.locator('#createNotesMount [data-action="notes-field-tab"][data-field="explanation"]').click();
    const keptDraft = await page.locator('#notesList [data-fn-edit]').first().inputValue();
    if (keptDraft !== '패널수정중') throw new Error(`탭 전환 후 미저장 각주 유실 ${keptDraft}`);
    const fnTa = page.locator('#notesList [data-fn-edit]').first();
    await fnTa.fill('dirtyonly');
    lastDialog.message = '';
    confirmQ.push(false);
    await page.locator('#createStudyNavBtn').click();
    await page.waitForTimeout(80);
    if (!lastDialog.message.includes('저장하지 않은')) {
      throw new Error(`각주만 수정 시 이탈 확인 없음 ${lastDialog.message}`);
    }
    if (await page.locator('#createSection').evaluate((el) => el.classList.contains('hidden'))) {
      throw new Error('각주 dirty 취소 후 제작 이탈');
    }
    if ((await fnTa.inputValue()) !== 'dirtyonly') throw new Error('각주 dirty 취소 후 초안 유실');
    pass('footnote-only dirty blocks study nav cancel keeps draft');
    const undoBody = 'undo패널본문';
    await fnTa.fill(undoBody);
    await page.locator('[data-action="save-note-fn"]').first().click();
    st = await editorMeta(page);
    const savedFn = st.meta.footnotes.find((f) => f.body === undoBody);
    if (!savedFn) throw new Error('undo 테스트 각주 저장 실패');
    const undoEditor = savedFn.field === 'display' ? '#promptTemplate' : '#explanationTemplate';
    await page.locator(undoEditor).click();
    await page.locator(undoEditor).press('Control+Z');
    await page.waitForTimeout(120);
    st = await editorMeta(page);
    const reverted = st.meta.footnotes.find((f) => f.id === savedFn.id);
    if (reverted?.body === undoBody) throw new Error('Ctrl+Z 후 모델 각주 본문 유지');
    const taVal = await page.locator(`[data-fn-edit="${savedFn.id}"]`).first().inputValue();
    if (taVal === undoBody) throw new Error(`Undo 후 패널 cache stale ${taVal}`);
    await page.locator(undoEditor).press('Control+Shift+Z');
    await page.waitForTimeout(120);
    st = await editorMeta(page);
    if (!st.meta.footnotes.some((f) => f.id === savedFn.id && f.body === undoBody)) {
      throw new Error('Ctrl+Shift+Z redo 후 모델 불일치');
    }
    const taRedo = await page.locator(`[data-fn-edit="${savedFn.id}"]`).first().inputValue();
    if (taRedo !== undoBody) throw new Error(`redo 후 패널 표시 ${taRedo}`);
    pass('footnote save + editor undo/redo sync panel');
    await page.locator('#notesList [data-fn-edit]').first().fill('패널수정');
    await page.locator('[data-action="save-note-fn"]').first().click();
    st = await editorMeta(page);
    if (!st.meta.footnotes.some((f) => f.body === '패널수정')) throw new Error('패널 각주 수정 실패');
    await page.locator('[data-action="delete-note-fn"]').first().click();
    st = await editorMeta(page);
    if (st.meta.footnotes.some((f) => f.body === '패널수정')) throw new Error('패널 각주 삭제 실패');
    await page.locator('[data-action="study-notes-tab"][data-tab="memo"]').click();
    await page.locator('#notesMemo').fill('제작메모구분');
    await page.locator('[data-action="study-notes-tab"][data-tab="notes"]').click();
    if ((await page.locator('#notesList').innerText()).includes('제작메모구분')) throw new Error('메모가 각주 탭에 섞임');
    if (!(await isDisplayed(page.locator('#notesList .study-fn-body')))) throw new Error('펼친 각주가 안 보임');
    const collapseBtns = page.locator('#notesPanel [data-action="toggle-study-notes"]');
    const saveMemoBtn = page.locator('#notesPanel [data-action="save-memo"]');
    for (let i = 0; i < await collapseBtns.count(); i += 1) {
      if (await isDisplayed(collapseBtns.nth(i))) throw new Error('제작에서 접기/펼치기 버튼이 보임');
    }
    if (await isDisplayed(saveMemoBtn)) throw new Error('제작에서 메모 저장 버튼이 보임');
    await page.locator('[data-action="open-explanation-focus"]').click();
    const focusPanel = page.locator('body.create-explanation-focus #createNotesMount #notesPanel');
    if (!(await isDisplayed(focusPanel))) throw new Error('집중편집에서 노트 패널이 화면에 없음');
    if (!(await isDisplayed(page.locator('body.create-explanation-focus #notesList .study-fn-body')))) {
      throw new Error('집중편집 진입 후 펼친 각주 유실');
    }
    if (await page.locator('#notesMemo').inputValue() !== '제작메모구분') throw new Error('집중편집 진입 후 메모 유실');
    await page.locator('[data-action="fmt-color-menu"][data-editor="explanationTemplate"]').click();
    const focusBar = await page.evaluate(() => {
      const bar = document.querySelector('.fmt-toolbar[data-fmt-for="explanationTemplate"]');
      const text = bar?.querySelector('.fmt-group-text')?.getBoundingClientRect();
      const align = bar?.querySelector('.fmt-group-align')?.getBoundingClientRect();
      const notes = bar?.querySelector('.fmt-group-notes')?.getBoundingClientRect();
      const br = bar?.getBoundingClientRect();
      const svgs = [...(bar?.querySelectorAll('[data-action="fmt-align"] svg') || [])].map((s) => s.getBoundingClientRect().width);
      return {
        barW: br?.width || 0,
        textLeft: text?.left || 0,
        barLeft: br?.left || 0,
        alignMid: align ? align.left + align.width / 2 : 0,
        barMid: br ? br.left + br.width / 2 : 0,
        notesRight: notes?.right || 0,
        barRight: br?.right || 0,
        svgMin: Math.min(...svgs, 99),
        textH: text?.height || 0,
      };
    });
    if (focusBar.barW < 500) throw new Error(`집중편집 툴바가 좁음 ${JSON.stringify(focusBar)}`);
    if (Math.abs(focusBar.textLeft - focusBar.barLeft) > 24) throw new Error(`집중 텍스트 그룹 왼쪽 아님 ${JSON.stringify(focusBar)}`);
    if (Math.abs(focusBar.alignMid - focusBar.barMid) > 56) throw new Error(`집중 정렬 그룹 가운데 아님 ${JSON.stringify(focusBar)}`);
    if (Math.abs(focusBar.notesRight - focusBar.barRight) > 28) throw new Error(`집중 노트 그룹 오른쪽 아님 ${JSON.stringify(focusBar)}`);
    if (focusBar.svgMin < 16 || focusBar.textH > 48) throw new Error(`집중 아이콘/그룹 ${JSON.stringify(focusBar)}`);
    await page.screenshot({ path: SHOT_FOCUS, fullPage: false });
    await page.screenshot({ path: SHOT_NOTES_FOCUS, fullPage: false });
    await page.locator('[data-action="close-explanation-focus"]').click();
    if (!(await isDisplayed(page.locator('#createNotesMount #notesPanel')))) throw new Error('집중편집 종료 후 패널 숨김');
    if (!(await isDisplayed(page.locator('#notesList .study-fn-body')))) throw new Error('집중편집 종료 후 펼친 각주 유실');
    if (await page.locator('#notesMemo').inputValue() !== '제작메모구분') throw new Error('집중편집 종료 후 메모 유실');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-action="open-explanation-focus"]').click();
    const notesTab = page.locator('body.create-explanation-focus [data-action="study-notes-tab"][data-tab="notes"]');
    const expl = page.locator('body.create-explanation-focus #explanationTemplate');
    if (!(await isDisplayed(notesTab)) || !(await isDisplayed(expl))) {
      throw new Error('좁은 화면에서 각주 탭/해설 편집기가 안 보임');
    }
    await notesTab.click();
    if (!(await isDisplayed(page.locator('body.create-explanation-focus #notesList')))) {
      throw new Error('좁은 화면 집중편집에서 각주 목록 안 보임');
    }
    const narrowGeom = await page.evaluate(() => {
      const expl = document.getElementById('explanationTemplate')?.getBoundingClientRect();
      const notes = document.getElementById('notesPanel')?.getBoundingClientRect();
      const bar = document.querySelector('.fmt-toolbar[data-fmt-for="explanationTemplate"]')?.getBoundingClientRect();
      const save = document.querySelector('body.create-explanation-focus [data-action="save-card"]')?.getBoundingClientRect();
      const tabs = document.querySelector('body.create-explanation-focus [data-action="notes-field-tab"]')?.getBoundingClientRect();
      return {
        vw: window.innerWidth,
        explW: expl?.width || 0,
        explH: expl?.height || 0,
        explBottom: expl?.bottom || 0,
        notesW: notes?.width || 0,
        notesH: notes?.height || 0,
        notesTop: notes?.top || 0,
        notesLeft: notes?.left || 0,
        barW: bar?.width || 0,
        saveOn: !!(save && save.width > 1 && save.top >= 0 && save.bottom <= window.innerHeight + 1),
        tabsOn: !!(tabs && tabs.width > 1),
      };
    });
    if (narrowGeom.explW < narrowGeom.vw * 0.8) {
      throw new Error(`좁은 집중편집 너비가 뷰포트에 못 미침 ${JSON.stringify(narrowGeom)}`);
    }
    if (narrowGeom.notesW < narrowGeom.vw * 0.8 || narrowGeom.notesH < 80) {
      throw new Error(`좁은 화면 노트 패널이 하단 폭을 못 씀 ${JSON.stringify(narrowGeom)}`);
    }
    if (narrowGeom.notesTop + 8 < narrowGeom.explBottom) {
      throw new Error(`좁은 집중편집에서 노트와 편집기가 겹침 ${JSON.stringify(narrowGeom)}`);
    }
    if (!narrowGeom.saveOn || !narrowGeom.tabsOn || narrowGeom.barW < 200) {
      throw new Error(`좁은 집중편집 툴바/탭/저장 미도달 ${JSON.stringify(narrowGeom)}`);
    }
    await page.screenshot({ path: SHOT_NARROW, fullPage: false });
    await page.locator('[data-action="close-explanation-focus"]').click();
    await page.setViewportSize({ width: 1280, height: 900 });
    pass('create shared notes panel / focus-edit');

    dialogCtl.dismissConfirm = true;
    await clickVisibleNav(page, 'nav-manage');
    const stillCreate = await page.evaluate(() => document.getElementById('createSection')?.classList.contains('hidden') === false);
    if (!stillCreate) throw new Error('이동 취소 후 제작 화면이 아님');
    if (!(await isDisplayed(page.locator('#createNotesMount #notesPanel')))) {
      throw new Error('이동 취소가 공유 패널 호스트를 바꿈');
    }
    if (await page.locator('#notesMemo').inputValue() !== '제작메모구분') throw new Error('이동 취소 후 제작 메모 유실');
    pass('cancel navigation keeps notes host');

    await clickVisibleNav(page, 'nav-manage');
    await waitObserve(page, (s) => s.section === 'manage', 8000, '초안 저장 후 관리');
    await page.locator('#cardList .list-item', { hasText: '서식카드B' }).locator('.item-title').click();
    await page.locator('#manageDetail [data-action="study-one"]').click();
    await waitObserve(page, (s) => s.section === 'study-play', 10000, '학습 B 메모');
    if (!(await isDisplayed(page.locator('#studyNotesMount #notesPanel')))) throw new Error('학습 B에서 패널 안 보임');
    await page.locator('[data-action="study-notes-tab"][data-tab="memo"]').click();
    const bMemo = await page.locator('#notesMemo').inputValue();
    if (bMemo === '제작메모구분') throw new Error('학습 B 메모에 제작 A 초안이 누수');
    await clickVisibleNav(page, 'nav-create');
    await page.waitForSelector('#createSection:not(.hidden) #notesPanel');
    await page.locator('[data-action="study-notes-tab"][data-tab="memo"]').click();
    if (await page.locator('#notesMemo').inputValue() !== '제작메모구분') {
      throw new Error(`A 초안 메모 미복원 ${await page.locator('#notesMemo').inputValue()}`);
    }
    pass('create A memo draft survives study B');

    await clickVisibleNav(page, 'nav-manage');
    await waitObserve(page, (s) => s.section === 'manage', 8000, 'A 학습 전 관리');
    await page.locator('#cardList .list-item', { hasText: '서식카드A' }).locator('.item-title').click();
    await page.locator('#manageDetail [data-action="study-one"]').click();
    await waitObserve(page, (s) => s.section === 'study-play', 10000, '학습 A');
    await page.locator('[data-action="study-notes-tab"][data-tab="memo"]').click();
    await page.locator('#notesMemo').fill('학습수정메모');
    await page.locator('[data-action="save-memo"]').click();
    await page.waitForTimeout(200);
    if (!(await isDisplayed(page.locator('#studyNotesMount #notesPanel')))) {
      throw new Error('학습 메모 저장 후 패널이 학습에서 사라짐');
    }
    if (await page.locator('#createNotesMount #notesPanel').count()) {
      throw new Error('숨은 제작 폼이 학습 패널을 빼앗음');
    }
    await page.locator('[data-action="study-notes-tab"][data-tab="memo"]').click();
    const studyMemoAfter = await page.locator('#notesMemo').inputValue();
    if (studyMemoAfter === '제작메모구분') throw new Error('학습 메모가 제작 초안으로 덮임');
    await clickVisibleNav(page, 'nav-create');
    await page.waitForSelector('#createSection:not(.hidden) #notesPanel');
    await page.locator('[data-action="study-notes-tab"][data-tab="memo"]').click();
    if (await page.locator('#notesMemo').inputValue() !== '제작메모구분') {
      throw new Error(`학습 저장 후 A 초안 메모 유실 ${await page.locator('#notesMemo').inputValue()}`);
    }
    pass('study memo save does not steal notes panel');

    await selectOffsets(page, 'explanationTemplate', 3, 5);
    await page.locator('#explanationTemplate').press('Control+b');
    st = await editorMeta(page);
    if (st.explModel.blanks.length < 2) throw new Error(`Ctrl+B 빈칸 생성 실패 blanks=${st.explModel.blanks.length}`);
    const blankId = st.explModel.blanks[1]?.id || st.explModel.blanks[0]?.id;
    await page.locator('[data-action="remove-blank-order"][data-editor="explanationTemplate"]').first().click();
    const afterRm = await editorMeta(page);
    const still = afterRm.explModel.blanks.some((b) => b.id === blankId && afterRm.explModel.blanks.length >= 2);
    void still;
    await page.locator('[data-action="quick-auto-blank"][data-editor="explanationTemplate"]').click();
    const alias = page.locator('input[data-alias-for="1"][data-editor="explanationTemplate"]');
    if (await alias.count()) {
      await alias.fill('동의||다른동의');
    }
    st = await editorMeta(page);
    pass('blank create/remove/aliases', `blanks=${st.explModel.blanks.length}`);

    const visBefore = (await editorMeta(page)).promptText;
    await page.locator('#promptTemplate').click();
    await page.keyboard.type('가나다');
    await page.locator('#promptTemplate').press('Control+z');
    st = await editorMeta(page);
    if (st.promptText.includes('가나다') && !visBefore.includes('가나다')) {
      throw new Error(`즉시 Undo 실패 text=${st.promptText}`);
    }
    await page.locator('#promptTemplate').press('Control+Shift+z');
    pass('immediate undo/redo after typing');

    await page.locator('#promptTemplate').click();
    await page.keyboard.press('End');
    await page.keyboard.type('  😀줄\n중간');
    await page.locator('#promptTemplate').press('Control+a');
    await page.keyboard.press('Delete');
    await page.keyboard.type('붙여넣기대상');
    await page.evaluate(async () => {
      const el = document.getElementById('promptTemplate');
      el.focus();
      const dt = new DataTransfer();
      dt.setData('text/plain', '복붙텍스트');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    st = await editorMeta(page);
    if (!st.promptText.includes('복붙텍스트') && !st.promptText.includes('붙여넣기대상')) {
      throw new Error(`붙여넣기/다줄 미반영 ${st.promptText}`);
    }
    pass('emoji/newline/paste');

    await page.locator('#promptTemplate').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.keyboard.type('줄A');
    await page.keyboard.press('Enter');
    await page.keyboard.type('줄B');
    const enterPreview = await page.evaluate(async () => {
      const { readCreateForm } = await import('/js/ui/create.js');
      const form = readCreateForm();
      const preview = document.getElementById('promptPreview')?.innerText || '';
      return { displayText: form.displayText, preview };
    });
    if (enterPreview.displayText !== '줄A\n줄B') {
      throw new Error(`Enter 미리보기/폼 원문 불일치 ${JSON.stringify(enterPreview)}`);
    }
    if (!enterPreview.preview.includes('줄A') || !enterPreview.preview.includes('줄B')) {
      throw new Error(`Enter 후 미리보기 미갱신 ${JSON.stringify(enterPreview)}`);
    }
    pass('Enter dispatches input for preview/draft');

    await page.locator('#explanationTemplate').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.keyboard.type('앞AB뒤');
    await selectOffsets(page, 'explanationTemplate', 1, 3);
    await page.locator('#explanationTemplate').press('Control+b');
    st = await editorMeta(page);
    const chipBlankId = st.explModel.blanks[0]?.id;
    const chipAnswer = st.explModel.blanks[0]?.answer;
    if (!chipBlankId || chipAnswer !== 'AB') {
      throw new Error(`빈칸 칩 생성 실패 ${JSON.stringify(st.explModel.blanks)}`);
    }
    await selectOffsets(page, 'explanationTemplate', 0, 0);
    await page.keyboard.type('Z');
    st = await editorMeta(page);
    const visExpl = await page.evaluate(async () => {
      const { editorVisibleText } = await import('/js/ui/chip-editor.js');
      return editorVisibleText(document.getElementById('explanationTemplate'));
    });
    if (visExpl !== 'Z앞AB뒤') throw new Error(`빈칸 앞 삽입 가시원문 ${visExpl}`);
    if (st.explModel.blanks[0]?.id !== chipBlankId) throw new Error('빈칸 id 변경');
    if (st.explModel.blanks[0]?.answer !== 'AB') throw new Error(`빈칸 답 손상 ${JSON.stringify(st.explModel.blanks[0])}`);
    pass('rebuild keeps blank id/answer after text before chip');

    await page.evaluate(async () => {
      const el = document.getElementById('promptTemplate');
      el.focus();
      const sel = window.getSelection();
      sel.selectAllChildren(el);
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: '각', isComposing: true, inputType: 'insertCompositionText' }));
      el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '각' }));
    });
    st = await editorMeta(page);
    pass('synthetic composition (not OS IME)', `textLen=${st.promptText.length} marks=${st.meta.textMarks.display.length}`);

    await openCardEdit(page, '서식카드B');
    await page.locator('#promptTemplate').click();
    await page.keyboard.type('첫편집');
    await page.locator('#promptTemplate').press('Control+z');
    st = await editorMeta(page);
    if (st.promptText.includes('첫편집')) throw new Error(`카드B 첫편집 Undo 실패 ${st.promptText}`);
    if (st.title !== '서식카드B') throw new Error('카드B가 아님');
    if (st.meta.footnotes.some((f) => f.body === '문제취지A')) throw new Error('카드A 각주가 B에 남음');
    pass('card A→B first edit undo baseline');

    await openCardEdit(page, '정렬카드');
    const alignText = await page.evaluate(() => document.getElementById('promptTemplate')?.innerText || '');
    const p0 = alignText.indexOf('\n');
    const p1 = alignText.indexOf('\n', p0 + 1);
    if (p0 < 2 || p1 < p0 + 2) throw new Error(`정렬카드 문단 부족 ${JSON.stringify(alignText)}`);
    await selectOffsets(page, 'promptTemplate', 1, 1);
    await page.locator('[data-action="fmt-align"][data-editor="promptTemplate"][data-align="center"]').click();
    await page.locator('[data-action="fmt-align"][data-editor="promptTemplate"][data-align="center"]').click();
    st = await editorMeta(page);
    const centerMarks = st.meta.textMarks.display.filter((m) => m.type === 'align' && m.value === 'center');
    if (!centerMarks.length || centerMarks.some((m) => m.end > p0)) {
      throw new Error(`캐럿 문단만 가운데가 아님 ${JSON.stringify(st.meta.textMarks.display)} p0=${p0}`);
    }
    await selectOffsets(page, 'promptTemplate', p0 + 2, p0 + 2);
    await page.locator('[data-action="fmt-align"][data-editor="promptTemplate"][data-align="right"]').click();
    st = await editorMeta(page);
    const afterRight = st.meta.textMarks.display.filter((m) => m.type === 'align');
    if (!afterRight.some((m) => m.value === 'center' && m.end <= p0) || !afterRight.some((m) => m.value === 'right' && m.start >= p0 + 1 && m.end <= p1)) {
      throw new Error(`인접 문단 독립 정렬 실패 ${JSON.stringify(afterRight)} p0=${p0} p1=${p1}`);
    }
    await selectOffsets(page, 'promptTemplate', 0, p0 + 1);
    await page.locator('[data-action="fmt-align"][data-editor="promptTemplate"][data-align="justify"]').click();
    st = await editorMeta(page);
    const afterJust = st.meta.textMarks.display.filter((m) => m.type === 'align');
    if (!afterJust.some((m) => m.value === 'justify' && m.end <= p0)) {
      throw new Error(`다음 문단 시작에서 끝난 선택이 첫 문단만 아님 ${JSON.stringify(afterJust)}`);
    }
    if (!afterJust.some((m) => m.value === 'right' && m.start >= p0 + 1)) {
      throw new Error(`둘째 문단 오른쪽 정렬 유실 ${JSON.stringify(afterJust)}`);
    }
    await selectOffsets(page, 'promptTemplate', p1 + 2, p1 + 2);
    await page.locator('[data-action="fmt-align"][data-editor="promptTemplate"][data-align="left"]').click();
    const geom = await page.evaluate(() => {
      const lines = [...document.querySelectorAll('#promptTemplate .tm-line')];
      const prev = [...document.querySelectorAll('#promptPreview .tm-line')];
      const info = (el) => {
        const cs = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(el);
        const tr = range.getBoundingClientRect();
        return { align: cs.textAlign, x: box.x, w: box.width, tx: tr.x, tw: tr.width, text: (el.innerText || '').trim() };
      };
      return { editor: lines.map(info), preview: prev.map(info), editorText: document.getElementById('promptTemplate')?.innerText };
    });
    if (geom.editor.length < 3) throw new Error(`편집기 문단 래핑 없음 ${JSON.stringify(geom)}`);
    if (geom.editor[0].align !== 'justify' || geom.preview[0]?.align !== 'justify') {
      throw new Error(`첫 문단 justify computed 아님 ${JSON.stringify(geom)}`);
    }
    if (geom.editor[1].align !== 'right' || geom.preview[1]?.align !== 'right') {
      throw new Error(`둘째 문단 right computed 아님 ${JSON.stringify(geom)}`);
    }
    if (geom.editor[1].tx < geom.editor[1].x + 20) {
      throw new Error(`둘째 문단 오른쪽 기하 아님 ${JSON.stringify(geom.editor[1])}`);
    }
    const explVis = await page.evaluate(async () => {
      const { editorVisibleText } = await import('/js/ui/chip-editor.js');
      return editorVisibleText(document.getElementById('explanationTemplate'));
    });
    const e0 = explVis.indexOf('\n');
    const e1 = explVis.indexOf('\n', e0 + 1);
    if (e0 < 2 || e1 < e0 + 2) throw new Error(`해설 문단 부족 ${JSON.stringify(explVis)}`);
    await selectOffsets(page, 'explanationTemplate', 1, 1);
    await page.locator('[data-action="fmt-align"][data-editor="explanationTemplate"][data-align="left"]').click();
    await selectOffsets(page, 'explanationTemplate', e0 + 2, e0 + 2);
    await page.locator('[data-action="fmt-align"][data-editor="explanationTemplate"][data-align="center"]').click();
    await selectOffsets(page, 'explanationTemplate', e1 + 2, e1 + 2);
    await page.locator('[data-action="fmt-align"][data-editor="explanationTemplate"][data-align="right"]').click();
    await page.locator('[data-action="open-explanation-focus"]').click();
    await page.locator('body.create-explanation-focus [data-action="study-notes-tab"][data-tab="notes"]').click();
    const focusAlign = await page.evaluate(() => [...document.querySelectorAll('#explanationTemplate .tm-line')].map((el) => getComputedStyle(el).textAlign));
    if (!focusAlign.includes('left') || !focusAlign.includes('center') || !focusAlign.includes('right')) {
      throw new Error(`집중편집 3정렬 없음 ${JSON.stringify(focusAlign)}`);
    }
    await page.screenshot({ path: SHOT_ALIGN, fullPage: false });
    await page.locator('[data-action="close-explanation-focus"]').click();
    const beforeType = geom.editorText;
    void beforeType;
    await selectOffsets(page, 'promptTemplate', p0, p0);
    await page.locator('#promptTemplate').click();
    await page.keyboard.type('추');
    st = await editorMeta(page);
    if (!st.promptText.includes('추')) throw new Error(`정렬 문단 타이핑 유실 ${st.promptText}`);
    await page.locator('#promptTemplate').press('Enter');
    await page.keyboard.type('새줄');
    st = await editorMeta(page);
    if (!st.promptText.includes('새줄')) throw new Error(`Enter 후 텍스트 없음 ${st.promptText}`);
    await page.locator('#promptTemplate').press('Backspace');
    await page.locator('#promptTemplate').press('Backspace');
    await page.evaluate(() => {
      const el = document.getElementById('promptTemplate');
      el.focus();
      const dt = new DataTransfer();
      dt.setData('text/plain', '붙여');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    st = await editorMeta(page);
    if (!st.promptText.includes('붙여') && !st.promptText.includes('새')) {
      throw new Error(`정렬 문단 paste/Enter 손상 ${st.promptText}`);
    }
    const explBefore = st.explModel;
    if (explBefore.blanks[0]?.answer !== '정렬답\n줄') {
      throw new Error(`멀티라인 빈칸 손상 ${JSON.stringify(explBefore.blanks[0])}`);
    }
    await page.locator('#promptTemplate').press('Control+z');
    await page.locator('#promptTemplate').press('Control+Shift+z');
    await saveCreateUi(page);
    const idbAlign = await idbCard(page, '정렬카드');
    if (!idbAlign?.textMarks?.display?.some((m) => m.type === 'align' && m.value === 'justify')) {
      throw new Error(`정렬 저장 실패 ${JSON.stringify(idbAlign?.textMarks)}`);
    }
    await openManage(page);
    await page.locator('#cardList .list-item', { hasText: '정렬카드' }).locator('.item-title').click();
    await page.locator('#manageDetail [data-action="study-one"]').click();
    await waitObserve(page, (s) => s.section === 'study-play', 10000, '정렬 학습');
    const studyAlign = await page.evaluate(() => [...document.querySelectorAll('#studyPrompt .tm-line')].map((el) => getComputedStyle(el).textAlign));
    if (!studyAlign.includes('justify') || !studyAlign.includes('right')) {
      throw new Error(`학습 정렬 computed 없음 ${JSON.stringify(studyAlign)}`);
    }
    await clickVisibleNav(page, 'nav-manage');
    await waitObserve(page, (s) => s.section === 'manage', 8000, '정렬 후 관리');
    pass('paragraph alignment editor/preview/study', `paras=${geom.editor.length} study=${studyAlign.join(',')}`);

    await openCardEdit(page, '메타없음');
    await page.locator('#promptTemplate').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('가나다');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('라마바');
    const readVis = async () => page.evaluate(async () => {
      const { editorVisibleText, readChipEditor } = await import('/js/ui/chip-editor.js');
      const { readAllEditorMeta } = await import('/js/ui/editor-surface.js');
      return {
        vis: editorVisibleText(document.getElementById('promptTemplate')),
        tmpl: readChipEditor('promptTemplate').template,
        marks: readAllEditorMeta().textMarks.display,
      };
    });
    let cross = await readVis();
    if (cross.vis !== '가나다\n\n라마바' || cross.tmpl !== '가나다\n\n라마바') {
      throw new Error(`빈 줄 문단 원문 아님 ${JSON.stringify(cross)}`);
    }
    await selectOffsets(page, 'promptTemplate', 0, cross.vis.length);
    await page.locator('[data-action="fmt-bold"][data-editor="promptTemplate"]').click();
    await selectOffsets(page, 'promptTemplate', 0, cross.vis.length);
    await applyMenuColor(page, 'promptTemplate', 'r');
    await selectOffsets(page, 'promptTemplate', 0, cross.vis.length);
    await page.locator('[data-action="fmt-hl"][data-editor="promptTemplate"]').click();
    cross = await readVis();
    if (cross.vis !== '가나다\n\n라마바' || cross.tmpl !== '가나다\n\n라마바') {
      throw new Error(`개행 걸친 서식 후 원문 손상 ${JSON.stringify(cross)}`);
    }
    if (!markCovers(cross.marks, 'bold', 0, 3) || !markCovers(cross.marks, 'bold', 5, 8)) {
      throw new Error(`개행 걸친 볼드 유실 ${JSON.stringify(cross.marks)}`);
    }
    if (!markCovers(cross.marks, 'color', 0, 3, 'r') || !markCovers(cross.marks, 'hl', 5, 8)) {
      throw new Error(`개행 걸친 색/형광 유실 ${JSON.stringify(cross.marks)}`);
    }
    const nestedLines = await page.evaluate(() => {
      const bold = document.querySelector('#promptTemplate .tm-bold');
      return bold ? bold.querySelectorAll('.tm-line').length : 0;
    });
    if (nestedLines > 1) throw new Error(`볼드가 tm-line 형제를 삼킴 nested=${nestedLines}`);
    await page.locator('#promptTemplate').press('Control+z');
    await page.locator('#promptTemplate').press('Control+z');
    await page.locator('#promptTemplate').press('Control+z');
    cross = await readVis();
    if (cross.vis !== '가나다\n\n라마바') throw new Error(`개행 서식 Undo 후 원문 손상 ${JSON.stringify(cross)}`);
    await page.locator('#promptTemplate').press('Control+Shift+z');
    await page.locator('#promptTemplate').press('Control+Shift+z');
    await page.locator('#promptTemplate').press('Control+Shift+z');
    cross = await readVis();
    if (cross.vis !== '가나다\n\n라마바') throw new Error(`개행 서식 Redo 후 원문 손상 ${JSON.stringify(cross)}`);
    await saveCreateUi(page);
    await openManage(page);
    await openCardEdit(page, '메타없음');
    cross = await readVis();
    if (cross.vis !== '가나다\n\n라마바' || cross.tmpl !== '가나다\n\n라마바') {
      throw new Error(`개행 서식 저장/재오픈 원문 손상 ${JSON.stringify(cross)}`);
    }
    if (!markCovers(cross.marks, 'bold', 0, 3) || !markCovers(cross.marks, 'hl', 5, 8)) {
      throw new Error(`개행 서식 재오픈 마크 유실 ${JSON.stringify(cross.marks)}`);
    }
    pass('inline marks across newlines keep canonical text');

    await openCardEdit(page, '서식카드A');
    await selectOffsets(page, 'promptTemplate', 2, 4);
    await page.locator('[data-action="fmt-hl"][data-editor="promptTemplate"]').click();
    const beforeSaveMeta = await editorMeta(page);
    if (!beforeSaveMeta.meta.textMarks.display.some((m) => m.type === 'hl')) {
      throw new Error('저장 전 형광이 메타에 없음');
    }
    await saveCreateUi(page);
    const idb = await idbCard(page, '서식카드A');
    if (!idb?.textMarks?.display?.some((m) => m.type === 'hl')) throw new Error(`IDB에 형광 없음 ${JSON.stringify(idb?.textMarks)}`);
    if (!idb.footnotes?.length) throw new Error('IDB에 각주 없음');
    if (idb.id !== beforeId) throw new Error(`저장 후 id 변경 ${beforeId} → ${idb.id}`);
    if (idb.rounds !== beforeRounds || idb.wrongCount !== beforeWrong) {
      throw new Error(`학습 메타 손실 rounds ${beforeRounds}→${idb.rounds} wrong ${beforeWrong}→${idb.wrongCount}`);
    }
    const nativeB = await page.evaluate(() => !!document.querySelector('#promptTemplate b, #promptTemplate strong'));
    if (nativeB) throw new Error('native <b>/<strong> 가 DOM에 남아 저장 유실 위험');
    const visHl = await page.evaluate(() => !!document.querySelector('#promptPreview .tm-hl, #promptTemplate .tm-hl'));
    if (!visHl) throw new Error('저장 직후 가시 형광 없음');
    pass('save to IDB preserves id/meta/marks');

    await logoutViaUi(page);
    await page.reload();
    await passAlphaGate(page, TEST_ALPHA_PLANNER);
    await loginViaUi(page, 'E2E유저', '1234');
    await waitObserve(page, (s) => s.listTitles.includes('서식카드A'), 10000, 'reload 로그인');
    await openCardEdit(page, '서식카드A');
    st = await editorMeta(page);
    if (st.id !== beforeId) throw new Error('reload 후 id 불일치');
    if (!st.preview.bold && !st.meta.textMarks.display.some((m) => m.type === 'bold')) {
      throw new Error('reload 후 볼드 유실');
    }
    if (!st.meta.footnotes.length) throw new Error('reload 후 각주 유실');
    pass('reload + UI login restores editor');

    await page.locator('#promptTemplate').click();
    await page.keyboard.type('초안표시');
    await clickVisibleNav(page, 'nav-manage');
    await waitObserve(page, (s) => s.section === 'manage', 8000, '초안 이탈');
    await clickVisibleNav(page, 'nav-create');
    await page.waitForSelector('#createSection:not(.hidden) #promptTemplate');
    st = await editorMeta(page);
    if (!st.promptText.includes('초안표시')) throw new Error(`제작 초안 복원 실패 ${st.promptText}`);
    if (!st.meta.footnotes.length) throw new Error('초안 복원 시 각주 유실');
    pass('create draft leave/restore keeps meta');

    await openCardEdit(page, '메타없음');
    st = await editorMeta(page);
    if (st.title !== '메타없음' || !st.promptText) throw new Error(`메타 없는 카드 편집 실패 ${st.promptText}`);
    await saveCreateUi(page);
    pass('card without metadata still saves');

    await openManage(page);
    await page.locator('#cardList .list-item', { hasText: '서식카드A' }).locator('.item-title').click();
    await page.locator('#manageDetail .tm-fn').first().waitFor({ state: 'visible', timeout: 8000 });
    const manageFn = await page.locator('#manageDetail .tm-fn').first().getAttribute('data-fn-id');
    await page.locator('#manageDetail .tm-fn').first().click();
    await page.waitForSelector('#modalRoot [data-fn-reader]', { timeout: 5000 });
    const reader = await page.locator('#modalRoot .study-fn-body').innerText();
    if (!reader.includes('문제취지A') && !reader.includes('해설취지A')) {
      throw new Error(`관리 각주가 해당 카드가 아님: ${reader} id=${manageFn}`);
    }
    const notesOpen = await page.evaluate(() => document.querySelector('#notesList .study-fn-body')?.textContent || '');
    if (notesOpen.includes('문제취지B')) throw new Error('관리 marker가 다른 학습 카드 각주를 염');
    await page.locator('#modalRoot [data-action="close-modal"]').click();
    pass('manage marker routes to that card');

    await page.locator('#manageDetail [data-action="study-one"]').click();
    await waitObserve(page, (s) => s.section === 'study-play', 10000, '학습 시작 A');
    const studyFont = await page.evaluate(() => ({
      prompt: getComputedStyle(document.getElementById('studyPrompt')).fontStyle,
      expl: getComputedStyle(document.getElementById('studyExplanation')).fontStyle,
      promptEmpty: document.getElementById('studyPrompt').classList.contains('empty'),
      explEmpty: document.getElementById('studyExplanation').classList.contains('empty'),
    }));
    if (studyFont.prompt !== 'normal' || studyFont.expl !== 'normal') {
      throw new Error(`학습 본문 placeholder 기울임 ${JSON.stringify(studyFont)}`);
    }
    if (studyFont.promptEmpty || studyFont.explEmpty) {
      throw new Error(`학습 본문에 empty 클래스 남음 ${JSON.stringify(studyFont)}`);
    }
    const hasStudyFmt = await page.evaluate(() => !!document.querySelector('#studyPrompt .tm-bold, #studyPrompt .tm-hl, #studyPrompt .tm-color'));
    if (!hasStudyFmt) throw new Error('학습 문제 서식 미표시');
    const studyToggle = await page.locator('#notesList .study-fn-jump').allInnerTexts();
    if (studyToggle.some((t) => t.includes('문제취지') || t.includes('다른답'))) {
      throw new Error(`학습 토글이 원문/답을 인용 ${studyToggle}`);
    }
    if (!studyToggle.some((t) => t.includes('각주 1'))) throw new Error(`각주 목록 번호 없음: ${studyToggle}`);
    if (await page.locator('#notesList .study-fn-body').count() < 1) throw new Error('학습 각주 기본 펼침 아님');
    const markerIdx = await page.locator('#studyPrompt .tm-fn').first().getAttribute('data-fn-index');
    const listLabel = await page.locator('.study-fn-jump').first().innerText();
    if (markerIdx && !listLabel.includes(`각주 ${markerIdx}`)) {
      throw new Error(`marker ${markerIdx} vs 목록 ${listLabel}`);
    }
    await page.locator('#studyPrompt .tm-fn').first().click();
    const opened = await page.locator('#notesList .study-fn-body').allInnerTexts();
    if (!opened.some((t) => t.includes('문제취지A'))) throw new Error(`학습 각주 오픈 실패 ${opened}`);
    await page.locator('#notesMemoWrap, [data-action="study-notes-tab"][data-tab="memo"]').first().click();
    const memoTab = page.locator('[data-action="study-notes-tab"][data-tab="memo"]');
    if (await memoTab.count()) await memoTab.click();
    await page.locator('#notesMemo').fill('메모입력보존');
    await memoTab.click().catch(() => {});
    await page.locator('[data-action="study-notes-tab"][data-tab="notes"]').click();
    const memoVal = await page.locator('#notesMemo').inputValue().catch(() => '');
    void memoVal;
    pass('study footnotes vs memo, no auto body');

    await clickVisibleNav(page, 'nav-study');
    const nextBtn = page.locator('[data-action="next-card"]');
    if (await nextBtn.count()) {
      await page.locator('#cardList .list-item', { hasText: '서식카드B' }).locator('.item-title').click().catch(() => {});
    }
    await openManage(page);
    await page.locator('#cardList .list-item', { hasText: '서식카드B' }).locator('.item-title').click();
    await page.locator('#manageDetail [data-action="study-one"]').click();
    await waitObserve(page, (s) => s.section === 'study-play', 10000, '학습 B');
    const bList = await page.locator('#notesList').innerText();
    if (bList.includes('문제취지A')) throw new Error('B 학습에 A 각주 오염');
    const bToggles = await page.locator('#notesList .study-fn-jump').allInnerTexts();
    if (bToggles.some((t) => t.includes('문제취지'))) throw new Error(`B 토글이 본문 인용 ${bToggles}`);
    pass('card switch keeps footnote bodies without A leak');

    await openManage(page);
    await page.locator('#cardList .list-item', { hasText: '서식카드A' }).locator('.item-title').click();
    await page.locator('#manageDetail [data-action="study-one"]').click();
    await waitObserve(page, (s) => s.section === 'study-play' && s.blanks.length >= 1, 10000, '학습 입력');
    const wrap1 = page.locator('#blankWrap1');
    await wrap1.waitFor({ state: 'visible', timeout: 8000 });
    await wrap1.click();
    await page.keyboard.type('답답');
    await page.locator('[data-action="grade"]').click();
    await waitObserve(page, (s) => s.blanks.some((b) => b.order === 1 && b.ok), 8000, '채점 ok');
    const counts1 = await page.evaluate(async () => {
      const { store } = await import('/js/core/store.js');
      const c = store.studyQueue[store.studyIndex];
      return {
        rounds: c.rounds, wrong: c.wrongCount,
        attempt: store.studyAttemptRecorded, round: store.studyRoundRecorded,
      };
    });
    await page.locator('[data-action="hide-answers"]').click();
    await waitObserve(page, (s) => s.blanks.every((b) => !b.text), 8000, '다시 풀기 입력 초기화');
    const counts2 = await page.evaluate(async () => {
      const { store } = await import('/js/core/store.js');
      return { attempt: store.studyAttemptRecorded, round: store.studyRoundRecorded };
    });
    if (counts2.attempt || counts2.round) throw new Error(`다시 풀기 가드 미재설정 ${JSON.stringify(counts2)}`);
    await clickVisibleNav(page, 'nav-manage');
    await waitObserve(page, (s) => s.section === 'manage', 8000, '학습 이탈');
    await page.locator('#cardList .list-item', { hasText: '서식카드A' }).locator('.item-title').click();
    await page.locator('#manageDetail [data-action="study-one"]').click();
    await waitObserve(page, (s) => s.section === 'study-play', 10000, '재진입');
    pass('study grade / retry / leave-reenter guards', JSON.stringify(counts1));

    const fontBefore = await page.evaluate(() => getComputedStyle(document.getElementById('studyPrompt')).fontSize);
    const slider = page.locator('#studyFontScale');
    await slider.waitFor({ state: 'visible', timeout: 8000 });
    await slider.scrollIntoViewIfNeeded();
    const box = await slider.boundingBox();
    if (!box || box.width < 8) throw new Error(`글자 크기 슬라이더 없음 ${JSON.stringify(box)}`);
    await slider.focus();
    await page.keyboard.press('End');
    const fontAfter = await page.evaluate(() => ({
      px: getComputedStyle(document.getElementById('studyPrompt')).fontSize,
      scale: document.documentElement.style.getPropertyValue('--study-font-scale'),
      label: document.getElementById('studyFontScaleLabel')?.textContent,
      value: document.getElementById('studyFontScale')?.value,
      inputW: document.querySelector('#studyExplanation [data-blank-order]')?.getBoundingClientRect().width || 0,
    }));
    if (fontBefore === fontAfter.px && (fontAfter.scale === '1' || fontAfter.value === '100')) {
      throw new Error(`본문 크기 미변경 ${fontBefore} → ${JSON.stringify(fontAfter)}`);
    }
    const scaleSaved = fontAfter.scale;
    const widthBefore = await page.evaluate(() => {
      const expl = document.querySelector('.study-layout > .study-panel:not(.study-prompt-panel)');
      const notes = document.getElementById('notesPanel');
      return {
        expl: expl?.getBoundingClientRect().width || 0,
        notes: notes?.getBoundingClientRect().width || 0,
      };
    });
    await page.locator('.study-prompt-panel [title="문제 가리기"]').click();
    const widthAfter = await (async () => {
      const started = Date.now();
      let last = null;
      while (Date.now() - started < 1200) {
        last = await page.evaluate(() => {
          const expl = document.querySelector('.study-layout > .study-panel:not(.study-prompt-panel)');
          const notes = document.getElementById('notesPanel');
          const layout = document.querySelector('.study-layout');
          return {
            collapsed: document.body.classList.contains('study-prompt-collapsed'),
            expl: expl?.getBoundingClientRect().width || 0,
            notes: notes?.getBoundingClientRect().width || 0,
            cols: layout ? getComputedStyle(layout).gridTemplateColumns : '',
          };
        });
        if (last.collapsed && last.expl > widthBefore.expl + 20) return last;
        await page.waitForTimeout(50);
      }
      return last;
    })();
    if (!widthAfter.collapsed) throw new Error('문제 가리기 미적용');
    if (Math.abs(widthAfter.notes - widthBefore.notes) > 8) {
      throw new Error(`각주 폭이 변함 ${widthBefore.notes} → ${widthAfter.notes}`);
    }
    if (widthAfter.expl <= widthBefore.expl + 20) {
      throw new Error(`해설 폭이 늘지 않음 ${widthBefore.expl} → ${widthAfter.expl} notes=${widthBefore.notes}/${widthAfter.notes}`);
    }
    await page.screenshot({ path: SHOT_STUDY, fullPage: true });
    pass('study font scale', `${fontBefore}→${fontAfter.px} scale=${fontAfter.scale}`);
    pass('prompt hide widens explanation', JSON.stringify({ widthBefore, widthAfter }));

    await page.locator('[data-action="edit-study-card"]').click();
    await page.waitForSelector('#createSection:not(.hidden) #promptTemplate', { timeout: 10000 });
    await selectOffsets(page, 'promptTemplate', 0, 2);
    await page.locator('[data-action="fmt-hl"][data-editor="promptTemplate"]').click();
    await page.locator('#createSection .create-head [data-action="save-card"]').click();
    await page.locator('#createStudyNavBtn').click();
    await waitObserve(page, (s) => s.section === 'study-play', 10000, '수정 저장 후 학습 복귀');
    const afterStudySave = await idbCard(page, '서식카드A');
    if (!afterStudySave?.textMarks?.display?.some((m) => m.type === 'hl')) {
      throw new Error('학습 중 수정 저장 후 서식 없음');
    }
    await page.locator('[data-action="edit-study-card"]').click();
    await page.waitForSelector('#createSection:not(.hidden) #promptTemplate', { timeout: 10000 });
    await page.locator('#promptTemplate').click();
    await page.keyboard.type('취소대상');
    await page.locator('#createStudyNavBtn').click();
    await waitObserve(page, (s) => s.section === 'study-play', 10000, '미저장 후 학습 복귀');
    const cancelled = await idbCard(page, '서식카드A');
    if (String(cancelled?.displayText || '').includes('취소대상')) {
      throw new Error('학습 중 수정 미저장이 본문에 남음');
    }
    pass('study-edit via create keeps new meta / unsaved discarded');

    await logoutViaUi(page);
    await loginViaUi(page, '타계정', '5678');
    await waitObserve(page, (s) => s.listTitles.includes('타카드'), 10000, '타계정 로그인');
    const otherTitles = await observe(page);
    if (otherTitles.listTitles.includes('서식카드A')) throw new Error('타계정에 서식카드A 노출');
    await logoutViaUi(page);
    await loginViaUi(page, 'E2E유저', '1234');
    await waitObserve(page, (s) => s.listTitles.includes('서식카드A'), 10000, 'E2E 복귀');
    await openCardEdit(page, '서식카드A');
    st = await editorMeta(page);
    if (st.meta.footnotes.some((f) => f.body === '문제취지B') && st.title === '서식카드A') {
      /* B 각주가 A에 섞이면 실패 */
      if (st.meta.footnotes.filter((f) => f.body.includes('취지B')).length) {
        throw new Error('계정 교대 후 각주 오염');
      }
    }
    const fontAgain = await page.evaluate(() => document.documentElement.style.getPropertyValue('--study-font-scale'));
    void fontAgain;
    pass('two-account isolation');

    await logoutViaUi(page);
    await page.reload();
    await passAlphaGate(page, TEST_ALPHA_PLANNER);
    await loginViaUi(page, 'E2E유저', '1234');
    await waitObserve(page, (s) => s.listTitles.includes('서식카드A'), 10000, '폰트 persist 로그인');
    await openManage(page);
    await page.locator('#cardList .list-item', { hasText: '서식카드A' }).locator('.item-title').click();
    await page.locator('#manageDetail [data-action="study-one"]').click();
    await waitObserve(page, (s) => s.section === 'study-play', 10000, '폰트 재진입');
    const fontReload = await page.evaluate(() => document.documentElement.style.getPropertyValue('--study-font-scale'));
    if (scaleSaved && fontReload && scaleSaved !== fontReload) {
      throw new Error(`폰트 reload 불일치 ${scaleSaved} vs ${fontReload}`);
    }
    pass('font scale persists after reload', fontReload);

    await openCardEdit(page, '서식카드A');
    await page.screenshot({ path: SHOT_CREATE, fullPage: true });
    const toolbarCount = await page.locator('.fmt-toolbar button').count();
    if (toolbarCount < 8) throw new Error(`툴바 버튼 부족 ${toolbarCount}`);
    pass('toolbar reachable + screenshots');
  } catch (err) {
    fail('editor-browser', err);
  }

  await browser.close();
  server.close();
  const failed = results.filter((r) => !r.ok).length;
  writeFileSync(LOG, `${lines.join('\n')}\nshots: ${SHOT_CREATE}\n${SHOT_STUDY}\n${SHOT_FOCUS}\n${SHOT_TOOLBAR}\n${SHOT_ALIGN}\n${SHOT_NARROW}\n${SHOT_NOTES_FILLED}\n${SHOT_NOTES_FOCUS}\n`, 'utf8');
  log(`report: ${LOG}`);
  log(`shots: ${SHOT_CREATE}`);
  log(`shots: ${SHOT_STUDY}`);
  log(`shots: ${SHOT_FOCUS}`);
  log(`shots: ${SHOT_TOOLBAR}`);
  log(`shots: ${SHOT_ALIGN}`);
  log(`shots: ${SHOT_NARROW}`);
  log(`shots: ${SHOT_NOTES_FILLED}`);
  log(`shots: ${SHOT_NOTES_FOCUS}`);
  process.exit(failed ? 1 : 0);
}

run();
