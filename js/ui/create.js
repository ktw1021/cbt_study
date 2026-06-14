import { escapeHtml, stripBlankMarkers } from '../utils/text.js';
import { syncTemplateAndBlanks } from '../domain/blank.js';
import { formatProblemHtml, formatPromptHtml } from './prompt.js';
import { writeTextarea, captureTextareaView } from '../utils/dom.js';

const BLANK_EDITORS = new Set(['explanationTemplate', 'studyEditExplanation']);

/** 카드 제작 폼 렌더 */
export function renderCreateForm(card) {
  document.getElementById('cardId').value = card?.id || '';
  document.getElementById('cardTitle').value = card?.title || '';
  document.getElementById('cardFolder').value = card?.folderId || '';
  document.getElementById('cardFlag').value = String(card?.flagColor ?? 0);
  document.getElementById('promptTemplate').value = stripBlankMarkers(card?.displayText || '');
  document.getElementById('explanationTemplate').value = card?.explanationText || '';
  document.getElementById('cardMemo').value = card?.memo || '';
  renderCreatePreview(card || { displayText: '', explanationText: '', blanks: [] });
}

/** 카드 제작 미리보기 */
export function renderCreatePreview(card) {
  document.getElementById('promptPreview').innerHTML = formatProblemHtml(card.displayText || '');

  const synced = syncTemplateAndBlanks(card.explanationText || '', card.blanks || []);
  document.getElementById('explanationPreview').innerHTML = formatPromptHtml(synced.template, synced.blanks);
  document.getElementById('blankSummary').innerHTML = synced.blanks.length
    ? synced.blanks.map((b) => `
      <span class="blank-chip-wrap">
        <button type="button" class="blank-chip" data-action="jump-blank" data-editor="explanationTemplate" data-order="${b.order}" title="해설 본문에서 이 빈칸 선택">빈칸 ${b.order} ↗</button>
        <button type="button" class="blank-chip-remove" data-action="remove-blank-order" data-editor="explanationTemplate" data-order="${b.order}" title="빈칸 해제">×</button>
      </span>`).join('')
    : '<span class="empty">빈칸 없음 — 해설에서 단어 드래그 후 Ctrl+B</span>';
  document.getElementById('answerSlots').innerHTML = synced.blanks.length
    ? synced.blanks.map((b) => `
      <div class="slot blank-slot">
        <div class="between" style="margin-bottom:4px">
          <button type="button" class="blank-slot-jump" data-action="jump-blank" data-editor="explanationTemplate" data-order="${b.order}" title="해설에서 이 빈칸으로">빈칸 ${b.order} ↗</button>
          <button type="button" class="ghost small" data-action="remove-blank-order" data-editor="explanationTemplate" data-order="${b.order}">해제</button>
        </div>
      <textarea data-answer-key="${b.order}" class="sm" placeholder="동의어: 줄바꿈 또는 ||">${escapeHtml(b.answer)}</textarea></div>`).join('')
    : '<div class="caption">해설에서 빈칸을 만들면 정답 입력칸이 나타납니다.</div>';
}

/** 폼에서 카드 draft 읽기 */
export function readCreateForm(existingBlanks = []) {
  const problem = stripBlankMarkers(document.getElementById('promptTemplate').value);
  const explRaw = document.getElementById('explanationTemplate').value;
  const src = [...document.querySelectorAll('[data-answer-key]')].map((el) => {
    const order = Number(el.dataset.answerKey);
    const prev = existingBlanks.find((b) => b.order === order) || {};
    return { ...prev, order, answer: el.value || '' };
  });
  const synced = syncTemplateAndBlanks(explRaw, src);
  return {
    id: document.getElementById('cardId').value,
    folderId: document.getElementById('cardFolder').value || null,
    title: document.getElementById('cardTitle').value.trim() || '제목 없음',
    displayText: problem,
    explanationText: synced.template,
    blanks: synced.blanks.map((b) => ({
      ...b,
      answer: document.querySelector(`[data-answer-key="${b.order}"]`)?.value || b.answer,
    })),
    memo: document.getElementById('cardMemo').value,
    flagColor: Number(document.getElementById('cardFlag').value),
  };
}

/** 에디터에서 blanks 읽기 (해설 전용) */
export function readBlanksFromEditor(editorId, cardId, existingBlanks = []) {
  const template = document.getElementById(editorId).value;
  const sel = editorId === 'studyEditExplanation' ? '[data-study-answer-key]' : '[data-answer-key]';
  const src = [...document.querySelectorAll(sel)].map((el) => {
    const order = Number(el.dataset.answerKey || el.dataset.studyAnswerKey);
    const prev = existingBlanks.find((b) => b.order === order) || {};
    return { ...prev, order, answer: el.value || '' };
  });
  return syncTemplateAndBlanks(template, src);
}

/** 에디터 UI 갱신 — textarea는 커서·스크롤 유지 */
export function refreshEditorUI(editorId, synced, caret = null) {
  const el = document.getElementById(editorId);
  if (!el) return;

  const view = captureTextareaView(el);
  const finalCaret = caret ?? synced.caret ?? { start: view.start, end: view.end };

  if (editorId === 'explanationTemplate') {
    const problem = document.getElementById('promptTemplate').value;
    renderCreatePreview({ displayText: problem, explanationText: synced.template, blanks: synced.blanks });
  } else if (editorId === 'studyEditExplanation') {
    renderStudyEditForm(null, synced);
  }

  writeTextarea(el, synced.template, finalCaret, view);
}

export function isBlankEditor(editorId) {
  return BLANK_EDITORS.has(editorId);
}

/** 학습 중 수정 폼 */
export function renderStudyEditForm(card, syncedOverride = null) {
  if (!card && !syncedOverride) return;

  if (card) {
    document.getElementById('studyEditTitle').value = card.title;
    document.getElementById('studyEditFolder').value = card.folderId || '';
    document.getElementById('studyEditPrompt').value = stripBlankMarkers(card.displayText || '');
    document.getElementById('studyEditExplanation').value = card.explanationText || '';
    document.getElementById('studyEditMemo').value = card.memo || '';
  }

  const synced = syncedOverride || syncTemplateAndBlanks(
    card?.explanationText || document.getElementById('studyEditExplanation')?.value || '',
    card?.blanks || [],
  );

  document.getElementById('studyEditExplanationPreview').innerHTML = formatPromptHtml(synced.template, synced.blanks);
  document.getElementById('studyEditSlots').innerHTML = synced.blanks.map((b) => `
    <div class="slot blank-slot">
      <div class="between" style="margin-bottom:4px">
        <label>빈칸 ${b.order}</label>
        <button type="button" class="ghost small" data-action="remove-blank-order" data-editor="studyEditExplanation" data-order="${b.order}">해제</button>
      </div>
    <textarea data-study-answer-key="${b.order}" class="sm">${escapeHtml(b.answer)}</textarea></div>`).join('');
}

export function renderStudyEditPreview() {
  const template = document.getElementById('studyEditExplanation').value;
  const src = [...document.querySelectorAll('[data-study-answer-key]')].map((el) => ({
    order: Number(el.dataset.studyAnswerKey),
    answer: el.value,
  }));
  const synced = syncTemplateAndBlanks(template, src);
  document.getElementById('studyEditExplanationPreview').innerHTML = formatPromptHtml(synced.template, synced.blanks);
}
