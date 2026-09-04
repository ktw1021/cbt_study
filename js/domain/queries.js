import { getState, store } from '../core/store.js';
import { escapeHtml } from '../utils/text.js';

/** 이름 정규화 (앞뒤 공백·유니코드) */
export function normalizeUserName(name) {
  return String(name || '').trim().normalize('NFC');
}

/** 같은 이름 계정 전부 (가입은 막지만, 예전 중복·가져오기 (1) 대비) */
export function findUsersByName(name) {
  const n = normalizeUserName(name);
  if (!n) return [];
  const users = getState()?.users || [];
  return users.filter((u) => normalizeUserName(u.name) === n);
}

/** 이미 있는 이름이면 true */
export function isUserNameTaken(name, exceptId = null) {
  return findUsersByName(name).some((u) => u.id !== exceptId);
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

/** 상위 폴더 ID 목록 (가까운 부모 → 루트) */
export function getAncestorFolderIds(folderId) {
  const out = [];
  let cur = getFolder(folderId);
  while (cur?.parentId) {
    out.push(cur.parentId);
    cur = getFolder(cur.parentId);
  }
  return out;
}

/**
 * 학습 폴더 다중 선택 토글.
 * - 이미 있으면 제거
 * - 새로 넣으면 자손·조상 선택을 걷고 자신만 추가 (상위=하위 포함, 하위=범위 좁히기)
 */
export function toggleStudyFolderSelection(selectedIds, folderId, userId) {
  const sel = new Set((selectedIds || []).filter(Boolean));
  if (!folderId) return [...sel];

  if (sel.has(folderId)) {
    sel.delete(folderId);
    return [...sel];
  }

  const descendants = new Set(getDescendantFolderIds(folderId, userId));
  const ancestors = new Set(getAncestorFolderIds(folderId));
  for (const id of [...sel]) {
    if (descendants.has(id) || ancestors.has(id)) sel.delete(id);
  }
  sel.add(folderId);
  return [...sel];
}

/** 서로 조상·자손이면 상위만 남김 (안전망) */
export function normalizeStudyFolderIds(selectedIds, userId) {
  const ids = [...new Set((selectedIds || []).filter(Boolean))];
  if (ids.length <= 1) return ids;
  return ids.filter((id) => {
    const ancestors = new Set(getAncestorFolderIds(id));
    return !ids.some((other) => other !== id && ancestors.has(other));
  });
}

/** 카드가 있는 폴더만 남김 (하위 포함 0장이면 제외) */
export function pruneEmptyStudyFolders(selectedIds, userId) {
  return normalizeStudyFolderIds(selectedIds, userId)
    .filter((id) => countCardsInFolder(id, userId) > 0);
}

/** 선택 폴더들(하위 포함, 중복 제거)의 카드 합 */
export function countCardsInStudyFolders(selectedIds, userId) {
  const roots = normalizeStudyFolderIds(selectedIds, userId);
  if (!roots.length) return 0;
  const allow = new Set();
  roots.forEach((fid) => {
    allow.add(fid);
    getDescendantFolderIds(fid, userId).forEach((d) => allow.add(d));
  });
  return getUserCards(userId).filter((c) => allow.has(c.folderId)).length;
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
 * scope: all | folder | wrong | flag  (selected는 레거시 → all로 취급)
 * order: created(만든 순서) | low-rounds(회독 낮은 순) | random(호출부에서 셔플)
 * 폴더 범위: folderIds(배열). 레거시 folderId 단일도 받음. 비면 빈 배열.
 */
export function buildStudyQueue({
  scope = 'all', order = 'created', folderId = null, folderIds = null, flag = 0,
} = {}) {
  const user = getActiveUser();
  if (!user) return [];
  const userId = user.id;
  let cards = getUserCards(userId);
  if (scope === 'selected') scope = 'all';

  if (scope === 'folder') {
    const roots = Array.isArray(folderIds) && folderIds.length
      ? folderIds.filter(Boolean)
      : (folderId ? [folderId] : []);
    if (!roots.length) return [];
    const allow = new Set();
    roots.forEach((fid) => {
      allow.add(fid);
      getDescendantFolderIds(fid, userId).forEach((d) => allow.add(d));
    });
    cards = cards.filter((c) => allow.has(c.folderId));
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
