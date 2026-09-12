/**
 * 앱 진입점 — 초기화, hash 라우팅, 이벤트 위임
 */
import { setState, store } from './core/store.js';
import { loadState, persist } from './core/storage.js';
import { migrateState } from './domain/migrate.js';
import { parseRoute, navigate, syncUrl } from './core/hash-router.js';
import { showSection, toggleSidebar, applySidebarState, toggleStudyPrompt, applyStudyPromptState, toggleMobileMenu, closeMobileMenu, handleViewportChange, syncSidebarHeightToMain } from './ui/router.js';
import { renderAll, renderManageDetail, renderStudyCard, renderCreateForm } from './ui/render.js';
import { getCard } from './domain/queries.js';
import { showAuthOverlay, renderAuthUserLists, setAuthTab, showAuthMessage } from './ui/auth.js';
import {
  ensureAlphaAccess,
  submitAlphaGateCode,
  getPendingAlphaPlanner,
  isAlphaGateVisible,
} from './ui/alpha-gate.js';
import { formatProblemHtml } from './ui/prompt.js';
import * as actions from './app/actions.js';
import { chipRemoveEl, chipSetAliases } from './ui/chip-editor.js';
import { closeModal } from './ui/modal.js';
import { renderPatchPage } from './ui/patch-notes.js';
import { initCaretAutoscroll } from './ui/caret-scroll.js';
import { saveStudySession } from './services/study-session.js';
import { syncThresholdControls, setGradingThreshold, layoutBlankAnswersSoon, watchBlankAnswerLayout } from './ui/study.js';
import {
  blankFieldText,
  normalizeBlankFieldDom,
  syncBlankRest,
  focusBlankField,
} from './ui/blank-input.js';
import { handleOutlineModalAction, closeOutlineModal, isOutlineModalOpen } from './ui/outline-modal.js';
import { toggleOutlineSummary, openExplanationFocus, closeExplanationFocus, isExplanationFocus } from './ui/create.js';
import { actionGuardKey, runGuardedClick } from './utils/action-guard.js';

/** hash → 화면 (뒤로가기) */
function handleHashRoute(fromInit = false) {
  const route = parseRoute();

  if (route.page === 'manage') {
    showSection('manage', { fromHash: true });
    if (!fromInit) renderAll();
    return;
  }

  if (route.page === 'patch') {
    showSection('patch', { fromHash: true });
    renderPatchPage();
    return;
  }

  if (route.page === 'create') {
    showSection('create', { fromHash: true, urlExtra: { cardId: route.cardId } });
    const draft = store.data.ui.createDraft;
    if (route.cardId) {
      const c = getCard(route.cardId);
      if (draft && draft.id === route.cardId) renderCreateForm(draft);
      else renderCreateForm(c || null);
    } else if (draft && !draft.id) {
      renderCreateForm(draft);
    } else if (!fromInit) {
      renderCreateForm(null);
    }
    if (!fromInit) renderAll();
    return;
  }

  if (route.page === 'study') {
    showSection('study', { fromHash: true });
    if (!fromInit) renderAll();
    return;
  }

  if (route.page === 'study-play') {
    if (actions.restoreStudySession(route.index)) {
      showSection('study-play', { fromHash: true, urlExtra: { index: store.studyIndex } });
      renderStudyCard();
    } else {
      syncUrl('study', {}, true);
      showSection('study', { fromHash: true });
      renderStudyCard();
    }
    if (!fromInit) renderAll();
    return;
  }
}

async function init() {
  bindEvents();

  // 알파 테스터 관문 — 통과 전에는 앱/로그인 UI로 진행하지 않음
  const alpha = await ensureAlphaAccess();
  if (!alpha.ok) return;

  try {
    const saved = await loadState();
    setState(migrateState(saved));
  } catch {
    setState(migrateState(null));
  }

  syncThresholdControls();
  applySidebarState();
  applyStudyPromptState();
  watchBlankAnswerLayout();

  const sessionRestored = actions.restoreSession();

  if (!sessionRestored) {
    const users = store.data.users;
    showAuthOverlay(users.length ? 'login' : 'register');
    renderAuthUserLists();
  }

  if (!location.hash) {
    navigate('/manage', { replace: true });
  }

  handleHashRoute(true);

  try {
    renderAll();
    renderManageDetail(null);
    if (!store.studyQueue.length) renderStudyCard();
  } catch (err) {
    console.error(err);
    if (!store.authenticatedUserId) {
      showAuthOverlay(store.data.users.length ? 'login' : 'register');
    }
    showAuthMessage(`화면 초기화 오류: ${err.message}`, 'error');
  }

  // 카드제작 자동 저장 (5분마다)
  setInterval(() => { actions.autoSaveCreate(); }, 5 * 60 * 1000);

  window.addEventListener('resize', handleViewportChange);
  window.addEventListener('resize', () => syncSidebarHeightToMain());
  // 폭이 바뀌면 빈칸의 마지막 줄 위치가 달라져 정답 표시를 다시 앉혀야 한다.
  window.addEventListener('resize', () => layoutBlankAnswersSoon());
  document.addEventListener('paste', onBlankPaste);
  document.addEventListener('mousedown', onBlankWrapMouseDown);
  document.addEventListener('compositionend', onBlankCompositionEnd);
}

