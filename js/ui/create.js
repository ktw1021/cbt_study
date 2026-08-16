import { escapeHtml, stripBlankMarkers, normalizeTight } from '../utils/text.js';
import { syncTemplateAndBlanks } from '../domain/blank.js';
import { normalizeOutline, extractOutlineBlankToken } from '../domain/outline.js';
import { formatProblemHtml, formatPromptHtml } from './prompt.js';
import { store } from '../core/store.js';
import { persist } from '../core/storage.js';
import {
  setChipEditorContent,
  readChipEditor,
  formatAliases,
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

/** 카드에 저장된 목차 JSON — hidden input */
export function readOutlineFromForm() {
  const raw = document.getElementById('cardOutlineData')?.value;
  if (!raw?.trim()) return null;
  try {
    return normalizeOutline(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeOutlineToForm(outline) {
  const el = document.getElementById('cardOutlineData');
  if (!el) return;
  el.value = outline?.items?.length ? JSON.stringify(outline) : '';
  const { blanks } = readChipEditor('explanationTemplate');
  renderOutlineSummary(outline, { blanks });
}

const OUTLINE_SUMMARY_COLLAPSE_AFTER = 8;

function attrValue(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/\r\n|\n|\r|\t/g, ' ');
}

function renderOutlineSummaryItem(it, occupiedSet) {
  const token = extractOutlineBlankToken(it.title);
  const isBlank = token.length >= 2 && occupiedSet.has(normalizeTight(token));
  const lineNo = (Number(it.lineIndex) || 0) + 1;
  const pick = isBlank
    ? '<span class="outline-summary-status is-blank">빈칸</span>'
    : (token.length >= 2
      ? `<label class="outline-summary-pick" title="빈칸으로 만들 항목"><input type="checkbox" data-outline-blank-token="${attrValue(token)}" /></label>`
      : '<span class="outline-summary-status">—</span>');

  return `
    <div class="outline-tree-node" style="--ol-level:${Math.min(it.level || 0, 5)}">
      <div class="outline-tree-row outline-summary-row">
        ${pick}
        <span class="outline-tree-badge">${escapeHtml(it.label || '·')}</span>
        <span class="outline-tree-title-read">${escapeHtml(it.title)}</span>
        <span class="outline-tree-line-num" title="해설 ${lineNo}행">${lineNo}행</span>
      </div>
    </div>`;
}

export function renderOutlineSummary(outline, { blanks = [] } = {}) {
  const box = document.getElementById('outlineSummary');
  if (!box) return;
  const norm = normalizeOutline(outline);
  const items = (norm?.items || []).filter((it) => it.enabled !== false);
  const n = items.length;
  const occupiedSet = new Set(blanks.map((b) => normalizeTight(b.answer)));

  if (!n) {
    box.innerHTML = `
      <div class="outline-summary-panel outline-summary-panel--empty">
        <span class="empty">목차 없음 — 「목차 생성·관리」로 해설에서 잡으세요</span>
      </div>`;
    return;
  }

  const hidden = Math.max(0, n - OUTLINE_SUMMARY_COLLAPSE_AFTER);
  const needsToggle = hidden > 0;
  const expanded = !!store.data.ui.outlineSummaryExpanded;
  const treeCls = needsToggle
    ? `outline-summary-tree ${expanded ? 'is-expanded' : 'is-collapsed'}`
    : 'outline-summary-tree';
  box.innerHTML = `
    <div class="outline-summary-panel">
      <div class="outline-summary-head">
        <span class="outline-summary-head-title">저장된 목차</span>
        <span class="pill">${n}개</span>
      </div>
      <div class="${treeCls}" id="outlineSummaryTree">
        ${items.map((it) => renderOutlineSummaryItem(it, occupiedSet)).join('')}
      </div>
      ${needsToggle ? `<button type="button" class="ghost small outline-summary-toggle" data-action="toggle-outline-summary" data-hidden-count="${hidden}">${expanded ? '접기' : `더보기 (${hidden}개 더)`}</button>` : ''}
      <div class="toolbar outline-summary-actions">
        <button type="button" class="secondary small" data-action="outline-blank-all">모두 빈칸으로</button>
        <button type="button" class="secondary small" data-action="outline-blank-selected">선택 빈칸 만들기</button>
        <button type="button" class="ghost small" data-action="outline-unblank">모두 해제</button>
      </div>
    </div>`;
}

export function toggleOutlineSummary() {
  const tree = document.getElementById('outlineSummaryTree');
  const btn = document.querySelector('[data-action="toggle-outline-summary"]');
  if (!tree || !btn) return;
  const expanded = !tree.classList.contains('is-expanded');
  tree.classList.toggle('is-expanded', expanded);
  tree.classList.toggle('is-collapsed', !expanded);
  store.data.ui.outlineSummaryExpanded = expanded;
  persist();
  const hidden = Number(btn.dataset.hiddenCount || 0);
  btn.textContent = expanded ? '접기' : `더보기 (${hidden}개 더)`;
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
  writeOutlineToForm(card?.outline || null);
  renderCreatePreview(card || { displayText: '', explanationText: '', blanks: [] });
}

/**
 * 빈칸별 동의어 입력칸.
 * 주 정답은 해설 본문의 단어라 고칠 수 없고, 다르게 써도 정답으로 칠 표현만 여기에 더한다.
 * 값은 칩 dataset에 곧바로 반영되므로 이 칸을 다시 그리지 않아도 저장에 반영된다.
 */
function aliasInputHtml(b, editorId) {
  const value = escapeHtml(formatAliases(b.aliases));
  return `<input type="text" class="alias-input" data-alias-for="${b.order}" data-editor="${editorId}"
    value="${value}" placeholder="동의어 (여러 개는 || 로 구분)" title="이렇게 써도 정답으로 인정합니다">`;
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
        ${aliasInputHtml(b, 'explanationTemplate')}
      </div>`).join('')
    : '<div class="caption">해설에서 단어를 드래그해 빈칸을 만들면 여기에 표시됩니다.</div>';

  renderOutlineSummary(readOutlineFromForm(), { blanks: synced.blanks });
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
    outline: readOutlineFromForm(),
  };
}

export function isBlankEditor(editorId) {
  return BLANK_EDITORS.has(editorId);
}

/**
 * 저장 시점 대비 변경 여부를 비교하기 위한 지문.
 * 필드를 빠뜨리면 「저장 안 된 변경」 경고가 조용히 어긋나므로 이 한 곳에서만 만든다.
 */
export function makeCreateSnapshot(draft) {
  const d = draft || {};
  return JSON.stringify({
    id: d.id || '',
    folderId: d.folderId || null,
    title: d.title || '',
    flagColor: Number(d.flagColor) || 0,
    displayText: d.displayText || '',
    explanationText: d.explanationText || '',
    memo: d.memo || '',
    outline: d.outline?.items?.length ? d.outline : null,
    blanks: (d.blanks || []).map((b) => ({
      order: Number(b.order) || 0,
      answer: String(b.answer || ''),
      aliases: b.aliases || [],
    })),
  });
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
        ${aliasInputHtml(b, 'studyEditExplanation')}
      </div>`).join('')
    : '<div class="caption">해설에서 단어를 드래그해 빈칸을 만드세요.</div>';
}

export function renderStudyEditPreview() {
  const synced = readChipEditor('studyEditExplanation');
  document.getElementById('studyEditExplanationPreview').innerHTML = formatPromptHtml(synced.template, synced.blanks);
}
