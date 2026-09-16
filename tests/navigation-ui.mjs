import { join } from 'node:path';
import { tmpdir } from 'node:os';

export const SHOT_MANAGE = join(tmpdir(), 'cbt-manage-range.png');

/**
 * 실제 사용자 UI 조작으로 nav/관리 포커스 드래그를 검증한다.
 * 모달·hover·채점·Undo를 action 호출로 대체하지 않는다.
 * 소유권 거부는 dropCardOnFolder 직접 호출만 허용.
 */
export function alphaCodeB64(planner) {
  return Buffer.from(planner, 'utf8').toString('base64');
}

export async function passAlphaGate(page, planner) {
  const phaseHandle = await page.waitForFunction(() => {
    const gate = document.getElementById('alphaGateOverlay');
    if (!gate) return false;
    if (!gate.classList.contains('hidden')) return 'gate';
    const auth = document.getElementById('authOverlay');
    if (auth && !auth.classList.contains('hidden')) return 'auth';
    if (document.querySelector('#cardList [data-drag-card]')) return 'app';
    return false;
  }, null, { timeout: 20000 });
  const phase = await phaseHandle.jsonValue();
  if (phase !== 'gate') return;
  const submit = page.locator('#alphaGateSubmit');
  await submit.waitFor({ state: 'visible', timeout: 15000 });
  if (await submit.getAttribute('disabled') != null) {
    throw new Error('알파 관문 제출이 비활성 — 가짜 env.alph 응답 실패 가능');
  }
  await page.locator('#alphaGateCode').fill(alphaCodeB64(planner));
  await page.locator('[data-action="alpha-gate-submit"]').click();
  await page.waitForFunction(
    () => document.getElementById('alphaGateOverlay')?.classList.contains('hidden'),
    null,
    { timeout: 15000 },
  );
}

export async function fixture(page, method, ...args) {
  return page.evaluate(async ({ method, args }) => {
    const mod = await import('/tests/lib/browser-fixture.js');
    return await mod[method](...args);
  }, { method, args });
}

export async function observe(page) {
  return fixture(page, 'observeApp');
}

export async function waitObserve(page, pred, timeout = 8000, label = '상태 대기') {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeout) {
    last = await observe(page);
    if (pred(last)) return last;
    await page.waitForTimeout(50);
  }
  throw new Error(`${label} 실패: ${JSON.stringify(summarize(last))}`);
}

function summarize(s) {
  if (!s) return null;
  return {
    section: s.section,
    selectedIds: s.selectedIds,
    manageFocusIds: s.manageFocusIds,
    manageFocusCount: s.manageFocusCount,
    listTitles: s.listTitles,
    navOpen: s.navOpen,
    navExpanded: s.navExpanded,
    blanks: s.blanks,
    navItems: s.navItems,
    activeClass: s.activeClass,
    activeBlankOrder: s.activeBlankOrder,
    currentBlankFocus: s.currentBlankFocus,
    activeManageId: s.activeManageId,
    cards: s.cards?.map((c) => ({ title: c.title, folderId: c.folderId, userId: c.userId })),
  };
}

export async function loginViaUi(page, name, pin) {
  await page.waitForSelector('#authOverlay:not(.hidden)', { timeout: 15000 });
  await page.locator('[data-action="auth-tab-login"]').click();
  await page.locator('#authName').fill(name);
  await page.locator('#loginPin').fill(pin);
  await page.locator('[data-action="auth-login"]').click();
  await page.waitForFunction(
    () => document.getElementById('authOverlay')?.classList.contains('hidden'),
    null,
    { timeout: 15000 },
  );
}