function bindEvents() {
  window.addEventListener('hashchange', () => handleHashRoute(false));
  window.addEventListener('popstate', () => handleHashRoute(false));

  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('input', onInput);
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('focusout', onBlankFocusOut);
  document.addEventListener('mouseover', actions.handleBlankPeekOver);
  document.addEventListener('mouseout', actions.handleBlankPeekOut);
  document.addEventListener('mousemove', actions.handleBlankPeekMove);
  initCaretAutoscroll();

  const folderTree = document.getElementById('folderTree');
  const folderPanel = document.getElementById('folderPanel');

  const isCardDrag = (dt) => [...dt.types].includes('text/card-id');
  const isFolderDrag = (dt) => [...dt.types].includes('text/folder-id');
  const onFolderNode = (el) => el?.closest('[data-folder-id]');

  const clearDropTargets = () => {
    document.querySelectorAll('.tree-node.drop-target, .folder-panel.drop-target-root')
      .forEach((n) => n.classList.remove('drop-target', 'drop-target-root'));
  };

  /** 폴더 패널 빈 배경 — 카드 미분류 · 폴더 루트 이동 (개별 폴더 행 제외) */
  folderPanel.addEventListener('dragover', (e) => {
    if (onFolderNode(e.target)) return;
    if (!isCardDrag(e.dataTransfer) && !isFolderDrag(e.dataTransfer)) return;
    e.preventDefault();
    clearDropTargets();
    folderPanel.classList.add('drop-target-root');
  });
  folderPanel.addEventListener('dragleave', (e) => {
    if (folderPanel.contains(e.relatedTarget) && !onFolderNode(e.relatedTarget)) return;
    folderPanel.classList.remove('drop-target-root');
  });
  folderPanel.addEventListener('drop', (e) => {
    if (onFolderNode(e.target)) return;
    e.preventDefault();
    clearDropTargets();
    const folderDragId = e.dataTransfer.getData('text/folder-id');
    if (folderDragId) {
      actions.moveFolder(folderDragId, null);
      return;
    }
    const cardId = e.dataTransfer.getData('text/card-id');
    if (cardId) actions.dropCardOnFolder(cardId, null);
  });

  folderTree.addEventListener('dragstart', (e) => {
    if (e.target.closest('[data-action="toggle-tree"]')) {
      e.preventDefault();
      return;
    }
    const hit = e.target.closest('[data-drag-folder]');
    if (!hit) return;
    e.dataTransfer.setData('text/folder-id', hit.dataset.dragFolder);
    e.dataTransfer.effectAllowed = 'move';
    hit.closest('.tree-node')?.classList.add('folder-dragging');
    window.getSelection()?.removeAllRanges();
  });
  folderTree.addEventListener('dragend', () => {
    document.querySelectorAll('.tree-node.folder-dragging').forEach((n) => n.classList.remove('folder-dragging'));
    clearDropTargets();
  });

  folderTree.addEventListener('dragover', (e) => {
    if (![...e.dataTransfer.types].includes('text/folder-id')
      && ![...e.dataTransfer.types].includes('text/card-id')) return;
    const node = e.target.closest('[data-folder-id]');
    if (!node) return;
    e.preventDefault();
    clearDropTargets();
    node.classList.add('drop-target');
  });
  folderTree.addEventListener('dragleave', (e) => {
    const node = e.target.closest('[data-folder-id]');
    if (node && !node.contains(e.relatedTarget)) node.classList.remove('drop-target');
  });
  folderTree.addEventListener('drop', (e) => {
    const node = e.target.closest('[data-folder-id]');
    if (!node) return;
    e.preventDefault();
    clearDropTargets();
    const folderDragId = e.dataTransfer.getData('text/folder-id');
    if (folderDragId) {
      actions.moveFolder(folderDragId, node.dataset.folderId);
      return;
    }
    const cardId = e.dataTransfer.getData('text/card-id');
    if (cardId) actions.dropCardOnFolder(cardId, node.dataset.folderId);
  });

  document.getElementById('cardList').addEventListener('dragstart', (e) => {
    const item = e.target.closest('[data-drag-card]');
    if (!item) return;
    const id = item.dataset.dragCard;
    e.dataTransfer.setData('text/card-id', id);
    e.dataTransfer.effectAllowed = 'move';
    item.classList.add('dragging');
    window.getSelection()?.removeAllRanges();
  });
  document.getElementById('cardList').addEventListener('dragend', (e) => {
    e.target.closest('[data-drag-card]')?.classList.remove('dragging');
    clearDropTargets();
  });
}

