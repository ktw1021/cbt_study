import { getState, store } from '../core/store.js';
import { getCardsFiltered } from '../domain/queries.js';
import { readFilters } from './sidebar.js';

/** 카드관리 목록에 보이는 카드 (트리 폴더 + 사이드바 필터) */
export function getManageVisibleCards() {
  return getCardsFiltered(readFilters(store.activeFolderId));
}

export function getManageVisibleCardIds() {
  return getManageVisibleCards().map((c) => c.id);
}

export function getManageFocusIds() {
  return Array.isArray(store.manageFocusIds) ? store.manageFocusIds.slice() : [];
}

export function clearManageFocus() {
  store.manageFocusIds = [];
  store.manageFocusAnchorId = null;
}

/** 필터·정렬·폴더가 바뀌면 숨은 관리 포커스를 버린다. 학습 selectedIds 는 건드리지 않는다. */
export function syncManageListFilterKey() {
  const key = JSON.stringify({
    folder: store.activeFolderId || null,
    user: store.authenticatedUserId || null,
    filters: readFilters(store.activeFolderId),
  });
  if (store._manageListFilterKey !== key) {
    store._manageListFilterKey = key;
    clearManageFocus();
  }
}

export function focusManageCard(id) {
  const visible = new Set(getManageVisibleCardIds());
  if (!visible.has(id)) return;
  store.manageFocusAnchorId = id;
  store.manageFocusIds = [id];
}

/** 현재 보이는 목록에서 앵커~끝 inclusive. 앵커가 없으면 그 장만. */
export function focusManageRange(toId) {
  const cards = getManageVisibleCards();
  const toIdx = cards.findIndex((c) => c.id === toId);
  if (toIdx < 0) return;
  let fromIdx = cards.findIndex((c) => c.id === store.manageFocusAnchorId);
  if (fromIdx < 0) {
    store.manageFocusAnchorId = toId;
    fromIdx = toIdx;
  }
  const start = Math.min(fromIdx, toIdx);
  const end = Math.max(fromIdx, toIdx);
  store.manageFocusIds = cards.slice(start, end + 1).map((c) => c.id);
}

/** Ctrl+클릭 — 보이는 목록에서 비연속 추가·해제. 앵커는 클릭한 카드. */
export function toggleManageFocus(id) {
  const visible = new Set(getManageVisibleCardIds());
  if (!visible.has(id)) return;
  store.manageFocusAnchorId = id;
  const ids = getManageFocusIds();
  const idx = ids.indexOf(id);
  if (idx >= 0) {
    store.manageFocusIds = ids.filter((x) => x !== id);
  } else if (ids.length) {
    store.manageFocusIds = [...ids, id];
  } else {
    store.manageFocusIds = [id];
  }
}

export function countManageVisibleSelected() {
  const visible = new Set(getManageVisibleCardIds());
  return (getState().selectedIds || []).filter((id) => visible.has(id)).length;
}
