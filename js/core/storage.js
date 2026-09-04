import { DB_NAME, DB_STORE, STATE_KEY } from '../config.js';
import { getState, setState } from './store.js';

let db = null;

/** IndexedDB 연결 */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => e.target.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 저장된 상태 로드 */
export async function loadState() {
  db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(STATE_KEY);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

function idbGet() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(STATE_KEY);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * 디스크에만 저장 (UI 리렌더 없음).
 * @param {{ allowEmptyUsers?: boolean }} [opts]
 *   allowEmptyUsers — 마지막 계정 삭제처럼 users를 비우는 의도일 때만 true.
 *   그 외에는 디스크에 계정이 있는데 빈 users로 덮지 않는다.
 */
export async function persist(opts = {}) {
  if (!db) db = await openDB();
  const state = getState();
  if (!state) return;

  const existing = await idbGet();
  const hadUsers = (existing?.users || []).length > 0;
  const nextUsers = (state.users || []).length;
  if (hadUsers && nextUsers === 0 && !opts.allowEmptyUsers) {
    console.error('persist 거부: 저장된 계정을 빈 상태로 덮어쓰려 함');
    return;
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(state, STATE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 저장 후 state 갱신 */
export async function saveState(next, opts) {
  if (next) setState(next);
  await persist(opts);
}
