import { getState, store } from '../core/store.js';
import { getActiveUser } from '../domain/queries.js';

function syncBlankDraftFromDOM() {
  store.currentBlankStatuses.forEach((s) => {
    const input = document.querySelector(`[data-blank-order="${s.order}"]`);
    if (input) s.user = input.value;
  });
}

/** 계정별 저장된 학습 세션 (로그아웃 후에도 유지) */
export function getPersistedStudySession() {
  const user = getActiveUser();
  if (!user) return null;
  const ui = getState().ui;
  if (!ui.studySessions) ui.studySessions = {};
  let sess = ui.studySessions[user.id];
  if (!sess?.cardIds?.length && ui.studySession?.cardIds?.length) {
    sess = ui.studySession;
    ui.studySessions[user.id] = sess;
    ui.studySession = null;
  }
  return sess?.cardIds?.length ? sess : null;
}

export function setPersistedStudySession(sess) {
  const user = getActiveUser();
  if (!user) return;
  const ui = getState().ui;
  if (!ui.studySessions) ui.studySessions = {};
  if (!sess) {
    delete ui.studySessions[user.id];
    ui.studySession = null;
    return;
  }
  ui.studySessions[user.id] = sess;
  ui.studySession = null;
}

/** 현재 카드의 빈칸 입력·채점 상태를 세션에 스냅샷 */
export function snapshotCurrentCardProgress() {
  syncBlankDraftFromDOM();
  const c = store.studyQueue[store.studyIndex];
  const sess = getPersistedStudySession();
  if (!c || !sess) return;
  if (!sess.cardProgress) sess.cardProgress = {};
  if (store.currentBlankStatuses.length && store._studyCardId === c.id) {
    sess.cardProgress[c.id] = {
      blankStatuses: store.currentBlankStatuses.map((s) => ({ ...s })),
      attemptRecorded: !!store.studyAttemptRecorded,
      focus: store.currentBlankFocus ?? null,
    };
  }
}

/** IndexedDB에 학습 큐 + 카드별 진행 저장 */
export function saveStudySession({ resetProgress = false } = {}) {
  if (!store.studyQueue.length) {
    setPersistedStudySession(null);
    return;
  }
  const prev = getPersistedStudySession() || {};
  const sess = {
    config: getState().ui.studyConfig || prev.config || null,
    cardIds: store.studyQueue.map((c) => c.id),
    index: store.studyIndex,
    cardProgress: resetProgress ? {} : { ...(prev.cardProgress || {}) },
  };
  setPersistedStudySession(sess);
  snapshotCurrentCardProgress();
}

export function loadCardProgress(cardId) {
  const prog = getPersistedStudySession()?.cardProgress?.[cardId];
  if (!prog?.blankStatuses?.length) return false;
  store.currentBlankStatuses = prog.blankStatuses.map((s) => ({ ...s }));
  store.studyAttemptRecorded = !!prog.attemptRecorded;
  store.currentBlankFocus = prog.focus ?? null;
  return true;
}
