/**
 * 사이드바 계정 전환 — 목록에서 고른 뒤 PIN. 취소하면 지금 로그인 유지.
 */
import { getState } from '../core/store.js';
import { getActiveUser } from '../domain/queries.js';
import { escapeHtml } from '../utils/text.js';

let open = false;
let pendingUserId = null;
let bound = false;

export function isAccountSwitcherOpen() {
  return open;
}

export function pendingSwitchUserId() {
  return pendingUserId;
}

export function closeAccountSwitcher() {
  open = false;
  pendingUserId = null;
  const pin = document.getElementById('accountSwitchPin');
  if (pin) pin.value = '';
  showAccountSwitchError('');
}

export function toggleAccountSwitcherOpen() {
  if (open) closeAccountSwitcher();
  else {
    open = true;
    pendingUserId = null;
    showAccountSwitchError('');
  }
  renderAccountSwitcher();
}

export function showAccountSwitchPin(user) {
  if (!user) return;
  open = true;
  pendingUserId = user.id;
  const pin = document.getElementById('accountSwitchPin');
  if (pin) pin.value = '';
  showAccountSwitchError('');
  renderAccountSwitcher();
  pin?.focus();
}

export function readAccountSwitchPin() {
  return document.getElementById('accountSwitchPin')?.value || '';
}

export function showAccountSwitchError(msg) {
  const el = document.getElementById('accountSwitcherError');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('hidden', !msg);
}

export function renderAccountSwitcher() {
  const wrap = document.getElementById('accountSwitcher');
  const list = document.getElementById('accountSwitcherList');
  const pinWrap = document.getElementById('accountSwitcherPin');
  const badge = document.getElementById('accountSwitcherToggle');
  if (!wrap || !list) return;

  const current = getActiveUser();
  if (!current) {
    closeAccountSwitcher();
    wrap.classList.add('hidden');
    if (badge) badge.setAttribute('aria-expanded', 'false');
    return;
  }

  wrap.classList.toggle('hidden', !open);
  if (badge) badge.setAttribute('aria-expanded', open ? 'true' : 'false');

  const users = (getState()?.users || []).slice().sort((a, b) => {
    if (a.id === current.id) return -1;
    if (b.id === current.id) return 1;
    return String(a.name || '').localeCompare(String(b.name || ''), 'ko');
  });

  const pinUser = pendingUserId && users.find((u) => u.id === pendingUserId);
  if (pinWrap) pinWrap.classList.toggle('hidden', !pinUser);
  list.classList.toggle('hidden', !!pinUser);

  if (pinUser) {
    const label = document.getElementById('accountSwitcherPinLabel');
    if (label) label.textContent = `「${pinUser.name}」 4자리 비밀번호`;
    revealAccountSwitcher();
    return;
  }

  if (!open) return;
  if (!users.length) {
    list.innerHTML = '<div class="caption">저장된 계정이 없습니다.</div>';
    revealAccountSwitcher();
    return;
  }
  const hint = users.length < 2
    ? '<div class="caption account-switch-empty">이 브라우저에 다른 계정이 없습니다.</div>'
    : '<div class="caption account-switch-empty">계정을 고른 뒤 비밀번호를 입력하세요.</div>';
  list.innerHTML = hint + users.map((u) => {
    const here = u.id === current.id;
    return `<button type="button" class="account-switch-item${here ? ' is-current' : ''}" data-action="pick-account-switch" data-user-id="${escapeHtml(u.id)}" ${here ? 'aria-current="true"' : ''}>${escapeHtml(u.name || '')}${here ? ' · 지금' : ''}</button>`;
  }).join('');
  revealAccountSwitcher();
}

function revealAccountSwitcher() {
  const wrap = document.getElementById('accountSwitcher');
  if (!wrap || wrap.classList.contains('hidden')) return;
  requestAnimationFrame(() => {
    const target = wrap.querySelector('.account-switch-item:last-of-type') || wrap;
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
}

export function bindAccountSwitcher() {
  if (bound) return;
  bound = true;
  document.addEventListener('mousedown', (e) => {
    if (!open) return;
    if (e.target.closest?.('#loggedInUser')) return;
    closeAccountSwitcher();
    renderAccountSwitcher();
  });
  document.addEventListener('keydown', (e) => {
    if (!open || e.key !== 'Escape') return;
    e.preventDefault();
    closeAccountSwitcher();
    renderAccountSwitcher();
  });
}