export async function runNavigationTests({ page, planner, touchPage }) {
  const results = [];
  const findings = [];

  const fail = (name, err, extra) => {
    const message = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, message });
    findings.push({ name, message, extra: extra || null });
  };
  const pass = (name) => results.push({ name, ok: true });
  const capture = async (page, name, err) => {
    let extra = null;
    try {
      extra = await observe(page);
    } catch (obsErr) {
      extra = { observeError: String(obsErr?.message || obsErr) };
    }
    fail(name, err, extra);
  };

  page.on('dialog', (d) => d.accept());

  await page.goto('http://127.0.0.1:4173/index.html#/manage');
  await passAlphaGate(page, planner);
  const meta = await fixture(page, 'seedPrimaryUser');
  await waitObserve(page, (s) => s.listTitles.includes('카드A') && s.section === 'manage', 10000, '시드 후 목록');

  try {
    await testManageFocusAndDrag(page, meta);
    pass('manage focus / ctrl / shift range / drag');
  } catch (err) {
    await capture(page, 'manage focus / ctrl / shift range / drag', err);
  }

  try {
    await testOwnership(page, meta);
    pass('ownership reject via action');
  } catch (err) {
    await capture(page, 'ownership reject via action', err);
  }

  try {
    await testBlankNavHover(page);
    pass('blank nav hover latch');
  } catch (err) {
    await capture(page, 'blank nav hover latch', err);
  }

  try {
    await testBlankNavKeyboardGrade(page);
    pass('blank nav keyboard/grade');
  } catch (err) {
    await capture(page, 'blank nav keyboard/grade', err);
  }

  try {
    await testReloadLogin(page, meta, planner);
    pass('reload + alpha + login persist');
  } catch (err) {
    await capture(page, 'reload + alpha + login persist', err);
  }

  if (touchPage) {
    touchPage.on('dialog', (d) => d.accept());
    try {
      await testBlankNavTouch(touchPage, planner);
      pass('blank nav touch 390x844');
    } catch (err) {
      await capture(touchPage, 'blank nav touch 390x844', err);
    }
  } else {
    fail('blank nav touch 390x844', new Error('터치 컨텍스트 없음'), null);
  }

  return { results, findings };
}

async function sameIds(a, b) {
  const x = [...(a || [])].sort().join(',');
  const y = [...(b || [])].sort().join(',');
  return x === y;
}

