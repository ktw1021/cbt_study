/**
 * 실제 클릭·키보드·좌표 드래그로 정렬/각주 수용 검증.
 * setVisibleSelection 으로 사용자 선택을 만들지 않음.
 * 관측은 Range.getClientRects 만 쓰고 window Selection 을 바꾸지 않음.
 */
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createAppServer, listen, TEST_ALPHA_PLANNER } from './lib/server.mjs';
import { loadChromium, browserExecutable } from './lib/playwright.mjs';
import { passAlphaGate, fixture, waitObserve } from './navigation-ui.mjs';
import { observeEditorGeometry } from './lib/editor-glyph-geometry.mjs';

const DEFAULT_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const ROOT = process.env.CBT_APP_ROOT || DEFAULT_ROOT;
const PORT = Number(process.env.CBT_ALIGN_FN_PORT || 4182);
const BASE = `http://127.0.0.1:${PORT}`;
const LOG = join(tmpdir(), 'cbt-align-footnote-ui.log');
const SHOT = (name) => join(tmpdir(), `cbt-align-fn-${name}.png`);

const LONG = '한글 법률 문장을 충분히 길게 써서 한 줄에 다 들어가지 않도록 단어 사이를 띄워 반복한다. ';
const LAST = '마지막짧은줄';
const SPECIAL = '가\u200B나\uFEFF다\u00A0라 마';

const lines = [];
const log = (msg) => {
  lines.push(msg);
  console.log(msg);
};
const fails = [];
function fail(msg) {
  fails.push(msg);
  log(`FAIL ${msg}`);
}

async function observe(page, editorId, needles = []) {
  return page.evaluate(observeEditorGeometry, { editorId, needles });
}

async function visAndMeta(page, editorId) {
  return page.evaluate(async (editorId) => {
    const { editorVisibleText } = await import('/js/ui/chip-editor.js');
    const { readAllEditorMeta } = await import('/js/ui/editor-surface.js');
    const el = document.getElementById(editorId);
    const sel = window.getSelection();
    let live = null;
    if (sel?.rangeCount && el) {
      const { rangeToVisibleOffsets } = await import('/js/ui/chip-editor.js');
      const r = sel.getRangeAt(0);
      if (el.contains(r.startContainer) || r.startContainer === el) {
        live = rangeToVisibleOffsets(el, r);
      }
    }
    const preview = editorId === 'promptTemplate' ? 'promptPreview' : 'explanationPreview';
    return {
      vis: editorVisibleText(el),
      innerText: el?.innerText || '',
      meta: readAllEditorMeta(),
      live,
      previewFn: [...document.querySelectorAll(`#${preview} .tm-fn`)].map((b) => b.dataset.fnId),
      editorFn: [...el.querySelectorAll('.tm-fn')].map((b) => ({
        id: b.dataset.fnId,
        index: b.dataset.fnIndex,
      })),
      notesFn: [...document.querySelectorAll('#notesList [data-action="delete-note-fn"]')].map((b) => ({
        id: b.dataset.fnId,
        field: b.dataset.fnField,
      })),
    };
  }, editorId);
}

async function pastePlainText(page, editorId, text) {
  await page.locator(`#${editorId}`).click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.evaluate(({ editorId, text }) => {
    const el = document.getElementById(editorId);
    if (!el) throw new Error(`no editor ${editorId}`);
    el.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
  }, { editorId, text });
  await page.waitForTimeout(150);
}

