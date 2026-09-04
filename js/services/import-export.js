/**
 * 내보내기 / 가져오기
 *
 * 파일 3종은 목적이 다르다.
 *   user   — 계정 하나 이전. 받는 쪽에 새 id로 계정을 만든다.
 *   all    — 유저들 이전. 파일에 있는 계정을 각각 새 id로 만든다.
 *   folder — 카드 공유. 고른 폴더와 그 안의 카드만. 지금 로그인한 사람에게 붙인다.
 *
 * 유저·유저들은 합치기/덮어쓰기가 없다. 이름만 같고 id는 항상 새로 발급한다.
 * 비밀번호는 파일에 넣지 않는다. 가져온 뒤 다시 정한다.
 * 지금 로그인 중인 계정은 가져오기가 바꾸지 않는다.
 */
import { getState } from '../core/store.js';
import { migrateCard } from '../domain/migrate.js';
import { uid } from '../utils/text.js';
import {
  getActiveUser,
  getUserFolders,
  getUserCards,
  getDescendantFolderIds,
  normalizeUserName,
} from '../domain/queries.js';

export const FILE_FORMAT = 'cbt-blank-study';
const FILE_VERSION = 2;

/** 계정 이관 — 비밀번호는 빼고 이름만 넘긴다 */
function publicUser(user) {
  return { id: user.id, name: user.name, createdAt: user.createdAt };
}

/** 최초 제작자가 비어 있는 예전 카드는 내보낼 때 현재 사용자로 채운다 */
function withAuthor(card, fallbackName) {
  return card.author ? card : { ...card, author: fallbackName };
}

/** 공유 파일에서 개인 학습기록을 뺀다 (받는 사람은 회독 0에서 시작) */
function stripStudyRecord(card) {
  return {
    ...card,
    rounds: 0,
    wrongCount: 0,
    lastResult: null,
    blanks: (card.blanks || []).map((b) => ({
      ...b, lastInput: '', lastResult: null, manualResult: null,
    })),
  };
}

/** 공유 파일에는 내부 계정 id를 남기지 않는다 */
function withoutOwner(obj) {
  const { userId, ...rest } = obj;
  return rest;
}