async function testManageFocusAndDrag(page, meta) {
  const list = page.locator('#cardList .list-item');
  await list.first().waitFor({ state: 'visible' });

  const titles = await observe(page);
  if (titles.listTitles.includes('타카드')) {
    throw new Error('목록에 타계정 카드가 보임');
  }
  if (await page.locator('#manageBulkBar, [data-action="open-manage-move-picker"], .manage-card-check').count()) {
    throw new Error('제거된 관리 일괄 UI가 남아 있음');
  }

  await page.locator('[data-action="deselect-all"]').click();
  await waitObserve(page, (s) => s.visibleSelectedCount === 0, 8000, '학습선택 해제');
  const selectedFrozen = (await observe(page)).selectedIds.slice();

  await list.nth(0).locator('.item-title').click();
  await waitObserve(page, (s) => (
    s.activeManageId === meta.cardIds[0]
    && s.manageFocusAnchorId === meta.cardIds[0]
    && s.manageFocusIds.length === 1
    && s.manageFocusIds[0] === meta.cardIds[0]
  ), 8000, '일반 클릭 포커스+상세');
  const detail = page.locator('#manageDetail');
  if (!(await detail.innerText()).includes('카드A')) throw new Error('상세에 카드A 없음');

  await page.locator('#selectionList input[data-action="toggle-select"]').first().click();
  await waitObserve(page, (s) => s.selectedIds.includes(meta.cardIds[0]), 8000, '사이드바 학습선택');
  const afterSidebar = await observe(page);
  if (!afterSidebar.manageFocusIds.includes(meta.cardIds[0]) || afterSidebar.manageFocusIds.length !== 1) {
    throw new Error(`학습선택이 관리 포커스를 바꿈 ${JSON.stringify(afterSidebar.manageFocusIds)}`);
  }

  const dropEl = page.locator(`#folderTree [data-folder-id="${meta.dropFolderId}"]`);

  await list.nth(2).click({ modifiers: ['Control'] });
  await waitObserve(page, (s) => (
    s.manageFocusIds.length === 2
    && s.manageFocusIds.includes(meta.cardIds[0])
    && s.manageFocusIds.includes(meta.cardIds[2])
    && s.manageFocusAnchorId === meta.cardIds[2]
  ), 8000, 'Ctrl 비연속 AC');

  await list.nth(2).click({ modifiers: ['Control'] });
  await waitObserve(page, (s) => (
    s.manageFocusIds.length === 1
    && s.manageFocusIds[0] === meta.cardIds[0]
    && s.manageFocusAnchorId === meta.cardIds[2]
  ), 8000, 'Ctrl 해제 C·앵커 최근 클릭');

  await list.nth(2).click({ modifiers: ['Control'] });
  await list.nth(3).click({ modifiers: ['Control'] });
  await waitObserve(page, (s) => {
    const expect = [meta.cardIds[0], meta.cardIds[2], meta.cardIds[3]];
    return expect.every((id) => s.manageFocusIds.includes(id))
      && s.manageFocusIds.length === 3
      && s.manageFocusAnchorId === meta.cardIds[3];
  }, 8000, 'Ctrl ACD');

  await page.evaluate(async () => {
    const { clearUndo } = await import('/js/services/undo.js');
    clearUndo();
  });
  const beforeCtrlDrag = await observe(page);
  const beforeCtrlMap = Object.fromEntries(beforeCtrlDrag.cards.map((c) => [c.id, c.folderId]));
  await page.locator(`#cardList [data-drag-card="${meta.cardIds[1]}"]`).dragTo(dropEl);
  await waitObserve(page, (s) => {
    const b = s.cards.find((c) => c.id === meta.cardIds[1]);
    const a = s.cards.find((c) => c.id === meta.cardIds[0]);
    return b?.folderId === meta.dropFolderId && a?.folderId === beforeCtrlMap[meta.cardIds[0]];
  }, 8000, '포커스 밖 B 단독 이동');

  await page.locator('[data-action="undo"]').click();
  await waitObserve(page, (s) => {
    const b = s.cards.find((c) => c.id === meta.cardIds[1]);
    return b?.folderId === beforeCtrlMap[meta.cardIds[1]];
  }, 8000, 'Ctrl B 단독 1 Undo');

  await page.evaluate(async () => {
    const { clearUndo } = await import('/js/services/undo.js');
    clearUndo();
  });
  await page.locator(`#cardList [data-drag-card="${meta.cardIds[2]}"]`).dragTo(dropEl);
  await waitObserve(page, (s) => {
    const a = s.cards.find((c) => c.id === meta.cardIds[0]);
    const c = s.cards.find((c) => c.id === meta.cardIds[2]);
    const d = s.cards.find((c) => c.id === meta.cardIds[3]);
    const b = s.cards.find((c) => c.id === meta.cardIds[1]);
    return a?.folderId === meta.dropFolderId
      && c?.folderId === meta.dropFolderId
      && d?.folderId === meta.dropFolderId
      && b?.folderId === beforeCtrlMap[meta.cardIds[1]];
  }, 8000, 'Ctrl 집합 ACD 드래그');

  await page.locator('[data-action="undo"]').click();
  await waitObserve(page, (s) => {
    const a = s.cards.find((c) => c.id === meta.cardIds[0]);
    const c = s.cards.find((c) => c.id === meta.cardIds[2]);
    const d = s.cards.find((c) => c.id === meta.cardIds[3]);
    return a?.folderId === beforeCtrlMap[meta.cardIds[0]]
      && c?.folderId === beforeCtrlMap[meta.cardIds[2]]
      && d?.folderId === beforeCtrlMap[meta.cardIds[3]];
  }, 8000, 'Ctrl 집합 1 Undo');

  await list.nth(0).locator('.item-title').click();
  await waitObserve(page, (s) => (
    s.manageFocusIds.length === 1
    && s.manageFocusIds[0] === meta.cardIds[0]
    && s.manageFocusAnchorId === meta.cardIds[0]
  ), 8000, '일반 클릭 Ctrl 후 단일 초기화');

  await list.nth(2).click({ modifiers: ['Shift'] });
  await waitObserve(page, (s) => {
    const expectIds = meta.cardIds.slice(0, 3);
    return expectIds.every((id) => s.manageFocusIds.includes(id))
      && s.manageFocusIds.length === 3
      && s.manageFocusCount === 3
      && s.manageFocusAnchorId === meta.cardIds[0]
      && s.selectedIds.includes(meta.cardIds[0]);
  }, 8000, 'Shift 범위 ABC');

  await list.nth(1).click({ modifiers: ['Shift'] });
  await waitObserve(page, (s) => (
    s.manageFocusIds.length === 2
    && s.manageFocusIds.includes(meta.cardIds[0])
    && s.manageFocusIds.includes(meta.cardIds[1])
    && !s.manageFocusIds.includes(meta.cardIds[2])
    && s.manageFocusAnchorId === meta.cardIds[0]
  ), 8000, '연속 Shift 범위 축소 AB');

  await list.nth(0).locator('.item-title').click();
  await list.nth(2).click({ modifiers: ['Shift'] });
  await waitObserve(page, (s) => s.manageFocusIds.length === 3 && s.manageFocusAnchorId === meta.cardIds[0], 8000, '새 앵커 후 ABC');
  await page.screenshot({ path: SHOT_MANAGE, fullPage: true });

  await page.evaluate(async () => {
    const { clearUndo } = await import('/js/services/undo.js');
    clearUndo();
  });
  const before = await observe(page);
  const beforeMap = Object.fromEntries(before.cards.map((c) => [c.id, c.folderId]));
  await page.locator(`#cardList [data-drag-card="${meta.cardIds[1]}"]`).dragTo(dropEl);
  await waitObserve(page, (s) => {
    const a = s.cards.find((c) => c.id === meta.cardIds[0]);
    const b = s.cards.find((c) => c.id === meta.cardIds[1]);
    const c = s.cards.find((c) => c.id === meta.cardIds[2]);
    const d = s.cards.find((c) => c.id === meta.cardIds[3]);
    return a?.folderId === meta.dropFolderId
      && b?.folderId === meta.dropFolderId
      && c?.folderId === meta.dropFolderId
      && d?.folderId === beforeMap[meta.cardIds[3]];
  }, 8000, '포커스 B 드래그로 ABC 이동');

  await list.nth(3).locator('.item-title').click();
  await waitObserve(page, (s) => (
    s.activeManageId === meta.cardIds[3]
    && s.manageFocusAnchorId === meta.cardIds[3]
    && s.manageFocusIds.length === 1
  ), 8000, '드래그 직후 D 단일 클릭');
  await list.nth(0).locator('.item-title').click();
  await waitObserve(page, (s) => (
    s.activeManageId === meta.cardIds[0]
    && s.manageFocusAnchorId === meta.cardIds[0]
  ), 8000, 'D 후 A 단일 클릭');

  await page.locator('[data-action="undo"]').click();
  await waitObserve(page, (s) => {
    const a = s.cards.find((c) => c.id === meta.cardIds[0]);
    const b = s.cards.find((c) => c.id === meta.cardIds[1]);
    const c = s.cards.find((c) => c.id === meta.cardIds[2]);
    return a?.folderId === beforeMap[meta.cardIds[0]]
      && b?.folderId === beforeMap[meta.cardIds[1]]
      && c?.folderId === beforeMap[meta.cardIds[2]];
  }, 8000, '1 Undo ABC 복원');

  await list.nth(0).locator('.item-title').click();
  await list.nth(2).click({ modifiers: ['Shift'] });
  await waitObserve(page, (s) => s.manageFocusIds.length === 3, 8000, 'ABC 재포커스');
  const dBefore = (await observe(page)).cards.find((c) => c.id === meta.cardIds[3])?.folderId;
  await page.locator(`#cardList [data-drag-card="${meta.cardIds[3]}"]`).dragTo(dropEl);
  await waitObserve(page, (s) => {
    const a = s.cards.find((c) => c.id === meta.cardIds[0]);
    const d = s.cards.find((c) => c.id === meta.cardIds[3]);
    return d?.folderId === meta.dropFolderId
      && dBefore !== meta.dropFolderId
      && a?.folderId === beforeMap[meta.cardIds[0]];
  }, 8000, '범위 밖 D 단독 이동');

  await list.nth(3).locator('.item-title').click();
  await waitObserve(page, (s) => s.manageFocusAnchorId === meta.cardIds[3] && s.manageFocusIds.length === 1, 8000, '일반 클릭 새 앵커 D');

  const selectedNow = (await observe(page)).selectedIds;
  if (!(await sameIds(selectedNow, afterSidebar.selectedIds))) {
    throw new Error(`관리 포커스가 selectedIds를 바꿈 ${JSON.stringify(selectedNow)}`);
  }

  await page.locator('#searchInput').fill('카드A');
  await waitObserve(page, (s) => s.listTitles.length === 1 && s.listTitles[0] === '카드A' && s.manageFocusIds.length === 0, 8000, '필터 시 숨은 포커스 제거');

  const staleBefore = await observe(page);
  const hiddenId = meta.cardIds[2];
  const visibleId = meta.cardIds[0];
  const hiddenFolder = staleBefore.cards.find((c) => c.id === hiddenId)?.folderId;
  await page.evaluate(async ({ visibleId, hiddenId }) => {
    const { store } = await import('/js/core/store.js');
    store.manageFocusIds = [visibleId, hiddenId];
    store.manageFocusAnchorId = visibleId;
  }, { visibleId, hiddenId });
  await page.locator(`#cardList [data-drag-card="${visibleId}"]`).dragTo(dropEl);
  await waitObserve(page, (s) => {
    const vis = s.cards.find((c) => c.id === visibleId);
    const hid = s.cards.find((c) => c.id === hiddenId);
    return vis?.folderId === meta.dropFolderId && hid?.folderId === hiddenFolder;
  }, 8000, '숨은 포커스는 이동하지 않음');

  await page.locator('#searchInput').fill('');
  await waitObserve(page, (s) => s.listTitles.length >= 4, 8000, '필터 해제');

  await list.nth(0).locator('.item-title').click();
  await waitObserve(page, (s) => s.manageFocusIds.length === 1 && s.manageFocusAnchorId === meta.cardIds[0], 8000, 'Ctrl+Shift 전 앵커 A');
  await list.nth(2).click({ modifiers: ['Control', 'Shift'] });
  await waitObserve(page, (s) => {
    const expectIds = meta.cardIds.slice(0, 3);
    return expectIds.every((id) => s.manageFocusIds.includes(id))
      && s.manageFocusIds.length === 3
      && s.manageFocusAnchorId === meta.cardIds[0];
  }, 8000, 'Ctrl+Shift는 범위(Shift)이고 토글이 아님');
}

