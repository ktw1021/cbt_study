/**
 * 사용자 액션 핸들러 — UI 이벤트와 도메인 로직 연결
 */
import { getState, store, setState } from '../core/store.js';
import { persist, saveState } from '../core/storage.js';
import { uid, shuffle, stripBlankMarkers } from '../utils/text.js';
import { migrateCard } from '../domain/migrate.js';
import {
  getActiveUser,
  getUserFolders,
  getUserCards,
  getCard,
  getFolder,
  getDescendantFolderIds,
  countCardsInFolder,
  getCardsFiltered,
  buildStudyQueue,
  findUserByName,
  normalizeUserName,
} from '../domain/queries.js';
import { findAutoCandidates } from '../domain/blank.js';
import { pushUndo, undo, hasUndo } from '../services/undo.js';
import { checkAnswer } from '../services/grading.js';
import { exportData, importFromFile } from '../services/import-export.js';
import { splitAnswers } from '../utils/text.js';
import { showSection } from '../ui/router.js';
import {
  renderAll,
  renderManageDetail,
  renderCreateForm,
} from '../ui/render.js';
import {
  readCreateForm,
  renderCreatePreview,
  renderStudyEditPreview,
  renderStudyEditForm,
  syncCardFlagPicker,
} from '../ui/create.js';
import {
  chipMakeBlank,
  chipRemoveAtCaret,
  chipRemoveByOrder,
  chipJump,
  chipApplyTokens,
  readChipEditor,
  readChipPlainText,
} from '../ui/chip-editor.js';
import {
  paintInlineBlanks,
  refreshStudyViews,
  focusBlankUI,
  getBlankInputValue,
  renderStudyCard,
  syncDraftFromDOM,
  handleBlankPeekOver,
  handleBlankPeekOut,
} from '../ui/study.js';
import { openAutoBlankModal, closeModal, getSelectedAutoTokens } from '../ui/modal.js';
import { readFilters } from '../ui/sidebar.js';

// ── 사용자 · 인증 ──

import {
  validatePin, verifyPin, userNeedsPinSetup,
} from '../services/auth.js';
import {
  showAuthOverlay, hideAuthOverlay, setAuthTab, renderAuthUserLists,
  showPinSetup, readLoginForm, readRegisterForm, readSetupForm,
  clearAuthInputs, setAuthError, showAuthMessage, setAuthSubmitting,
} from '../ui/auth.js';

async function completeLogin(userId) {
  const state = getState();
  const user = state.users.find((u) => u.id === userId);
  if (!user) return false;

  store.authenticatedUserId = userId;
  state.activeUserId = userId;
  store.activeFolderId = null;
  store.activeManageId = null;

  clearAuthInputs();
  showAuthMessage('');
  await saveState();

  hideAuthOverlay();
  renderCreateForm(null);
  renderManageDetail(null);
  renderAll();
  return true;
}

/** 저장된 activeUserId로 자동 로그인 (새로고침·재방문) */
export function restoreSession() {
  const state = getState();
  const userId = state.activeUserId;
  if (!userId) return false;

  const user = state.users.find((u) => u.id === userId);
  if (!user) {
    state.activeUserId = null;
    return false;
  }

  if (userNeedsPinSetup(user)) {
    showPinSetup(user.id, user.name);
    return false;
  }

  store.authenticatedUserId = userId;
  hideAuthOverlay();
  return true;
}

export async function loginUser() {
  showAuthMessage('');
  setAuthSubmitting(true);
  try {
    const { name, pin } = readLoginForm();
    if (!name) return showAuthMessage('맨 위 「이름」 칸에 가입할 때 쓴 이름을 입력하세요.', 'error');
    if (!validatePin(pin)) return showAuthMessage('4자리 숫자 비밀번호를 입력하세요.', 'error');

    const user = findUserByName(name);
    if (!user) {
      const saved = getState().users.map((u) => u.name).join(', ');
      return showAuthMessage(
        saved
          ? `"${name}" 계정이 없습니다. 저장된 계정: ${saved}`
          : `"${name}" 계정이 없습니다. 회원가입 탭에서 먼저 만드세요.`,
        'error',
      );
    }

    if (userNeedsPinSetup(user)) {
      showPinSetup(user.id, user.name);
      return;
    }

    const ok = verifyPin(pin, user);
    if (!ok) return showAuthMessage('비밀번호가 일치하지 않습니다. 다시 입력해 주세요.', 'error');

    await completeLogin(user.id);
  } catch (err) {
    console.error(err);
    showAuthMessage(err.message || '로그인 중 오류가 발생했습니다.', 'error');
  } finally {
    setAuthSubmitting(false);
  }
}

