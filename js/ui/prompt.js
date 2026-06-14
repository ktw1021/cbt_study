import { escapeHtml, splitAnswers, stripBlankMarkers, blankShapeHint } from '../utils/text.js';
import { store } from '../core/store.js';

/** 문제 패널 — 빈칸 토큰 없이 그대로 표시 */
export function formatProblemHtml(text) {
  const plain = stripBlankMarkers(text);
  if (!plain.trim()) return '<span class="empty">문제가 없습니다.</span>';
  return escapeHtml(plain).replace(/\n/g, '<br>');
}

function blankInputHtml(order, card, st = {}) {
  const blank = (card?.blanks || []).find((b) => b.order === order);
  const answer = splitAnswers(blank?.answer)[0] || '';
  const userVal = st.user ?? '';
  const checked = st.checked;
  const correct = st.correct;
  const revealed = st.revealed;

  let cls = 'blank-field';
  if (checked) cls += correct ? ' ok' : ' bad';
  if (store.currentBlankFocus === order) cls += ' focus';
  if (revealed && correct) cls += ' revealed';

  const hint = blankShapeHint(answer);
  const len = Math.max(hint.length, String(userVal || (revealed && correct ? answer : '')).length, 1);
  const w = `width:${len}em`;

  if (revealed && !correct) {
    return `<span class="blank-wrap" id="blankWrap${order}">
      <input type="text" class="${cls} blank-field-shape" data-blank-order="${order}" data-action="blank-input"
        value="${escapeHtml(userVal)}" placeholder="${escapeHtml(hint)}" style="${w}" />
      <span class="blank-hint bad-hint">→ ${escapeHtml(answer)}</span>
    </span>`;
  }
  if (revealed && correct) {
    return `<span class="blank-wrap" id="blankWrap${order}">
      <input type="text" class="${cls} blank-field-shape" data-blank-order="${order}" data-action="blank-input"
        value="${escapeHtml(userVal || answer)}" readonly style="${w}" />
    </span>`;
  }

  return `<span class="blank-wrap" id="blankWrap${order}">
    <input type="text" class="${cls} blank-field-shape" data-blank-order="${order}" data-action="blank-input"
      value="${escapeHtml(userVal)}" placeholder="${escapeHtml(hint)}" style="${w}" autocomplete="off" />
  </span>`;
}

/** 해설 패널 — 본문 흐름 속 인라인 빈칸 입력 */
export function formatExplanationHtml(template, card, statuses = []) {
  const statusMap = new Map(statuses.map((s) => [s.order, s]));
  const html = escapeHtml(template || '').replace(/\[\[BLANK(\d+)\]\]/g, (_, n) => {
    const order = Number(n);
    return blankInputHtml(order, card, statusMap.get(order) || {});
  });
  return html || '<span class="empty">해설을 입력하세요. (카드제작 → 해설)</span>';
}

export function getExplanationText(card) {
  return String(card?.explanationText ?? '').trim();
}

/** 학습 해설 — explanationText + 인라인 빈칸 */
export function formatStudyExplanationHtml(card, statuses = []) {
  return formatExplanationHtml(getExplanationText(card), card, statuses);
}

/** 카드 제작·관리 미리보기 — ○ 패턴으로 글자 수·띄어쓰기 표시 */
export function formatPromptHtml(template, blanks = []) {
  const blankMap = new Map((blanks || []).map((b) => [Number(b.order), b]));
  const html = escapeHtml(template || '').replace(/\[\[BLANK(\d+)\]\]/g, (_, n) => {
    const order = Number(n);
    const hint = blankShapeHint(blankMap.get(order)?.answer || '');
    return `<span class="blank-inline blank-shape" title="빈칸 ${order}">${escapeHtml(hint)}</span>`;
  });
  return html || '<span class="empty">내용 없음</span>';
}
