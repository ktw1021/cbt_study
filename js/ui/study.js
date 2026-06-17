import { store } from '../core/store.js';
import { escapeHtml, splitAnswers, shorten } from '../utils/text.js';
import { getState } from '../core/store.js';
import { folderPathNames, buildStudyQueue, getFolder } from '../domain/queries.js';
import { loadCardProgress, getPersistedStudySession } from '../services/study-session.js';
import { renderResumePanel } from './resume-panel.js';
import { formatProblemHtml, formatStudyExplanationHtml } from './prompt.js';
import { renderStudyEditForm } from './create.js';

const SCOPE_LABEL = { all: '전체 카드', folder: '폴더', selected: '선택 카드', wrong: '최근 오답', flag: '플래그' };
const ORDER_LABEL = { created: '만든 순서', 'low-rounds': '회독 낮은 순', random: '랜덤' };
const FLAG_NAME = ['없음', '빨강', '주황', '노랑', '초록', '청록', '파랑', '보라'];

/** 범위별 보조 선택 UI (폴더=모달 버튼 / 플래그=색 스와치 / 선택카드=모달 버튼) */
function scopeDetailHtml(cfg) {
  if (cfg.scope === 'folder') {
    const name = cfg.folderId ? getFolder(cfg.folderId)?.name : null;
    return `<button type="button" class="ghost small" data-action="pick-study-folder">📁 ${name ? `폴더: ${escapeHtml(name)}` : '폴더 선택'}</button>`;
  }
  if (cfg.scope === 'selected') {
    return `<button type="button" class="ghost small" data-action="pick-study-cards">🗂 학습할 카드 고르기</button>`;
  }
  if (cfg.scope === 'flag') {
    const swatches = [1, 2, 3, 4, 5, 6, 7].map((n) =>
      `<button type="button" class="flag-pick${cfg.flag === n ? ' active' : ''}" data-action="pick-study-flag" data-flag="${n}" title="${FLAG_NAME[n]}"><span class="flag flag-${n}"></span></button>`).join('');
    return `<span class="caption">플래그 색:</span><div class="flag-picker">${swatches}</div>`;
  }
  return '';
}

function scopeText(cfg) {
  if (cfg.scope === 'folder') return `폴더 '${escapeHtml(getFolder(cfg.folderId)?.name || '')}'`;
  if (cfg.scope === 'flag') return `${FLAG_NAME[cfg.flag] || ''} 플래그`;
  return SCOPE_LABEL[cfg.scope];
}

/** 학습 세트 구성 화면 — 범위·순서 + 범위별 보조선택 + 실시간 요약/장수 + 이어서 학습 */
export function renderStudySetup() {
  syncThresholdControls();
  const scopeEl = document.getElementById('studyScope');
  if (!scopeEl) return;
  const orderEl = document.getElementById('studyOrder');
  const detail = document.getElementById('studyScopeDetail');
  const summary = document.getElementById('studySummary');
  const startBtn = document.getElementById('startStudyBtn');

  const state = getState();
  const cfg = { scope: 'all', order: 'created', folderId: null, flag: 1, ...(state?.ui?.studyConfig || {}) };

  scopeEl.value = cfg.scope;
  orderEl.value = cfg.order;
  detail.innerHTML = scopeDetailHtml(cfg);

  const cards = buildStudyQueue({
    scope: cfg.scope, order: cfg.order, folderId: cfg.folderId, flag: cfg.flag,
    selectedIds: state?.selectedIds || [],
  });
  const count = cards.length;

  let needPick = '';
  if (cfg.scope === 'folder' && !cfg.folderId) needPick = '학습할 폴더를 선택하세요.';
  else if (cfg.scope === 'flag' && !cfg.flag) needPick = '플래그 색을 선택하세요.';
  else if (cfg.scope === 'selected' && count === 0) needPick = '「학습할 카드 고르기」로 카드를 선택하세요.';

  if (needPick) {
    summary.textContent = needPick;
    summary.classList.add('warn');
  } else {
    summary.innerHTML = count
      ? `<strong>${scopeText(cfg)}</strong> · ${count}장 · 순서: ${ORDER_LABEL[cfg.order]}`
      : `<strong>${scopeText(cfg)}</strong> · 해당하는 카드가 없습니다.`;
    summary.classList.toggle('warn', count === 0);
  }
  if (startBtn) {
    startBtn.disabled = count === 0;
    startBtn.textContent = count ? `새로 시작 (${count}장)` : '새로 시작';
  }

  const preview = document.getElementById('studyPreviewList');
  if (preview) {
    if (needPick || !count) {
      preview.innerHTML = '';
    } else {
      preview.innerHTML = `
        <div class="study-preview-head caption">포함된 카드 ${count}장</div>
        <div class="study-preview-list">${cards.map((c) => `
          <div class="study-preview-item">
            <span class="flag flag-${c.flagColor}"></span>
            <span class="study-preview-title">${escapeHtml(shorten(c.title || c.displayText, 40))}</span>
            <span class="study-preview-meta">${escapeHtml(folderPathNames(c.folderId))} · 빈칸 ${c.blanks.length}</span>
          </div>`).join('')}</div>`;
    }
  }

  renderResumePanel({
    mountId: 'studyResumeMount',
    variant: 'study',
    sess: getPersistedStudySession(),
  });
}

