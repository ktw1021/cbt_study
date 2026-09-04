/**
 * 알파 테스터 코드 입력 관문 UI
 */
import {
  loadAlphaEnv,
  hasValidAlphaSession,
  isAlphaCodeValid,
  storeAlphaCode,
} from '../services/alpha-access.js';

let unlockResolve = null;

export function isAlphaGateVisible() {
  return !document.getElementById('alphaGateOverlay')?.classList.contains('hidden');
}

export function showAlphaGate(message = '') {
  const overlay = document.getElementById('alphaGateOverlay');
  overlay?.classList.remove('hidden');
  document.body.classList.add('alpha-locked');
  setAlphaGateMessage(message);
  const input = document.getElementById('alphaGateCode');
  if (input) {
    input.value = '';
    queueMicrotask(() => input.focus());
  }
}

export function hideAlphaGate() {
  document.getElementById('alphaGateOverlay')?.classList.add('hidden');
  document.body.classList.remove('alpha-locked');
  setAlphaGateMessage('');
}

export function setAlphaGateMessage(msg, type = 'error') {
  const el = document.getElementById('alphaGateFeedback');
  if (!el) return;
  const text = String(msg || '').trim();
  el.textContent = text;
  el.classList.toggle('hidden', !text);
  el.classList.toggle('is-error', type === 'error');
  el.classList.toggle('is-success', type === 'success');
}

/** 코드 제출 — 성공 시 쿠키 저장 후 true */
export function submitAlphaGateCode(productPlanner) {
  const code = document.getElementById('alphaGateCode')?.value?.trim() || '';
  if (!code) {
    setAlphaGateMessage('알파 테스터 코드를 입력하세요.');
    return false;
  }
  if (!isAlphaCodeValid(code, productPlanner)) {
    setAlphaGateMessage('코드가 올바르지 않습니다. 다시 확인해주세요.');
    return false;
  }
  storeAlphaCode(code);
  setAlphaGateMessage('확인되었습니다.', 'success');
  hideAlphaGate();
  unlockResolve?.(true);
  unlockResolve = null;
  return true;
}

/**
 * 쿠키가 유효하면 즉시 통과.
 * 아니면 오버레이를 띄우고 코드 입력까지 대기.
 * @returns {Promise<{ ok: boolean, productPlanner: string }>}
 */
export async function ensureAlphaAccess() {
  let env;
  try {
    env = await loadAlphaEnv();
  } catch (err) {
    showAlphaGate(err.message || 'env.alph 를 불러오지 못했습니다.');
    document.getElementById('alphaGateSubmit')?.setAttribute('disabled', 'true');
    document.getElementById('alphaGateCode')?.setAttribute('disabled', 'true');
    return { ok: false, productPlanner: '' };
  }

  if (hasValidAlphaSession(env.productPlanner)) {
    return { ok: true, productPlanner: env.productPlanner };
  }

  showAlphaGate('');
  return new Promise((resolve) => {
    unlockResolve = () => resolve({ ok: true, productPlanner: env.productPlanner });
    // submitAlphaGateCode 가 productPlanner 를 알 수 있게 보관
    ensureAlphaAccess._planner = env.productPlanner;
  });
}

export function getPendingAlphaPlanner() {
  return ensureAlphaAccess._planner || '';
}