export async function registerUser() {
  showAuthMessage('');
  setAuthSubmitting(true);
  try {
    const { name, pin, pinConfirm } = readRegisterForm();
    if (!name) return showAuthMessage('맨 위 「이름」 칸에 이름을 입력하세요.', 'error');
    if (name.length < 2) return showAuthMessage('이름은 2자 이상 입력하세요.', 'error');
    if (findUserByName(name)) {
      return showAuthMessage(`"${name}" 계정이 이미 있습니다. 로그인 탭에서 같은 이름·비밀번호로 들어가세요.`, 'error');
    }
    if (!validatePin(pin)) return showAuthMessage('비밀번호는 4자리 숫자(0000~9999)여야 합니다.', 'error');
    if (pin !== pinConfirm) return showAuthMessage('비밀번호 확인이 일치하지 않습니다.', 'error');

    pushUndo();
    const u = {
      id: uid('u'),
      name: normalizeUserName(name),
      pin,
      createdAt: new Date().toISOString(),
    };
    getState().users.push(u);
    await saveState();

    showAuthMessage(`"${name}" 계정을 만들었습니다. 들어갑니다…`, 'success');
    await completeLogin(u.id);
    showSection('manage');
  } catch (err) {
    console.error(err);
    showAuthMessage(err.message || '계정 생성에 실패했습니다.', 'error');
  } finally {
    setAuthSubmitting(false);
  }
}

export async function setupUserPin() {
  showAuthMessage('');
  setAuthSubmitting(true);
  try {
    const userId = store.pendingPinSetupUserId;
    const { pin, pinConfirm } = readSetupForm();
    const user = getState().users.find((u) => u.id === userId);
    if (!user) return showAuthMessage('사용자를 찾을 수 없습니다.', 'error');
    if (!validatePin(pin)) return showAuthMessage('비밀번호는 4자리 숫자여야 합니다.', 'error');
    if (pin !== pinConfirm) return showAuthMessage('비밀번호 확인이 일치하지 않습니다.', 'error');

    pushUndo();
    user.pin = pin;
    store.pendingPinSetupUserId = null;
    await saveState();
    await completeLogin(userId);
  } catch (err) {
    console.error(err);
    showAuthMessage(err.message || '비밀번호 설정에 실패했습니다.', 'error');
  } finally {
    setAuthSubmitting(false);
  }
}

export async function logoutUser() {
  const prevName = getActiveUser()?.name || '';
  store.authenticatedUserId = null;
  getState().activeUserId = null;
  store.activeFolderId = null;
  store.activeManageId = null;
  clearAuthInputs();
  if (prevName) {
    const el = document.getElementById('authName');
    if (el) el.value = prevName;
  }
  showAuthMessage('');
  await saveState();
  showAuthOverlay('login');
  renderAuthUserLists();
  renderAll();
}

export async function renameUser() {
  const u = getActiveUser();
  if (!u) return;
  const name = prompt('새 이름', u.name);
  if (!name?.trim()) return;
  if (getState().users.some((x) => x.id !== u.id && x.name === name.trim())) {
    return alert('같은 이름이 있습니다.');
  }
  pushUndo();
  u.name = name.trim();
  await saveState();
  renderAll();
}