/** 학습 메타·임계값 라벨 */
export function getGradingThreshold() {
  return Number(getState().settings.gradingThreshold ?? 80);
}

export function syncThresholdControls() {
  const v = getGradingThreshold();
  for (const id of ['gradingThreshold', 'gradingThresholdPlay']) {
    const el = document.getElementById(id);
    if (el) el.value = String(v);
  }
  const label = `${v}% 이상`;
  for (const id of ['thresholdLabel', 'thresholdLabelPlay']) {
    const el = document.getElementById(id);
    if (el) el.textContent = label;
  }
}

export function setGradingThreshold(value) {
  getState().settings.gradingThreshold = Number(value);
  syncThresholdControls();
}

export function renderStudyMeta() {
  syncThresholdControls();

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
    store._studyCardId = c.id;
    const restored = loadCardProgress(c.id);
    if (!restored) {
      store.currentBlankStatuses = c.blanks.map((b) => ({
        order: b.order, checked: false, correct: false, score: 0, user: '', revealed: false,
      }));
      store.studyAttemptRecorded = false;
      store.currentBlankFocus = null;
    } else {
      const nextOrder = store.currentBlankFocus
        ?? store.currentBlankStatuses.find((s) => !s.checked)?.order;
      if (nextOrder) {
        requestAnimationFrame(() => focusBlankUI(nextOrder));
      }
    }
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
    input.readOnly = false;
  });
}

/** DOM 입력값 → 모델 흡수 (단일 출처 유지). 채점 여부와 무관하게 현재 입력을 보존 — 채점 후에도 수정·삭제 가능 */
export function syncDraftFromDOM() {
  store.currentBlankStatuses.forEach((s) => {
    const input = document.querySelector(`[data-blank-order="${s.order}"]`);
    if (input) s.user = input.value;
  });
}

export function refreshStudyViews({ focusOrder } = {}) {
  const c = store.studyQueue[store.studyIndex];
  if (!c) return;
  syncDraftFromDOM();
  document.getElementById('studyPrompt').innerHTML = formatProblemHtml(c.displayText);
  document.getElementById('studyExplanation').innerHTML = formatStudyExplanationHtml(c, store.currentBlankStatuses);
  paintInlineBlanks(store.currentBlankStatuses);
  if (focusOrder != null) focusBlankInput(focusOrder);
}

function focusBlankInput(order) {
  const input = document.querySelector(`[data-blank-order="${order}"]`);
  if (!input) return;
  input.focus();
  const len = input.value.length;
  input.setSelectionRange(len, len);
}

