import { getState, store } from '../core/store.js';
import { getActiveUser } from '../domain/queries.js';
import { syncDraftFromDOM } from '../ui/blank-input.js';

/** 계정별 저장된 학습 세션 (로그아웃 후에도 유지) */
export function getPersistedStudySession() {
  const user = getActiveUser();
  if (!user) return null;
  const ui = getState().ui;
  if (!ui.studySessions) ui.studySessions = {};
  // Legacy sessions are assigned once by migrateState, before account switching.
  const sess = ui.studySessions[user.id];
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
  syncDraftFromDOM();
  const c = store.studyQueue[store.studyIndex];
  const sess = getPersistedStudySession();
  if (!c || !sess) return;
  if (!sess.cardProgress) sess.cardProgress = {};
  if (store.currentBlankStatuses.length && store._studyCardId === c.id) {
    sess.cardProgress[c.id] = {
      blankStatuses: store.currentBlankStatuses.map((s) => ({ ...s })),
      attemptRecorded: !!store.studyAttemptRecorded,
      roundRecorded: !!store.studyRoundRecorded,
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
  store.studyRoundRecorded = !!prog.roundRecorded;
  store.currentBlankFocus = prog.focus ?? null;
  return true;
}

/** Keep progress attached to blank ids when editing inserts/removes/reorders blanks. */
export function reconcileEditedCardProgress(cardId, previousBlanks, nextBlanks) {
  const previous = new Map(previousBlanks.map(b => [b.id, b]));
  const remap = (statuses) => nextBlanks.map(blank => {
    const old = previous.get(blank.id);
    const status = old && statuses.find(s => s.order === old.order);
    const sameAnswer = old && old.answer === blank.answer
      && JSON.stringify(old.aliases || []) === JSON.stringify(blank.aliases || []);
    return status && sameAnswer
      ? { ...status, order: blank.order }
      : { order: blank.order, checked: false, correct: false, score: 0, user: '', revealed: false };
  });
  const focus = order => {
    const id = previousBlanks.find(b => b.order === order)?.id;
    return nextBlanks.find(b => b.id === id)?.order ?? null;
  };
  const progress = getPersistedStudySession()?.cardProgress?.[cardId];
  if (progress) {
    progress.blankStatuses = remap(progress.blankStatuses || []);
    progress.focus = focus(progress.focus);
  }
  if (store._studyCardId === cardId) {
    store.currentBlankStatuses = remap(store.currentBlankStatuses || []);
    store.currentBlankFocus = focus(store.currentBlankFocus);
  }
}
