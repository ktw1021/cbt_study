import { getActiveUser, getUserFolders, countCardsInFolder } from '../domain/queries.js';
import { escapeHtml } from '../utils/text.js';

/**
 * 폴더 <select> 옵션 HTML — 계층 접두어(↳)로 층위 표시
 * @param {object} opts.showCount — 카드 수 표시 (필터용)
 */
export function buildFolderOptions(userId, parentId = null, depth = 0, opts = {}) {
  const { showCount = false } = opts;
  const folders = getUserFolders(userId)
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));

  return folders.flatMap((f) => {
    const prefix = depth === 0 ? '📁 ' : `${'　'.repeat(depth)}↳ `;
    const cnt = showCount ? ` · ${countCardsInFolder(f.id, userId)}장` : '';
    return [
      `<option value="${f.id}">${prefix}${escapeHtml(f.name)}${cnt}</option>`,
      buildFolderOptions(userId, f.id, depth + 1, opts),
    ];
  }).join('');
}

/** 폴더 <select> 채우기 — 카드제작·필터·학습수정 등 공용 */
export function fillFolderSelect(el, {
  value = '',
  includeAll = false,
  allLabel = '전체 폴더',
  includeUnclassified = false,
  unclassifiedLabel = '(미분류)',
  showCount = false,
} = {}) {
  if (!el) return;
  const user = getActiveUser();
  const userId = user?.id;
  let html = '';
  if (includeAll) html += `<option value="">${escapeHtml(allLabel)}</option>`;
  if (includeUnclassified) html += `<option value="">${escapeHtml(unclassifiedLabel)}</option>`;
  if (userId) html += buildFolderOptions(userId, null, 0, { showCount });
  el.innerHTML = html;
  const v = value ?? '';
  if ([...el.options].some((o) => o.value === v)) el.value = v;
  else el.value = includeAll || includeUnclassified ? '' : el.options[0]?.value ?? '';
}
