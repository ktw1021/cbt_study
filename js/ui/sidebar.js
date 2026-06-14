import { getState, store } from '../core/store.js';
import { escapeHtml, shorten } from '../utils/text.js';
import {
  getActiveUser,
  getUserFolders,
  getUserCards,
  getCardsFiltered,
  countCardsInFolder,
} from '../domain/queries.js';

/** 사이드바: 사용자·필터·선택 카드 */
export function renderSidebar() {
  const state = getState();
  const user = getActiveUser();

  const loggedInEl = document.getElementById('loggedInUser');
  const guestEl = document.getElementById('guestUserPanel');
  if (loggedInEl) loggedInEl.classList.toggle('hidden', !user);
  if (guestEl) guestEl.classList.toggle('hidden', !!user);

  if (!user) {
    return;
  }

  if (loggedInEl) {
    document.getElementById('currentUserName').textContent = user.name;
  }

  const cards = getUserCards(user.id);
  document.getElementById('userSummary').textContent =
    `카드 ${cards.length}개 · 폴더 ${getUserFolders(user.id).length}개`;

  const filters = readFilters();
  const filtered = getCardsFiltered(filters, store.activeFolderId);

  document.getElementById('selectionList').innerHTML = filtered.length
    ? filtered.map((c) => `
      <label class="list-item" style="cursor:default">
        <input type="checkbox" data-action="toggle-select" data-id="${c.id}" ${state.selectedIds.includes(c.id) ? 'checked' : ''} />
        <span>${escapeHtml(shorten(c.title || c.displayText, 30))}</span>
      </label>`).join('')
    : '<div class="list-item"><span class="item-sub">없음</span></div>';

  document.getElementById('statTotal').textContent = cards.length;
  document.getElementById('statSelected').textContent =
    state.selectedIds.filter((id) => cards.some((c) => c.id === id)).length;
  document.getElementById('statRounds').textContent = cards.reduce((a, c) => a + c.rounds, 0);
}

export function readFilters() {
  return {
    search: document.getElementById('searchInput').value,
    flag: document.getElementById('flagFilter').value,
    wrong: document.getElementById('wrongFilter').value,
  };
}