async function testOwnership(page, meta) {
  const blocked = await page.evaluate(async ({ otherFolderId, otherCardId, ownIds, folderId }) => {
    const { store } = await import('/js/core/store.js');
    const { dropCardOnFolder } = await import('/js/app/actions.js');
    const snap = () => store.data.cards.map((c) => ({ id: c.id, folderId: c.folderId || null }));
    store.manageFocusIds = [...ownIds, otherCardId];
    store.manageFocusAnchorId = ownIds[0];
    const before = snap();
    await dropCardOnFolder(ownIds[0], otherFolderId);
    const afterForeign = snap();
    await dropCardOnFolder(ownIds[0], 'not-a-folder');
    const afterInvalid = snap();
    await dropCardOnFolder(otherCardId, folderId);
    const afterOther = snap();
    const foreignSame = JSON.stringify(before) === JSON.stringify(afterForeign);
    const invalidSame = JSON.stringify(afterForeign) === JSON.stringify(afterInvalid);
    const otherSame = JSON.stringify(afterInvalid) === JSON.stringify(afterOther);
    const other = store.data.cards.find((c) => c.id === otherCardId);
    return { foreignSame, invalidSame, otherSame, otherFolder: other?.folderId || null };
  }, {
    otherFolderId: meta.otherFolderId,
    otherCardId: meta.otherCardId,
    ownIds: meta.cardIds,
    folderId: meta.folderId,
  });
  if (!blocked.foreignSame) throw new Error('타인 폴더로 부분 이동됨');
  if (!blocked.invalidSame) throw new Error('잘못된 폴더 id로 부분 이동됨');
  if (!blocked.otherSame) throw new Error('타계정 카드 드래그가 처리됨');
  if (blocked.otherFolder === null) throw new Error('타계정 카드가 이동됨');
}

