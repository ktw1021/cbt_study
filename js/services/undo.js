import { MAX_UNDO } from '../config.js';
import { deepCopy } from '../utils/text.js';
import { getState, setState } from '../core/store.js';
import { migrateState } from '../domain/migrate.js';
import { persist } from '../core/storage.js';

const undoStack = [];
let applyingUndo = false;

/** 변경 전 상태 스냅샷 저장 */
export function pushUndo() {
  if (applyingUndo) return;
  undoStack.push(deepCopy(getState()));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
}

/** 되돌릴 스냅샷이 있는지 */
export function hasUndo() {
  return undoStack.length > 0;
}

/** 마지막 스냅샷으로 복원 */
export async function undo() {
  if (!undoStack.length) {
    alert('되돌릴 상태가 없습니다.');
    return false;
  }
  applyingUndo = true;
  setState(migrateState(undoStack.pop()));
  applyingUndo = false;
  await persist();
  return true;
}