export async function deleteUser() {
  const u = getActiveUser();
  if (!u) return;
  const pin = prompt(`"${u.name}" 계정 삭제 — 4자리 비밀번호 입력`);
  if (!pin) return;
  if (!validatePin(pin)) return alert('4자리 숫자 비밀번호를 입력하세요.');
  if (userNeedsPinSetup(u) || !verifyPin(pin, u)) {
    return alert('비밀번호가 일치하지 않습니다.');
  }
  if (!confirm(`"${u.name}" 계정과 모든 카드·폴더를 삭제할까요?`)) return;

  pushUndo();
  const state = getState();
  state.cards = state.cards.filter((c) => c.userId !== u.id);
  state.folders = state.folders.filter((f) => f.userId !== u.id);
  state.users = state.users.filter((x) => x.id !== u.id);
  state.selectedIds = state.selectedIds.filter((id) => !state.cards.some((c) => c.id === id));

  store.authenticatedUserId = null;
  state.activeUserId = null;
  await saveState();

  if (state.users.length) {
    showAuthOverlay('login');
    renderAuthUserLists();
  } else {
    showAuthOverlay('register');
  }
  renderAll();
}

// ── 폴더 ──

export function selectFolder(id) {
  store.activeFolderId = id;
  renderAll();
}

export function toggleTree(id) {
  getState().ui.treeExpanded[id] = getState().ui.treeExpanded[id] === false;
  persist();
  renderAll();
}

export function expandAllTree(expand) {
  getUserFolders(getActiveUser().id).forEach((f) => {
    getState().ui.treeExpanded[f.id] = expand;
  });
  persist();
  renderAll();
}

export async function createFolder(parentId) {
  const name = prompt('폴더 이름');
  if (!name?.trim()) return;
  pushUndo();
  const now = new Date().toISOString();
  const f = {
    id: uid('f'), userId: getActiveUser().id, name: name.trim(),
    parentId: parentId || null, createdAt: now, updatedAt: now,
  };
  getState().folders.push(f);
  getState().ui.treeExpanded[f.id] = true;
  if (parentId) getState().ui.treeExpanded[parentId] = true;
  await saveState();
  renderAll();
}

export async function renameFolder(id) {
  const f = getFolder(id);
  if (!f) return;
  const name = prompt('새 폴더 이름', f.name);
  if (!name?.trim()) return;
  pushUndo();
  f.name = name.trim();
  f.updatedAt = new Date().toISOString();
  await saveState();
  renderAll();
}

export async function deleteFolder(id) {
  const f = getFolder(id);
  if (!f) return;
  const cnt = countCardsInFolder(id, f.userId);
  if (!confirm(`"${f.name}" 폴더(하위 포함 카드 ${cnt}개)를 삭제할까요?`)) return;
  pushUndo();
  const desc = getDescendantFolderIds(id, f.userId);
  desc.push(id);
  getState().folders = getState().folders.filter((x) => !desc.includes(x.id));
  getUserCards(f.userId).filter((c) => desc.includes(c.folderId)).forEach((c) => { c.folderId = null; });
  if (store.activeFolderId === id) store.activeFolderId = null;
  await saveState();
  renderAll();
}

export async function dropCardOnFolder(cardId, folderId) {
  const card = getCard(cardId);
  if (!card) return;
  pushUndo();
  card.folderId = folderId;
  card.updatedAt = new Date().toISOString();
  await saveState();
  renderAll();
}

// ── 카드 ──

export function startNewCard() {
  renderCreateForm(null);
  showSection('create', { urlExtra: {} });
  document.getElementById('cardTitle').focus();
}

export function editCard(id) {
  const c = getCard(id);
  if (!c) return;
  renderCreateForm(c);
  showSection('create', { urlExtra: { cardId: id } });
}

