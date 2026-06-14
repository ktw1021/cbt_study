import { getState, store } from '../core/store.js';

function readAuthName() {
  return document.getElementById('authName')?.value?.trim().normalize('NFC') || '';
}

/** 로그인 화면 표시 */
export function showAuthOverlay(mode = 'login') {
  const overlay = document.getElementById('authOverlay');
  overlay?.classList.remove('hidden');
  document.body.classList.add('auth-locked');
  setAuthTab(mode);
  renderAuthUserLists();
  document.getElementById('authName')?.focus();
  overlay?.scrollIntoView({ block: 'center' });
}

/** 로그인 화면 숨김 */
export function hideAuthOverlay() {
  document.getElementById('authOverlay')?.classList.add('hidden');
  document.body.classList.remove('auth-locked');
}

export function isAuthVisible() {
  return !document.getElementById('authOverlay')?.classList.contains('hidden');
}

export function setAuthTab(tab) {
  store.authTab = tab;
  document.getElementById('authLoginPanel')?.classList.toggle('hidden', tab !== 'login');
  document.getElementById('authRegisterPanel')?.classList.toggle('hidden', tab !== 'register');
  document.getElementById('authSetupPanel')?.classList.toggle('hidden', tab !== 'setup');
  document.getElementById('authTabBar')?.classList.toggle('hidden', tab === 'setup');
  document.querySelector('.auth-name-block')?.classList.toggle('hidden', tab === 'setup');
  document.querySelectorAll('[data-auth-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.authTab === tab);
  });
}

export function renderAuthUserLists() {
  const users = getState()?.users || [];
  const el = document.getElementById('authSavedAccounts');
  if (el) {
    el.textContent = users.length
      ? `이 브라우저에 저장된 계정: ${users.map((u) => u.name).join(', ')}`
      : '저장된 계정 없음 — 회원가입 탭에서 새로 만드세요.';
  }
}

export function showPinSetup(userId, userName) {
  store.pendingPinSetupUserId = userId;
  document.getElementById('setupUserName').textContent = userName;
  const nameInput = document.getElementById('authName');
  if (nameInput) nameInput.value = userName;
  setAuthTab('setup');
  showAuthOverlay('setup');
}

export function readLoginForm() {
  return {
    name: readAuthName(),
    pin: document.getElementById('loginPin')?.value || '',
  };
}

export function readRegisterForm() {
  return {
    name: readAuthName(),
    pin: document.getElementById('registerPin')?.value || '',
    pinConfirm: document.getElementById('registerPinConfirm')?.value || '',
  };
}

export function readSetupForm() {
  return {
    pin: document.getElementById('setupPin')?.value || '',
    pinConfirm: document.getElementById('setupPinConfirm')?.value || '',
  };
}

export function clearAuthInputs() {
  ['authName', 'loginPin', 'registerPin', 'registerPinConfirm', 'setupPin', 'setupPinConfirm'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

/** 사용자에게 보이는 안내·오류·성공 메시지 */
export function showAuthMessage(msg, type = 'error') {
  const el = document.getElementById('authFeedback');
  if (!el) return;
  el.textContent = msg || '';
  el.className = msg ? `auth-feedback auth-feedback-${type}` : 'auth-feedback hidden';
  if (msg) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

export function setAuthError(msg) {
  showAuthMessage(msg, 'error');
}

export function setAuthSubmitting(busy) {
  document.querySelectorAll('[data-auth-submit]').forEach((btn) => {
    btn.disabled = busy;
    const label = btn.dataset.label || btn.textContent;
    if (busy) btn.textContent = btn.dataset.busyLabel || '처리 중…';
    else btn.textContent = label;
  });
}
