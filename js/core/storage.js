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

/** 디스크에만 저장 (UI 리렌더 없음) */
export async function persist() {
  if (!db) db = await openDB();
  const state = getState();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(state, STATE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 저장 후 state 갱신 */
export async function saveState(next) {
  if (next) setState(next);
  await persist();
}