function runAuthAction(fn) {
  const result = fn();
  if (result?.catch) {
    result.catch((err) => {
      console.error(err);
      showAuthMessage(err?.message || '처리 중 오류가 발생했습니다.', 'error');
    });
  }
}

function onClick(e) {
  const chipX = e.target.closest('.cz-chip-x');
  if (chipX) {
    e.preventDefault();
    chipRemoveEl(chipX.closest('.cz-chip'));
    return;
  }

  const backdrop = e.target.closest('.modal-backdrop');
  if (backdrop && e.target === backdrop) {
    closeModal();
    closeOutlineModal();
    return;
  }

  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  const map = {
    'toggle-sidebar': () => toggleSidebar(),
    'toggle-study-prompt': () => { toggleStudyPrompt(); layoutBlankAnswersSoon(); },
    'toggle-mobile-menu': () => toggleMobileMenu(),
    'close-mobile-menu': () => closeMobileMenu(),
    'nav-manage': () => { showSection('manage'); renderAll(); },
    'nav-create': () => actions.goCreate(),
    'nav-study': () => { showSection('study'); renderAll(); },
    'nav-patch': () => { showSection('patch'); renderPatchPage(); },
    'export-all': () => actions.handleExport('all'),
    'export-user': () => actions.handleExport('user'),
    'export-folder': () => actions.handleExport('folder'),
    'undo': () => actions.undoAppState(),
    'auth-login': () => runAuthAction(actions.loginUser),
    'auth-register': () => runAuthAction(actions.registerUser),
    'auth-setup': () => runAuthAction(actions.setupUserPin),
    'auth-tab-login': () => { setAuthTab('login'); showAuthMessage(''); },
    'auth-tab-register': () => { setAuthTab('register'); showAuthMessage(''); },
    'alpha-gate-submit': () => {
      submitAlphaGateCode(getPendingAlphaPlanner());
    },
    'logout': () => runAuthAction(actions.logoutUser),
    'rename-user': () => actions.renameUser(),
    'delete-user': () => actions.deleteUser(),
    'select-all': () => actions.selectFiltered(true),
    'deselect-all': () => actions.selectFiltered(false),
    'new-card': () => actions.startNewCard(),
    'pick-flag': () => actions.pickCardFlag(Number(btn.dataset.flag)),
    'save-card': () => actions.saveCard(),
    'delete-card-form': () => actions.deleteCurrentCard(),
    'make-blank': () => actions.makeBlankFromSelection(btn.dataset.editor),
    'remove-blank': () => actions.removeBlankFromSelection(btn.dataset.editor),
    'remove-blank-order': () => actions.removeBlankByOrder(btn.dataset.editor, Number(btn.dataset.order)),
    'jump-blank': () => actions.jumpToBlank(btn.dataset.editor, Number(btn.dataset.order)),
    'auto-blank': () => actions.openAutoBlank(btn.dataset.editor),
    'remove-all-blanks': () => actions.removeAllBlanks(btn.dataset.editor),
    'quick-auto-blank': () => actions.confirmQuickAutoBlank(btn.dataset.editor, Number(btn.dataset.limit || 5)),
    'outline-blank-all': () => actions.applyOutlineBlanksAll(),
    'outline-blank-selected': () => actions.applyOutlineBlanksSelected(),
    'outline-unblank': () => actions.removeOutlineBlanks(),
    'open-outline': () => actions.openOutlineManager(),
    'toggle-outline-summary': () => toggleOutlineSummary(),
    'open-explanation-focus': () => openExplanationFocus(),
    'close-explanation-focus': () => closeExplanationFocus(),
    'outline-run-preview': () => { handleOutlineModalAction('outline-run-preview'); },
    'outline-adopt-preview': () => { handleOutlineModalAction('outline-adopt-preview'); },
    'outline-item-del': () => { handleOutlineModalAction('outline-item-del', btn); },
    'apply-outline': () => { handleOutlineModalAction('apply-outline'); },
    'outline-modal-cancel': () => { handleOutlineModalAction('outline-modal-cancel'); },
    'start-study': () => actions.startStudy(),
    'resume-study': () => actions.resumeStudy(),
    'study-manage-folder': () => actions.startStudyFromManageFolder(),
    'study-setup-select-all': () => actions.selectStudySetupAll(true),
    'study-setup-deselect-all': () => actions.selectStudySetupAll(false),
    'pick-study-folder': () => actions.openStudyFolderModal(),
    'pick-study-cards': () => actions.openStudyCardModal(),
    'pick-study-flag': () => actions.pickStudyFlag(Number(btn.dataset.flag)),
    'filter-flag': () => actions.pickFilterFlag(btn.dataset.flag),
    'start-selected-study': () => actions.startSelectedStudy(),
    'grade': () => actions.gradeCurrent(),
    'hide-answers': () => actions.hideAnswers(),
    'save-memo': () => actions.saveStudyMemo(),
    'save-study-edit': () => actions.saveStudyEdits(),
    'round-minus': () => actions.adjustRounds(-1),
    'round-plus': () => actions.adjustRounds(1),
    'prev-card': () => actions.prevCard(),
    'next-card': () => actions.nextCard(),
    'edit-study-card': () => actions.editCurrentStudyCard(),
    'toggle-tree': () => actions.toggleTree(btn.dataset.id),
    'select-folder': () => actions.selectFolder(btn.dataset.id),
    'create-folder': () => actions.createFolder(btn.dataset.parent || null),
    'rename-folder': () => actions.renameFolder(btn.dataset.id),
    'delete-folder': () => actions.deleteFolder(btn.dataset.id),
    'select-card': () => renderManageDetail(btn.dataset.id),
    'edit-card': () => actions.editCard(btn.dataset.id),
    'study-one': () => actions.studyOne(btn.dataset.id),
    'delete-card': () => actions.deleteCardById(btn.dataset.id),
    'focus-blank': () => actions.focusBlank(Number(btn.dataset.order)),
    'expand-tree': () => actions.expandAllTree(true),
    'collapse-tree': () => actions.expandAllTree(false),
    'create-root-folder': () => actions.createFolder(null),
    'select-root-folder': () => actions.selectFolder(null),
    'apply-auto-blank': () => actions.applyAutoBlank(),
    'close-modal': () => closeModal(),
  };

  if (isOutlineModalOpen() && btn.closest('.outline-modal')) {
    if (map[action]) {
      e.preventDefault();
      const key = actionGuardKey(action, btn);
      runGuardedClick(key, () => map[action]());
    }
    return;
  }

  if (map[action]) {
    e.preventDefault();
    const key = actionGuardKey(action, btn);
    runGuardedClick(key, () => map[action]());
  }
}

