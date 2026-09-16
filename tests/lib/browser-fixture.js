import { migrateState } from '../../js/domain/migrate.js';
import { saveState } from '../../js/core/storage.js';
import { store, setState } from '../../js/core/store.js';
import { uid } from '../../js/utils/text.js';
import { showSection } from '../../js/ui/router.js';
import { renderAll, renderStudyCard } from '../../js/ui/render.js';
import { hideAuthOverlay } from '../../js/ui/auth.js';
import { countManageVisibleSelected, getManageVisibleCardIds, getManageFocusIds } from '../../js/ui/manage-selection.js';

function blankCard(userId, folderId, title, n) {
  const blanks = [];
  let text = '';
  for (let i = 1; i <= n; i += 1) {
    text += `항목${i} [[BLANK${i}]] `;
    blanks.push({ order: i, answer: `답${i}`, aliases: '' });
  }
  return {
    id: uid(),
    userId,
    folderId,
    title,
    displayText: title,
    explanationText: text.trim(),
    blanks,
    flagColor: 0,
    rounds: 0,
    wrongCount: 0,
    memo: '',
    updatedAt: new Date().toISOString(),
  };
}

export async function seedPrimaryUser() {
  const user = {
    id: uid(),
    name: 'E2E유저',
    pin: '1234',
    createdAt: new Date().toISOString(),
  };
  const folderId = uid();
  const folder = {
    id: folderId,
    userId: user.id,
    name: 'E2E폴더',
    parentId: null,
    updatedAt: new Date().toISOString(),
  };
  const dropFolderId = uid();
  const dropFolder = {
    id: dropFolderId,
    userId: user.id,
    name: '드롭폴더',
    parentId: null,
    updatedAt: new Date().toISOString(),
  };
  const otherUser = {
    id: uid(),
    name: '타계정',
    pin: '5678',
    createdAt: new Date().toISOString(),
  };
  const otherFolderId = uid();
  const otherFolder = {
    id: otherFolderId,
    userId: otherUser.id,
    name: '타폴더',
    parentId: null,
    updatedAt: new Date().toISOString(),
  };
  const cards = [
    blankCard(user.id, folderId, '카드A', 3),
    blankCard(user.id, folderId, '카드B', 2),
    blankCard(user.id, folderId, '카드C', 2),
    blankCard(user.id, folderId, '카드D', 1),
    blankCard(otherUser.id, otherFolderId, '타카드', 1),
  ];
  const state = migrateState({
    users: [user, otherUser],
    cards,
    folders: [folder, dropFolder, otherFolder],
    activeUserId: user.id,
    selectedIds: [],
    ui: { filterFlag: 'all', filterFolderId: null, treeExpanded: {}, studyConfig: {} },
  });
  setState(state);
  await saveState(state);
  store.authenticatedUserId = user.id;
  store.activeFolderId = null;
  store.activeManageId = null;
  hideAuthOverlay();
  showSection('manage');
  renderAll();
  return {
    userId: user.id,
    folderId,
    dropFolderId,
    otherUserId: otherUser.id,
    otherFolderId,
    cardIds: cards.filter((c) => c.userId === user.id).map((c) => c.id),
    otherCardId: cards.find((c) => c.userId === otherUser.id).id,
  };
}

export function startStudyPlayFirst() {
  const userId = store.authenticatedUserId ?? store.data?.activeUserId;
  const card = store.data?.cards?.find((c) => c.userId === userId);
  if (!card) throw new Error('startStudyPlayFirst: 카드 없음');
  store.studyQueue = [card];
  store.studyIndex = 0;
  store.currentBlankStatuses = card.blanks.map((b) => ({
    order: b.order, checked: false, correct: false, score: 0, user: '', revealed: false,
  }));
  store._studyCardId = card.id;
  store._studyNavCardId = null;
  store.currentBlankFocus = null;
  showSection('study-play');
  renderStudyCard();
}

export function cardFoldersForActiveUser() {
  const userId = store.authenticatedUserId;
  return store.data.cards.filter((c) => c.userId === userId).map((c) => c.folderId || null);
}

/** 관측 전용 — 테스트가 동작을 우회하지 않음 */
export function observeApp() {
  const userId = store.authenticatedUserId;
  const cards = (store.data?.cards || []).map((c) => ({
    id: c.id,
    title: c.title,
    folderId: c.folderId || null,
    userId: c.userId,
  }));
  const panel = document.querySelector('.study-blank-nav-panel');
  const trigger = document.querySelector('.study-blank-nav-trigger');
  const blanks = [...document.querySelectorAll('#studyExplanation [data-blank-order]')].map((el) => ({
    order: Number(el.dataset.blankOrder),
    text: String(el.textContent || '').replace(/\u00a0/g, ' '),
    focused: document.activeElement === el,
    ok: el.classList.contains('ok'),
    bad: el.classList.contains('bad'),
  }));
  const navItems = [...document.querySelectorAll('.study-blank-nav-item')].map((el) => ({
    order: Number(el.dataset.order),
    ok: el.classList.contains('ok'),
    bad: el.classList.contains('bad'),
    current: el.classList.contains('is-current'),
  }));
  return {
    section: store.currentSection,
    authenticatedUserId: userId,
    selectedIds: [...(store.data?.selectedIds || [])],
    visibleSelectedCount: countManageVisibleSelected(),
    visibleCardIds: getManageVisibleCardIds(),
    activeManageId: store.activeManageId,
    manageFocusIds: getManageFocusIds(),
    manageFocusAnchorId: store.manageFocusAnchorId || null,
    currentBlankFocus: store.currentBlankFocus,
    blankStatuses: (store.currentBlankStatuses || []).map((s) => ({
      order: s.order, checked: s.checked, correct: s.correct, user: s.user,
    })),
    cards,
    listIds: [...document.querySelectorAll('#cardList [data-drag-card]')].map((el) => el.dataset.dragCard),
    listTitles: [...document.querySelectorAll('#cardList .item-title')].map((el) => el.textContent.trim()),
    manageFocusCount: document.querySelectorAll('#cardList .is-manage-focus').length,
    navOpen: panel ? !panel.hidden : false,
    navExpanded: trigger?.getAttribute('aria-expanded') === 'true',
    blanks,
    navItems,
    activeTag: document.activeElement?.tagName || null,
    activeClass: String(document.activeElement?.className || ''),
    activeBlankOrder: document.activeElement?.dataset?.blankOrder || null,
  };
}
