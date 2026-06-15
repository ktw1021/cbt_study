import { store } from '../core/store.js';
import { escapeHtml, shorten } from '../utils/text.js';
import {
  getActiveUser,
  getUserFolders,
  getCard,
  getCardsFiltered,
  countCardsInFolder,
  folderPathNames,
  buildFolderOptions,
} from '../domain/queries.js';
import { formatProblemHtml, formatPromptHtml } from './prompt.js';
import { readFilters } from './sidebar.js';

/** 폴더 트리 렌더 */
export function renderFolderTree() {
  const wrap = document.getElementById('folderTree');
  const user = getActiveUser();
  if (!user) {
    wrap.innerHTML = '<div class="caption">로그인하세요.</div>';
    return;
  }
  const userId = user.id;
  const folders = getUserFolders(userId);
  const roots = folders.filter((f) => !f.parentId).sort((a, b) => a.name.localeCompare(b.name, 'ko'));

  if (!roots.length) {
    wrap.innerHTML = '<div class="caption">폴더가 없습니다. 루트 폴더를 만드세요.</div>';
    return;
  }

  wrap.innerHTML = roots.map((f) => folderNodeHtml(f, folders, userId)).join('');
}

function folderNodeHtml(folder, all, userId) {
  const kids = all.filter((f) => f.parentId === folder.id).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const cnt = countCardsInFolder(folder.id, userId);
  const expanded = store.data.ui.treeExpanded[folder.id] !== false;
  const active = store.activeFolderId === folder.id;

  return `<div class="tree-node ${active ? 'active' : ''}" data-folder-id="${folder.id}">
    <div class="tree-row">
      <div class="tree-left">
        <button class="tree-toggle" data-action="toggle-tree" data-id="${folder.id}">${kids.length ? (expanded ? '▾' : '▸') : '·'}</button>
        <div data-action="select-folder" data-id="${folder.id}" style="min-width:0;cursor:pointer">
          <div class="tree-title">${escapeHtml(folder.name)}</div>
          <div class="tree-meta">카드 ${cnt}개</div>
        </div>
      </div>
      <div class="toolbar">
        <button class="small ghost" data-action="create-folder" data-parent="${folder.id}">+</button>
        <button class="small ghost" data-action="rename-folder" data-id="${folder.id}">✎</button>
        <button class="small danger" data-action="delete-folder" data-id="${folder.id}">×</button>
      </div>
    </div>
    ${expanded && kids.length ? `<div class="tree-children">${kids.map((k) => folderNodeHtml(k, all, userId)).join('')}</div>` : ''}
  </div>`;
}

/** 카드 목록 */
export function renderCardList() {
  const list = document.getElementById('cardList');
  const cards = getCardsFiltered(readFilters(), store.activeFolderId);

  if (!cards.length) {
    list.innerHTML = '<div class="list-item"><span class="item-sub">카드 없음</span></div>';
    return;
  }

  list.innerHTML = cards.map((c) => `
    <div class="list-item ${store.activeManageId === c.id ? 'active' : ''}" draggable="true"
      data-action="select-card" data-id="${c.id}" data-drag-card="${c.id}">
      <span class="flag flag-${c.flagColor}"></span>
      <div style="flex:1;min-width:0">
        <div class="item-title">${escapeHtml(c.title || shorten(c.displayText))}</div>
        <div class="item-sub">${escapeHtml(folderPathNames(c.folderId))} · 빈칸 ${c.blanks.length} · 회독 ${c.rounds}${c.isSample ? ' · 샘플' : ''}</div>
      </div>
    </div>`).join('');
}

/** 카드 상세 */
export function renderManageDetail(id) {
  store.activeManageId = id;
  renderCardList();

  const box = document.getElementById('manageDetail');
  if (!id) {
    box.innerHTML = '<div class="detail-empty">카드를 선택하세요.</div>';
    return;
  }

  const c = getCard(id);
  if (!c) {
    box.innerHTML = '<div class="detail-empty">카드를 찾을 수 없습니다.</div>';
    return;
  }

  const opts = buildFolderOptions(getActiveUser().id);
  box.innerHTML = `
    <div class="detail-body">
      <div class="col">
        <div><strong>${escapeHtml(c.title)}</strong> <span class="flag flag-${c.flagColor}"></span></div>
        <div class="caption">${escapeHtml(folderPathNames(c.folderId))} · 회독 ${c.rounds} · 오답 ${c.wrongCount}</div>
        <div><strong>문제</strong><br>${formatProblemHtml(c.displayText)}</div>
        <div><strong>해설</strong><br>${formatPromptHtml(c.explanationText || '', c.blanks || [])}</div>
        <div><strong>정답</strong><br>${c.blanks.map((b) => `빈칸${b.order}: ${escapeHtml(b.answer)}`).join('<br>') || '없음'}</div>
        <div><strong>메모</strong><br>${escapeHtml(c.memo || '(없음)')}</div>
        <label>폴더 이동</label>
        <select data-action="move-card-folder" data-card-id="${c.id}">
          <option value="">(미분류)</option>${opts}
        </select>
      </div>
    </div>
    <div class="detail-actions">
      <button class="primary" data-action="edit-card" data-id="${c.id}">수정하기</button>
      <button class="pink" data-action="study-one" data-id="${c.id}">바로 학습</button>
      <button class="danger" data-action="delete-card" data-id="${c.id}">삭제</button>
    </div>`;

  const sel = box.querySelector('[data-action="move-card-folder"]');
  if (sel) sel.value = c.folderId || '';
}

/** 폴더 select 갱신 */
export function renderFolderSelects() {
  const user = getActiveUser();
  const opts = user ? buildFolderOptions(user.id) : '';
  ['cardFolder', 'studyEditFolder'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value;
    el.innerHTML = `<option value="">(미분류)</option>${opts}`;
    if ([...el.options].some((o) => o.value === cur)) el.value = cur;
  });
}