function onChange(e) {
  if (e.target.id === 'importFile') actions.handleImport(e.target.files?.[0]).then(() => { e.target.value = ''; });
  if (e.target.dataset.action === 'toggle-select') actions.toggleSelected(e.target.dataset.id, e.target.checked);
  if (e.target.dataset.action === 'toggle-study-setup-card') {
    actions.toggleStudySetupCard(e.target.dataset.id, e.target.checked);
  }
  if (e.target.dataset.action === 'move-card-folder') actions.moveCardFolder(e.target.dataset.cardId, e.target.value);
  if (['searchInput', 'wrongFilter'].includes(e.target.id)) renderAll();
  if (e.target.id === 'filterFolderSelect') actions.onFilterFolderChange();
  if (['studyScope', 'studyOrder'].includes(e.target.id)) actions.onStudyConfigChange();
  if (e.target.id === 'gradingThreshold' || e.target.id === 'gradingThresholdPlay') {
    setGradingThreshold(Number(e.target.value));
    persist();
  }
}

/** 빈칸 포커스 이탈 → 미채점이면 채점 (탭·다른 빈칸 클릭 등) */
function onBlankFocusOut(e) {
  const input = e.target;
  if (!input?.matches?.('.blank-field')) return;
  if (store.currentSection !== 'study-play') return;
  if (input.isComposing || e.isComposing) return;
  normalizeBlankFieldDom(input);
  const order = Number(input.dataset.blankOrder);
  if (!Number.isFinite(order)) return;
  const nextOrder = e.relatedTarget?.matches?.('.blank-field')
    ? Number(e.relatedTarget.dataset.blankOrder)
    : null;
  queueMicrotask(() => {
    actions.gradeBlankOnLeave(order, {
      focusAfter: Number.isFinite(nextOrder) ? nextOrder : null,
    });
  });
}