async function openStudyPlayFromManage(page) {
  const now = await observe(page);
  if (now.section !== 'manage') {
    const nav = page.locator('#navManage');
    await nav.waitFor({ state: 'visible', timeout: 8000 });
    await nav.click();
    await waitObserve(page, (s) => s.section === 'manage', 8000, '관리 복귀');
  }
  const search = page.locator('#searchInput');
  if (await search.isVisible()) {
    await search.fill('');
    await waitObserve(page, (s) => s.listTitles.includes('카드A'), 8000, '학습 전 목록');
  }
  await page.locator('#cardList .item-title').filter({ hasText: '카드A' }).click();
  await waitObserve(page, (s) => s.cards.find((c) => c.id === s.activeManageId)?.title === '카드A', 8000, '카드A 상세');
  const detail = page.locator('#manageDetail');
  if (!(await detail.innerText()).includes('카드A')) throw new Error('상세에 카드A 없음');
  await page.locator('#manageDetail [data-action="study-one"]').click();
  await waitObserve(page, (s) => s.section === 'study-play' && s.blanks.length >= 2, 10000, '학습 시작');
  const wrap1 = page.locator('#blankWrap1');
  await wrap1.waitFor({ state: 'visible', timeout: 8000 });
  return wrap1;
}

async function testBlankNavHover(page) {
  await openStudyPlayFromManage(page);
  const trigger = page.locator('.study-blank-nav-trigger');
  await trigger.waitFor({ state: 'visible', timeout: 8000 });
  const css = await page.evaluate(() => {
    const panel = document.querySelector('.study-blank-nav-panel');
    if (!panel) return null;
    const cs = getComputedStyle(panel);
    return { hiddenAttr: panel.hidden, display: cs.display, visibility: cs.visibility, pointerEvents: cs.pointerEvents };
  });
  const start = Date.now();
  let probe = null;
  while (Date.now() - start < 2000) {
    probe = await pointerHover(page, trigger);
    if ((await observe(page)).navOpen) break;
  }
  await waitObserve(page, (s) => s.navOpen === true, 800, `hover 열림 css=${JSON.stringify(css)} probe=${JSON.stringify(probe)}`);
  const holdUntil = Date.now() + 400;
  while (Date.now() < holdUntil) {
    const s = await observe(page);
    if (!s.navOpen) {
      throw new Error(`포인터가 트리거에 있는데 CLOSE_DELAY 이후 닫힘 css=${JSON.stringify(css)} probe=${JSON.stringify(probe)} later=${JSON.stringify(summarize(s))}`);
    }
  }
  await trigger.click();
  if (!(await observe(page)).navOpen) throw new Error('hover 후 첫 클릭이 목록을 닫음');
  await page.mouse.move(2, 2);
  const afterLeave = Date.now() + 400;
  while (Date.now() < afterLeave) {
    if (!(await observe(page)).navOpen) throw new Error('첫 클릭 고정 후 마우스 이탈에 닫힘');
  }
  await trigger.click();
  await waitObserve(page, (s) => s.navOpen === false, 8000, '두번째 클릭 닫기');
}