export async function saveCard() {
  const draft = readCreateForm();
  if (!draft.displayText.trim()) return alert('문제를 입력하세요.');
  if (!draft.explanationText.trim()) return alert('해설을 입력하세요.');
  const emptyAnswer = draft.blanks.find((b) => !String(b.answer).trim());
  if (emptyAnswer) return alert(`빈칸 ${emptyAnswer.order}의 정답이 비어 있습니다. 아래 "빈칸별 정답"을 채우거나 해당 빈칸을 해제하세요.`);
  pushUndo();
  const state = getState();
  const now = new Date().toISOString();
  const existing = getCard(draft.id);

  if (existing) {
    Object.assign(existing, draft, { userId: getActiveUser().id, updatedAt: now, isSample: false });
    existing.originalText = draft.displayText;
    existing.blanks = draft.blanks.map((b) => ({ ...b, cardId: existing.id }));
  } else {
    const newId = uid('c');
    const card = migrateCard({
      ...draft, id: newId, userId: getActiveUser().id,
      createdAt: now, updatedAt: now, rounds: 0, wrongCount: 0, isSample: false,
    });
    card.originalText = card.displayText;
    card.blanks = card.blanks.map((b) => ({ ...b, cardId: card.id }));
    state.cards.unshift(card);
    store.activeManageId = card.id;
    document.getElementById('cardId').value = card.id;
  }

  await saveState();
  alert('저장했습니다.');
  showSection('create', { urlExtra: { cardId: store.activeManageId }, replaceUrl: true });
  renderManageDetail(store.activeManageId);
  renderAll();
}

export async function deleteCurrentCard() {
  const id = document.getElementById('cardId').value;
  if (!id) return alert('삭제할 카드가 없습니다.');
  if (!confirm('이 카드를 삭제할까요?')) return;
  await deleteCardById(id);
  renderCreateForm(null);
}

export async function deleteCardById(id) {
  if (!confirm('삭제할까요?')) return;
  pushUndo();
  const state = getState();
  state.cards = state.cards.filter((c) => c.id !== id);
  state.selectedIds = state.selectedIds.filter((x) => x !== id);
  if (store.activeManageId === id) renderManageDetail(null);
  await saveState();
  renderAll();
}

export async function moveCardFolder(cardId, folderId) {
  const c = getCard(cardId);
  if (!c) return;
  pushUndo();
  c.folderId = folderId || null;
  c.updatedAt = new Date().toISOString();
  await saveState();
  renderAll();
}

export async function toggleSelected(id, checked) {
  pushUndo();
  const state = getState();
  if (checked) state.selectedIds = [...new Set([...state.selectedIds, id])];
  else state.selectedIds = state.selectedIds.filter((x) => x !== id);
  await saveState();
  renderAll();
}

export async function selectFiltered(all) {
  const ids = getCardsFiltered(readFilters(), store.activeFolderId).map((c) => c.id);
  pushUndo();
  const state = getState();
  if (all) state.selectedIds = [...new Set([...state.selectedIds, ...ids])];
  else state.selectedIds = state.selectedIds.filter((x) => !ids.includes(x));
  await saveState();
  renderAll();
}

// ── 빈칸 ──

export function makeBlankFromSelection(editorId) {
  chipMakeBlank(editorId);
}

export function removeBlankFromSelection(editorId) {
  chipRemoveAtCaret(editorId);
}

export function removeBlankByOrder(editorId, order) {
  if (!order) return;
  chipRemoveByOrder(editorId, order);
}

export function jumpToBlank(editorId, order) {
  if (!chipJump(editorId, order)) {
    alert(`빈칸 ${order}을(를) 해설에서 찾지 못했습니다.`);
  }
}

export function openAutoBlank(editorId) {
  store.autoBlankEditorId = editorId;
  const plain = readChipPlainText(editorId);
  if (!plain.trim()) return alert('해설을 먼저 입력하세요.');
  const { blanks } = readChipEditor(editorId);
  const candidates = findAutoCandidates(plain, blanks);
  if (!candidates.length) return alert('자동 빈칸 후보를 찾지 못했습니다.');
  openAutoBlankModal(candidates, applyAutoBlank);
}

export function applyAutoBlank() {
  const editorId = store.autoBlankEditorId;
  const tokens = getSelectedAutoTokens();
  if (!tokens.length) return alert('선택된 후보가 없습니다.');
  chipApplyTokens(editorId, tokens);
  closeModal();
  alert(`${tokens.length}개 빈칸을 적용했습니다.`);
}

