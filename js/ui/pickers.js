/**
 * 폴더·카드 선택 모달 (학습 범위, 내보내기 등 공용)
 */
import { escapeHtml, shorten } from '../utils/text.js';
import { getActiveUser, getUserFolders, getUserCards, countCardsInFolder } from '../domain/queries.js';
import { closeModal } from './modal.js';

function mountModal(innerHtml) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="modal-backdrop"><div class="modal">${innerHtml}</div></div>`;
  const backdrop = root.firstElementChild;
  backdrop.addEventListener('click', () => closeModal());
  backdrop.querySelector('.modal').addEventListener('click', (e) => e.stopPropagation());
  return backdrop;
}

function folderTreeHtml(userId, folders, roots, currentId) {
  const nodeHtml = (f) => {
    const kids = folders.filter((k) => k.parentId === f.id).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    const cnt = countCardsInFolder(f.id, userId);
    return `<div class="pick-folder-node">
      <button type="button" class="pick-folder-row${f.id === currentId ? ' active' : ''}" data-fid="${f.id}">
        <span class="pick-folder-name">${escapeHtml(f.name)}</span>
        <span class="pick-folder-cnt">카드 ${cnt}</span>
      </button>
      ${kids.length ? `<div class="pick-folder-children">${kids.map(nodeHtml).join('')}</div>` : ''}
    </div>`;
  };
  return roots.length ? roots.map(nodeHtml).join('')
    : '<div class="caption">폴더가 없습니다. 카드관리에서 폴더를 먼저 만드세요.</div>';
}

/** 폴더 트리 선택 모달 — title/caption으로 용도별 재사용 */
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
    <div class="pick-folder-tree">${clearRow}${folderTreeHtml(user?.id, folders, roots, currentId)}</div>
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

/** 학습 범위 — 폴더 선택 */
export function openStudyFolderPicker(currentId, onPick) {
  openFolderPicker({
    title: '학습할 폴더 선택',
    caption: '선택한 폴더(하위 폴더 포함)의 카드를 학습합니다.',
    currentId,
    onPick,
  });
}

/** 내보내기 — 폴더 선택 */
export function openExportFolderPicker(onPick) {
  openFolderPicker({
    title: '내보낼 폴더 선택',
    caption: '선택한 폴더와 하위 폴더·카드를 JSON으로 내보냅니다.',
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
