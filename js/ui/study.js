import { store } from '../core/store.js';
import { escapeHtml, splitAnswers } from '../utils/text.js';
import { getState } from '../core/store.js';
import { folderPathNames } from '../domain/queries.js';
import { formatProblemHtml, formatStudyExplanationHtml } from './prompt.js';
import { renderStudyEditForm } from './create.js';

/** 학습 메타·임계값 라벨 */
export function renderStudyMeta() {
  const threshold = Number(document.getElementById('gradingThreshold')?.value || getState().settings.gradingThreshold);
  getState().settings.gradingThreshold = threshold;
  document.getElementById('thresholdLabel').textContent = `${threshold}% 이상`;

  const c = store.studyQueue[store.studyIndex];
  const box = document.getElementById('studyMeta');

  if (!c) {
    box.innerHTML = '<span class="pill">대기</span>';
    document.getElementById('roundBadge').textContent = '회독 0';
    return;
  }

  box.innerHTML = `
    <span class="pill">${store.studyIndex + 1}/${store.studyQueue.length}</span>
    <span class="pill">${escapeHtml(c.title)}</span>
    <span class="pill"><span class="flag flag-${c.flagColor}"></span></span>
    <span class="pill">${escapeHtml(folderPathNames(c.folderId))}</span>`;
  document.getElementById('roundBadge').textContent = `회독 ${c.rounds}`;
}

/** 학습 카드 UI — 좌: 문제 / 우: 해설(인라인 빈칸) */
export function renderStudyCard() {
  renderStudyMeta();
  const c = store.studyQueue[store.studyIndex];
  const prompt = document.getElementById('studyPrompt');
  const explanation = document.getElementById('studyExplanation');

  if (!c) {
    prompt.innerHTML = '<span class="empty">학습을 시작하세요.</span>';
    if (explanation) explanation.innerHTML = '<span class="empty">해설 영역</span>';
    document.getElementById('gradeResult').textContent = '빈칸 입력 후 Enter로 채점';
    document.getElementById('studyNavigator').innerHTML = '';
    return;
  }

  if (!store.currentBlankStatuses.length || store._studyCardId !== c.id) {
    store.currentBlankStatuses = c.blanks.map((b) => ({
      order: b.order, checked: false, correct: false, score: 0, user: '', revealed: false,
    }));
    store.studyAttemptRecorded = false;
    store.currentBlankFocus = null;
    store._studyCardId = c.id;
  }

  prompt.innerHTML = formatProblemHtml(c.displayText);
  explanation.innerHTML = formatStudyExplanationHtml(c, store.currentBlankStatuses);

  document.getElementById('studyNavigator').innerHTML = c.blanks.map((b) =>
    `<button class="small ghost" data-action="focus-blank" data-order="${b.order}">빈칸${b.order}</button>`).join('');

  document.getElementById('studyMemo').value = c.memo || '';
  const checked = store.currentBlankStatuses.filter((s) => s.checked).length;
  const ok = store.currentBlankStatuses.filter((s) => s.correct).length;
  document.getElementById('gradeResult').textContent = checked
    ? `채점 ${ok}/${c.blanks.length} · Enter로 빈칸별 채점`
    : '해설에서 빈칸 입력 → Enter로 채점';
  renderStudyEditForm(c);
}

/** 인라인 빈칸 UI 상태 반영 */
export function paintInlineBlanks(statuses) {
  statuses.forEach((s) => {
    const input = document.querySelector(`[data-blank-order="${s.order}"]`);
    if (!input) return;
    input.classList.toggle('ok', s.correct);
    input.classList.toggle('bad', s.checked && !s.correct);
    input.classList.toggle('focus', store.currentBlankFocus === s.order);
    if (s.revealed && s.correct) input.readOnly = true;
  });
}

export function refreshStudyViews() {
  const c = store.studyQueue[store.studyIndex];
  if (!c) return;
  document.getElementById('studyPrompt').innerHTML = formatProblemHtml(c.displayText);
  document.getElementById('studyExplanation').innerHTML = formatStudyExplanationHtml(c, store.currentBlankStatuses);
  paintInlineBlanks(store.currentBlankStatuses);
}

export function focusBlankUI(order) {
  store.currentBlankFocus = order;
  const input = document.querySelector(`[data-blank-order="${order}"]`);
  if (input) {
    input.focus();
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  refreshStudyViews();
}

export function getBlankInputValue(order) {
  return document.querySelector(`[data-blank-order="${order}"]`)?.value?.trim() || '';
}

/** @deprecated — 인라인 방식으로 대체 */
export function paintStatuses() { paintInlineBlanks(store.currentBlankStatuses); }
export function refreshStudyPrompt() { refreshStudyViews(); }
export function renderReveal() {}
