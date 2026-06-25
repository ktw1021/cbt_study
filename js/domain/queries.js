import { getState, store } from '../core/store.js';
import { escapeHtml } from '../utils/text.js';

/** 이름 정규화 (앞뒤 공백·유니코드) */
export function normalizeUserName(name) {
  return String(name || '').trim().normalize('NFC');
}

/** 이름으로 사용자 찾기 (정확히 일치) */
export function findUserByName(name) {
  const n = normalizeUserName(name);
  if (!n) return null;
  return getState().users.find((u) => normalizeUserName(u.name) === n) || null;
}

/** 활성 사용자 (로그인된 사용자) */
export function getActiveUser() {
  const state = getState();
  if (!state) return null;
  const id = store.authenticatedUserId;
  if (!id) return null;
  return state.users.find((u) => u.id === id) || null;
}

export function getUserFolders(userId) {
  return getState().folders.filter((f) => f.userId === userId);
}

export function getUserCards(userId) {
  return getState().cards.filter((c) => c.userId === userId);
}

export function getCard(id) {
  return getState().cards.find((c) => c.id === id);
}

export function getFolder(id) {
  return getState().folders.find((f) => f.id === id);
}

/** 폴더 경로 문자열 */
export function folderPathNames(folderId) {
  const parts = [];
  let cur = getFolder(folderId);
  while (cur) {
    parts.unshift(cur.name);
    cur = cur.parentId ? getFolder(cur.parentId) : null;
  }
  return parts.join(' > ') || '(미분류)';
}

/** 하위 폴더 ID 목록 */
export function getDescendantFolderIds(folderId, userId) {
  const kids = getUserFolders(userId).filter((f) => f.parentId === folderId);
  return kids.flatMap((k) => [k.id, ...getDescendantFolderIds(k.id, userId)]);
}

/** 폴더(하위 포함) 카드 수 */
export function countCardsInFolder(folderId, userId) {
  const ids = [folderId, ...getDescendantFolderIds(folderId, userId)];
  return getUserCards(userId).filter((c) => ids.includes(c.folderId)).length;
}

/** 폴더 미지정(미분류) 카드 수 */
export function countUnclassifiedCards(userId) {
  return getUserCards(userId).filter((c) => !c.folderId).length;
}

/** 하위 폴더 ID 목록 */
export function getCardsFiltered(filters) {
  const user = getActiveUser();
  if (!user) return [];
  const userId = user.id;
  let cards = getUserCards(userId);

  if (filters.folderId) {
    const folder = getFolder(filters.folderId);
    if (folder?.userId === userId) {
      const ids = [filters.folderId, ...getDescendantFolderIds(filters.folderId, userId)];
      cards = cards.filter((c) => ids.includes(c.folderId));
    }
  }

  const q = filters.search.trim().toLowerCase();

  return cards.filter((c) => {
    const hay = [c.title, c.displayText, c.explanationText, c.memo, ...(c.blanks || []).map((b) => b.answer)].join(' ').toLowerCase();
    if (q && !hay.includes(q)) return false;
    if (filters.flag !== 'all' && String(c.flagColor) !== filters.flag) return false;
    if (filters.wrong === 'wrong' && c.lastResult !== 'wrong') return false;
    if (filters.wrong === 'correct' && c.lastResult !== 'correct') return false;
    return true;
  });
}

/** 학습 큐 생성 */
/**
 * 학습 큐 구성 — 범위(scope) × 순서(order).
 * scope: all | folder | selected | wrong | flag
 * order: created(만든 순서) | low-rounds(회독 낮은 순) | random(호출부에서 셔플)
 * 폴더 범위인데 folderId가 없으면 빈 배열(전체로 새지 않음).
 */
export function buildStudyQueue({ scope = 'all', order = 'created', folderId = null, flag = 0, selectedIds = [] } = {}) {
  const user = getActiveUser();
  if (!user) return [];
  const userId = user.id;
  let cards = getUserCards(userId);

  if (scope === 'folder') {
    if (!folderId) return [];
    const ids = [folderId, ...getDescendantFolderIds(folderId, userId)];
    cards = cards.filter((c) => ids.includes(c.folderId));
  } else if (scope === 'selected') {
    cards = cards.filter((c) => selectedIds.includes(c.id));
  } else if (scope === 'wrong') {
    cards = cards.filter((c) => c.lastResult === 'wrong');
  } else if (scope === 'flag') {
    if (!flag) return [];
    cards = cards.filter((c) => c.flagColor === Number(flag));
  }

  if (order === 'low-rounds') {
    cards = cards.slice().sort((a, b) => a.rounds - b.rounds || a.wrongCount - b.wrongCount);
  }

  return cards;
}