async function testBlankNavKeyboardGrade(page) {
  const s0 = await observe(page);
  if (s0.section !== 'study-play') await openStudyPlayFromManage(page);
  const trigger = page.locator('.study-blank-nav-trigger');
  const wrap1 = page.locator('#blankWrap1');
  await wrap1.waitFor({ state: 'visible', timeout: 8000 });
  await trigger.waitFor({ state: 'visible', timeout: 8000 });

  await wrap1.click();
  await trigger.click();
  await waitObserve(page, (s) => s.navOpen === true, 8000, '클릭 열림');
  await page.locator('#gradeResult').click();
  await waitObserve(page, (s) => s.navOpen === false, 8000, '외부 클릭 닫기');

  await wrap1.click();
  await trigger.click();
  await waitObserve(page, (s) => s.navOpen === true, 8000, 'Escape용 열림');
  await page.keyboard.press('Escape');
  await waitObserve(page, (s) => s.navOpen === false, 8000, 'Escape 닫기');
  // 클릭으로 연 경우 Playwright가 트리거에 포커스를 둔 뒤 핸들러가 열므로, 복원 대상은 트리거다.
  // 빈칸 포커스 중 hover 열림→Escape 복원은 hover 시나리오에서만 검증한다.

  let tabs = 0;
  while (tabs < 25) {
    if ((await observe(page)).activeClass.includes('study-blank-nav-trigger')) break;
    await page.keyboard.press('Tab');
    tabs += 1;
  }
  if (!(await observe(page)).activeClass.includes('study-blank-nav-trigger')) {
    throw new Error('Tab으로 빈칸 목록 버튼에 도달하지 못함');
  }
  await page.keyboard.press('Enter');
  await waitObserve(page, (s) => s.navOpen === true, 8000, 'Enter 열림');
  await page.keyboard.press('Escape');
  await waitObserve(page, (s) => s.navOpen === false && s.activeClass.includes('study-blank-nav-trigger'), 8000, 'Escape 후 트리거 포커스');

  await wrap1.click();
  await page.keyboard.type('답1');
  await waitObserve(page, (s) => s.blanks.some((b) => b.order === 1 && b.text.includes('답1') && b.focused), 8000, '빈칸1 입력');
  await trigger.click();
  await waitObserve(page, (s) => s.navOpen === true, 8000, '항목 이동 전 클릭 열림');
  const typed = (await observe(page)).blanks.find((b) => b.order === 1)?.text;
  await page.locator('.study-blank-nav-item[data-order="2"]').click();
  await waitObserve(page, (s) => s.activeBlankOrder === '2' && s.blanks.find((b) => b.order === 1)?.text === typed, 8000, '빈칸 이동 후 입력 유지');

  await page.locator('[data-action="grade"]').click();
  await waitObserve(page, (s) => {
    const item = s.navItems.find((n) => n.order === 1);
    const field = s.blanks.find((b) => b.order === 1);
    return item?.ok === true && field?.ok === true;
  }, 8000, '채점 버튼 후 ok');
  const item2 = (await observe(page)).navItems.find((n) => n.order === 2);
  if (!item2?.bad) throw new Error(`빈칸2 채점 bad 아님: ${JSON.stringify(item2)}`);
}

