import { store } from '../core/store.js';
import { escapeHtml, shorten } from '../utils/text.js';
import {
  getActiveUser,
  getUserFolders,
  getCard,
  getFolder,
  getCardsFiltered,
  countCardsInFolder,
  countUnclassifiedCards,
  getUserCards,
  folderPathNames,
} from '../domain/queries.js';
import { buildFolderOptions, fillFolderSelect } from './folder-select.js';
import { formatProblemHtml, formatPromptHtml } from './prompt.js';
import { readFilters } from './sidebar.js';

/** 현재 위치 빵부스러기 — 「전체 ▸ 상위 ▸ 현재」, 각 단계 클릭 시 이동 */
export function renderFolderBreadcrumb() {
  const el = document.getElementById('folderBreadcrumb');
  if (!el) return;

  const chain = [];
  let cur = store.activeFolderId ? getFolder(store.activeFolderId) : null;
  while (cur) {
    chain.unshift(cur);
    cur = cur.parentId ? getFolder(cur.parentId) : null;
  }

  const rootActive = !store.activeFolderId;
  const user = getActiveUser();
  const totalCards = user ? getUserCards(user.id).length : 0;
  const unclassified = user ? countUnclassifiedCards(user.id) : 0;
  const crumbs = [
    `<button class="crumb${rootActive ? ' active' : ''}" data-action="select-root-folder"><span class="crumb-label">전체</span><span class="tree-meta">카드 ${totalCards}개 · 미분류 ${unclassified}개</span></button>`,
    ...chain.map((f, i) => {
      const last = i === chain.length - 1;
      return `<span class="crumb-sep">▸</span><button class="crumb${last ? ' active' : ''}" data-action="select-folder" data-id="${f.id}">${escapeHtml(f.name)}</button>`;
    }),
  ];

  const folderId = store.activeFolderId;
  const canStudy = !!(folderId && user && countCardsInFolder(folderId, user.id) > 0);
  crumbs.push(
    `<button type="button" class="small pink folder-study-btn${canStudy ? '' : ' is-disabled'}"`
    + ` data-action="study-manage-folder"${canStudy ? '' : ' disabled aria-disabled="true"'}`
    + ` title="${canStudy ? '이 폴더로 학습 시작' : '카드가 있는 폴더를 선택하세요'}">학습</button>`,
  );

  el.innerHTML = crumbs.join('');
}

/** 폴더 트리 렌더 */
export function renderFolderTree() {
  renderFolderBreadcrumb();
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
      <div class="tree-left" draggable="true" data-drag-folder="${folder.id}" data-action="select-folder" data-id="${folder.id}">
        <button type="button" class="tree-toggle" draggable="false" data-action="toggle-tree" data-id="${folder.id}">${kids.length ? (expanded ? '▾' : '▸') : '·'}</button>
        <div class="tree-label">
          <div class="tree-title">${escapeHtml(folder.name)}</div>
          <div class="tree-meta">카드 ${cnt}개</div>
        </div>
      </div>
      <div class="toolbar">
        <button class="small folder-add" data-action="create-folder" data-parent="${folder.id}">+</button>
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
  const cards = getCardsFiltered(readFilters(store.activeFolderId));

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
        <div class="caption">${escapeHtml(folderPathNames(c.folderId))} · 회독 ${c.rounds} · 오답 ${c.wrongCount}${c.author ? ` · 제작 ${escapeHtml(c.author)}` : ''}</div>
        <div><strong>문제</strong><br>${formatProblemHtml(c.displayText)}</div>
        <div><strong>해설</strong><br>${formatPromptHtml(c.explanationText || '', c.blanks || [])}</div>
        <div><strong>정답</strong><br>${c.blanks.map((b) => `빈칸${b.order}: ${escapeHtml(b.answer)}`).join('<br>') || '없음'}</div>
        <div><strong>메모</strong><br>${escapeHtml(c.memo || '(없음)')}</div>
        <label>폴더 이동</label>
        <select data-action="move-card-folder" data-card-id="${c.id}" class="folder-select">
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
  if (!user) return;
  fillFolderSelect(document.getElementById('cardFolder'), {
    value: document.getElementById('cardFolder')?.value,
    includeUnclassified: true,
  });
  fillFolderSelect(document.getElementById('studyEditFolder'), {
    value: document.getElementById('studyEditFolder')?.value,
    includeUnclassified: true,
  });
}
