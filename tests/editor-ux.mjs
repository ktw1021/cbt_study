import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createAppServer, listen, TEST_ALPHA_PLANNER } from './lib/server.mjs';
import { loadChromium, browserExecutable } from './lib/playwright.mjs';
import { passAlphaGate, loginViaUi, fixture, waitObserve, observe } from './navigation-ui.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PORT = Number(process.env.CBT_EDITOR_UX_PORT || 4175);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOT_DIR = join(tmpdir(), 'cbt-editor-ux');
const LOG = join(tmpdir(), 'cbt-editor-ux.log');
const SHOT_DESKTOP = join(SHOT_DIR, 'create-notes-desktop.png');
const SHOT_NARROW = join(SHOT_DIR, 'create-notes-390.png');
const SHOT_FOCUS = join(SHOT_DIR, 'create-focus-tooltip.png');
const SHOT_STUDY_BTN = join(SHOT_DIR, 'create-study-nav.png');

const lines = [];
const log = (msg) => {
  lines.push(msg);
  console.log(msg);
};

async function clickVisibleNav(page, action) {
  const top = page.locator(`.topbar-nav [data-action="${action}"]`);
  if (await top.isVisible()) {
    await top.click();
    return;
  }
  const toggle = page.locator('#sidebarToggle');
  if (await toggle.isVisible()) await toggle.click();
  await page.locator(`aside.sidebar [data-action="${action}"]`).first().evaluate((el) => el.click());
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
  await page.locator('#manageDetail [data-action="edit-card"]').click();
  await page.waitForSelector('#createSection:not(.hidden) #promptTemplate', { timeout: 10000 });
}

async function studySnapshot(page) {
  return page.evaluate(async () => {
    const { store } = await import('/js/core/store.js');
    const { getPersistedStudySession } = await import('/js/services/study-session.js');
    const sess = getPersistedStudySession();
    return {
      section: store.currentSection,
      queue: store.studyQueue.map((c) => c.id),
      index: store.studyIndex,
      statuses: (store.currentBlankStatuses || []).map((s) => ({
        order: s.order, checked: s.checked, correct: s.correct, user: s.user,
      })),
      attempt: !!store.studyAttemptRecorded,
      round: !!store.studyRoundRecorded,
      returnTo: store._createStudyReturn,
      btn: document.getElementById('createStudyNavBtn')?.textContent || '',
      sessIds: sess?.cardIds || [],
      sessIndex: sess?.index ?? null,
    };
  });
}

