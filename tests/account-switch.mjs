/**
 * 사이드바 계정 전환 — 목록·PIN·취소 후 현재 계정 유지.
 */
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createAppServer, listen, TEST_ALPHA_PLANNER } from './lib/server.mjs';
import { loadChromium, browserExecutable } from './lib/playwright.mjs';
import { passAlphaGate, fixture, waitObserve } from './navigation-ui.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PORT = Number(process.env.CBT_ACCOUNT_SWITCH_PORT || 4186);
const BASE = `http://127.0.0.1:${PORT}`;

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
    await fixture(page, 'seedPrimaryUser');
    await waitObserve(page, (s) => s.listTitles.includes('카드A') && s.section === 'manage', 10000, 'seed');

    await page.locator('#accountSwitcherToggle').click();
    const names = await page.locator('#accountSwitcherList .account-switch-item').allTextContents();
    if (!names.some((n) => n.includes('E2E유저')) || !names.some((n) => n.includes('타계정'))) {
      fail(`account list missing users ${JSON.stringify(names)}`);
      return;
    }
    pass('lists registered accounts');

    await page.locator('#accountSwitcherList .account-switch-item', { hasText: '타계정' }).click();
    await page.locator('#accountSwitcherPin').waitFor({ state: 'visible' });
    await page.locator('[data-action="cancel-account-switch"]').click();
    const still = await page.locator('#currentUserName').textContent();
    const switcherHidden = await page.locator('#accountSwitcher').evaluate((el) => el.classList.contains('hidden'));
    if (still !== 'E2E유저' || !switcherHidden) {
      fail(`cancel must keep current user, got name=${still} hidden=${switcherHidden}`);
      return;
    }
    const cards = await page.locator('#cardList .item-title').allTextContents();
    if (!cards.includes('카드A')) {
      fail(`cancel must keep cards ${JSON.stringify(cards)}`);
      return;
    }
    pass('cancel stays on current account');

    await page.locator('#accountSwitcherToggle').click();
    await page.locator('#accountSwitcherList .account-switch-item', { hasText: '타계정' }).click();
    await page.locator('#accountSwitchPin').fill('5678');
    await page.locator('[data-action="confirm-account-switch"]').click();
    await waitObserve(page, (s) => s.authenticatedUserId && !s.listTitles.includes('카드A'), 10000, 'switched');
    const after = await page.locator('#currentUserName').textContent();
    if (after !== '타계정') {
      fail(`expected 타계정, got ${after}`);
      return;
    }
    pass('PIN login switches account');

    const studyMeta = await fixture(page, 'seedPrimaryUser');
    await waitObserve(page, (s) => s.listTitles.includes('카드A') && s.section === 'manage', 10000, 'reseed');
    await fixture(page, 'startStudyPlayFirst');
    await waitObserve(page, (s) => s.section === 'study-play' && s.blanks.length >= 1, 10000, 'study-play A');
    await page.locator('#sidebarToggle').click();
    await page.locator('#accountSwitcherToggle').click();
    await page.locator('#accountSwitcherList .account-switch-item', { hasText: '타계정' }).click();
    await page.locator('#accountSwitchPin').fill('5678');
    await page.locator('[data-action="confirm-account-switch"]').click();
    const home = await waitObserve(page, (s) => (
      s.section === 'manage'
      && s.listTitles.includes('타카드')
      && !s.listTitles.includes('카드A')
    ), 10000, 'switch from study to B home');
    const studyHidden = await page.locator('#studySection').evaluate((el) => el.classList.contains('hidden'));
    const manageHidden = await page.locator('#manageSection').evaluate((el) => el.classList.contains('hidden'));
    if (home.section !== 'manage' || !studyHidden || manageHidden) {
      fail(`switch from study must land B home, section=${home.section} studyHidden=${studyHidden} manageHidden=${manageHidden}`);
      return;
    }
    pass('study-play switch lands other user home');

    const sess = await page.evaluate(async ({ aId, aCardId }) => {
      const { store } = await import('/js/core/store.js');
      const { getPersistedStudySession } = await import('/js/services/study-session.js');
      const bSess = getPersistedStudySession();
      return {
        auth: store.authenticatedUserId,
        bCardIds: bSess?.cardIds || [],
        leftover: store.data.ui.studySession || null,
        aHasCard: (store.data.ui.studySessions?.[aId]?.cardIds || []).includes(aCardId),
        bHasA: (bSess?.cardIds || []).includes(aCardId),
      };
    }, { aId: studyMeta.userId, aCardId: studyMeta.cardIds[0] });
    if (sess.auth !== studyMeta.otherUserId) {
      fail(`B auth expected, got ${sess.auth}`);
      return;
    }
    if (sess.bHasA || sess.bCardIds.includes(studyMeta.cardIds[0])) {
      fail(`B inherited A study session ${JSON.stringify(sess)}`);
      return;
    }
    if (!sess.aHasCard) {
      fail(`A study session lost after switch ${JSON.stringify(sess)}`);
      return;
    }
    pass('B does not inherit A study session');

    await page.locator('#accountSwitcherToggle').click();
    await page.locator('#accountSwitcherList .account-switch-item', { hasText: 'E2E유저' }).click();
    await page.locator('#accountSwitchPin').fill('1234');
    await page.locator('[data-action="confirm-account-switch"]').click();
    await waitObserve(page, (s) => s.listTitles.includes('카드A') && !s.listTitles.includes('타카드'), 10000, 'back to A');
    const back = await page.evaluate(async ({ aId, aCardId }) => {
      const { getPersistedStudySession } = await import('/js/services/study-session.js');
      const sess = getPersistedStudySession();
      return {
        cardIds: sess?.cardIds || [],
        user: sess?.cardProgress?.[aCardId]?.blankStatuses?.[0]?.user || '',
        aId,
      };
    }, { aId: studyMeta.userId, aCardId: studyMeta.cardIds[0] });
    if (!back.cardIds.includes(studyMeta.cardIds[0])) {
      fail(`A session missing after return ${JSON.stringify(back)}`);
      return;
    }
    pass('A study session restored after return');

    console.log(`account-switch harness: ${ok} OK`);
  } catch (e) {
    fail(e.message || String(e));
  } finally {
    await browser.close();
    server.close();
  }
}

run();