function fileSafe(name) {
  return String(name || '').replace(/[\\/:*?"<>|]/g, '').trim() || 'export';
}

function download(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

/**
 * JSON 파일 다운로드
 * @param {'all'|'user'|'folder'} scope
 * @param {string|null} activeFolderId scope==='folder'일 때 내보낼 폴더
 */
export function exportData(scope, activeFolderId) {
  const state = getState();
  const me = getActiveUser();
  if (!me) return { ok: false, reason: '로그인이 필요합니다.' };

  const today = new Date().toISOString().slice(0, 10);
  const base = { format: FILE_FORMAT, version: FILE_VERSION, exportedAt: new Date().toISOString() };

  if (scope === 'all') {
    download({
      ...base,
      kind: 'all',
      users: state.users.map(publicUser),
      folders: state.folders,
      cards: state.cards.map((c) => withAuthor(c, me.name)),
      settings: state.settings,
    }, `cbt_유저들_${today}.json`);
    return { ok: true };
  }

  if (scope === 'user') {
    download({
      ...base,
      kind: 'user',
      users: [publicUser(me)],
      folders: getUserFolders(me.id),
      cards: getUserCards(me.id).map((c) => withAuthor(c, me.name)),
      settings: state.settings,
    }, `cbt_유저_${fileSafe(me.name)}_${today}.json`);
    return { ok: true };
  }

  if (scope === 'folder') {
    const root = state.folders.find((f) => f.id === activeFolderId && f.userId === me.id);
    if (!root) return { ok: false, reason: '내보낼 폴더를 선택하세요.' };

    const fids = [root.id, ...getDescendantFolderIds(root.id, me.id)];
    // 고른 폴더를 새 루트로 만든다. 받는 쪽에서 부모를 못 찾아 사라지는 일이 없도록.
    const folders = state.folders
      .filter((f) => fids.includes(f.id))
      .map((f) => withoutOwner({ ...f, parentId: f.id === root.id ? null : f.parentId }));
    const cards = getUserCards(me.id)
      .filter((c) => fids.includes(c.folderId))
      .map((c) => withoutOwner(stripStudyRecord(withAuthor(c, me.name))));

    download({
      ...base, kind: 'folder', folderName: root.name, folders, cards,
    }, `cbt_폴더_${fileSafe(root.name)}_${today}.json`);
    return { ok: true, count: cards.length };
  }

  return { ok: false, reason: '알 수 없는 내보내기 범위입니다.' };
}

// ── 가져오기 ──

/**
 * 파일 내용을 읽고 종류를 판별한다. 앱 파일이 아니면 예외.
 * kind가 없는 예전 파일도 모양으로 추론한다.
 */
export async function readImportFile(file) {
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('JSON 파일이 아니거나 내용이 깨져 있습니다.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('이 앱에서 내보낸 파일이 아닙니다.');
  }
  if (!Array.isArray(parsed.cards) || !Array.isArray(parsed.folders)) {
    throw new Error('이 앱에서 내보낸 파일이 아닙니다. (카드·폴더 정보 없음)');
  }

  const kind = parsed.kind || inferKind(parsed);
  if (!kind) throw new Error('파일 종류를 알 수 없습니다.');
  return { kind, data: parsed };
}

function inferKind(parsed) {
  if (!Array.isArray(parsed.users)) return 'folder';
  if ('activeUserId' in parsed || parsed.users.length > 1) return 'all';
  return parsed.users.length === 1 ? 'user' : 'all';
}

/** 파일 안에 부모가 없는 폴더는 루트. 예전 하위폴더 내보내기도 살린다. */
function isFileRoot(folder, folders) {
  if (!folder.parentId) return true;
  return !folders.some((f) => f.id === folder.parentId);
}

function fileRootFolder(folders, fallbackName) {
  const list = folders || [];
  return list.find((f) => isFileRoot(f, list)) || list[0] || { name: fallbackName || '폴더' };
}

export function describeImport(kind, data) {
  const cardCount = data.cards.length;
  if (kind === 'all') {
    const names = (data.users || []).map((u) => u.name).filter(Boolean);
    const who = names.length ? names.join(', ') : '(계정 없음)';
    return {
      title: '유저들을 가져옵니다',
      message: `${who} — 폴더 ${data.folders.length}개 · 카드 ${cardCount}장을 새 계정으로 추가합니다.`,
    };
  }
  if (kind === 'user') {
    const name = data.users?.[0]?.name || '(이름 없음)';
    return {
      title: `유저 「${name}」을 가져옵니다`,
      message: `폴더 ${data.folders.length}개 · 카드 ${cardCount}장이 새 계정으로 추가됩니다. 비밀번호는 가져온 뒤 다시 정합니다.`,
    };
  }
  const folderName = data.folderName || fileRootFolder(data.folders).name || '폴더';
  return {
    title: `폴더 「${folderName}」을 가져옵니다`,
    message: `카드 ${cardCount}장이 내 폴더 목록의 맨 위(루트)에 추가됩니다. 회독·오답 기록은 없이 들어옵니다.`,
  };
}

/** 제목 + 해설 + 빈칸이 모두 같으면 같은 카드로 본다 */
export function cardFingerprint(card) {
  const blanks = (card.blanks || [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((b) => `${b.order}:${String(b.answer || '').trim()}`)
    .join('|');
  return [
    String(card.title || '').trim(),
    String(card.explanationText || '').trim(),
    blanks,
  ].join('\u0001');
}

/** 들어올 카드 중 내가 이미 가진 것 */
export function findDuplicates(cards) {
  const me = getActiveUser();
  if (!me) return [];
  const mine = new Set(getUserCards(me.id).map(cardFingerprint));
  return cards.filter((c) => mine.has(cardFingerprint(c)));
}

/** 폴더 파일을 실제로 적용하기 전에, 어떤 이름으로 어디에 들어갈지 미리 계산 */
export function previewFolderImport(data) {
  const me = getActiveUser();
  const rootNames = new Set(
    me ? getUserFolders(me.id).filter((f) => !f.parentId).map((f) => f.name) : [],
  );
  const srcRoot = fileRootFolder(data.folders || [], data.folderName);
  const rootName = data.folderName || srcRoot?.name || '폴더';
  return {
    rootName,
    finalName: uniqueName(rootName, rootNames),
    cardCount: (data.cards || []).length,
    duplicates: findDuplicates(data.cards || []),
  };
}

/** 이름이 겹치면 「이름 (1)」 */
function uniqueName(name, taken) {
  const base = String(name || '').trim() || '이름 없음';
  if (!taken.has(base)) return base;
  let n = 1;
  while (taken.has(`${base} (${n})`)) n += 1;
  return `${base} (${n})`;
}

/** 유저·유저들 파일을 적용하기 전에 어떤 이름으로 들어올지 */
export function previewUsersImport(data) {
  const taken = new Set((getState()?.users || []).map((u) => normalizeUserName(u.name)));
  const users = (data.users || []).map((u) => {
    const fromName = normalizeUserName(u.name) || '이름 없음';
    const finalName = uniqueName(fromName, taken);
    taken.add(finalName);
    return { fromName, finalName };
  });
  return {
    users,
    cardCount: (data.cards || []).length,
    folderCount: (data.folders || []).length,
  };
}

/**
 * 유저·유저들 가져오기 — 계정·폴더·카드 id를 전부 새로 발급한다.
 * 기존 데이터는 건드리지 않고 옆에 추가한다. 비밀번호는 비운다.
 */
export function applyUsersImport(data) {
  const srcUsers = data.users || [];
  if (!srcUsers.length) throw new Error('파일에 사용자 정보가 없습니다.');

  const state = getState();
  const now = new Date().toISOString();
  const taken = new Set(state.users.map((u) => normalizeUserName(u.name)));
  const userMap = new Map();
  const createdUsers = [];

  srcUsers.forEach((u) => {
    const fromName = normalizeUserName(u.name) || '이름 없음';
    const name = uniqueName(fromName, taken);
    taken.add(name);
    const user = {
      id: uid('u'),
      name,
      pin: null,
      createdAt: now,
    };
    if (u.id) userMap.set(u.id, user.id);
    createdUsers.push({ user, fromName });
    state.users.push(user);
  });

  const fallbackUserId = createdUsers[0].user.id;
  const folderMap = new Map();
  const createdFolders = [];

  (data.folders || []).forEach((f) => {
    const folder = {
      id: uid('f'),
      userId: userMap.get(f.userId) || fallbackUserId,
      name: String(f.name || '폴더'),
      parentId: f.parentId || null,
      createdAt: f.createdAt || now,
      updatedAt: now,
    };
    if (f.id) folderMap.set(f.id, folder.id);
    createdFolders.push({ src: f, folder });
    state.folders.push(folder);
  });
  createdFolders.forEach(({ src, folder }) => {
    folder.parentId = src.parentId ? (folderMap.get(src.parentId) || null) : null;
  });

  const cards = [];
  (data.cards || []).forEach((raw) => {
    const card = migrateCard({
      ...raw,
      id: uid('c'),
      userId: userMap.get(raw.userId) || fallbackUserId,
      folderId: raw.folderId ? (folderMap.get(raw.folderId) || null) : null,
      updatedAt: now,
    });
    card.author = String(raw.author || card.author || '').trim();
    card.blanks = card.blanks.map((b) => ({ ...b, id: uid('b'), cardId: card.id }));
    cards.push(card);
  });
  state.cards.unshift(...cards);

  return {
    users: createdUsers.map(({ user, fromName }) => ({
      id: user.id,
      name: user.name,
      fromName,
    })),
    cards: cards.length,
    folders: createdFolders.length,
  };
}

/**
 * 공유 폴더 가져오기 — 내 소유의 새 폴더·카드로 복제한다.
 * 파일의 id는 쓰지 않고 전부 새로 발급하므로, 같은 파일을 여러 번 받아도 서로 덮어쓰지 않는다.
 */
export function applyFolderImport(data, { skipDuplicates = true } = {}) {
  const me = getActiveUser();
  if (!me) throw new Error('로그인이 필요합니다.');

  const state = getState();
  const now = new Date().toISOString();

  const rootNames = new Set(getUserFolders(me.id).filter((f) => !f.parentId).map((f) => f.name));
  const idMap = new Map();
  const created = [];

  const incoming = data.cards || [];
  const dupes = new Set(findDuplicates(incoming).map(cardFingerprint));
  const toAdd = incoming.filter((c) => !(skipDuplicates && dupes.has(cardFingerprint(c))));
  const skipped = incoming.length - toAdd.length;

  // 넣을 카드가 전부 중복이면 빈 폴더만 만들지 않는다. 카드 0장 폴더 파일은 폴더는 만든다.
  if (!toAdd.length && incoming.length) {
    return { added: 0, skipped, folders: 0, renamedRoot: null };
  }

  const srcFolders = data.folders || [];
  // 부모가 먼저 만들어지도록 루트에서부터 내려간다
  const queue = srcFolders.filter((f) => isFileRoot(f, srcFolders));
  const rest = srcFolders.filter((f) => !isFileRoot(f, srcFolders));
  let renamedRoot = null;

  const makeFolder = (src, parentId, isRoot) => {
    const siblings = isRoot
      ? rootNames
      : new Set(created.filter((f) => f.parentId === parentId).map((f) => f.name));
    const name = uniqueName(String(src.name || '폴더'), siblings);
    if (isRoot) {
      rootNames.add(name);
      if (name !== src.name) renamedRoot = { from: src.name, to: name };
    }
    const folder = {
      id: uid('f'), userId: me.id, name, parentId: parentId || null, createdAt: now, updatedAt: now,
    };
    idMap.set(src.id, folder.id);
    created.push(folder);
    return folder;
  };

  queue.forEach((f) => makeFolder(f, null, true));

  let guard = rest.length + 1;
  let pending = rest;
  while (pending.length && guard > 0) {
    const next = [];
    pending.forEach((f) => {
      const parentId = idMap.get(f.parentId);
      if (parentId) makeFolder(f, parentId, false);
      else next.push(f);
    });
    if (next.length === pending.length) break; // 부모를 못 찾는 것들은 루트로
    pending = next;
    guard -= 1;
  }
  pending.forEach((f) => makeFolder(f, null, true));

  const cards = [];

  toAdd.forEach((raw) => {
    const card = migrateCard({
      ...raw,
      id: uid('c'),
      userId: me.id,
      folderId: idMap.get(raw.folderId) || null,
      createdAt: now,
      updatedAt: now,
      rounds: 0,
      wrongCount: 0,
      lastResult: null,
    });
    card.author = String(raw.author || '').trim();
    card.blanks = card.blanks.map((b) => ({ ...b, id: uid('b'), cardId: card.id }));
    cards.push(card);
  });

  state.folders.push(...created);
  state.cards.unshift(...cards);

  return { added: cards.length, skipped, folders: created.length, renamedRoot };
}
