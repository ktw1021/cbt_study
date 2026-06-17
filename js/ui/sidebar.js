import { getState, store } from '../core/store.js';
import { escapeHtml, shorten } from '../utils/text.js';
import {
  getActiveUser,
  getUserFolders,
  getUserCards,
  getCardsFiltered,
} from '../domain/queries.js';
import { getPersistedStudySession } from '../services/study-session.js';
import { renderResumePanel } from './resume-panel.js';
import { fillFolderSelect } from './folder-select.js';

/** 필터 UI 상태 반영 (플래그 스와치·폴더 select) */
export function renderFilterUI() {
  const ui = getState().ui || {};
  const flag = ui.filterFlag ?? 'all';
  document.querySelectorAll('[data-action="filter-flag"]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.flag === flag);
  });
  fillFolderSelect(document.getElementById('filterFolderSelect'), {
    value: ui.filterFolderId ?? '',
    includeAll: true,
    allLabel: '전체 폴더',
    showCount: true,
  });
}

/**
 * 사이드바 필터 읽기
 * @param {string|null|undefined} manageFolderId — 카드관리 트리 폴더(전달 시 우선). 생략 시 필터 select
 */
export function readFilters(manageFolderId) {
  const ui = getState().ui || {};
  const folderFromSelect = document.getElementById('filterFolderSelect')?.value || null;
  const folderId = manageFolderId !== undefined
    ? manageFolderId
    : (folderFromSelect || ui.filterFolderId || null);
  return {
    search: document.getElementById('searchInput')?.value || '',
    flag: ui.filterFlag ?? 'all',
    wrong: document.getElementById('wrongFilter')?.value || 'all',
    folderId: folderId || null,
  };
}

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

  renderFilterUI();

  const cards = getUserCards(user.id);
  document.getElementById('userSummary').textContent =
    `카드 ${cards.length}개 · 폴더 ${getUserFolders(user.id).length}개`;

  const filters = readFilters();
  const filtered = getCardsFiltered(filters);

  document.getElementById('selectionList').innerHTML = filtered.length
    ? filtered.map((c) => `
      <label class="list-item" style="cursor:default">
        <input type="checkbox" data-action="toggle-select" data-id="${c.id}" ${state.selectedIds.includes(c.id) ? 'checked' : ''} />
        <span>${escapeHtml(shorten(c.title || c.displayText, 30))}</span>
      </label>`).join('')
    : '<div class="list-item"><span class="item-sub">없음</span></div>';

  const selectedVisible = filtered.filter((c) => state.selectedIds.includes(c.id)).length;
  document.getElementById('statTotal').textContent = cards.length;
  document.getElementById('statSelected').textContent = selectedVisible;
  document.getElementById('statRounds').textContent = cards.reduce((a, c) => a + c.rounds, 0);

  const selCountEl = document.getElementById('selectionCount');
  if (selCountEl) selCountEl.textContent = selectedVisible ? `${selectedVisible}개 선택` : '선택 없음';
  const startBtn = document.getElementById('startSelectedBtn');
  if (startBtn) startBtn.disabled = selectedVisible === 0;

  renderResumePanel({
    mountId: 'sidebarResumeMount',
    variant: 'sidebar',
    sess: getPersistedStudySession(),
  });
}