async function pointerHover(page, locator) {
  const box = await locator.boundingBox();
  if (!box || box.width < 1 || box.height < 1) {
    throw new Error(`hover 대상이 화면에 없음: ${JSON.stringify(box)}`);
  }
  await page.evaluate(() => {
    const onOver = (e) => {
      const t = e.target;
      const el = t && t.nodeType === 1 ? t : t?.parentElement;
      if (!el || typeof el.closest !== 'function') return;
      if (!el.closest('[data-study-blank-nav]')) return;
      document.removeEventListener('mouseover', onOver, true);
      document.documentElement.dataset.navHoverProbe = JSON.stringify({
        nodeType: t.nodeType,
        nodeName: t.nodeName,
        hasClosest: typeof t.closest === 'function',
      });
    };
    document.addEventListener('mouseover', onOver, true);
  });
  await locator.hover();
  const box2 = await locator.boundingBox();
  const x = box2.x + box2.width / 2;
  const y = box2.y + box2.height / 2;
  const hit = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el ? { tag: el.tagName, id: el.id, cls: String(el.className).slice(0, 120), action: el.getAttribute?.('data-action') } : null;
  }, { x, y });
  const over = await page.evaluate(() => {
    const raw = document.documentElement.dataset.navHoverProbe || null;
    delete document.documentElement.dataset.navHoverProbe;
    return raw ? JSON.parse(raw) : null;
  });
  const now = await observe(page);
  return { hit, over, navOpen: now.navOpen, navExpanded: now.navExpanded };
}