/** 자동 빈칸 — 상위 N개 즉시 적용 (모달 없음) */
export function applyQuickAutoBlank(editorId, limit = 5) {
  const plain = readChipPlainText(editorId);
  if (!plain.trim()) return alert('해설을 먼저 입력하세요.');
  const { blanks } = readChipEditor(editorId);
  const candidates = findAutoCandidates(plain, blanks);
  if (!candidates.length) return alert('자동 빈칸 후보를 찾지 못했습니다. (2자 미만·숫자·조항·불용어 제외)');
  const tokens = candidates.slice(0, limit).map(([t]) => t);
  chipApplyTokens(editorId, tokens);
  alert(`추천 ${tokens.length}개를 빈칸으로 만들었습니다: ${tokens.join(', ')}`);
}

// ── 학습 ──

/** IndexedDB에 학습 큐 저장 (새로고침 복원용) */
export function saveStudySession() {
  if (!store.studyQueue.length) {
    getState().ui.studySession = null;
    return;
  }
  getState().ui.studySession = {
    mode: document.getElementById('studyMode')?.value || 'all-order',
    cardIds: store.studyQueue.map((c) => c.id),
    index: store.studyIndex,
  };
}

export function clearStudySession() {
  getState().ui.studySession = null;
  store.studyQueue = [];
  store.studyIndex = 0;
  store._studyCardId = null;
  store.currentBlankStatuses = [];
}

/** 저장된 학습 큐 복원 */
export function restoreStudySession(index = 0) {
  const sess = getState().ui.studySession;
  if (!sess?.cardIds?.length) return false;

  const cards = sess.cardIds.map((id) => getCard(id)).filter(Boolean);
  if (!cards.length) {
    clearStudySession();
    return false;
  }

  store.studyQueue = cards;
  const idx = Number.isFinite(index) ? index : (sess.index ?? 0);
  store.studyIndex = Math.min(Math.max(0, idx), cards.length - 1);
  store._studyCardId = null;
  store.currentBlankStatuses = [];

  const modeSel = document.getElementById('studyMode');
  if (modeSel && sess.mode) modeSel.value = sess.mode;
  getState().ui.studySession.index = store.studyIndex;
  return true;
}

export function startStudy() {
  const mode = document.getElementById('studyMode').value;
  let cards = buildStudyQueue(mode, store.activeFolderId, getState().selectedIds);
  if (mode.includes('random')) cards = shuffle(cards);
  if (!cards.length) return alert('학습할 카드가 없습니다.');
  store.studyQueue = cards;
  store.studyIndex = 0;
  store._studyCardId = null;
  saveStudySession();
  renderStudyCard();
  showSection('study-play', { urlExtra: { index: 0 } });
}

export function studyOne(id) {
  const c = getCard(id);
  if (!c) return;
  store.studyQueue = [c];
  store.studyIndex = 0;
  store._studyCardId = null;
  saveStudySession();
  renderStudyCard();
  showSection('study-play', { urlExtra: { index: 0 } });
}

/** 빈칸 하나 Enter 채점 */
export async function gradeBlankOnEnter(order) {
  const c = store.studyQueue[store.studyIndex];
  if (!c) return;
  syncDraftFromDOM();
  const user = getBlankInputValue(order);
  if (!user) return;

  const threshold = Number(document.getElementById('gradingThreshold').value);
  const blank = c.blanks.find((b) => b.order === order);
  const { correct, score } = checkAnswer(user, splitAnswers(blank?.answer || ''), threshold);

  let st = store.currentBlankStatuses.find((s) => s.order === order);
  if (!st) return;
  st.checked = true;
  st.correct = correct;
  st.score = score;
  st.user = user;
  st.revealed = true;

  if (blank) {
    blank.lastInput = user;
    blank.lastResult = correct ? 'correct' : 'wrong';
  }

  if (store.currentBlankStatuses.every((s) => s.checked)) {
    applyCardResult(c, store.currentBlankStatuses);
  }

  refreshStudyViews();
  const ok = store.currentBlankStatuses.filter((s) => s.correct).length;
  const total = c.blanks.length;
  document.getElementById('gradeResult').textContent = correct
    ? `빈칸${order} 정답! (${ok}/${total})`
    : `빈칸${order} 오답 · ${score}% (${ok}/${total})`;

  await persist();
}