/** ○○○ 마스크 클릭해도 입력칸으로 포커스 */
function onBlankWrapMouseDown(e) {
  const wrap = e.target.closest?.('.blank-wrap');
  if (!wrap || store.currentSection !== 'study-play') return;
  const field = wrap.querySelector('.blank-field');
  if (!field) return;
  if (e.target === field || field.contains(e.target)) return;
  e.preventDefault();
  focusBlankField(field);
}

function onBlankPaste(e) {
  const el = e.target?.closest?.('.blank-field');
  if (!el) return;
  e.preventDefault();
  const text = String(e.clipboardData?.getData('text/plain') || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ');
  document.execCommand('insertText', false, text);
  syncBlankRest(el);
}

function onBlankCompositionEnd(e) {
  if (!e.target?.matches?.('.blank-field')) return;
  normalizeBlankFieldDom(e.target, { dropGradedColors: true });
}

function onInput(e) {
  if (e.target.id === 'promptTemplate') {
    document.getElementById('promptPreview').innerHTML = formatProblemHtml(e.target.value);
    return;
  }
  if (e.target.id === 'explanationTemplate') { actions.onCreateInput(); return; }
  if (e.target.id === 'studyEditExplanation') { actions.onStudyEditInput(); return; }
  if (e.target.matches('input[data-alias-for]')) {
    chipSetAliases(e.target.dataset.editor, Number(e.target.dataset.aliasFor), e.target.value);
    return;
  }
  if (e.target.matches('.blank-field')) {
    actions.armBlankPeekSticky(e.target);
    if (!e.isComposing) normalizeBlankFieldDom(e.target, { dropGradedColors: true });
    else syncBlankRest(e.target);
    const order = Number(e.target.dataset.blankOrder);
    actions.resetBlankGradeIfEdited(order, blankFieldText(e.target));
    actions.retainBlankPeekAfterEdit(e.target);
    clearTimeout(onInput._blankSave);
    onInput._blankSave = setTimeout(() => { saveStudySession(); persist(); }, 500);
  }
  if (e.target.id === 'gradingThreshold' || e.target.id === 'gradingThresholdPlay') {
    setGradingThreshold(Number(e.target.value));
    return;
  }
  if (['searchInput'].includes(e.target.id)) renderAll();
}

function onKeydown(e) {
  const active = document.activeElement;
  const isBlankField = active?.matches?.('[data-blank-order]');

  if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    actions.undoAppState();
    return;
  }

  if (e.key === 'Escape' && isExplanationFocus()) {
    if (document.querySelector('#modalRoot .modal-backdrop')) return;
    e.preventDefault();
    closeExplanationFocus();
    return;
  }

  if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
    // 브라우저 기본 저장(페이지 저장) 막고, 카드제작은 바로 저장
    e.preventDefault();
    if (store.currentSection === 'create') {
      runGuardedClick('save-card', () => actions.saveCard());
    }
    return;
  }

  if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b') {
    if (active?.classList?.contains('chip-editor')) {
      e.preventDefault();
      actions.makeBlankFromSelection(active.id);
      return;
    }
  }

  // 글을 쓰는 중에는 플래그 단축키가 화면 밖 카드에 찍힐 수 있어 제외
  const isTyping = active?.matches?.('input:not([type="range"]), textarea, [contenteditable="true"]');
  if (e.ctrlKey && !e.altKey && !e.shiftKey && /^[0-7]$/.test(e.key) && !isTyping) {
    e.preventDefault();
    actions.applyFlag(Number(e.key));
    return;
  }

  if (isBlankField && e.key === 'Enter') {
    e.preventDefault();
    actions.gradeBlank(Number(active.dataset.blankOrder));
    return;
  }

  if (document.getElementById('authOverlay') && !document.getElementById('authOverlay').classList.contains('hidden')) {
    if (e.isComposing) return;
    if (e.key === 'Enter' && active?.matches?.('#authName, #loginPin, #registerPinConfirm, #setupPinConfirm, #registerPin, #setupPin')) {
      e.preventDefault();
      const tab = store.authTab;
      if (tab === 'login') actions.loginUser();
      else if (tab === 'register') actions.registerUser();
      else if (tab === 'setup') actions.setupUserPin();
      return;
    }
  }

  if (isAlphaGateVisible() && e.key === 'Enter' && !e.isComposing) {
    if (active?.matches?.('#alphaGateCode')) {
      e.preventDefault();
      submitAlphaGateCode(getPendingAlphaPlanner());
    }
  }
}

init();
