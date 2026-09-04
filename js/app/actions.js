/**
 * 사용자 액션 핸들러 — UI 이벤트와 도메인 로직 연결
 */
import { getState, store } from '../core/store.js';
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
  findUsersByName,
  isUserNameTaken,
  normalizeUserName,
  pruneEmptyStudyFolders,
} from '../domain/queries.js';
import { findAutoCandidates, acceptedAnswers } from '../domain/blank.js';
import { findOutlineBlankCandidates, listOutlineTokens, normalizeOutline } from '../domain/outline.js';
import { normalizeTight } from '../utils/text.js';
import { pushUndo, undo, hasUndo } from '../services/undo.js';
import { checkAnswer } from '../services/grading.js';
import {
  exportData,
  readImportFile,
  describeImport,
  previewFolderImport,
  previewUsersImport,
  applyUsersImport,
  applyFolderImport,
} from '../services/import-export.js';
import { saveStudySession, snapshotCurrentCardProgress, getPersistedStudySession, setPersistedStudySession } from '../services/study-session.js';
import { showSection } from '../ui/router.js';
import {
  renderAll,
  renderManageDetail,
  renderCreateForm,
} from '../ui/render.js';
import {
  readCreateForm,
  makeCreateSnapshot,
  renderCreatePreview,
  renderStudyEditPreview,
  renderStudyEditForm,
  syncCardFlagPicker,
  writeOutlineToForm,
  readOutlineFromForm,
  syncCreateDeleteButton,
} from '../ui/create.js';
import {
  chipMakeBlank,
  chipRemoveAtCaret,
  chipRemoveByOrder,
  chipRemoveAll,
  chipBlankCount,
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
  renderStudySetup,
  refreshStudySetupChecksOnly,
  syncDraftFromDOM,
  handleBlankPeekOver,
  handleBlankPeekOut,
  handleBlankPeekMove,
  armBlankPeekSticky,
  retainBlankPeekAfterEdit,
  resetBlankGradeIfEdited,
  getGradingThreshold,
  showRoundToast,
} from '../ui/study.js';
import { openChoice } from '../ui/choice-modal.js';
import { openAutoBlankModal, closeModal, getSelectedAutoTokens } from '../ui/modal.js';
import { openOutlineModal, handleOutlineModalAction, closeOutlineModal } from '../ui/outline-modal.js';
import { openStudyFolderPicker, openStudyCardPicker, openExportFolderPicker } from '../ui/pickers.js';
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

  const sameUser = store.authenticatedUserId === userId;
  store.authenticatedUserId = userId;
  state.activeUserId = userId;

  if (!sameUser) {
    store.activeFolderId = null;
    store.activeManageId = null;
    state.ui.createDraft = null;
    state.ui.filterFolderId = null;
    state.ui.filterFlag = 'all';
    store.studyQueue = [];
    store.studyIndex = 0;
    store._studyCardId = null;
    store.currentBlankStatuses = [];
  }

  clearAuthInputs();
  showAuthMessage('');
  await saveState();

  hideAuthOverlay();
  if (!sameUser) {
    renderCreateForm(null);
    renderManageDetail(null);
  }
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

  // PIN 미설정 계정이 active면 설정 화면만. 로그인 탭으로 덮지 않는다.
  if (userNeedsPinSetup(user)) {
    showPinSetup(user.id, user.name);
    return true;
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

    const matches = findUsersByName(name);
    if (!matches.length) {
      const saved = getState().users.map((u) => u.name).join(', ');
      return showAuthMessage(
        saved
          ? `"${name}" 계정이 없습니다. 저장된 계정: ${saved}`
          : `"${name}" 계정이 없습니다. 회원가입 탭에서 먼저 만드세요.`,
        'error',
      );
    }

    // 비밀번호 없는 계정만 있으면 바로 설정
    const pinReady = matches.filter((u) => !userNeedsPinSetup(u));
    if (!pinReady.length) {
      showPinSetup(matches[0].id, matches[0].name);
      return;
    }

    if (!validatePin(pin)) return showAuthMessage('4자리 숫자 비밀번호를 입력하세요.', 'error');

    const user = pinReady.find((u) => verifyPin(pin, u));
    if (!user) return showAuthMessage('비밀번호가 일치하지 않습니다. 다시 입력해 주세요.', 'error');

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
    const taken = normalizeUserName(name);
    if (isUserNameTaken(taken)) {
      return showAuthMessage(`「${taken}」은 이미 있는 이름입니다. 다른 이름을 입력하세요.`, 'error');
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

    const nextId = store.pinSetupQueue.shift();
    if (nextId) {
      const next = getState().users.find((u) => u.id === nextId);
      clearAuthInputs();
      showAuthMessage('');
      if (next) {
        showPinSetup(next.id, next.name);
        return;
      }
    }

    const resumeId = store.pinSetupResumeUserId || userId;
    store.pinSetupResumeUserId = null;
    // 이미 그 계정으로 들어가 있으면 세션만 유지 (계정 전환처럼 보이지 않게)
    if (store.authenticatedUserId === resumeId) {
      hideAuthOverlay();
      renderAll();
      return;
    }
    await completeLogin(resumeId);
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
  getState().ui.createDraft = null;
  getState().ui.filterFolderId = null;
  getState().ui.filterFlag = 'all';
  store.studyQueue = [];
  store.studyIndex = 0;
  store._studyCardId = null;
  store.currentBlankStatuses = [];
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
  if (isUserNameTaken(name, u.id)) {
    return alert('이미 있는 이름입니다. 다른 이름을 입력하세요.');
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
  await saveState(null, { allowEmptyUsers: true });

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
  const name = prompt('새 폴더 이름');
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
  const name = prompt('폴더 이름', f.name);
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

/** 폴더 트리 — 다른 폴더 아래(또는 루트)로 이동 */
export async function moveFolder(folderId, newParentId) {
  const f = getFolder(folderId);
  if (!f) return;
  const userId = getActiveUser().id;
  const parentId = newParentId || null;
  if (f.parentId === parentId) return;
  if (parentId === folderId) return;
  if (parentId) {
    const parent = getFolder(parentId);
    if (!parent || parent.userId !== userId) return;
    const descendants = getDescendantFolderIds(folderId, userId);
    if (descendants.includes(parentId)) {
      alert('하위 폴더 안으로는 옮길 수 없습니다.');
      return;
    }
  }
  pushUndo();
  f.parentId = parentId;
  f.updatedAt = new Date().toISOString();
  if (parentId) getState().ui.treeExpanded[parentId] = true;
  await saveState();
  renderAll();
}

export async function dropCardOnFolder(cardId, folderId) {
  const card = getCard(cardId);
  if (!card) return;
  const next = folderId || null;
  if (card.folderId === next) return;
  pushUndo();
  card.folderId = next;
  card.updatedAt = new Date().toISOString();
  await saveState();
  renderAll();
}

// ── 카드 ──

/** 카드관리에서 선택한 폴더(activeFolderId)를 새 카드 폼 초기값으로 */
function newCardSeedFromContext() {
  const folderId = store.activeFolderId || null;
  return folderId ? { folderId } : null;
}

/** 카드제작 진입(메뉴) — 작성 중 초안이 있으면 이어쓰기, 없으면 빈 폼 */
export function goCreate() {
  const draft = getState().ui.createDraft;
  renderCreateForm(draft || newCardSeedFromContext());
  showSection('create', { urlExtra: draft?.id ? { cardId: draft.id } : {} });
  syncCreateSavedSnapshotFromForm();
  document.getElementById('cardTitle').focus();
}

/** 카드제작 폼에 보호할 내용이 있는지 (기존 수정·작성 중) */
function createFormHasWork() {
  try {
    const d = readCreateForm();
    return !!(
      d.id
      || d.displayText.trim()
      || d.explanationText.trim()
      || (d.memo || '').trim()
      || d.blanks.length
      || d.outline?.items?.length
      || (d.title && d.title !== '제목 없음')
    );
  } catch {
    return false;
  }
}

function createDraftHasWork(draft) {
  if (!draft) return false;
  return !!(
    draft.id
    || String(draft.displayText || '').trim()
    || String(draft.explanationText || '').trim()
    || String(draft.memo || '').trim()
    || (draft.blanks || []).length
    || draft.outline?.items?.length
    || (draft.title && draft.title !== '제목 없음')
  );
}

/** 「새 카드」 — 작성·수정 중이면 확인 후 빈 폼 */
export function startNewCard() {
  const alreadyOnCreate = store.currentSection === 'create';
  const needsConfirm = alreadyOnCreate
    ? createFormHasWork()
    : createDraftHasWork(getState().ui.createDraft);

  if (needsConfirm) {
    if (!confirm('지금 작성·수정 중인 내용이 있습니다.\n새 카드를 만들까요?\n(취소 = 현재 내용 유지)')) {
      if (!alreadyOnCreate) goCreate();
      return;
    }
  }

  getState().ui.createDraft = null;
  persist();
  // 카드제작 화면에서 다시 「새 카드」→ 완전 초기화. 관리 등에서 진입할 때만 폴더 컨텍스트 반영
  const seed = alreadyOnCreate ? null : newCardSeedFromContext();
  renderCreateForm(seed);
  showSection('create', { urlExtra: {} });
  syncCreateSavedSnapshotFromForm();
  document.getElementById('cardTitle').focus();
}

export function editCard(id) {
  const c = getCard(id);
  if (!c) return;
  const draft = getState().ui.createDraft;
  renderCreateForm(draft && draft.id === id ? draft : c);
  showSection('create', { urlExtra: { cardId: id } });
  syncCreateSavedSnapshotFromForm();
}

/** 학습 중 현재 카드 → 카드제작(수정) 화면 */
export function editCurrentStudyCard() {
  const c = store.studyQueue[store.studyIndex];
  if (!c) return alert('학습 중인 카드가 없습니다.');
  editCard(c.id);
}

export async function saveCard() {
  return saveCardWithOptions();
}

function formatHHMM(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function updateCreateSaveStamp() {
  const el = document.getElementById('createSaveStamp');
  if (!el) return;
  const saved = store.data.ui.lastSavedAt;
  const auto = store.data.ui.lastAutoSaveAt;
  const savedTs = saved ? new Date(saved).getTime() : 0;
  const autoTs = auto ? new Date(auto).getTime() : 0;
  if (!savedTs && !autoTs) { el.textContent = ''; return; }
  if (autoTs >= savedTs) {
    el.textContent = `자동저장 ${formatHHMM(auto)}`;
  } else {
    el.textContent = `마지막 저장 ${formatHHMM(saved)}`;
  }
}

async function saveCardWithOptions({ silent = false } = {}) {
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
    if (!existing.author) existing.author = getActiveUser().name;
    existing.originalText = draft.displayText;
    existing.blanks = draft.blanks.map((b) => ({ ...b, cardId: existing.id }));
  } else {
    const newId = uid('c');
    const card = migrateCard({
      ...draft, id: newId, userId: getActiveUser().id, author: getActiveUser().name,
      createdAt: now, updatedAt: now, rounds: 0, wrongCount: 0, isSample: false,
    });
    card.originalText = card.displayText;
    card.blanks = card.blanks.map((b) => ({ ...b, cardId: card.id }));
    state.cards.unshift(card);
    store.activeManageId = card.id;
    document.getElementById('cardId').value = card.id;
    syncCreateDeleteButton(true);
  }

  state.ui.createDraft = null;
  await saveState();
  // 마지막 저장 상태 스냅샷 (이동 경고용)
  store.data.ui.createSavedSnapshot = makeCreateSnapshot(readCreateForm());
  store.data.ui.lastSavedAt = new Date().toISOString();
  persist();
  updateCreateSaveStamp();
  if (!silent) alert('저장했습니다.');
  showSection('create', { urlExtra: { cardId: store.activeManageId }, replaceUrl: true });
  renderManageDetail(store.activeManageId);
  renderAll();
}

export async function autoSaveCreate() {
  if (store.currentSection !== 'create') return false;
  try {
    const d = readCreateForm();
    const has = d.displayText.trim() || d.explanationText.trim() || (d.memo || '').trim()
      || d.blanks.length || d.outline?.items?.length
      || (d.title && d.title !== '제목 없음');
    if (!has) return false;
    await saveCardWithOptions({ silent: true });
    store.data.ui.lastAutoSaveAt = new Date().toISOString();
    persist();
    updateCreateSaveStamp();
    return true;
  } catch {
    return false;
  }
}

export function syncCreateSavedSnapshotFromForm() {
  try {
    store.data.ui.createSavedSnapshot = makeCreateSnapshot(readCreateForm());
    persist();
  } catch { /* ignore */ }
}

export async function deleteCurrentCard() {
  const id = document.getElementById('cardId').value;
  if (!id) return; // 미등록 카드 — 버튼 비활성. 방어용.

  const deleted = await deleteCardById(id);
  if (!deleted) return;
  getState().ui.createDraft = null;
  persist();
  renderCreateForm(null);
}

/** @returns {Promise<boolean>} 실제 삭제 여부 */
export async function deleteCardById(id) {
  if (!confirm('이 카드를 삭제할까요?')) return false;
  pushUndo();
  const state = getState();
  state.cards = state.cards.filter((c) => c.id !== id);
  state.selectedIds = state.selectedIds.filter((x) => x !== id);
  if (store.activeManageId === id) renderManageDetail(null);
  await saveState();
  renderAll();
  return true;
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
  const ids = getCardsFiltered(readFilters()).map((c) => c.id);
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

/** 해설 빈칸 전체 해제 — 처음부터 다시 만들 때 */
export function removeAllBlanks(editorId) {
  const count = chipBlankCount(editorId);
  if (!count) return alert('해제할 빈칸이 없습니다.');
  if (!confirm(`빈칸 ${count}개를 모두 해제할까요?\n정답은 해설 본문으로 돌아갑니다.`)) return;
  chipRemoveAll(editorId);
  if (editorId === 'explanationTemplate') onCreateInput();
  else if (editorId === 'studyEditExplanation') onStudyEditInput();
}

export function jumpToBlank(editorId, order) {
  if (!chipJump(editorId, order)) {
    alert(`빈칸 ${order}을(를) 해설에서 찾지 못했습니다.`);
  }
}

export function openAutoBlank(editorId, { suggestLimit = null } = {}) {
  store.autoBlankEditorId = editorId;
  const plain = readChipPlainText(editorId);
  if (!plain.trim()) return alert('해설을 먼저 입력하세요.');
  const { blanks } = readChipEditor(editorId);
  const outline = readOutlineFromForm();
  const candidates = findAutoCandidates(plain, blanks, outline);
  if (!candidates.length) return alert('빈칸 후보를 찾지 못했습니다. (저장된 목차·키워드 없음 또는 이미 빈칸)');
  openAutoBlankModal(candidates, applyAutoBlank, {
    hasOutline: !!outline?.items?.length,
    checkedCount: suggestLimit,
  });
}

/** 추천 N개 — 즉시 적용하지 않고 confirm으로 1회 확인 */
export function confirmQuickAutoBlank(editorId, limit = 5) {
  const plain = readChipPlainText(editorId);
  if (!plain.trim()) return alert('해설을 먼저 입력하세요.');
  const { blanks } = readChipEditor(editorId);
  const outline = readOutlineFromForm();
  const candidates = findAutoCandidates(plain, blanks, outline);
  if (!candidates.length) return alert('빈칸 후보를 찾지 못했습니다. (저장된 목차·키워드 없음 또는 이미 빈칸)');

  const tokens = candidates.slice(0, limit).map(([t]) => t);
  const msg = `추천 ${tokens.length}개를 빈칸으로 만들까요?\n\n${tokens.join('\n')}`;
  if (!confirm(msg)) return;

  chipApplyTokens(editorId, tokens);
  if (editorId === 'explanationTemplate') onCreateInput();
  else if (editorId === 'studyEditExplanation') onStudyEditInput();
}

export function applyAutoBlank() {
  const editorId = store.autoBlankEditorId;
  const tokens = getSelectedAutoTokens();
  if (!tokens.length) return alert('선택된 후보가 없습니다.');
  chipApplyTokens(editorId, tokens);
  closeModal();
  if (editorId === 'explanationTemplate') onCreateInput();
  else if (editorId === 'studyEditExplanation') onStudyEditInput();
  alert(`${tokens.length}개 빈칸을 적용했습니다.`);
}

/** 저장된 목차 제목 → 빈칸 (아직 빈칸 아닌 항목만) */
export function applyOutlineBlanksAll() {
  const outline = readOutlineFromForm();
  if (!normalizeOutline(outline)?.items?.length) return alert('저장된 목차가 없습니다.');
  const { blanks } = readChipEditor('explanationTemplate');
  const tokens = findOutlineBlankCandidates(outline, blanks).map(([t]) => t);
  if (!tokens.length) return alert('빈칸으로 만들 목차 항목이 없습니다. (이미 모두 빈칸이거나 본문에 없음)');
  chipApplyTokens('explanationTemplate', tokens);
  onCreateInput();
  saveCardWithOptions({ silent: true });
}

/** 목차 미리보기에서 체크한 항목만 빈칸 */
export function applyOutlineBlanksSelected() {
  const outline = readOutlineFromForm();
  if (!normalizeOutline(outline)?.items?.length) return alert('저장된 목차가 없습니다.');
  const tokens = [...document.querySelectorAll('[data-outline-blank-token]')]
    .filter((el) => el.checked)
    .map((el) => el.dataset.outlineBlankToken);
  if (!tokens.length) return alert('목차 항목을 선택하세요.');
  chipApplyTokens('explanationTemplate', tokens);
  onCreateInput();
  saveCardWithOptions({ silent: true });
}

/** 저장된 목차와 일치하는 빈칸만 해제 */
export function removeOutlineBlanks() {
  const outline = readOutlineFromForm();
  if (!normalizeOutline(outline)?.items?.length) return alert('저장된 목차가 없습니다.');
  const tokenKeys = new Set(
    listOutlineTokens(outline).map(({ token }) => normalizeTight(token)),
  );
  const { blanks } = readChipEditor('explanationTemplate');
  const orders = blanks
    .filter((b) => tokenKeys.has(normalizeTight(b.answer)))
    .map((b) => b.order)
    .sort((a, b) => b - a);
  if (!orders.length) return alert('목차에서 만든 빈칸이 없습니다.');
  orders.forEach((order) => chipRemoveByOrder('explanationTemplate', order));
  onCreateInput();
  saveCardWithOptions({ silent: true });
}

export function openOutlineManager() {
  const plain = readChipPlainText('explanationTemplate');
  if (!plain.trim()) return alert('해설을 먼저 입력하세요.');
  openOutlineModal({
    explanationText: plain,
    outline: readOutlineFromForm(),
    refreshExplanation: () => readChipPlainText('explanationTemplate'),
    onApply: async (outline) => {
      writeOutlineToForm(outline);
      persist();
      await saveCardWithOptions({ silent: true });
    },
  });
}

// ── 학습 ──

export { saveStudySession };

export function clearStudySession() {
  setPersistedStudySession(null);
  store.studyQueue = [];
  store.studyIndex = 0;
  store._studyCardId = null;
  store.currentBlankStatuses = [];
  store.studyAttemptRecorded = false;
  store.studyRoundRecorded = false;
}

/** 저장된 학습 큐 복원 — index 생략 시 세션에 저장된 카드 위치 사용 (기본값 0 금지) */
export function restoreStudySession(index) {
  const sess = getPersistedStudySession();
  if (!sess?.cardIds?.length) return false;

  const cards = sess.cardIds.map((id) => getCard(id)).filter(Boolean);
  if (!cards.length) {
    clearStudySession();
    return false;
  }

  store.studyQueue = cards;
  const idx = (index !== undefined && Number.isFinite(index))
    ? index
    : (sess.index ?? 0);
  store.studyIndex = Math.min(Math.max(0, idx), cards.length - 1);
  store._studyCardId = null;
  store.currentBlankStatuses = [];
  if (!sess.cardProgress) sess.cardProgress = {};

  sess.index = store.studyIndex;
  return true;
}

/** 학습 setup 폼 → 설정 객체 (folderIds·flag는 모달/스와치로 따로 정해 보존) */
export function readStudyConfig() {
  const prev = getState().ui.studyConfig || {};
  const folderIds = Array.isArray(prev.folderIds)
    ? prev.folderIds
    : (prev.folderId ? [prev.folderId] : []);
  const next = {
    ...prev,
    scope: document.getElementById('studyScope')?.value || 'all',
    order: document.getElementById('studyOrder')?.value || 'created',
    folderIds,
  };
  delete next.folderId;
  return next;
}

/** 범위/순서 변경 → 설정 저장 + 요약 갱신 */
export function onStudyConfigChange() {
  const cfg = readStudyConfig();
  if (cfg.scope === 'selected') cfg.scope = 'all';
  getState().ui.studyConfig = cfg;
  persist();
  renderStudySetup();
}

/** 플래그 색 선택 (범위=플래그) */
export function pickStudyFlag(n) {
  getState().ui.studyConfig = { ...getState().ui.studyConfig, flag: Number(n) };
  persist();
  renderStudySetup();
}

/** 사이드바 필터 — 폴더 select 변경 */
export function onFilterFolderChange() {
  getState().ui.filterFolderId = document.getElementById('filterFolderSelect')?.value || null;
  persist();
  renderAll();
}

/** 사이드바 필터 — 플래그 색 */
export function pickFilterFlag(flag) {
  getState().ui.filterFlag = flag;
  persist();
  renderAll();
}

/** 폴더 선택 모달 (범위=폴더, 여러 개 토글) */
export function openStudyFolderModal() {
  const cfg = getState().ui.studyConfig || {};
  const current = Array.isArray(cfg.folderIds)
    ? cfg.folderIds
    : (cfg.folderId ? [cfg.folderId] : []);
  openStudyFolderPicker(current, (ids) => {
    const user = getActiveUser();
    const folderIds = pruneEmptyStudyFolders(ids, user?.id);
    if (!folderIds.length) return;
    getState().ui.studyConfig = {
      ...getState().ui.studyConfig,
      folderIds,
      folderId: undefined,
    };
    delete getState().ui.studyConfig.folderId;
    persist();
    renderStudySetup();
  });
}

/** 학습 setup 미리보기 — 카드 체크 */
export function toggleStudySetupCard(id, checked) {
  const cfg = readStudyConfig();
  if (cfg.scope === 'selected') cfg.scope = 'all';
  const pool = buildStudyQueue({ ...cfg }).map((c) => c.id);
  const set = store.studySetupCheckedIds == null
    ? new Set(pool)
    : new Set(store.studySetupCheckedIds);
  if (checked) set.add(id);
  else set.delete(id);
  store.studySetupCheckedIds = [...set];
  // 목록 전체 재렌더 금지 — 스크롤이 맨 위로 튀는 UX 방지
  refreshStudySetupChecksOnly();
}

/** 학습 setup 미리보기 — 전체 선택/해제 */
export function selectStudySetupAll(all) {
  store.studySetupCheckedIds = all ? null : [];
  renderStudySetup();
}

/** 카드 선택 모달 (범위=선택 카드) — selectedIds에 반영(사이드바와 공유) */
export function openStudyCardModal() {
  openStudyCardPicker(getState().selectedIds || [], async (ids) => {
    getState().selectedIds = [...new Set(ids)];
    await saveState();
    renderAll();
    renderStudySetup();
  });
}

export function startStudy() {
  const cfg = readStudyConfig();
  if (cfg.scope === 'selected') cfg.scope = 'all';
  getState().ui.studyConfig = cfg;
  const pool = buildStudyQueue({ ...cfg });
  const checked = store.studySetupCheckedIds == null
    ? new Set(pool.map((c) => c.id))
    : new Set(store.studySetupCheckedIds);
  let cards = pool.filter((c) => checked.has(c.id));
  if (cfg.order === 'random') cards = shuffle(cards);
  if (!cards.length) return alert('학습할 카드가 없습니다. 범위를 확인하세요.');

  const sess = getPersistedStudySession();
  if (sess?.cardIds?.length && !confirm('진행 중인 학습이 있습니다. 새로 시작할까요?')) return;

  store.studyQueue = cards;
  store.studyIndex = 0;
  store._studyCardId = null;
  store.currentBlankStatuses = [];
  saveStudySession({ resetProgress: true });
  persist();
  renderStudyCard();
  showSection('study-play', { urlExtra: { index: 0 } });
}

/** 카드관리 — 선택 폴더(+하위)로 바로 학습 시작 */
export function startStudyFromManageFolder() {
  const folderId = store.activeFolderId;
  const user = getActiveUser();
  if (!folderId || !user) return;
  if (!countCardsInFolder(folderId, user.id)) return;

  const order = getState().ui.studyConfig?.order || 'created';
  let cards = buildStudyQueue({ scope: 'folder', order, folderIds: [folderId] });
  if (order === 'random') cards = shuffle(cards);
  if (!cards.length) return alert('학습할 카드가 없습니다.');

  const sess = getPersistedStudySession();
  if (sess?.cardIds?.length && !confirm('진행 중인 학습이 있습니다. 이 폴더로 새로 시작할까요?')) return;

  getState().ui.studyConfig = {
    ...getState().ui.studyConfig,
    scope: 'folder',
    folderIds: [folderId],
    order,
  };
  delete getState().ui.studyConfig.folderId;

  store.studyQueue = cards;
  store.studyIndex = 0;
  store._studyCardId = null;
  store.currentBlankStatuses = [];
  saveStudySession({ resetProgress: true });
  persist();
  renderStudyCard();
  showSection('study-play', { urlExtra: { index: 0 } });
}

/** 진행 중이던 학습 이어서 */
export function resumeStudy() {
  if (restoreStudySession()) {
    renderStudyCard();
    showSection('study-play', { urlExtra: { index: store.studyIndex } });
  } else {
    alert('이어서 학습할 내용이 없습니다.');
    renderStudySetup();
  }
}

/** 사이드바 「선택 카드」 → 현재 필터에 보이면서 선택된 카드만 학습 */
export function startSelectedStudy() {
  const order = document.getElementById('selectedStudyOrder')?.value || 'order';
  const selected = new Set(getState().selectedIds);
  let cards = getCardsFiltered(readFilters()).filter((c) => selected.has(c.id));
  if (order === 'random') cards = shuffle(cards);
  if (!cards.length) return alert('선택된 카드가 없습니다. 카드를 선택하거나 「전체 선택」을 누르세요.');

  const sess = getPersistedStudySession();
  if (sess?.cardIds?.length && !confirm('진행 중인 학습이 있습니다. 선택 카드로 새로 시작할까요?')) return;

  store.studyQueue = cards;
  store.studyIndex = 0;
  store._studyCardId = null;
  store.currentBlankStatuses = [];
  saveStudySession({ resetProgress: true });
  persist();
  renderStudyCard();
  showSection('study-play', { urlExtra: { index: 0 } });
}

export function studyOne(id) {
  const c = getCard(id);
  if (!c) return;

  const sess = getPersistedStudySession();
  if (sess?.cardIds?.length && !confirm('진행 중인 학습이 있습니다. 이 카드로 새로 시작할까요?')) return;

  store.studyQueue = [c];
  store.studyIndex = 0;
  store._studyCardId = null;
  store.currentBlankStatuses = [];
  saveStudySession({ resetProgress: true });
  persist();
  renderStudyCard();
  showSection('study-play', { urlExtra: { index: 0 } });
}

/** 빈칸 하나 채점 (Enter / 포커스 이탈 공용) */
export async function gradeBlank(order, { onlyIfPending = false, focusAfter = order } = {}) {
  const c = store.studyQueue[store.studyIndex];
  if (!c) return;
  syncDraftFromDOM();
  const user = getBlankInputValue(order);
  if (!user) return;

  let st = store.currentBlankStatuses.find((s) => s.order === order);
  if (!st) return;
  // 이미 같은 내용으로 채점됐으면 스킵 (Enter 직후 blur 등)
  if (onlyIfPending && st.checked && String(st.user ?? '').trim() === user) return;

  const threshold = getGradingThreshold();
  const blank = c.blanks.find((b) => b.order === order);
  const { correct, score } = checkAnswer(user, acceptedAnswers(blank), threshold);

  st.checked = true;
  st.correct = correct;
  st.score = score;
  st.user = user;
  st.revealed = true;

  if (blank) {
    blank.lastInput = user;
    blank.lastResult = correct ? 'correct' : 'wrong';
  }

  let roundedUp = false;
  if (store.currentBlankStatuses.every((s) => s.checked)) {
    roundedUp = applyCardResult(c, store.currentBlankStatuses);
  }

  // focusAfter: Enter는 같은 칸, 이탈 채점은 이동한 칸(없으면 포커스 복구 안 함)
  refreshStudyViews(focusAfter != null ? { focusOrder: focusAfter } : {});
  const ok = store.currentBlankStatuses.filter((s) => s.correct).length;
  const total = c.blanks.length;
  document.getElementById('gradeResult').textContent = correct
    ? `빈칸${order} 정답! (${ok}/${total})`
    : `빈칸${order} 오답 · ${score}% (${ok}/${total})`;

  saveStudySession();
  await persist();

  if (roundedUp) await celebrateRound(c, order);
}

/** @deprecated 이름 호환 — gradeBlank 사용 */
export function gradeBlankOnEnter(order) {
  return gradeBlank(order);
}

/** 빈칸에서 포커스가 나갈 때 — 내용 있고 미채점이면 채점 */
export function gradeBlankOnLeave(order, { focusAfter = null } = {}) {
  return gradeBlank(order, { onlyIfPending: true, focusAfter });
}

export async function gradeCurrent() {
  const c = store.studyQueue[store.studyIndex];
  if (!c) return;
  pushUndo();
  const threshold = getGradingThreshold();

  store.currentBlankStatuses = c.blanks.map((b) => {
    const user = getBlankInputValue(b.order);
    const { correct, score } = checkAnswer(user, acceptedAnswers(b), threshold);
    b.lastInput = user;
    b.lastResult = correct ? 'correct' : 'wrong';
    return { order: b.order, checked: true, correct, score, user, revealed: true };
  });

  const roundedUp = applyCardResult(c, store.currentBlankStatuses);
  refreshStudyViews();
  const ok = store.currentBlankStatuses.filter((s) => s.correct).length;
  document.getElementById('gradeResult').textContent = `전체 채점 ${ok}/${store.currentBlankStatuses.length}`;
  saveStudySession();
  await persist();
  renderAll();

  if (roundedUp) {
    const lastOrder = store.currentBlankStatuses[store.currentBlankStatuses.length - 1]?.order;
    await celebrateRound(c, lastOrder);
  }
}

/**
 * 카드 1회 시도 결과 반영.
 * lastResult는 '지금 상태'라 매번 갱신하고, 누적 카운터(rounds·wrongCount)는
 * 시도당 1회만 올린다. 「다시 풀기」로 시도가 리셋되면 다시 집계된다.
 * @returns {boolean} 이번 호출로 회독이 올라갔는지
 */
function applyCardResult(c, statuses) {
  const allCorrect = statuses.every((s) => s.correct);
  c.lastResult = allCorrect ? 'correct' : 'wrong';

  if (!allCorrect) {
    if (!store.studyAttemptRecorded) c.wrongCount = (c.wrongCount || 0) + 1;
    store.studyAttemptRecorded = true;
    return false;
  }

  store.studyAttemptRecorded = true;
  if (store.studyRoundRecorded) return false;
  store.studyRoundRecorded = true;
  c.rounds = Math.max(0, (c.rounds || 0) + 1);
  c.updatedAt = new Date().toISOString();
  return true;
}

/** 회독 +1 알림 → 다음 문제(또는 세트 완료) 안내 */
async function celebrateRound(card, order) {
  renderAll();
  await showRoundToast(order);
  await promptAfterRound(card);
}

/** 토스트가 뜬 사이 답을 고쳤을 수 있으므로 다시 확인하고 안내한다 */
async function promptAfterRound(card) {
  if (store.studyQueue[store.studyIndex]?.id !== card.id) return;
  const statuses = store.currentBlankStatuses;
  if (!statuses.length || !statuses.every((s) => s.checked && s.correct)) return;

  if (store.studyIndex >= store.studyQueue.length - 1) {
    await finishStudySet({ completed: true });
    return;
  }

  const pick = await openChoice({
    title: '다음 문제로 넘어가시겠습니까?',
    message: `${store.studyIndex + 1}/${store.studyQueue.length}장 완료`,
    choices: [
      { value: 'next', label: '확인' },
      { value: null, label: '취소' },
    ],
  });
  if (pick === 'next') nextCard();
}

/** 학습 세트의 끝 — 다음 행동을 고르게 하고, 화면을 떠날 때만 저장된 진행을 정리 */
async function finishStudySet({ completed = false } = {}) {
  if (!store.studyQueue.length) return;
  const total = store.studyQueue.length;

  const pick = await openChoice({
    title: completed ? '학습을 모두 마쳤습니다' : '마지막 문제입니다',
    message: completed
      ? `${total}장을 끝냈습니다. 이어서 무엇을 할까요?`
      : `${total}장 중 마지막입니다. 지금 학습을 마칠까요?`,
    choices: [
      { value: 'manage', label: '홈으로' },
      { value: 'study', label: '학습모드로' },
      { value: null, label: '취소' },
    ],
  });
  if (!pick) return;

  clearStudySession();
  await persist();
  showSection(pick === 'manage' ? 'manage' : 'study');
  renderStudyCard();
  renderAll();
}

export function hideAnswers() {
  const c = store.studyQueue[store.studyIndex];
  if (!c) return;
  // 입력·채점 모두 초기화. DOM을 먼저 비운 뒤 저장해야 syncDraftFromDOM이 옛 값을 다시 안 넣음.
  store.currentBlankStatuses = c.blanks.map((b) => ({
    order: b.order, checked: false, correct: false, score: 0, user: '', revealed: false,
  }));
  c.blanks.forEach((b) => {
    b.lastInput = '';
    b.lastResult = null;
    b.manualResult = null;
  });
  store.studyAttemptRecorded = false;
  store.studyRoundRecorded = false;
  store._studyCardId = c.id;
  store.currentBlankFocus = null;
  renderStudyCard();
  saveStudySession();
  persist();
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
    snapshotCurrentCardProgress();
    store.studyIndex--;
    store._studyCardId = null;
    store.currentBlankStatuses = [];
    saveStudySession();
    persist();
    renderStudyCard();
    showSection('study-play', { urlExtra: { index: store.studyIndex }, replaceUrl: true });
  }
}

export function nextCard() {
  if (store.studyIndex >= store.studyQueue.length - 1) {
    finishStudySet();
    return;
  }
  snapshotCurrentCardProgress();
  store.studyIndex++;
  store._studyCardId = null;
  store.currentBlankStatuses = [];
  saveStudySession();
  persist();
  renderStudyCard();
  showSection('study-play', { urlExtra: { index: store.studyIndex }, replaceUrl: true });
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
  if (scope === 'folder') {
    openExportFolderPicker((folderId) => {
      const r = exportData('folder', folderId);
      if (!r?.ok) alert(r?.reason || '내보내기에 실패했습니다.');
    });
    return;
  }
  const r = exportData(scope, store.activeFolderId);
  if (!r?.ok) alert(r?.reason || '내보내기에 실패했습니다.');
}

export async function handleImport(file) {
  if (!file) return;
  let kind;
  let data;
  try {
    ({ kind, data } = await readImportFile(file));
  } catch (err) {
    alert(err.message || '가져오기에 실패했습니다.');
    return;
  }

  try {
    if (kind === 'folder') await importSharedFolder(data);
    else await importUsers(kind, data);
  } catch (err) {
    alert(err.message || '가져오기에 실패했습니다.');
  }
}

async function importSharedFolder(data) {
  if (!getActiveUser()) {
    alert('로그인한 뒤에 폴더를 가져올 수 있습니다.');
    return;
  }

  const desc = describeImport('folder', data);
  const preview = previewFolderImport(data);
  const dupes = preview.duplicates;
  const renameNote = preview.finalName !== preview.rootName
    ? `\n폴더 이름이 겹쳐 「${preview.finalName}」로 들어옵니다.`
    : '';

  let skipDuplicates = true;
  if (dupes.length) {
    const pick = await openChoice({
      title: desc.title,
      message: `${desc.message}${renameNote}\n\n이미 가지고 있는 카드 ${dupes.length}장이 있습니다. 제목·해설·빈칸이 같습니다.`,
      items: dupes.map((c) => c.title || '(제목 없음)'),
      choices: [
        { value: 'skip', label: '중복은 건너뛰기' },
        { value: 'keep', label: '중복도 가져오기' },
        { value: null, label: '취소' },
      ],
    });
    if (!pick) return;
    skipDuplicates = pick === 'skip';
  } else {
    const pick = await openChoice({
      title: desc.title,
      message: `${desc.message}${renameNote}`,
      choices: [
        { value: 'ok', label: '가져오기' },
        { value: null, label: '취소' },
      ],
    });
    if (pick !== 'ok') return;
  }

  pushUndo();
  const r = applyFolderImport(data, { skipDuplicates });
  await saveState();
  renderStudyCard();
  renderAll();

  const lines = [`카드 ${r.added}장을 가져왔습니다.`];
  if (r.skipped) lines.push(`중복 ${r.skipped}장은 건너뛰었습니다.`);
  if (r.renamedRoot) lines.push(`폴더 이름이 겹쳐 「${r.renamedRoot.to}」로 들어왔습니다.`);
  alert(lines.join('\n'));
}

async function importUsers(kind, data) {
  if (!(data.users || []).length) {
    alert('파일에 사용자 정보가 없습니다.');
    return;
  }

  const desc = describeImport(kind, data);
  const preview = previewUsersImport(data);
  const renames = preview.users.filter((u) => u.fromName !== u.finalName);
  const renameNote = renames.length
    ? `\n이름이 겹쳐 ${renames.map((u) => `「${u.fromName}」→「${u.finalName}」`).join(', ')}로 들어옵니다.`
    : '';

  const pick = await openChoice({
    title: desc.title,
    message: `${desc.message}${renameNote}\n기존 계정은 그대로 두고, 새 계정을 추가합니다.`,
    items: preview.users.map((u) => u.finalName),
    choices: [
      { value: 'ok', label: '가져오기' },
      { value: null, label: '취소' },
    ],
  });
  if (pick !== 'ok') return;

  const wasLoggedIn = store.authenticatedUserId;
  pushUndo();
  const r = applyUsersImport(data);
  await saveState();
  renderStudyCard();
  renderAll();

  // 기존 세션은 유지. 가져온 계정만 PIN 설정 큐에 넣고, 끝나면 원래 계정으로 돌아온다.
  const importedIds = r.users.map((u) => u.id);
  store.pinSetupQueue = importedIds.slice(1);
  store.pinSetupResumeUserId = wasLoggedIn || importedIds[0];
  const first = getState().users.find((u) => u.id === importedIds[0]);
  if (first) showPinSetup(first.id, first.name);
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
export {
  handleBlankPeekOver,
  handleBlankPeekOut,
  handleBlankPeekMove,
  armBlankPeekSticky,
  retainBlankPeekAfterEdit,
  resetBlankGradeIfEdited,
};
