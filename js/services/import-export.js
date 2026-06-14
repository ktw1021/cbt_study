import { getState } from '../core/store.js';
import { migrateCard, migrateState } from '../domain/migrate.js';
import {
  getActiveUser,
  getUserFolders,
  getUserCards,
  getDescendantFolderIds,
} from '../domain/queries.js';

/** JSON 파일 다운로드 */
export function exportData(scope, activeFolderId) {
  const state = getState();
  const uid = getActiveUser().id;
  let payload;

  if (scope === 'user') {
    payload = {
      version: 1,
      users: [getActiveUser()],
      folders: getUserFolders(uid),
      cards: getUserCards(uid),
      exportedAt: new Date().toISOString(),
    };
  } else if (scope === 'folder') {
    if (!activeFolderId) {
      alert('폴더를 먼저 선택하세요.');
      return;
    }
    const fids = [activeFolderId, ...getDescendantFolderIds(activeFolderId, uid)];
    payload = {
      version: 1,
      folders: state.folders.filter((f) => fids.includes(f.id)),
      cards: getUserCards(uid).filter((c) => fids.includes(c.folderId)),
      exportedAt: new Date().toISOString(),
    };
  } else {
    payload = { ...state, exportedAt: new Date().toISOString() };
  }

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cbt_backup_${scope}_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
}

/** 병합 가져오기 */
export function mergeImport(data) {
  const state = getState();
  (data.users || []).forEach((u) => {
    if (!state.users.some((x) => x.id === u.id)) state.users.push(u);
  });
  (data.folders || []).forEach((f) => {
    const i = state.folders.findIndex((x) => x.id === f.id);
    if (i >= 0) state.folders[i] = f;
    else state.folders.push(f);
  });
  (data.cards || []).forEach((c) => {
    const card = migrateCard(c);
    const i = state.cards.findIndex((x) => x.id === card.id);
    if (i >= 0) state.cards[i] = card;
    else state.cards.push(card);
  });
}

/** JSON 파일 가져오기 */
export async function importFromFile(file, mode) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (mode === 'overwrite') {
    return migrateState(parsed.users ? parsed : { ...parsed, users: getState().users });
  }
  mergeImport(parsed);
  return getState();
}
