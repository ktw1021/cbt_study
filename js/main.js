/**
 * 앱 진입점 — 초기화, hash 라우팅, 이벤트 위임
 */
import { setState, store } from './core/store.js';
import { loadState, persist } from './core/storage.js';
import { migrateState } from './domain/migrate.js';
import { parseRoute, navigate, syncUrl } from './core/hash-router.js';
import { showSection, toggleSidebar, applySidebarState, toggleMobileMenu, closeMobileMenu, handleViewportChange } from './ui/router.js';
import { renderAll, renderManageDetail, renderStudyCard, renderCreateForm } from './ui/render.js';
import { getCard } from './domain/queries.js';
import { showAuthOverlay, renderAuthUserLists, setAuthTab, showAuthMessage } from './ui/auth.js';
import { formatProblemHtml } from './ui/prompt.js';
import * as actions from './app/actions.js';
import { closeModal } from './ui/modal.js';

/** hash → 화면 (뒤로가기) */
function handleHashRoute(fromInit = false) {
  const route = parseRoute();

  if (route.page === 'manage') {
    showSection('manage', { fromHash: true });
    if (!fromInit) renderAll();
    return;
  }

  if (route.page === 'create') {
    showSection('create', { fromHash: true, urlExtra: { cardId: route.cardId } });
    if (route.cardId) {
      const c = getCard(route.cardId);
      if (c) renderCreateForm(c);
      else renderCreateForm(null);
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

  try {
    const saved = await loadState();
    setState(migrateState(saved));
  } catch {
    setState(migrateState(null));
  }

  document.getElementById('gradingThreshold').value = store.data.settings.gradingThreshold;
  applySidebarState();

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

  window.addEventListener('resize', handleViewportChange);
}

function bindEvents() {
  window.addEventListener('hashchange', () => handleHashRoute(false));
  window.addEventListener('popstate', () => handleHashRoute(false));

  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('input', onInput);
  document.addEventListener('keydown', onKeydown);

  document.getElementById('folderTree').addEventListener('dragover', (e) => {
    const node = e.target.closest('[data-folder-id]');
    if (node) { e.preventDefault(); node.classList.add('drop-target'); }
  });
  document.getElementById('folderTree').addEventListener('dragleave', (e) => {
    const node = e.target.closest('[data-folder-id]');
    if (node) node.classList.remove('drop-target');
  });
  document.getElementById('folderTree').addEventListener('drop', (e) => {
    const node = e.target.closest('[data-folder-id]');
    if (!node) return;
    e.preventDefault();
    node.classList.remove('drop-target');
    const cardId = e.dataTransfer.getData('text/card-id');
    if (cardId) actions.dropCardOnFolder(cardId, node.dataset.folderId);
  });

  document.getElementById('cardList').addEventListener('dragstart', (e) => {
    const item = e.target.closest('[data-drag-card]');
    if (!item) return;
    e.dataTransfer.setData('text/card-id', item.dataset.dragCard);
    item.classList.add('dragging');
  });
  document.getElementById('cardList').addEventListener('dragend', (e) => {
    e.target.closest('[data-drag-card]')?.classList.remove('dragging');
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
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  const map = {
    'toggle-sidebar': () => toggleSidebar(),
    'toggle-mobile-menu': () => toggleMobileMenu(),
    'close-mobile-menu': () => closeMobileMenu(),
    'nav-manage': () => showSection('manage'),
    'nav-create': () => actions.startNewCard(),
    'nav-study': () => showSection('study'),
    'export-all': () => actions.handleExport('all'),
    'export-user': () => actions.handleExport('user'),
    'export-folder': () => actions.handleExport('folder'),
    'undo': () => actions.undoAppState(),
    'auth-login': () => runAuthAction(actions.loginUser),
    'auth-register': () => runAuthAction(actions.registerUser),
    'auth-setup': () => runAuthAction(actions.setupUserPin),
    'auth-tab-login': () => { setAuthTab('login'); showAuthMessage(''); },
    'auth-tab-register': () => { setAuthTab('register'); showAuthMessage(''); },
    'logout': () => runAuthAction(actions.logoutUser),
    'rename-user': () => actions.renameUser(),
    'delete-user': () => actions.deleteUser(),
    'select-all': () => actions.selectFiltered(true),
    'deselect-all': () => actions.selectFiltered(false),
    'delete-sample': () => actions.deleteSampleData(),
    'new-card': () => actions.startNewCard(),
    'save-card': () => actions.saveCard(),
    'delete-card-form': () => actions.deleteCurrentCard(),
    'make-blank': () => actions.makeBlankFromSelection(btn.dataset.editor),
    'remove-blank': () => actions.removeBlankFromSelection(btn.dataset.editor),
    'remove-blank-order': () => actions.removeBlankByOrder(btn.dataset.editor, Number(btn.dataset.order)),
    'jump-blank': () => actions.jumpToBlank(btn.dataset.editor, Number(btn.dataset.order)),
    'auto-blank': () => actions.openAutoBlank(btn.dataset.editor),
    'quick-auto-blank': () => actions.applyQuickAutoBlank(btn.dataset.editor, Number(btn.dataset.limit || 5)),
    'start-study': () => actions.startStudy(),
    'grade': () => actions.gradeCurrent(),
    'hide-answers': () => actions.hideAnswers(),
    'save-memo': () => actions.saveStudyMemo(),
    'save-study-edit': () => actions.saveStudyEdits(),
    'round-minus': () => actions.adjustRounds(-1),
    'round-plus': () => actions.adjustRounds(1),
    'prev-card': () => actions.prevCard(),
    'next-card': () => actions.nextCard(),
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
    'close-modal': () => closeModal(),
    'apply-auto-blank': () => actions.applyAutoBlank(),
  };

  if (action === 'close-modal' && e.target === btn && btn.classList.contains('modal-backdrop')) {
    closeModal();
    return;
  }

  if (map[action]) {
    e.preventDefault();
    map[action]();
  }
}

function onChange(e) {
  if (e.target.id === 'importFile') actions.handleImport(e.target.files?.[0]).then(() => { e.target.value = ''; });
  if (e.target.dataset.action === 'toggle-select') actions.toggleSelected(e.target.dataset.id, e.target.checked);
  if (e.target.dataset.action === 'move-card-folder') actions.moveCardFolder(e.target.dataset.cardId, e.target.value);
  if (['searchInput', 'flagFilter', 'wrongFilter'].includes(e.target.id)) renderAll();
  if (e.target.id === 'gradingThreshold') {
    store.data.settings.gradingThreshold = Number(e.target.value);
    persist();
    renderAll();
  }
}

function onInput(e) {
  if (e.target.id === 'promptTemplate') {
    document.getElementById('promptPreview').innerHTML = formatProblemHtml(e.target.value);
    return;
  }
  if (e.target.id === 'explanationTemplate' || e.target.matches('[data-answer-key]')) actions.onCreateInput();
  if (e.target.id === 'studyEditExplanation' || e.target.matches('[data-study-answer-key]')) actions.renderStudyEditPreview();
  if (e.target.matches('input.blank-field')) {
    const n = Math.max(e.target.placeholder?.length || 0, e.target.value.length, 1);
    e.target.style.width = `${n}em`;
  }
  if (['searchInput'].includes(e.target.id)) renderAll();
}

function onKeydown(e) {
  const active = document.activeElement;
  const isText = active && (active.tagName === 'TEXTAREA' || (active.tagName === 'INPUT' && active.type === 'text'));
  const isBlankField = active?.matches?.('[data-blank-order]');

  if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    actions.undoAppState();
    return;
  }

  if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b' && isText && active.selectionStart !== active.selectionEnd) {
    if (active.id === 'explanationTemplate' || active.id === 'studyEditExplanation') {
      e.preventDefault();
      actions.makeBlankFromSelection(active.id);
    }
    return;
  }

  if (e.ctrlKey && !e.altKey && !e.shiftKey && /^[0-7]$/.test(e.key)) {
    e.preventDefault();
    actions.applyFlag(Number(e.key));
    return;
  }

  if (isBlankField && e.key === 'Enter') {
    e.preventDefault();
    actions.gradeBlankOnEnter(Number(active.dataset.blankOrder));
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

  if (store.currentSection.startsWith('study') && e.key === 'Enter' && !e.shiftKey && active?.tagName === 'TEXTAREA') {
    e.preventDefault();
    actions.gradeCurrent();
  }
}

init();