async function goManageFromPlay(page) {
  const s = await observe(page);
  if (s.section === 'manage') return;
  const toggle = page.locator('#sidebarToggle');
  if (await toggle.isVisible()) await toggle.click();
  await page.locator('#navManage').click();
  await waitObserve(page, (x) => x.section === 'manage', 8000, '관리 이동');
}

async function testReloadLogin(page, meta, planner) {
  await goManageFromPlay(page);
  const snap = await observe(page);
  const folderSnap = Object.fromEntries(
    snap.cards.filter((c) => c.userId === meta.userId).map((c) => [c.id, c.folderId]),
  );
  await page.locator('aside.sidebar').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.locator('#loggedInUser [data-action="logout"]').click();
  await page.waitForSelector('#authOverlay:not(.hidden)', { timeout: 10000 });
  await page.reload();
  await passAlphaGate(page, planner);
  await loginViaUi(page, 'E2E유저', '1234');
  await waitObserve(page, (s) => s.section === 'manage' && s.listTitles.includes('카드A'), 10000, '로그인 후 관리');
  const after = await observe(page);
  for (const id of meta.cardIds) {
    const now = after.cards.find((c) => c.id === id)?.folderId ?? null;
    if (now !== folderSnap[id]) {
      throw new Error(`reload 후 폴더 불일치 ${id}: ${folderSnap[id]} → ${now}`);
    }
  }
}

async function testBlankNavTouch(page, planner) {
  await page.goto('http://127.0.0.1:4173/index.html#/manage');
  await passAlphaGate(page, planner);
  await fixture(page, 'seedPrimaryUser');
  await waitObserve(page, (s) => s.listTitles.includes('카드A'), 10000, '터치 시드');
  await openStudyPlayFromManage(page);
  const trigger = page.locator('.study-blank-nav-trigger');
  await trigger.tap();
  await waitObserve(page, (s) => s.navOpen === true, 8000, '터치 열림');
  await page.locator('.study-blank-nav-item[data-order="2"]').tap();
  await waitObserve(page, (s) => s.activeBlankOrder === '2', 8000, '터치 빈칸2');
  await trigger.tap();
  await waitObserve(page, (s) => s.navOpen === true, 8000, '터치 재열림');
  await page.locator('#gradeResult').tap();
  await waitObserve(page, (s) => s.navOpen === false, 8000, '터치 외부 닫기');
}