async function run() {
  mkdirSync(SHOT_DIR, { recursive: true });
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
  const lastDialog = { type: '', message: '' };
  const confirmQ = [];
  page.on('dialog', async (d) => {
    lastDialog.type = d.type();
    lastDialog.message = d.message();
    if (d.type() === 'confirm') {
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
    await fixture(page, 'seedPrimaryUser');
    await waitObserve(page, (s) => s.listTitles.includes('카드A') && s.section === 'manage', 10000, '시드 후 목록');

    await clickVisibleNav(page, 'nav-create');
    await page.waitForSelector('#createSection:not(.hidden)');
    lastDialog.message = '';
    await page.locator('#createStudyNavBtn').click();
    await page.waitForTimeout(50);
    if (lastDialog.message !== '먼저 카드를 저장하세요.') {
      throw new Error(`신규 카드 안내 아님 ${lastDialog.message}`);
    }
    if (await page.locator('#createSection').evaluate((el) => !el.classList.contains('hidden')) !== true) {
      throw new Error('신규 카드 안내 후 제작 화면이 아님');
    }
    pass('new unsaved card asks to save first');

    await openCardEdit(page, '카드A');
    const defaultTabs = await page.evaluate(() => ({
      field: document.querySelector('#createNotesMount [data-action="notes-field-tab"].active')?.dataset.field,
      tab: document.querySelector('#createNotesMount [data-action="study-notes-tab"].active')?.dataset.tab,
      btn: document.getElementById('createStudyNavBtn')?.textContent,
    }));
    if (defaultTabs.field !== 'explanation' || defaultTabs.tab !== 'notes') {
      throw new Error(`관리→수정 기본 탭 ${JSON.stringify(defaultTabs)}`);
    }
    if (defaultTabs.btn !== '학습하러 가기') throw new Error(`관리 수정 버튼 ${defaultTabs.btn}`);
    await page.screenshot({ path: SHOT_STUDY_BTN, fullPage: false });
    await page.locator('[data-action="fmt-align"][data-align="justify"][data-editor="explanationTemplate"]').hover();
    await page.waitForTimeout(420);
    const deskTip = await page.locator('#uiDelayTip').innerText();
    if (!deskTip.includes('양쪽 정렬')) throw new Error(`desktop tooltip ${deskTip}`);
    await page.screenshot({ path: SHOT_DESKTOP, fullPage: false });
    pass('manage edit defaults + tooltip');

    await openCardEdit(page, '카드A');
    await page.locator('#createNotesMount [data-action="study-notes-tab"][data-tab="memo"]').click();
    await page.locator('#notesMemo').fill('UX메모1');
    await page.locator('#cardTitle').fill('카드A-제목미저장');
    lastDialog.message = '';
    await page.locator('#createNotesMount [data-action="save-memo"]').click();
    await page.waitForTimeout(100);
    if (lastDialog.message !== '메모 저장됐습니다.') {
      throw new Error(`메모 저장 안내 ${lastDialog.message}`);
    }
    const memoIsolate = await page.evaluate(async () => {
      const { store } = await import('/js/core/store.js');
      const id = document.getElementById('cardId').value;
      const a = store.data.cards.find((c) => c.id === id);
      const b = store.data.cards.find((c) => c.title === '카드B');
      return {
        aMemo: a?.memo,
        aTitle: a?.title,
        formTitle: document.getElementById('cardTitle').value,
        bMemo: b?.memo ?? '',
      };
    });
    if (memoIsolate.aMemo !== 'UX메모1' || memoIsolate.aTitle !== '카드A') {
      throw new Error(`카드A memo만 저장 실패 ${JSON.stringify(memoIsolate)}`);
    }
    if (memoIsolate.formTitle !== '카드A-제목미저장') throw new Error('본문/제목 미저장 유지');
    confirmQ.push(false);
    lastDialog.message = '';
    await clickVisibleNav(page, 'nav-manage');
    await page.waitForTimeout(100);
    if (!lastDialog.message.includes('저장하지 않은')) {
      throw new Error(`미저장 제목 이동 경고 없음 ${lastDialog.message}`);
    }
    await page.locator('#cardTitle').fill('카드A');
    pass('create memo save cardA only + body still dirty');

    await page.evaluate(async () => {
      const { store } = await import('/js/core/store.js');
      store.data.ui.createDraft = null;
    });
    await openCardEdit(page, '카드A');
    await page.locator('#createNotesMount [data-action="study-notes-tab"][data-tab="memo"]').click();
    await page.locator('#notesMemo').fill('UX메모2');
    lastDialog.message = '';
    await page.locator('#createNotesMount [data-action="save-memo"]').click();
    await page.waitForTimeout(100);
    confirmQ.length = 0;
    lastDialog.message = '';
    await clickVisibleNav(page, 'nav-manage');
    await page.waitForTimeout(120);
    if (lastDialog.type === 'confirm' && lastDialog.message.includes('저장하지 않은')) {
      throw new Error('memo-only 저장 후 불필요한 dirty 경고');
    }
    const afterMemoOnly = await observe(page);
    if (afterMemoOnly.section !== 'manage') throw new Error(`memo-only 후 섹션 ${afterMemoOnly.section}`);
    pass('create memo-only save no leave confirm');

    await clickVisibleNav(page, 'nav-create');
    await page.waitForSelector('#createSection:not(.hidden)');
    await page.locator('#createSection .create-head [data-action="new-card"]').click();
    await page.waitForFunction(() => !document.getElementById('cardId')?.value);
    await page.locator('#createNotesMount [data-action="study-notes-tab"][data-tab="memo"]').click();
    await page.locator('#notesMemo').fill('신규메모');
    lastDialog.message = '';
    await page.locator('#createNotesMount [data-action="save-memo"]').click();
    await page.waitForTimeout(80);
    if (lastDialog.message !== '먼저 카드를 저장하세요.') {
      throw new Error(`신규 카드 메모 안내 ${lastDialog.message}`);
    }
    pass('new card memo save-first via memo button');

    await openCardEdit(page, '카드A');
    await page.locator('#createNotesMount [data-action="study-notes-tab"][data-tab="memo"]').click();
    await page.locator('#notesMemo').fill('UndoA');
    lastDialog.message = '';
    await page.locator('#createNotesMount [data-action="save-memo"]').click();
    await page.waitForTimeout(80);
    await page.locator('#notesMemo').fill('UndoB');
    lastDialog.message = '';
    await page.locator('#createNotesMount [data-action="save-memo"]').click();
    await page.waitForTimeout(80);
    confirmQ.push(true);
    lastDialog.message = '';
    await page.locator('[data-action="undo"]').click();
    await page.waitForTimeout(120);
    const undoMemo = await page.evaluate(async () => {
      const { store } = await import('/js/core/store.js');
      const id = document.getElementById('cardId').value;
      return {
        storeMemo: store.data.cards.find((c) => c.id === id)?.memo,
        field: document.getElementById('notesMemo')?.value,
      };
    });
    if (undoMemo.storeMemo !== 'UndoA') throw new Error(`Undo memo store ${JSON.stringify(undoMemo)}`);
    pass('create memo undo restores previous saved memo');

    await page.reload();
    await passAlphaGate(page, TEST_ALPHA_PLANNER);
    await openCardEdit(page, '카드A');
    await page.locator('#createNotesMount [data-action="study-notes-tab"][data-tab="memo"]').click();
    const reloadedMemo = await page.locator('#notesMemo').inputValue();
    if (reloadedMemo !== 'UndoA') throw new Error(`새로고침 memo ${reloadedMemo}`);
    pass('create memo persists after reload');

    await openManage(page);
    await page.locator('#cardList .list-item', { hasText: '카드B' }).locator('.item-title').click();
    await page.locator('#manageDetail [data-action="study-one"]').click();
    await waitObserve(page, (s) => s.section === 'study-play', 10000, '카드B 학습');
    await page.locator('[data-action="study-notes-tab"][data-tab="memo"]').click();
    const aMemoBeforeStudy = await page.evaluate(async () => {
      const { store } = await import('/js/core/store.js');
      return store.data.cards.find((c) => c.title === '카드A')?.memo;
    });
    await page.locator('#notesMemo').fill('학습B메모');
    await page.locator('[data-action="save-memo"]').click();
    await page.waitForTimeout(100);
    const studyMemoCheck = await page.evaluate(async () => {
      const { store } = await import('/js/core/store.js');
      const idx = store.studyIndex;
      const cur = store.studyQueue[idx];
      const a = store.data.cards.find((c) => c.title === '카드A');
      const b = store.data.cards.find((c) => c.title === '카드B');
      return {
        grade: document.getElementById('gradeResult')?.textContent || '',
        queueMemo: cur?.memo,
        bMemo: b?.memo,
        aMemo: a?.memo,
      };
    });
    if (!studyMemoCheck.grade.includes('메모 저장')) throw new Error(`학습 메모 UI ${studyMemoCheck.grade}`);
    if (studyMemoCheck.bMemo !== '학습B메모' || studyMemoCheck.aMemo !== aMemoBeforeStudy) {
      throw new Error(`학습 메모 격리 실패 ${JSON.stringify(studyMemoCheck)}`);
    }
    pass('study memo save path unchanged');

    await openManage(page);
    await page.locator('#cardList .list-item', { hasText: '카드A' }).locator('.item-title').click();
    await page.locator('#manageDetail [data-action="study-one"]').click();
    await waitObserve(page, (s) => s.section === 'study-play', 10000, '카드A 학습');
    const wrap1 = page.locator('#blankWrap1');
    await wrap1.waitFor({ state: 'visible', timeout: 8000 });
    await wrap1.click();
    await page.keyboard.type('답1');
    await page.locator('[data-action="grade"]').click();
    await waitObserve(page, (s) => s.blanks.some((b) => b.order === 1 && b.ok), 8000, '채점');
    const beforeEdit = await studySnapshot(page);
    await page.locator('[data-action="edit-study-card"]').click();
    await page.waitForSelector('#createSection:not(.hidden) #createStudyNavBtn');
    const resumeLabel = await page.locator('#createStudyNavBtn').innerText();
    if (resumeLabel !== '이어서 학습하기') throw new Error(`학습→수정 버튼 ${resumeLabel}`);

    await page.locator('#cardTitle').fill('카드A-수정중');
    confirmQ.push(false);
    await page.locator('#createStudyNavBtn').click();
    await page.waitForTimeout(80);
    const afterCancel = await studySnapshot(page);
    if (afterCancel.section !== 'create') throw new Error(`복귀 취소 후 섹션 ${afterCancel.section}`);
    if (afterCancel.queue.join() !== beforeEdit.queue.join() || afterCancel.index !== beforeEdit.index) {
      throw new Error(`취소가 학습 큐를 바꿈 ${JSON.stringify(afterCancel)}`);
    }
    const titleKept = await page.locator('#cardTitle').inputValue();
    if (titleKept !== '카드A-수정중') throw new Error(`취소 후 편집 유실 ${titleKept}`);
    if (afterCancel.statuses[0]?.user !== '답1') throw new Error(`취소 후 입력 유실 ${JSON.stringify(afterCancel.statuses)}`);
    pass('study edit cancel keeps queue and draft');

    confirmQ.push(true);
    await page.locator('#createStudyNavBtn').click();
    await waitObserve(page, (s) => s.section === 'study-play', 10000, '이어서 학습');
    const resumed = await studySnapshot(page);
    if (resumed.queue.join() !== beforeEdit.queue.join() || resumed.index !== beforeEdit.index) {
      throw new Error(`복귀가 큐를 바꿈 ${JSON.stringify(resumed)}`);
    }
    if (resumed.statuses[0]?.user !== '답1' || !resumed.statuses[0]?.checked) {
      throw new Error(`복귀 후 채점 유실 ${JSON.stringify(resumed.statuses)}`);
    }
    const savedTitle = await page.evaluate(async () => {
      const { store } = await import('/js/core/store.js');
      return store.data.cards.find((c) => c.title === '카드A-수정중')?.title || '';
    });
    if (savedTitle) throw new Error('이어서 학습이 확정 저장함');
    pass('resume study keeps progress without confirm-save');

    await openCardEdit(page, '카드B');
    const oneLabel = await page.locator('#createStudyNavBtn').innerText();
    if (oneLabel !== '학습하러 가기') throw new Error(`다른 카드 수정 버튼 ${oneLabel}`);
    const beforeReplace = await studySnapshot(page);
    confirmQ.push(false);
    await page.locator('#createStudyNavBtn').click();
    await page.waitForTimeout(80);
    const cancelReplace = await studySnapshot(page);
    if (cancelReplace.section !== 'create') throw new Error('세션 교체 취소 후 제작이 아님');
    if (cancelReplace.sessIds.join() !== beforeReplace.sessIds.join()) {
      throw new Error(`교체 취소가 세션을 바꿈 ${JSON.stringify(cancelReplace)}`);
    }
    confirmQ.push(true);
    await page.locator('#createStudyNavBtn').click();
    await waitObserve(page, (s) => s.section === 'study-play', 10000, '단일 학습 교체');
    const replaced = await studySnapshot(page);
    if (replaced.queue.length !== 1 || replaced.statuses[0]?.user === '답1') {
      throw new Error(`단일 학습 교체 실패 ${JSON.stringify(replaced)}`);
    }
    const bTitle = await page.locator('#studyPrompt').innerText();
    if (!bTitle.includes('카드B')) throw new Error(`교체 후 본문 ${bTitle}`);
    pass('manage edit study-one replace cancel/accept');

    await openManage(page);
    await page.locator('#selectionList label').filter({ hasText: '카드A' }).locator('input').check();
    await page.locator('#selectionList label').filter({ hasText: '카드B' }).locator('input').check();
    confirmQ.push(true);
    await page.locator('#startSelectedBtn').click();
    await waitObserve(page, (s) => s.section === 'study-play', 10000, '선택 2장 학습');
    await page.locator('[data-action="next-card"]').click();
    await page.waitForTimeout(120);
    let atIdx1 = await studySnapshot(page);
    if (atIdx1.index !== 1) throw new Error(`next-card 후 index ${atIdx1.index}`);
    const wrapB = page.locator('#blankWrap1');
    await wrapB.waitFor({ state: 'visible' });
    await wrapB.click();
    await page.keyboard.type('답1');
    await page.locator('[data-action="grade"]').click();
    await waitObserve(page, (s) => s.blanks.some((b) => b.order === 1 && b.ok), 8000, 'B 채점');
    atIdx1 = await studySnapshot(page);
    if (atIdx1.index !== 1) throw new Error(`index1 아님 ${atIdx1.index}`);
    await page.locator('[data-action="edit-study-card"]').click();
    await page.waitForSelector('#createStudyNavBtn');
    await page.locator('#cardTitle').fill('카드B-임시');
    confirmQ.push(false);
    await page.locator('#createStudyNavBtn').click();
    await page.waitForTimeout(80);
    const cancelIdx1 = await studySnapshot(page);
    if (cancelIdx1.section !== 'create' || cancelIdx1.index !== 1) {
      throw new Error(`index1 취소 후 ${JSON.stringify(cancelIdx1)}`);
    }
    confirmQ.push(true);
    await page.locator('#createStudyNavBtn').click();
    await waitObserve(page, (s) => s.section === 'study-play', 10000, 'index1 복귀');
    const backIdx1 = await studySnapshot(page);
    if (backIdx1.index !== 1 || backIdx1.statuses[0]?.user !== '답1') {
      throw new Error(`index1 복귀 유실 ${JSON.stringify(backIdx1)}`);
    }
    await page.locator('[data-action="edit-study-card"]').click();
    await page.locator('#cardTitle').fill('카드B-저장됨');
    await page.locator('#createSection .create-head [data-action="save-card"]').click();
    await page.waitForTimeout(200);
    await page.locator('#createStudyNavBtn').click();
    await waitObserve(page, (s) => s.section === 'study-play', 10000, '저장 후 index1 복귀');
    const savedBack = await studySnapshot(page);
    if (savedBack.index !== 1) throw new Error(`저장 후 복귀 index ${savedBack.index}`);
    pass('multi-card queue index>0 resume after cancel and save');

    await page.setViewportSize({ width: 390, height: 844 });
    await openCardEdit(page, '카드A');
    await page.locator('[data-action="open-explanation-focus"]').click();
    await page.locator('[data-action="fmt-footnote"][data-editor="explanationTemplate"]').hover();
    await page.waitForTimeout(420);
    const narrowTip = await page.locator('#uiDelayTip').boundingBox();
    const vw = 390;
    if (!narrowTip || narrowTip.x < -1 || narrowTip.x + narrowTip.width > vw + 2) {
      throw new Error(`좁은 창 tooltip 잘림 ${JSON.stringify(narrowTip)}`);
    }
    await page.screenshot({ path: SHOT_NARROW, fullPage: false });
    await page.screenshot({ path: SHOT_FOCUS, fullPage: false });
    pass('390px + focus tooltip not clipped');
  } catch (err) {
    fail('editor-ux', err);
  }

  await browser.close();
  server.close();
  const failed = results.filter((r) => !r.ok).length;
  writeFileSync(LOG, `${lines.join('\n')}\nshots: ${SHOT_DESKTOP}\n${SHOT_NARROW}\n${SHOT_FOCUS}\n${SHOT_STUDY_BTN}\n`, 'utf8');
  log(`shots: ${SHOT_DIR}`);
  if (failed) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
