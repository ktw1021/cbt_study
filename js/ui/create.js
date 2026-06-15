import { escapeHtml, stripBlankMarkers } from '../utils/text.js';
import { syncTemplateAndBlanks } from '../domain/blank.js';
import { formatProblemHtml, formatPromptHtml } from './prompt.js';
import {
  setChipEditorContent,
  readChipEditor,
} from './chip-editor.js';

const BLANK_EDITORS = new Set(['explanationTemplate', 'studyEditExplanation']);

/** 플래그 스와치 선택 상태 동기화 (hidden input + active 표시) */
export function syncCardFlagPicker(value) {
  const n = Number(value) || 0;
  const input = document.getElementById('cardFlag');
  if (input) input.value = String(n);
  document.querySelectorAll('#cardFlagPicker .flag-pick').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.flag) === n);
  });
}

/** 카드 제작 폼 렌더 */
export function renderCreateForm(card) {
  document.getElementById('cardId').value = card?.id || '';
  document.getElementById('cardTitle').value = card?.title || '';
  document.getElementById('cardFolder').value = card?.folderId || '';
  syncCardFlagPicker(card?.flagColor ?? 0);
  document.getElementById('promptTemplate').value = stripBlankMarkers(card?.displayText || '');
  setChipEditorContent('explanationTemplate', card?.explanationText || '', card?.blanks || []);
  document.getElementById('cardMemo').value = card?.memo || '';
  renderCreatePreview(card || { displayText: '', explanationText: '', blanks: [] });
}

/** 카드 제작 미리보기 — 빈칸 단어는 드래그한 그대로(읽기 전용) */
export function renderCreatePreview(data) {
  document.getElementById('promptPreview').innerHTML = formatProblemHtml(data.displayText || '');

  const synced = syncTemplateAndBlanks(data.explanationText || '', data.blanks || []);
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
        <div class="answer-readonly">${escapeHtml(b.answer) || '<span class="empty">(단어 없음)</span>'}</div>
      </div>`).join('')
    : '<div class="caption">해설에서 단어를 드래그해 빈칸을 만들면 여기에 표시됩니다.</div>';
}

/** 폼에서 카드 draft 읽기 (정답·빈칸은 칩 에디터가 단일 출처) */
export function readCreateForm() {
  const problem = stripBlankMarkers(document.getElementById('promptTemplate').value);
  const { template, blanks } = readChipEditor('explanationTemplate');
  return {
    id: document.getElementById('cardId').value,
    folderId: document.getElementById('cardFolder').value || null,
    title: document.getElementById('cardTitle').value.trim() || '제목 없음',
    displayText: problem,
    explanationText: template,
    blanks,
    memo: document.getElementById('cardMemo').value,
    flagColor: Number(document.getElementById('cardFlag').value),
  };
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
    setChipEditorContent('studyEditExplanation', card.explanationText || '', card.blanks || []);
    document.getElementById('studyEditMemo').value = card.memo || '';
  }

  const synced = syncedOverride || readChipEditor('studyEditExplanation');

  document.getElementById('studyEditExplanationPreview').innerHTML = formatPromptHtml(synced.template, synced.blanks);
  document.getElementById('studyEditSlots').innerHTML = synced.blanks.length
    ? synced.blanks.map((b) => `
      <div class="slot blank-slot">
        <div class="between" style="margin-bottom:4px">
          <label>빈칸 ${b.order}</label>
          <button type="button" class="ghost small" data-action="remove-blank-order" data-editor="studyEditExplanation" data-order="${b.order}">해제</button>
        </div>
        <div class="answer-readonly">${escapeHtml(b.answer) || '<span class="empty">(단어 없음)</span>'}</div>
      </div>`).join('')
    : '<div class="caption">해설에서 단어를 드래그해 빈칸을 만드세요.</div>';
}

export function renderStudyEditPreview() {
  const synced = readChipEditor('studyEditExplanation');
  document.getElementById('studyEditExplanationPreview').innerHTML = formatPromptHtml(synced.template, synced.blanks);
}
