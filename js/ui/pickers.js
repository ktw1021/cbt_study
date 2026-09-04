/**
 * 폴더·카드 선택 모달 (학습 범위, 내보내기 등 공용)
 */
import { escapeHtml, shorten } from '../utils/text.js';
import {
  getActiveUser,
  getUserFolders,
  getUserCards,
  countCardsInFolder,
  toggleStudyFolderSelection,
  normalizeStudyFolderIds,
  pruneEmptyStudyFolders,
  countCardsInStudyFolders,
} from '../domain/queries.js';
import { closeModal } from './modal.js';

function mountModal(innerHtml) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="modal-backdrop"><div class="modal">${innerHtml}</div></div>`;
  const backdrop = root.firstElementChild;
  backdrop.addEventListener('click', () => closeModal());
  backdrop.querySelector('.modal').addEventListener('click', (e) => e.stopPropagation());
  return backdrop;
}

function folderTreeHtml(userId, folders, roots, selectedIds) {
  const selected = new Set(selectedIds || []);
  const nodeHtml = (f) => {
    const kids = folders.filter((k) => k.parentId === f.id).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    const cnt = countCardsInFolder(f.id, userId);
    return `<div class="pick-folder-node">
      <button type="button" class="pick-folder-row${selected.has(f.id) ? ' active' : ''}" data-fid="${f.id}">
        <span class="pick-folder-name">${escapeHtml(f.name)}</span>
        <span class="pick-folder-cnt">카드 ${cnt}</span>
      </button>
      ${kids.length ? `<div class="pick-folder-children">${kids.map(nodeHtml).join('')}</div>` : ''}
    </div>`;
  };
  return roots.length ? roots.map(nodeHtml).join('')
    : '<div class="caption">폴더가 없습니다. 카드관리에서 폴더를 먼저 만드세요.</div>';
}

/** 폴더 트리 선택 모달 — title/caption으로 용도별 재사용 (단일 선택, 클릭 즉시 확정) */
export function openFolderPicker({ title = '폴더 선택', caption = '', currentId = null, allowClear = false, onPick }) {
  const user = getActiveUser();
  const folders = user ? getUserFolders(user.id) : [];
  const roots = folders.filter((f) => !f.parentId).sort((a, b) => a.name.localeCompare(b.name, 'ko'));

  const clearRow = allowClear
    ? `<button type="button" class="pick-folder-row${!currentId ? ' active' : ''}" data-fid="">
        <span class="pick-folder-name">전체 (폴더 제한 없음)</span>
      </button>`
    : '';

  const modal = mountModal(`
    <h3>${escapeHtml(title)}</h3>
    ${caption ? `<div class="caption">${escapeHtml(caption)}</div>` : ''}
    <div class="pick-folder-tree">${clearRow}${folderTreeHtml(user?.id, folders, roots, currentId ? [currentId] : [])}</div>
    <div class="toolbar" style="margin-top:12px;justify-content:flex-end">
      <button type="button" class="ghost" data-close>닫기</button>
    </div>`);

  modal.querySelector('[data-close]').addEventListener('click', () => closeModal());
  modal.querySelectorAll('.pick-folder-row').forEach((btn) => {
    btn.addEventListener('click', () => {
      onPick(btn.dataset.fid || null);
      closeModal();
    });
  });
}

/** 학습 범위 — 폴더 여러 개 (클릭으로 넣기/빼기, 완료 시 확정) */
export function openStudyFolderPicker(currentIds, onConfirm) {
  const user = getActiveUser();
  const userId = user?.id;
  const folders = user ? getUserFolders(userId) : [];
  const roots = folders.filter((f) => !f.parentId).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  let sel = new Set(normalizeStudyFolderIds(currentIds || [], userId));

  const modal = mountModal(`
    <h3>학습할 폴더 선택</h3>
    <div class="caption">폴더를 눌러 추가·제외합니다. 상위 폴더는 하위를 포함하고, 서로 포함 관계면 하나만 남깁니다.</div>
    <div class="toolbar" style="margin:6px 0">
      <button type="button" class="ghost small" data-clear>선택 비우기</button>
      <span class="caption" id="pickFolderCount"></span>
    </div>
    <div class="pick-folder-tree">${folderTreeHtml(userId, folders, roots, [...sel])}</div>
    <div class="toolbar" style="margin-top:12px;justify-content:flex-end">
      <button type="button" class="primary" data-confirm>선택 완료</button>
      <button type="button" class="ghost" data-close>취소</button>
    </div>`);

  const tree = modal.querySelector('.pick-folder-tree');
  const countEl = modal.querySelector('#pickFolderCount');
  const confirmBtn = modal.querySelector('[data-confirm]');
  const syncUi = () => {
    const cardCount = countCardsInStudyFolders([...sel], userId);
    if (!sel.size) {
      countEl.textContent = '선택 없음 · 완료 불가';
    } else if (!cardCount) {
      countEl.textContent = `${sel.size}개 선택 · 카드 0장 · 완료 불가`;
    } else {
      countEl.textContent = `${sel.size}개 선택 · 카드 ${cardCount}장`;
    }
    confirmBtn.disabled = cardCount === 0;
    confirmBtn.title = cardCount ? '' : '카드가 있는 폴더를 선택하세요';
    tree.querySelectorAll('.pick-folder-row').forEach((btn) => {
      btn.classList.toggle('active', sel.has(btn.dataset.fid));
    });
  };
  syncUi();

  tree.querySelectorAll('.pick-folder-row').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.fid;
      if (!id) return;
      sel = new Set(toggleStudyFolderSelection([...sel], id, userId));
      syncUi();
    });
  });
  modal.querySelector('[data-clear]').addEventListener('click', () => {
    sel.clear();
    syncUi();
  });
  modal.querySelector('[data-close]').addEventListener('click', () => closeModal());
  confirmBtn.addEventListener('click', () => {
    const kept = pruneEmptyStudyFolders([...sel], userId);
    if (!kept.length) return;
    onConfirm(kept);
    closeModal();
  });
}

/** 내보내기 — 폴더 선택 */
export function openExportFolderPicker(onPick) {
  openFolderPicker({
    title: '내보낼 폴더 선택',
    caption: '선택한 폴더와 그 안의 카드만 내보냅니다. 미분류 카드는 들어가지 않습니다.',
    onPick,
  });
}

/** 학습 범위 — 카드 선택 */
export function openStudyCardPicker(selectedIds, onConfirm) {
  const user = getActiveUser();
  const cards = user ? getUserCards(user.id) : [];
  const sel = new Set(selectedIds || []);

  const modal = mountModal(`
    <h3>학습할 카드 선택</h3>
    <div class="toolbar" style="margin:6px 0">
      <button type="button" class="ghost small" data-all="1">전체 선택</button>
      <button type="button" class="ghost small" data-all="0">전체 해제</button>
      <span class="caption" id="pickCardCount"></span>
    </div>
    <div class="pick-card-list">${cards.length ? cards.map((c) => `
      <label class="candidate-row"><input type="checkbox" data-cid="${c.id}" ${sel.has(c.id) ? 'checked' : ''} /> ${escapeHtml(shorten(c.title || c.displayText, 50))}</label>`).join('') : '<div class="caption">카드가 없습니다.</div>'}
    </div>
    <div class="toolbar" style="margin-top:12px;justify-content:flex-end">
      <button type="button" class="primary" data-confirm>선택 완료</button>
      <button type="button" class="ghost" data-close>취소</button>
    </div>`);

  const list = modal.querySelector('.pick-card-list');
  const countEl = modal.querySelector('#pickCardCount');
  const updateCount = () => {
    countEl.textContent = `${list.querySelectorAll('input:checked').length}장 선택`;
  };
  updateCount();
  list.addEventListener('change', updateCount);

  modal.querySelectorAll('[data-all]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const on = btn.dataset.all === '1';
      list.querySelectorAll('input').forEach((i) => { i.checked = on; });
      updateCount();
    });
  });
  modal.querySelector('[data-close]').addEventListener('click', () => closeModal());
  modal.querySelector('[data-confirm]').addEventListener('click', () => {
    const ids = [...list.querySelectorAll('input:checked')].map((i) => i.dataset.cid);
    onConfirm(ids);
    closeModal();
  });
}
