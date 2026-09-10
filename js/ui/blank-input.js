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

export function caretOffsetIn(el) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.endContainer)) return null;
  const probe = document.createRange();
  probe.selectNodeContents(el);
  probe.setEnd(range.endContainer, range.endOffset);
  return probe.toString().length;
}

/** 채점 후 bd-seg 등 여러 텍스트 노드에도 같은 문자 위치로 커서를 둔다. */
export function placeCaretAtOffset(el, offset) {
  if (!el) return;
  const limit = Math.max(0, offset ?? 0);
  let remaining = limit;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const len = node.nodeValue.length;
    if (remaining <= len) {
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    remaining -= len;
  }
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

/**
 * 채점 하이라이트(bd-seg)를 지우고 평문 한 덩어리로 되돌린다.
 * 색이 남은 채로 이어 쓰면 새로 친 글자까지 그 색을 물려받기 때문에, 편집이 시작되면 즉시 벗긴다.
 */
function dropGradedSpans(el) {
  if (!el.querySelector('.bd-seg')) return;
  const offset = caretOffsetIn(el);
  const text = el.textContent;
  el.textContent = text;
  if (offset != null) placeCaretAtOffset(el, offset);
}

/**
 * <br>·줄바꿈 정리 후 마스크 동기화
 * @param {{dropGradedColors?: boolean}} [opts] 입력·조합 종료처럼 "사용자가 고쳐 쓰는" 경로에서만 true.
 *   포커스 이탈은 false여야 칸을 떠나도 채점 색이 남는다.
 */
export function normalizeBlankFieldDom(el, { dropGradedColors = false } = {}) {
  if (!el?.matches?.('.blank-field')) return;
  if (dropGradedColors) dropGradedSpans(el);
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

export function focusBlankField(el, { caretOffset = null } = {}) {
  if (!el) return;
  el.focus();
  if (caretOffset != null) placeCaretAtOffset(el, caretOffset);
  else placeCaretAtOffset(el, blankFieldText(el).length);
}