export async function gradeCurrent() {
  const c = store.studyQueue[store.studyIndex];
  if (!c) return;
  pushUndo();
  const threshold = Number(document.getElementById('gradingThreshold').value);
  getState().settings.gradingThreshold = threshold;

  store.currentBlankStatuses = c.blanks.map((b) => {
    const user = getBlankInputValue(b.order);
    const { correct, score } = checkAnswer(user, splitAnswers(b.answer), threshold);
    b.lastInput = user;
    b.lastResult = correct ? 'correct' : 'wrong';
    return { order: b.order, checked: true, correct, score, user, revealed: true };
  });

  applyCardResult(c, store.currentBlankStatuses);
  refreshStudyViews();
  const ok = store.currentBlankStatuses.filter((s) => s.correct).length;
  document.getElementById('gradeResult').textContent = `전체 채점 ${ok}/${store.currentBlankStatuses.length}`;
  await persist();
  renderAll();
}

function applyCardResult(c, statuses) {
  const allCorrect = statuses.every((s) => s.correct);
  c.lastResult = allCorrect ? 'correct' : 'wrong';
  if (!allCorrect) c.wrongCount = (c.wrongCount || 0) + 1;
  store.studyAttemptRecorded = true;
}

export async function markSingleBlank(order, isCorrect) {
  const c = store.studyQueue[store.studyIndex];
  if (!c) return;
  pushUndo();
  const user = getBlankInputValue(order);
  const st = store.currentBlankStatuses.find((s) => s.order === order);
  if (!st) return;
  st.checked = true;
  st.correct = isCorrect;
  st.score = isCorrect ? 100 : 0;
  st.user = user;
  st.revealed = true;
  const blank = c.blanks.find((b) => b.order === order);
  if (blank) {
    blank.lastInput = user;
    blank.lastResult = isCorrect ? 'correct' : 'wrong';
    blank.manualResult = isCorrect ? 'correct' : 'wrong';
  }
  if (store.currentBlankStatuses.every((s) => s.checked)) applyCardResult(c, store.currentBlankStatuses);
  refreshStudyViews();
  await persist();
}

export async function markCardAll(isCorrect) {
  const c = store.studyQueue[store.studyIndex];
  if (!c) return;
  pushUndo();
  store.currentBlankStatuses = c.blanks.map((b) => ({
    order: b.order, checked: true, correct: isCorrect, score: isCorrect ? 100 : 0,
    user: getBlankInputValue(b.order), revealed: true,
  }));
  applyCardResult(c, store.currentBlankStatuses);
  refreshStudyViews();
  document.getElementById('gradeResult').textContent = isCorrect ? '전체 정답 처리' : '전체 오답 처리';
  await persist();
  renderAll();
}

export function hideAnswers() {
  const c = store.studyQueue[store.studyIndex];
  if (!c) return;
  store.currentBlankStatuses = c.blanks.map((b) => ({
    order: b.order, checked: false, correct: false, score: 0, user: '', revealed: false,
  }));
  store._studyCardId = null;
  renderStudyCard();
  document.getElementById('gradeResult').textContent = '다시 풀 준비됐습니다.';
}

export async function adjustRounds(delta) {
  const c = store.studyQueue[store.studyIndex];
  if (!c) return;
  pushUndo();
  c.rounds = Math.max(0, c.rounds + delta);
  c.updatedAt = new Date().toISOString();
  await persist();
  renderAll();
  renderStudyCard();
}

export async function saveStudyMemo() {
  const c = store.studyQueue[store.studyIndex];
  if (!c) return;
  pushUndo();
  c.memo = document.getElementById('studyMemo').value;
  c.updatedAt = new Date().toISOString();
  await saveState();
  renderAll();
  document.getElementById('gradeResult').textContent = '메모 저장됐습니다.';
}