/** 빈칸 이동 — 입력 보존을 위해 패널을 재생성하지 않고 포커스·하이라이트만 갱신 */
export function focusBlankUI(order) {
  syncDraftFromDOM();
  store.currentBlankFocus = order;
  const input = document.querySelector(`[data-blank-order="${order}"]`);
  if (input) {
    input.focus();
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  paintInlineBlanks(store.currentBlankStatuses);
}

export function getBlankInputValue(order) {
  return document.querySelector(`[data-blank-order="${order}"]`)?.value?.trim() || '';
}

/** 채점 후 답을 지우거나 바꾸면 해당 칸만 다시 풀기 상태로 */
export function resetBlankGradeIfEdited(order, value) {
  const st = store.currentBlankStatuses.find((s) => s.order === order);
  if (!st?.checked) return false;
  const trimmed = String(value ?? '').trim();
  if (trimmed === String(st.user ?? '').trim()) return false;
  st.checked = false;
  st.correct = false;
  st.score = 0;
  st.revealed = false;
  st.user = value;
  paintInlineBlanks(store.currentBlankStatuses);
  const wrap = document.getElementById(`blankWrap${order}`);
  wrap?.querySelector('.blank-answer')?.remove();
  wrap?.classList.remove('revealing');
  return true;
}

function canBlankPeek(order) {
  const st = store.currentBlankStatuses.find((s) => s.order === order);
  if (!st?.checked) return true;
  return !getBlankInputValue(order);
}

// ── 호버 정답 엿보기 (모를 때 잠깐 보기) ──
const PEEK_DELAY_MS = 1500;
const PEEK_SHOW_MS = 500;
const PEEK_GAUGE_C = 2 * Math.PI * 8;

let peekHideTimer = null;
let peekEl = null;
let peekGaugeEl = null;
let peekGaugeRaf = null;
let peekTargetInput = null;
let peekStartTime = 0;

function ensurePeekEl() {
  if (peekEl) return peekEl;
  peekEl = document.createElement('div');
  peekEl.className = 'blank-peek';
  document.body.appendChild(peekEl);
  return peekEl;
}

function ensurePeekGaugeEl() {
  if (peekGaugeEl) return peekGaugeEl;
  peekGaugeEl = document.createElement('div');
  peekGaugeEl.className = 'blank-peek-gauge';
  peekGaugeEl.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle class="blank-peek-gauge__track" cx="10" cy="10" r="8"/><circle class="blank-peek-gauge__fill" cx="10" cy="10" r="8"/></svg>';
  document.body.appendChild(peekGaugeEl);
  return peekGaugeEl;
}

function positionPeekGauge(input) {
  const gauge = ensurePeekGaugeEl();
  const r = input.getBoundingClientRect();
  gauge.style.left = `${r.right + window.scrollX + 4}px`;
  gauge.style.top = `${r.top + window.scrollY + (r.height - 20) / 2}px`;
  return gauge;
}

function setPeekGaugeProgress(progress) {
  const p = Math.min(Math.max(progress, 0), 1);
  ensurePeekGaugeEl().querySelector('.blank-peek-gauge__fill')?.style.setProperty(
    'stroke-dashoffset', String(PEEK_GAUGE_C * (1 - p)),
  );
}

function hidePeekGauge() {
  if (peekGaugeRaf) cancelAnimationFrame(peekGaugeRaf);
  peekGaugeRaf = null;
  peekStartTime = 0;
  peekTargetInput = null;
  if (peekGaugeEl) {
    peekGaugeEl.classList.remove('show', 'ready');
    setPeekGaugeProgress(0);
  }
}

function hidePeek() {
  clearTimeout(peekHideTimer);
  hidePeekGauge();
  if (peekEl) peekEl.classList.remove('show');
}

function showPeekAnswer(input, answer) {
  hidePeekGauge();
  const el = ensurePeekEl();
  el.textContent = answer;
  const r = input.getBoundingClientRect();
  el.style.left = `${r.left + window.scrollX}px`;
  el.style.top = `${r.top + window.scrollY - 34}px`;
  el.classList.add('show');
  peekHideTimer = setTimeout(() => el.classList.remove('show'), PEEK_SHOW_MS);
}

function tickPeekGauge() {
  if (!peekTargetInput) return;
  const elapsed = Date.now() - peekStartTime;
  const progress = elapsed / PEEK_DELAY_MS;
  setPeekGaugeProgress(progress);
  ensurePeekGaugeEl().classList.add('show');

  if (progress >= 1) {
    peekGaugeRaf = null;
    ensurePeekGaugeEl().classList.add('ready');
    const order = Number(peekTargetInput.dataset.blankOrder);
    const c = store.studyQueue[store.studyIndex];
    const blank = c?.blanks.find((b) => b.order === order);
    const answer = splitAnswers(blank?.answer)[0] || '';
    if (answer) showPeekAnswer(peekTargetInput, answer);
    return;
  }
  peekGaugeRaf = requestAnimationFrame(tickPeekGauge);
}

/** 빈칸 위 1.5초 호버(게이지) → 정답 잠깐 표시 후 사라짐 */
export function handleBlankPeekOver(e) {
  const input = e.target.closest?.('.blank-field');
  if (!input) return;
  const order = Number(input.dataset.blankOrder);
  if (!canBlankPeek(order)) return;
  const c = store.studyQueue[store.studyIndex];
  const blank = c?.blanks.find((b) => b.order === order);
  const answer = splitAnswers(blank?.answer)[0] || '';
  if (!answer) return;

  if (peekTargetInput === input && peekGaugeRaf) return;

  hidePeek();
  peekTargetInput = input;
  peekStartTime = Date.now();
  positionPeekGauge(input);
  setPeekGaugeProgress(0);
  peekGaugeRaf = requestAnimationFrame(tickPeekGauge);
}

export function handleBlankPeekOut(e) {
  if (!e.target.closest?.('.blank-field')) return;
  hidePeek();
}

/** @deprecated — 인라인 방식으로 대체 */
export function paintStatuses() { paintInlineBlanks(store.currentBlankStatuses); }
export function refreshStudyPrompt() { refreshStudyViews(); }
export function renderReveal() {}
