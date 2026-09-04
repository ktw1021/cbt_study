import { store } from '../core/store.js';

/**
 * 학습 빈칸: contenteditable + 남은 ○○○ 마스크
 * - 본문과 같이 줄바꿈
 * - 입력해도 힌트 길이만큼 칸이 유지됨
 */

export function blankFieldText(el) {
  if (!el) return '';
  return String(el.textContent || '').replace(/\u00a0/g, ' ');
}

export function getBlankInputValue(order) {
  return blankFieldText(document.querySelector(`[data-blank-order="${order}"]`)).trim();
}

/** DOM 입력값 → 모델 흡수 */
export function syncDraftFromDOM() {
  store.currentBlankStatuses.forEach((s) => {
    const el = document.querySelector(`[data-blank-order="${s.order}"]`);
    if (el) s.user = blankFieldText(el);
  });
}

/** 입력 길이에 맞춰 남은 ○○○ 마스크 갱신 */
export function syncBlankRest(field) {
  if (!field?.matches?.('.blank-field')) return;
  const rest = field.parentElement?.querySelector?.('.blank-rest');
  if (!rest) return;
  const hint = field.dataset.hint || '';
  const val = blankFieldText(field);
  rest.textContent = hint.slice(val.length);
}

/** <br>·줄바꿈 정리 후 마스크 동기화 */
export function normalizeBlankFieldDom(el) {
  if (!el?.matches?.('.blank-field')) return;
  const text = blankFieldText(el);
  if (!text) {
    if (el.innerHTML !== '') el.textContent = '';
    syncBlankRest(el);
    return;
  }
  const cleaned = text.replace(/[\r\n\u2028\u2029]+/g, ' ');
  if (cleaned !== text) el.textContent = cleaned;
  syncBlankRest(el);
}

export function focusBlankField(el) {
  if (!el) return;
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}