export async function saveStudyEdits() {
  const c = store.studyQueue[store.studyIndex];
  if (!c) return;
  const synced = readChipEditor('studyEditExplanation');
  const emptyAnswer = synced.blanks.find((b) => !String(b.answer).trim());
  if (emptyAnswer) return alert(`빈칸 ${emptyAnswer.order}의 정답이 비어 있습니다. 정답을 채우거나 빈칸을 해제하세요.`);
  pushUndo();
  c.title = document.getElementById('studyEditTitle').value.trim() || c.title;
  c.folderId = document.getElementById('studyEditFolder').value || null;
  c.displayText = stripBlankMarkers(document.getElementById('studyEditPrompt').value);
  c.originalText = c.displayText;
  c.explanationText = synced.template;
  c.blanks = synced.blanks.map((b) => ({ ...b, cardId: c.id }));
  c.memo = document.getElementById('studyEditMemo').value;
  c.updatedAt = new Date().toISOString();
  await persist();
  if (document.getElementById('cardId').value === c.id) renderCreateForm(c);
  if (store.activeManageId === c.id) renderManageDetail(c.id);
  renderAll();
  renderStudyCard();
  alert('원본 카드에 저장했습니다.');
}

export function prevCard() {
  if (store.studyIndex > 0) {
    store.studyIndex--;
    store._studyCardId = null;
    saveStudySession();
    renderStudyCard();
    showSection('study-play', { urlExtra: { index: store.studyIndex }, replaceUrl: true });
  }
}

export function nextCard() {
  if (store.studyIndex < store.studyQueue.length - 1) {
    store.studyIndex++;
    store._studyCardId = null;
    saveStudySession();
    renderStudyCard();
    showSection('study-play', { urlExtra: { index: store.studyIndex }, replaceUrl: true });
  }
}

// ── 플래그·Undo·Import/Export ──

/** 카드 제작 폼의 플래그 스와치 선택 */
export function pickCardFlag(n) {
  syncCardFlagPicker(n);
}

export async function applyFlag(n) {
  const c = store.studyQueue[store.studyIndex] || getCard(document.getElementById('cardId').value);
  if (!c) return;
  pushUndo();
  c.flagColor = n;
  await persist();
  renderAll();
  renderStudyCard();
}

export async function undoAppState() {
  if (!hasUndo()) {
    alert('되돌릴 작업이 없습니다.');
    return;
  }
  const ok = confirm(
    '마지막 데이터 변경(카드·채점·폴더·메모 등)을 되돌릴까요?\n'
    + '입력 중인 글자 단위 되돌리기(Ctrl+Z)와는 다릅니다.',
  );
  if (!ok) return;
  if (await undo()) { renderAll(); renderStudyCard(); }
}

export function handleExport(scope) {
  exportData(scope, store.activeFolderId);
}

export async function handleImport(file) {
  if (!file) return;
  try {
    const mode = confirm('확인=병합 / 취소=덮어쓰기') ? 'merge' : 'overwrite';
    pushUndo();
    const next = await importFromFile(file, mode);
    if (mode === 'overwrite') setState(next);
    await saveState();
    renderStudyCard();
    renderAll();
    alert('가져오기 완료');
  } catch {
    alert('JSON 파싱 실패');
  }
}

/** 카드 제작 해설 칩 에디터가 바뀜 → 미리보기·정답 슬롯 재구성 */
export function onCreateInput() {
  const { template, blanks } = readChipEditor('explanationTemplate');
  renderCreatePreview({
    displayText: document.getElementById('promptTemplate').value,
    explanationText: template,
    blanks,
  });
}

/** 학습 중 수정 해설 칩 에디터가 바뀜 → 미리보기·정답 슬롯 재구성 */
export function onStudyEditInput() {
  renderStudyEditForm(null, readChipEditor('studyEditExplanation'));
}

export { focusBlankUI as focusBlank, renderStudyEditPreview };
export { handleBlankPeekOver, handleBlankPeekOut };
