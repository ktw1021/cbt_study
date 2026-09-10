import { escapeHtml, splitAnswers, stripBlankMarkers, blankShapeHint, normalizeNewlines } from '../utils/text.js';
import { store } from '../core/store.js';
import { acceptedAnswers } from '../domain/blank.js';
import { diffAgainstAnswer } from '../services/grading.js';

/** 문제 패널 — 빈칸 토큰 없이 그대로 표시 */
export function formatProblemHtml(text) {
  const plain = normalizeNewlines(stripBlankMarkers(text));
  if (!plain.trim()) return '<span class="empty">문제가 없습니다.</span>';
  return escapeHtml(plain).replace(/\n/g, '<br>');
}

function blankInputHtml(order, card, st = {}) {
  const blank = (card?.blanks || []).find((b) => b.order === order);
  const answer = splitAnswers(blank?.answer)[0] || '';
  const userVal = String(st.user ?? '');
  const checked = st.checked;
  const correct = st.correct;
  const score = Number(st.score ?? 0);

  let cls = 'blank-field blank-field-shape';
  if (checked) cls += correct ? ' ok' : ' bad';
  if (store.currentBlankFocus === order) cls += ' focus';

  const hint = blankShapeHint(answer);
  const reveal = checked && (!correct || score < 100);
  const diff = reveal ? diffAgainstAnswer(userVal, acceptedAnswers(blank)) : null;
  const rest = diff ? remainingHint(diff, answer) : hint.slice(userVal.length);
  // 어긋난 글자는 입력칸 안에서 직접 빨갛게 보이므로, 여기에는 정답만 초록으로 남긴다.
  // 정답은 폭 0 짜리 자리표시자 안에 띄운다. 래퍼 바깥이라 빈칸의 밑줄·배경도 덮지 않는다.
  const answerHtml = reveal
    ? `<span class="blank-answer-holder" data-blank-answer="${order}" contenteditable="false" aria-hidden="true"><span class="blank-answer">정답: ${escapeHtml(normalizeNewlines(diff?.answer ?? answer).replace(/\n+/g, ' '))}</span></span>`
    : '';

  // 인라인 contenteditable + 남은 ○○○ 마스크 → 줄바꿈 + 칸 크기 유지.
  // 채점 후에는 글자별 대조 결과를 그대로 칠하고, 다시 입력하면 dropGradedSpans 가 평문으로 되돌린다.
  const body = diff ? renderDiffSegments(diff.segments) : escapeHtml(userVal);
  return `<span class="blank-wrap" id="blankWrap${order}" data-blank-wrap="${order}"><span class="${cls}" contenteditable="true" role="textbox" aria-label="빈칸 ${order}" data-blank-order="${order}" data-action="blank-input" data-hint="${escapeHtml(hint)}" spellcheck="false">${body}</span><span class="blank-rest" contenteditable="false" aria-hidden="true">${escapeHtml(rest)}</span></span>${answerHtml}`;
}

function remainingHint(diff, fallback) {
  const ans = String(diff?.answer ?? fallback ?? '');
  const left = Array.from(ans.normalize('NFC')).slice(Number(diff?.covered ?? 0));
  if (!left.length) return '';
  return left.map((ch) => (ch === '\n' || /\s/.test(ch) ? (ch === '\n' ? ' ' : ch) : '○')).join('');
}

function renderDiffSegments(segments) {
  return (segments || []).map((s) => {
    if (s.kind === 'space-miss') {
      return '<span class="bd-seg bd-space-miss" contenteditable="false"></span>';
    }
    return `<span class="bd-seg bd-${s.kind}">${escapeHtml(s.text)}</span>`;
  }).join('');
}

/** 해설 패널 — 본문 흐름 속 인라인 빈칸 입력 */
export function formatExplanationHtml(template, card, statuses = []) {
  const statusMap = new Map(statuses.map((s) => [s.order, s]));
  const html = escapeHtml(normalizeNewlines(template || '')).replace(/\[\[BLANK(\d+)\]\]/g, (_, n) => {
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