function assertVisExact(label, got, want) {
  if (got === want) return;
  fail(`${label} vis mismatch got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  if (got.length === want.length) {
    for (let i = 0; i < want.length; i += 1) {
      if (got.charCodeAt(i) !== want.charCodeAt(i)) {
        fail(`${label} codeUnit ${i} got=${got.charCodeAt(i)} want=${want.charCodeAt(i)}`);
        break;
      }
    }
  }
}

async function clickNeedle(page, editorId, needle) {
  const pos = await page.evaluate(({ editorId, needle }) => {
    const el = document.getElementById(editorId);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest?.('.tm-fn, .cz-chip-x')) continue;
      const val = node.nodeValue || '';
      const i = val.indexOf(needle);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(node, i + Math.min(1, Math.max(0, needle.length - 1)));
      r.setEnd(node, i + Math.min(1, Math.max(0, needle.length - 1)) + (needle.length ? 1 : 0));
      if (r.collapsed) {
        r.setStart(node, i);
        r.setEnd(node, Math.min(val.length, i + 1));
      }
      const rec = r.getClientRects()[0] || r.getBoundingClientRect();
      if (!Number.isFinite(rec.left) || rec.width <= 0) continue;
      return { x: rec.left + Math.min(6, rec.width / 2), y: rec.top + rec.height / 2 };
    }
    return null;
  }, { editorId, needle });
  if (!pos) throw new Error(`clickNeedle 없음 ${editorId} ${needle}`);
  await page.mouse.click(pos.x, pos.y);
}

async function dragNeedles(page, editorId, fromNeedle, toNeedle) {
  const pos = await page.evaluate(({ editorId, fromNeedle, toNeedle }) => {
    const el = document.getElementById(editorId);
    const find = (needle, atEnd) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      let node;
      while ((node = walker.nextNode())) {
        if (node.parentElement?.closest?.('.tm-fn, .cz-chip-x')) continue;
        const val = node.nodeValue || '';
        const i = val.indexOf(needle);
        if (i < 0) continue;
        const r = document.createRange();
        if (atEnd) {
          r.setStart(node, i + needle.length - 1);
          r.setEnd(node, i + needle.length);
        } else {
          r.setStart(node, i);
          r.setEnd(node, i + 1);
        }
        const rec = r.getClientRects()[0] || r.getBoundingClientRect();
        return { x: rec.left + (atEnd ? rec.width - 1 : 2), y: rec.top + rec.height / 2 };
      }
      return null;
    };
    return { a: find(fromNeedle, false), b: find(toNeedle, true) };
  }, { editorId, fromNeedle, toNeedle });
  if (!pos?.a || !pos?.b) throw new Error(`dragNeedles ${fromNeedle}->${toNeedle}`);
  await page.mouse.move(pos.a.x, pos.a.y);
  await page.mouse.down();
  await page.mouse.move(pos.b.x, pos.b.y, { steps: 8 });
  await page.mouse.up();
}

async function clickAlign(page, editorId, align) {
  await page.locator(`[data-action="fmt-align"][data-editor="${editorId}"][data-align="${align}"]`).click();
}

async function activeAligns(page, editorId) {
  const g = await observe(page, editorId);
  return (g.alignBtns || []).filter((b) => b.active).map((b) => b.align);
}

async function openPromptEdit(page) {
  await page.goto(`${BASE}/index.html#/manage`);
  await passAlphaGate(page, TEST_ALPHA_PLANNER);
  await fixture(page, 'seedPrimaryUser');
  await waitObserve(page, (s) => s.listTitles.includes('카드A') && s.section === 'manage', 10000, 'seed');
  await page.locator('#cardList .list-item', { hasText: '카드A' }).locator('.item-title').click();
  await page.locator('#manageDetail [data-action="edit-card"]').click();
  await page.waitForSelector('#createSection:not(.hidden) #promptTemplate');
}

async function fillPrompt(page, parts) {
  const ed = page.locator('#promptTemplate');
  await ed.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  for (let i = 0; i < parts.length; i += 1) {
    if (i) await page.keyboard.press('Enter');
    if (parts[i]) await page.keyboard.type(parts[i], { delay: 8 });
  }
}

async function run() {
  const server = createAppServer(ROOT, PORT);
  await listen(server, PORT);
  const chromium = await loadChromium();
  const browser = await chromium.launch({ headless: true, executablePath: browserExecutable() });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const dialogs = [];
  let promptReply = '취지본문';
  let confirmMode = 'accept';
  page.on('dialog', async (d) => {
    dialogs.push({ type: d.type(), msg: d.message() });
    try {
      if (d.type() === 'prompt') {
        if (promptReply == null) await d.dismiss();
        else await d.accept(promptReply);
      } else if (d.type() === 'confirm') {
        if (confirmMode === 'dismiss') await d.dismiss();
        else await d.accept();
      } else {
        await d.accept();
      }
    } catch { /* already handled */ }
  });

  try {
    await openPromptEdit(page);
    await fillPrompt(page, ['AAA줄', 'BBB줄', 'CCC줄']);
    const st0 = await visAndMeta(page, 'promptTemplate');
    if (st0.vis !== 'AAA줄\nBBB줄\nCCC줄') fail(`초기 원문 ${JSON.stringify(st0.vis)}`);
    await clickNeedle(page, 'promptTemplate', 'AAA줄');
    const defBar = await activeAligns(page, 'promptTemplate');
    log(`default toolbar ${JSON.stringify(defBar)}`);
    if (defBar.join(',') !== 'left') fail(`기본 왼쪽 미표시 ${JSON.stringify(defBar)}`);

    const before = await observe(page, 'promptTemplate', ['AAA줄', 'BBB줄', 'CCC줄']);
    if (!before.glyphs.BBB줄 || before.glyphs.BBB줄.missing) fail(`BBB glyph 없음 ${JSON.stringify(before.glyphs)}`);
    const liveBefore = await visAndMeta(page, 'promptTemplate');
    await page.screenshot({ path: SHOT('before-align'), fullPage: true });

    await clickNeedle(page, 'promptTemplate', 'BBB줄');
    await clickAlign(page, 'promptTemplate', 'center');
    await clickAlign(page, 'promptTemplate', 'center');
    const afterCenter = await observe(page, 'promptTemplate', ['AAA줄', 'BBB줄', 'CCC줄']);
    const stC = await visAndMeta(page, 'promptTemplate');
    log(`after center vis=${JSON.stringify(stC.vis)} marks=${JSON.stringify(stC.meta.textMarks.display)}`);
    log(`glyphs AAA L ${before.glyphs.AAA줄?.left}->${afterCenter.glyphs.AAA줄?.left} BBB ${before.glyphs.BBB줄?.left}->${afterCenter.glyphs.BBB줄?.left} CCC ${before.glyphs.CCC줄?.left}->${afterCenter.glyphs.CCC줄?.left}`);
    if (stC.vis !== 'AAA줄\nBBB줄\nCCC줄') fail(`가운데 후 원문 변경 ${JSON.stringify(stC.vis)}`);
    const bbbShift = (afterCenter.glyphs.BBB줄?.left || 0) - (before.glyphs.BBB줄?.left || 0);
    const aaaShift = (afterCenter.glyphs.AAA줄?.left || 0) - (before.glyphs.AAA줄?.left || 0);
    const cccShift = (afterCenter.glyphs.CCC줄?.left || 0) - (before.glyphs.CCC줄?.left || 0);
    if (!(bbbShift > 12)) fail(`BBB 가운데 이동 없음 delta=${bbbShift} before=${before.glyphs.BBB줄?.left} after=${afterCenter.glyphs.BBB줄?.left}`);
    if (Math.abs(aaaShift) > 8) fail(`AAA가 가운데와 함께 이동 ${aaaShift}`);
    if (Math.abs(cccShift) > 8) fail(`CCC가 가운데와 함께 이동 ${cccShift}`);
    const centerActive = await activeAligns(page, 'promptTemplate');
    if (centerActive.join(',') !== 'center') fail(`가운데 단독 활성 아님 ${JSON.stringify(centerActive)}`);
    const tmAligns = (afterCenter.tm || []).map((t) => t.align);
    if (tmAligns.filter((a) => a === 'center').length !== 1) fail(`tm-line center 개수 ${JSON.stringify(tmAligns)}`);
    if ((afterCenter.tm || []).some((t) => t.textAlignLast === 'justify' || t.textAlignLast === 'distributed')) {
      fail(`text-align-last 강제 ${JSON.stringify(afterCenter.tm)}`);
    }
    await page.screenshot({ path: SHOT('after-center'), fullPage: true });

    await clickNeedle(page, 'promptTemplate', 'AAA줄');
    await clickAlign(page, 'promptTemplate', 'right');
    const afterRight = await observe(page, 'promptTemplate', ['AAA줄', 'BBB줄', 'CCC줄']);
    const aaaRight = (afterRight.glyphs.AAA줄?.left || 0) - (before.glyphs.AAA줄?.left || 0);
    if (!(aaaRight > 12)) fail(`AAA 오른쪽 이동 없음 ${aaaRight}`);
    const bbbKeep = (afterRight.glyphs.BBB줄?.left || 0) - (afterCenter.glyphs.BBB줄?.left || 0);
    if (Math.abs(bbbKeep) > 8) fail(`BBB가 오른쪽 적용에 영향 ${bbbKeep}`);

    await clickNeedle(page, 'promptTemplate', 'CCC줄');
    await clickAlign(page, 'promptTemplate', 'left');
    const leftActive = await activeAligns(page, 'promptTemplate');
    if (leftActive.join(',') !== 'left') fail(`명시 left 활성 아님 ${JSON.stringify(leftActive)}`);

    await dragNeedles(page, 'promptTemplate', 'AAA줄', 'CCC줄');
    const mixed = await activeAligns(page, 'promptTemplate');
    log(`mixed ${JSON.stringify(mixed)}`);
    if (mixed.length) fail(`혼합 선택이 한 값으로 표시됨 ${JSON.stringify(mixed)}`);

    await clickAlign(page, 'promptTemplate', 'center');
    const allCenter = await observe(page, 'promptTemplate', ['AAA줄', 'BBB줄', 'CCC줄']);
    const shifts = ['AAA줄', 'BBB줄', 'CCC줄'].map((n) => (allCenter.glyphs[n]?.left || 0) - (before.glyphs[n]?.left || 0));
    log(`drag-all center shifts ${JSON.stringify(shifts)}`);
    if (!shifts.every((d) => d > 12)) fail(`드래그 여러 문단 가운데 실패 ${JSON.stringify(shifts)}`);
    const allActive = await activeAligns(page, 'promptTemplate');
    if (allActive.join(',') !== 'center') fail(`전체 가운데 후 활성 ${JSON.stringify(allActive)}`);

    await clickNeedle(page, 'promptTemplate', 'BBB줄');
    await clickAlign(page, 'promptTemplate', 'left');
    const liveAfterClick = await visAndMeta(page, 'promptTemplate');
    if (liveAfterClick.live && Math.abs((liveAfterClick.live.start ?? -1) - (liveBefore.live?.start ?? -2)) > 40) {
      log(`sel moved after toolbar ${JSON.stringify(liveBefore.live)} -> ${JSON.stringify(liveAfterClick.live)}`);
    }

    await fillPrompt(page, [LONG.repeat(4), LAST]);
    await clickNeedle(page, 'promptTemplate', '한글 법률');
    await clickAlign(page, 'promptTemplate', 'justify');
    await clickAlign(page, 'promptTemplate', 'justify');
    const justAfter = await observe(page, 'promptTemplate', [LAST]);
    const justMeta = await visAndMeta(page, 'promptTemplate');
    log(`justify visLen=${justMeta.vis.length} marks=${JSON.stringify(justMeta.meta.textMarks.display)}`);
    if (justMeta.vis !== `${LONG.repeat(4)}\n${LAST}`) {
      fail(`justify 원문 변경 ${JSON.stringify(justMeta.vis)}`);
    }
    const justPara = (justAfter.tm || []).find((t) => t.align === 'justify');
    if (!justPara || !(justPara.wrapCount >= 2)) fail(`양쪽정렬 자동줄바꿈 부족 ${JSON.stringify(justPara)}`);
    if (!Number.isFinite(justPara.firstLineRightGap) || justPara.firstLineRightGap < 0) {
      fail(`양쪽정렬 첫줄 gap 비정상 ${justPara.firstLineRightGap}`);
    }
    await clickAlign(page, 'promptTemplate', 'left');
    const leftJust = await observe(page, 'promptTemplate', [LAST]);
    const leftPara = (leftJust.tm || []).find((t) => t.align === 'left' && (t.wrapCount || 0) >= 2);
    log(`justify ink firstGap=${justPara.firstLineRightGap} wraps=${justPara.wrapCount} lineGaps=${JSON.stringify(justPara.lineInkGaps)} lastGap=${justPara.lastLineRightGap}`);
    log(`left ink lineGaps=${JSON.stringify(leftPara?.lineInkGaps)}`);
    if (!leftPara) fail(`왼쪽 비교 문단 없음 ${JSON.stringify(leftJust.tm)}`);
    if (!Number.isFinite(justPara.firstLineRightGap) || justPara.firstLineRightGap < 0) {
      fail(`양쪽정렬 첫줄 gap 비정상 ${justPara.firstLineRightGap}`);
    }
    if (!(justPara.firstLineRightGap <= 8)) {
      fail(`양쪽정렬 첫줄 ink가 박스 밖 overflow gap=${justPara.firstLineRightGap}`);
    }
    const jGaps = justPara.lineInkGaps || [];
    const lGaps = leftPara.lineInkGaps || [];
    if (jGaps.length < 2 || lGaps.length < 2) fail(`줄 수 부족 j=${jGaps.length} l=${lGaps.length}`);
    let bestDiff = -Infinity;
    for (let i = 0; i < Math.min(jGaps.length - 1, lGaps.length - 1); i += 1) {
      const d = lGaps[i] - jGaps[i];
      if (d > bestDiff) bestDiff = d;
    }
    if (!Number.isFinite(bestDiff) || !(bestDiff > 8)) {
      fail(`양쪽 vs 왼쪽 비마지막 줄 ink gap 차이 없음 best=${bestDiff} j=${JSON.stringify(jGaps)} l=${JSON.stringify(lGaps)}`);
    }
    if (!(Number.isFinite(justPara.lastLineRightGap) && justPara.lastLineRightGap > 12)) {
      fail(`문단 마지막 줄이 양쪽으로 늘어남 lastGap=${justPara.lastLineRightGap}`);
    }
    if (!(justPara.lastLineWidth < justPara.firstLineWidth - 8)) {
      fail(`문단 마지막 줄 ink 폭이 첫줄과 같음 last=${justPara.lastLineWidth} first=${justPara.firstLineWidth}`);
    }
    const lastW = justAfter.glyphs[LAST]?.width || 0;
    if (!(lastW < justAfter.contentWidth * 0.55)) fail(`다음 짧은 문단이 늘어난 듯 w=${lastW} cw=${justAfter.contentWidth}`);
    if ((justAfter.tm || []).some((t) => t.textAlignLast === 'justify' || t.textAlignLast === 'distributed')) {
      fail(`justify text-align-last ${JSON.stringify(justAfter.tm.map((t) => t.textAlignLast))}`);
    }
    await page.screenshot({ path: SHOT('justify'), fullPage: true });

    await pastePlainText(page, 'promptTemplate', SPECIAL);
    let sp = await visAndMeta(page, 'promptTemplate');
    assertVisExact('paste', sp.vis, SPECIAL);
    await page.locator('#promptTemplate').click();
    await page.keyboard.press('Control+End');
    promptReply = '특수각주';
    await page.locator('[data-action="fmt-footnote"][data-editor="promptTemplate"]').click();
    await page.waitForTimeout(200);
    sp = await visAndMeta(page, 'promptTemplate');
    assertVisExact('footnote-add', sp.vis, SPECIAL);
    const fn0 = sp.meta.footnotes.find((f) => f.body === '특수각주' && f.field === 'display');
    if (!fn0 || fn0.end !== SPECIAL.length) {
      fail(`각주 anchor offset ${JSON.stringify(fn0)} len=${SPECIAL.length}`);
    }
    await page.locator('[data-action="notes-field-tab"][data-field="display"]').click();
    await page.locator('#notesList [data-action="delete-note-fn"]').first().waitFor({ state: 'visible', timeout: 8000 });
    confirmMode = 'accept';
    await page.locator('#notesList [data-action="delete-note-fn"]').first().click();
    await page.waitForTimeout(200);
    sp = await visAndMeta(page, 'promptTemplate');
    assertVisExact('footnote-delete', sp.vis, SPECIAL);
    await page.locator('#promptTemplate').click();
    await page.keyboard.press('Control+End');
    promptReply = '특수각주2';
    await page.locator('[data-action="fmt-footnote"][data-editor="promptTemplate"]').click();
    await page.waitForTimeout(200);
    sp = await visAndMeta(page, 'promptTemplate');
    assertVisExact('footnote-add2', sp.vis, SPECIAL);
    await page.locator('#promptTemplate').click();
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    sp = await visAndMeta(page, 'promptTemplate');
    assertVisExact('footnote-undo', sp.vis, SPECIAL);
    if (sp.meta.footnotes.some((f) => f.body === '특수각주2')) fail('Undo 후 각주 메타 남음');

    await fillPrompt(page, ['앞문단', '각주자리BBB', '끝문단']);
    await clickNeedle(page, 'promptTemplate', '각주자리BBB');
    await page.keyboard.press('End');
    const beforeFn = await visAndMeta(page, 'promptTemplate');
    const geomBeforeFn = await observe(page, 'promptTemplate', ['각주자리BBB']);
    promptReply = '문제취지';
    await page.locator('[data-action="fmt-footnote"][data-editor="promptTemplate"]').click();
    await page.waitForTimeout(200);
    const afterFn = await visAndMeta(page, 'promptTemplate');
    const geomAfterFn = await observe(page, 'promptTemplate', ['각주자리BBB']);
    log(`fn vis before=${JSON.stringify(beforeFn.vis)} after=${JSON.stringify(afterFn.vis)}`);
    log(`fn inner before=${JSON.stringify(beforeFn.innerText)} after=${JSON.stringify(afterFn.innerText)}`);
    log(`fn marks=${JSON.stringify(afterFn.meta.footnotes)} editorFn=${JSON.stringify(afterFn.editorFn)}`);
    log(`fn geom ${JSON.stringify(geomAfterFn.fns)}`);
    if (afterFn.vis !== beforeFn.vis) fail(`각주 추가가 원문을 바꿈 ${JSON.stringify(beforeFn.vis)} -> ${JSON.stringify(afterFn.vis)}`);
    if (!afterFn.meta.footnotes.some((f) => f.body === '문제취지' && f.field === 'display')) {
      fail(`각주 메타 없음 ${JSON.stringify(afterFn.meta.footnotes)}`);
    }
    if (!geomAfterFn.fns.length) fail('본문 각주 번호 없음');
    const fn = geomAfterFn.fns[0];
    if (fn.display === 'inline-flex') fail(`tm-fn inline-flex 유지 display=${fn.display}`);
    if ((fn.marginLeft || 0) > 0.6 || (fn.marginRight || 0) > 0.6) fail(`tm-fn 여분 margin ${fn.marginLeft}/${fn.marginRight}`);
    if ((fn.paddingLeft || 0) > 6 || (fn.paddingRight || 0) > 6) fail(`tm-fn global padding ${fn.paddingLeft}/${fn.paddingRight}`);
    if (fn.gapBefore != null && fn.gapBefore > 6) fail(`각주 앞 여분 공백 gap=${fn.gapBefore}`);
    if (fn.gapAfter != null && fn.gapAfter > 6) fail(`각주 뒤 여분 공백 gap=${fn.gapAfter}`);
    const lhBefore = geomBeforeFn.glyphs['각주자리BBB']?.height;
    const lhAfter = geomAfterFn.glyphs['각주자리BBB']?.height;
    if (lhBefore && lhAfter && lhAfter > lhBefore + 6) fail(`각주로 줄높이 증가 ${lhBefore} -> ${lhAfter}`);
    await page.locator('[data-action="notes-field-tab"][data-field="display"]').click();
    await page.locator('#notesList [data-fn-edit]').first().waitFor({ state: 'visible', timeout: 8000 });
    const notesAfterAdd = await visAndMeta(page, 'promptTemplate');
    if (!notesAfterAdd.notesFn.some((n) => n.id === afterFn.editorFn[0]?.id)) {
      fail(`목록 미반영 ${JSON.stringify(notesAfterAdd.notesFn)}`);
    }
    if (!notesAfterAdd.previewFn.length) fail(`미리보기 각주 없음 ${JSON.stringify(notesAfterAdd.previewFn)}`);
    await page.screenshot({ path: SHOT('footnote-desktop'), fullPage: true });

    const keepDraft = '미저장초안';
    await page.locator('#notesList [data-fn-edit]').first().fill(keepDraft);
    confirmMode = 'dismiss';
    dialogs.length = 0;
    await page.locator('#notesList [data-action="delete-note-fn"]').first().click();
    await page.waitForTimeout(200);
    const cancelSt = await visAndMeta(page, 'promptTemplate');
    const cancelDialog = dialogs.find((d) => d.type === 'confirm');
    log(`delete cancel dialogs=${JSON.stringify(dialogs)} fns=${cancelSt.meta.footnotes.length}`);
    if (!cancelDialog || !String(cancelDialog.msg).includes('각주를 삭제하시겠습니까')) {
      fail(`삭제 확인 없음 ${JSON.stringify(dialogs)}`);
    }
    if (!cancelSt.meta.footnotes.some((f) => f.body === '문제취지')) fail('취소 후 각주 삭제됨');
    const draftVal = await page.locator('#notesList [data-fn-edit]').first().inputValue();
    if (draftVal !== keepDraft) fail(`취소 후 초안 유실 ${JSON.stringify(draftVal)}`);

    confirmMode = 'accept';
    dialogs.length = 0;
    await page.locator('#notesList [data-action="delete-note-fn"]').first().click();
    await page.waitForTimeout(200);
    const delSt = await visAndMeta(page, 'promptTemplate');
    const delGeom = await observe(page, 'promptTemplate', ['각주자리BBB']);
    log(`deleted fns=${JSON.stringify(delSt.meta.footnotes)} editorFn=${JSON.stringify(delSt.editorFn)} preview=${JSON.stringify(delSt.previewFn)}`);
    if (delSt.meta.footnotes.some((f) => f.body === '문제취지')) fail('승인 후에도 각주 메타 남음');
    if (delSt.editorFn.length) fail(`승인 후 본문 번호 남음 ${JSON.stringify(delSt.editorFn)}`);
    if (delSt.previewFn.length) fail(`승인 후 미리보기 번호 남음 ${JSON.stringify(delSt.previewFn)}`);
    if (delSt.notesFn.length) fail(`승인 후 목록 남음 ${JSON.stringify(delSt.notesFn)}`);
    if (delSt.vis !== beforeFn.vis) fail(`삭제 후 원문 ${JSON.stringify(delSt.vis)}`);
    if (delGeom.fns.length) fail('삭제 후 glyph 옆 번호 잔존');

    promptReply = '다시각주';
    await clickNeedle(page, 'promptTemplate', '각주자리BBB');
    await page.keyboard.press('End');
    await page.locator('[data-action="fmt-footnote"][data-editor="promptTemplate"]').click();
    await page.waitForTimeout(200);
    await page.locator('[data-action="notes-field-tab"][data-field="display"]').click();
    await page.locator('#notesList [data-fn-edit]').first().waitFor({ state: 'visible', timeout: 8000 });
    await page.locator('#notesList [data-fn-edit]').first().fill('');
    dialogs.length = 0;
    confirmMode = 'dismiss';
    await page.locator('#notesList [data-action="save-note-fn"]').first().click();
    await page.waitForTimeout(200);
    const emptyCancel = await visAndMeta(page, 'promptTemplate');
    if (!dialogs.some((d) => d.type === 'confirm' && String(d.msg).includes('각주를 삭제하시겠습니까'))) {
      fail(`본문 비워 저장 시 확인 없음 ${JSON.stringify(dialogs)}`);
    }
    if (!emptyCancel.meta.footnotes.some((f) => f.body === '다시각주')) fail('비워 저장 취소가 삭제를 수행');
    confirmMode = 'accept';
    await page.locator('#notesList [data-fn-edit]').first().fill('');
    await page.locator('#notesList [data-action="save-note-fn"]').first().click();
    await page.waitForTimeout(200);
    const emptyOk = await visAndMeta(page, 'promptTemplate');
    if (emptyOk.meta.footnotes.some((f) => f.body === '다시각주')) fail('비워 저장 승인이 삭제 안 함');
    if (emptyOk.editorFn.length) fail('비워 저장 후 본문 번호 잔존');

    await page.setViewportSize({ width: 390, height: 844 });
    await fillPrompt(page, ['좁은화면본문']);
    await clickNeedle(page, 'promptTemplate', '좁은화면본문');
    promptReply = '좁은각주';
    await page.locator('[data-action="fmt-footnote"][data-editor="promptTemplate"]').click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: SHOT('footnote-narrow') });
    const narrow = await observe(page, 'promptTemplate', ['좁은화면본문']);
    if (!narrow.fns.length) fail('좁은 화면 각주 번호 없음');

    log(`dialogs all ${JSON.stringify(dialogs.slice(-8))}`);
  } finally {
    await browser.close();
    server.close();
    writeFileSync(LOG, `${lines.join('\n')}\nFAILS:\n${fails.join('\n')}\n`, 'utf8');
  }

  if (fails.length) {
    console.error(`FAIL align-footnote-ui ${fails.length}\n${fails.join('\n')}`);
    process.exitCode = 1;
    return;
  }
  console.log(`OK align-footnote-ui root=${ROOT} log=${LOG}`);
}

run().catch((e) => {
  console.error(e);
  writeFileSync(LOG, `${lines.join('\n')}\nERROR ${e.stack || e}\n`, 'utf8');
  process.exitCode = 1;
});
