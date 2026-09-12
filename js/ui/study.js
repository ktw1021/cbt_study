import { store } from '../core/store.js';
import { escapeHtml, shorten } from '../utils/text.js';
import { getState } from '../core/store.js';
import { folderPathNames, buildStudyQueue, getFolder } from '../domain/queries.js';
import { acceptedAnswers } from '../domain/blank.js';
import { loadCardProgress, getPersistedStudySession } from '../services/study-session.js';
import { renderResumePanel } from './resume-panel.js';
import { formatProblemHtml, formatStudyExplanationHtml } from './prompt.js';
import { renderStudyEditForm } from './create.js';
import { getBlankInputValue, syncDraftFromDOM, focusBlankField } from './blank-input.js';

export { getBlankInputValue, syncDraftFromDOM };

const SCOPE_LABEL = { all: '전체 카드', folder: '폴더들', wrong: '최근 오답', flag: '플래그' };
const ORDER_LABEL = { created: '만든 순서', 'low-rounds': '회독 낮은 순', random: '랜덤' };
const FLAG_NAME = ['없음', '빨강', '주황', '노랑', '초록', '청록', '파랑', '보라'];

/** 범위별 보조 선택 UI (폴더=모달 버튼 / 플래그=색 스와치) */
function scopeDetailHtml(cfg) {
  if (cfg.scope === 'folder') {
    const names = (cfg.folderIds || []).map((id) => getFolder(id)?.name).filter(Boolean);
    let label = '폴더 선택';
    if (names.length === 1) label = `폴더: ${names[0]}`;
    else if (names.length > 1) label = `폴더 ${names.length}개`;
    return `<button type="button" class="ghost small" data-action="pick-study-folder">📁 ${escapeHtml(label)}</button>`;
  }
  if (cfg.scope === 'flag') {
    const swatches = [1, 2, 3, 4, 5, 6, 7].map((n) =>
      `<button type="button" class="flag-pick${cfg.flag === n ? ' active' : ''}" data-action="pick-study-flag" data-flag="${n}" title="${FLAG_NAME[n]}"><span class="flag flag-${n}"></span></button>`).join('');
    return `<span class="caption">플래그 색:</span><div class="flag-picker">${swatches}</div>`;
  }
  return '';
}

function scopeText(cfg) {
  if (cfg.scope === 'folder') {
    const names = (cfg.folderIds || []).map((id) => getFolder(id)?.name).filter(Boolean);
    if (!names.length) return '폴더';
    if (names.length === 1) return `폴더 '${escapeHtml(names[0])}'`;
    return `폴더 ${names.length}개 (${names.map(escapeHtml).join(', ')})`;
  }
  if (cfg.scope === 'flag') return `${FLAG_NAME[cfg.flag] || ''} 플래그`;
  return SCOPE_LABEL[cfg.scope] || SCOPE_LABEL.all;
}

function normalizeStudyCfg(raw) {
  const cfg = { scope: 'all', order: 'created', folderIds: [], flag: 1, ...(raw || {}) };
  if (cfg.scope === 'selected') cfg.scope = 'all';
  if (!Array.isArray(cfg.folderIds)) cfg.folderIds = [];
  if (cfg.folderId && !cfg.folderIds.length) cfg.folderIds = [cfg.folderId];
  delete cfg.folderId;
  return cfg;
}

/** 미리보기 체크 집합 — null이면 목록 전부 선택 */
export function getStudySetupCheckedSet(poolIds) {
  if (store.studySetupCheckedIds == null) return new Set(poolIds);
  return new Set(store.studySetupCheckedIds);
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
  const cfg = normalizeStudyCfg(state?.ui?.studyConfig);

  scopeEl.value = cfg.scope;
  orderEl.value = cfg.order;
  detail.innerHTML = scopeDetailHtml(cfg);

  const cards = buildStudyQueue({
    scope: cfg.scope, order: cfg.order, folderIds: cfg.folderIds, flag: cfg.flag,
  });
  const poolIds = cards.map((c) => c.id);
  const poolKey = `${cfg.scope}|${(cfg.folderIds || []).join(',')}|${cfg.flag || ''}`;
  if (store.studySetupPoolKey !== poolKey) {
    store.studySetupPoolKey = poolKey;
    store.studySetupCheckedIds = null; // 범위가 바뀌면 다시 전부 체크
  }
  const checked = getStudySetupCheckedSet(poolIds);
  const checkedCards = cards.filter((c) => checked.has(c.id));
  const checkedCount = checkedCards.length;
  const poolCount = cards.length;

  let needPick = '';
  if (cfg.scope === 'folder' && !(cfg.folderIds || []).length) needPick = '학습할 폴더를 선택하세요.';
  else if (cfg.scope === 'flag' && !cfg.flag) needPick = '플래그 색을 선택하세요.';

  if (needPick) {
    summary.textContent = needPick;
    summary.classList.add('warn');
  } else {
    summary.innerHTML = poolCount
      ? `<strong>${scopeText(cfg)}</strong> · ${checkedCount}/${poolCount}장 · 순서: ${ORDER_LABEL[cfg.order]}`
      : `<strong>${scopeText(cfg)}</strong> · 해당하는 카드가 없습니다.`;
    summary.classList.toggle('warn', checkedCount === 0);
  }
  if (startBtn) {
    startBtn.disabled = checkedCount === 0;
    startBtn.textContent = checkedCount ? `새로 시작 (${checkedCount}장)` : '새로 시작';
  }

  const preview = document.getElementById('studyPreviewList');
  if (preview) {
    const listEl = preview.querySelector('.study-preview-list');
    const savedScroll = listEl?.scrollTop ?? 0;
    if (needPick || !poolCount) {
      preview.innerHTML = '';
    } else {
      preview.innerHTML = `
        <div class="study-preview-head caption">
          <span data-study-preview-count>포함된 카드 ${checkedCount}/${poolCount}장</span>
          <span class="study-preview-head-actions">
            <button type="button" class="ghost small" data-action="study-setup-select-all">전체 선택</button>
            <button type="button" class="ghost small" data-action="study-setup-deselect-all">전체 해제</button>
          </span>
        </div>
        <div class="study-preview-list">${cards.map((c) => `
          <div class="study-preview-item">
            <label class="study-preview-main">
              <input type="checkbox" data-action="toggle-study-setup-card" data-id="${c.id}" ${checked.has(c.id) ? 'checked' : ''} />
              <span class="flag flag-${c.flagColor}"></span>
              <span class="study-preview-title">${escapeHtml(shorten(c.title || c.displayText, 40))}</span>
              <span class="study-preview-meta">${escapeHtml(folderPathNames(c.folderId))} · 빈칸 ${c.blanks.length}</span>
            </label>
            <span class="study-preview-actions">
              <button type="button" class="primary small" data-action="edit-card" data-id="${c.id}">수정</button>
              <button type="button" class="pink small" data-action="study-one" data-id="${c.id}">학습</button>
            </span>
          </div>`).join('')}</div>`;
      const nextList = preview.querySelector('.study-preview-list');
      if (nextList) nextList.scrollTop = savedScroll;
    }
  }

  renderResumePanel({
    mountId: 'studyResumeMount',
    variant: 'study',
    sess: getPersistedStudySession(),
  });
}

/** 체크만 바꿀 때 — 목록 HTML을 안 갈아엎어 스크롤 유지 */
export function refreshStudySetupChecksOnly() {
  const state = getState();
  const cfg = normalizeStudyCfg(state?.ui?.studyConfig);
  const cards = buildStudyQueue({
    scope: cfg.scope, order: cfg.order, folderIds: cfg.folderIds, flag: cfg.flag,
  });
  const checked = getStudySetupCheckedSet(cards.map((c) => c.id));
  const checkedCount = cards.filter((c) => checked.has(c.id)).length;
  const poolCount = cards.length;

  let needPick = '';
  if (cfg.scope === 'folder' && !(cfg.folderIds || []).length) needPick = '학습할 폴더를 선택하세요.';
  else if (cfg.scope === 'flag' && !cfg.flag) needPick = '플래그 색을 선택하세요.';

  const summary = document.getElementById('studySummary');
  const startBtn = document.getElementById('startStudyBtn');
  if (needPick) {
    summary.textContent = needPick;
    summary.classList.add('warn');
  } else {
    summary.innerHTML = poolCount
      ? `<strong>${scopeText(cfg)}</strong> · ${checkedCount}/${poolCount}장 · 순서: ${ORDER_LABEL[cfg.order]}`
      : `<strong>${scopeText(cfg)}</strong> · 해당하는 카드가 없습니다.`;
    summary.classList.toggle('warn', checkedCount === 0);
  }
  if (startBtn) {
    startBtn.disabled = checkedCount === 0;
    startBtn.textContent = checkedCount ? `새로 시작 (${checkedCount}장)` : '새로 시작';
  }
  const countEl = document.querySelector('[data-study-preview-count]');
  if (countEl && !needPick) countEl.textContent = `포함된 카드 ${checkedCount}/${poolCount}장`;

  document.querySelectorAll('#studyPreviewList input[data-action="toggle-study-setup-card"]').forEach((el) => {
    el.checked = checked.has(el.dataset.id);
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
      store.studyRoundRecorded = false;
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
    ? `채점 ${ok}/${c.blanks.length} · Enter 또는 다른 칸으로 이동 시 채점`
    : '해설에서 빈칸 입력 → Enter 또는 다음 칸으로 이동 시 채점';
  renderStudyEditForm(c);
}

const ANSWER_GAP = 11;
const ANSWER_OVERLAP_PAD = 3;

function answerBoxesOverlap(a, b, pad = ANSWER_OVERLAP_PAD) {
  return a.left < b.right + pad && b.left < a.right + pad
    && a.top < b.bottom + pad && b.top < a.bottom + pad;
}

/**
 * 정답은 폭 0 자리표시자(빈칸 끝)에 들어 있지만, 좌표는 해설 본문 기준이다.
 * 자리표시자 기준으로 왼쪽으로 당기면 overflow-x:hidden 에 잘리거나, 측정 실패 시
 * 빈칸 끝(문장 한가운데)에 남는다. 빈칸 줄상자 중 가장 왼쪽·자리표시자 세로에 앉힌다.
 * 같은 줄에 오답이 여럿이면 실제 박스가 겹칠 때만 아래 행으로 내린다.
 */
export function layoutBlankAnswers(root = document) {
  const groups = new Map();
  root.querySelectorAll('.blank-answer-holder').forEach((holder) => {
    const wrap = holder.previousElementSibling;
    const answer = holder.firstElementChild;
    const host = holder.closest('.explanation-body');
    if (!wrap || !answer || !host) return;
    const list = groups.get(host) || [];
    list.push({ holder, wrap, answer });
    groups.set(host, list);
  });

  groups.forEach((items, host) => {
    const placed = [];
    items.forEach(({ holder, wrap, answer }) => {
      const lines = [...wrap.getClientRects()].filter((r) => r.width >= 1 && r.height >= 1);
      if (!lines.length) return;
      const leftEdge = Math.min(...lines.map((r) => r.left));
      const hostRect = host.getBoundingClientRect();
      const left = leftEdge - hostRect.left;
      answer.style.left = `${left}px`;
      answer.style.maxWidth = `${Math.max(hostRect.right - leftEdge - 8, 80)}px`;

      const width = answer.offsetWidth;
      const height = answer.offsetHeight;
      const lineH = parseFloat(getComputedStyle(answer).lineHeight) || height;
      const rowStep = Math.max(Math.round(lineH + 4), 18);

      holder.style.height = `${ANSWER_GAP + height}px`;
      holder.style.verticalAlign = `-${ANSWER_GAP + height}px`;
      const hostRect2 = host.getBoundingClientRect();
      const holderRect2 = holder.getBoundingClientRect();
      const prefTop = holderRect2.top - hostRect2.top + ANSWER_GAP;

      let row = 0;
      let top = prefTop;
      let box = { left, right: left + width, top, bottom: top + height };
      while (placed.some((p) => answerBoxesOverlap(box, p))) {
        row += 1;
        top = prefTop + row * rowStep;
        box = { left, right: left + width, top, bottom: top + height };
      }

      const need = ANSWER_GAP + row * rowStep + height;
      holder.style.height = `${need}px`;
      holder.style.verticalAlign = `-${need}px`;
      const hostRect3 = host.getBoundingClientRect();
      const holderRect3 = holder.getBoundingClientRect();
      top = holderRect3.top - hostRect3.top + ANSWER_GAP + row * rowStep;
      box = { left, right: left + width, top, bottom: top + height };
      answer.style.top = `${top}px`;
      answer.classList.add('is-placed');
      placed.push(box);
    });
  });
}

let answerLayoutRaf = 0;
/** 그리드 접힘 애니메이션·폰트 반영 뒤에 한 번 더 앉힌다. */
export function layoutBlankAnswersSoon() {
  layoutBlankAnswers();
  cancelAnimationFrame(answerLayoutRaf);
  answerLayoutRaf = requestAnimationFrame(() => {
    layoutBlankAnswers();
    answerLayoutRaf = requestAnimationFrame(() => layoutBlankAnswers());
  });
}

let answerLayoutObs = null;
export function watchBlankAnswerLayout() {
  if (answerLayoutObs || typeof ResizeObserver === 'undefined') return;
  answerLayoutObs = new ResizeObserver(() => layoutBlankAnswersSoon());
  const layout = document.querySelector('.study-layout');
  const expl = document.getElementById('studyExplanation');
  if (layout) answerLayoutObs.observe(layout);
  if (expl) answerLayoutObs.observe(expl);
}

/** 인라인 빈칸 UI 상태 반영 */
export function paintInlineBlanks(statuses) {
  statuses.forEach((s) => {
    const input = document.querySelector(`[data-blank-order="${s.order}"]`);
    if (!input) return;
    input.classList.toggle('ok', s.correct);
    input.classList.toggle('bad', s.checked && !s.correct);
    input.classList.toggle('focus', store.currentBlankFocus === s.order);
  });
  layoutBlankAnswersSoon();
}

export function refreshStudyViews({ focusOrder, caretOffset = null } = {}) {
  const c = store.studyQueue[store.studyIndex];
  if (!c) return;
  syncDraftFromDOM();
  document.getElementById('studyPrompt').innerHTML = formatProblemHtml(c.displayText);
  document.getElementById('studyExplanation').innerHTML = formatStudyExplanationHtml(c, store.currentBlankStatuses);
  paintInlineBlanks(store.currentBlankStatuses);
  if (focusOrder != null) focusBlankInput(focusOrder, caretOffset);
}

function focusBlankInput(order, caretOffset = null) {
  focusBlankField(document.querySelector(`[data-blank-order="${order}"]`), { caretOffset });
}

/** 빈칸 이동 — 입력 보존을 위해 패널을 재생성하지 않고 포커스·하이라이트만 갱신 */
export function focusBlankUI(order) {
  syncDraftFromDOM();
  store.currentBlankFocus = order;
  const input = document.querySelector(`[data-blank-order="${order}"]`);
  if (input) {
    focusBlankField(input);
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  paintInlineBlanks(store.currentBlankStatuses);
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
  // 빈칸 바깥의 형제라 지워도 입력 중인 칸의 캐럿에 영향이 없다.
  document.querySelector(`[data-blank-answer="${order}"]`)?.remove();
  layoutBlankAnswersSoon();
  return true;
}

// ── 호버 정답 엿보기 (모를 때 보기) ──
// 채점 전후 모두 열어둔다. 볼지 말지는 사용자가 정하고, 대기 게이지가 그 문턱 역할을 한다.
const PEEK_DELAY_MS = 1500;
const PEEK_DELAY_GRADED_MS = 300;
const PEEK_GAUGE_C = 2 * Math.PI * 8;

let peekEl = null;
let peekGaugeEl = null;
let peekGaugeRaf = null;
let peekTargetInput = null;
let peekStartTime = 0;
let peekDelayMs = PEEK_DELAY_MS;
let peekPointer = { x: 0, y: 0 };
/** 타이핑으로 ○○○가 줄어들 때 가짜 mouseout 무시 */
let peekStickyWrap = null;
let peekStickyUntil = 0;

/** 인정되는 답(주 정답 + 동의어)을 모두 표시 */
function peekAnswerText(order) {
  const c = store.studyQueue[store.studyIndex];
  const blank = c?.blanks.find((b) => b.order === order);
  return acceptedAnswers(blank).join(' / ');
}

/** 채점이 끝난 빈칸은 확인이 목적이므로 대기를 짧게 */
function peekDelayFor(order) {
  const st = store.currentBlankStatuses.find((s) => s.order === order);
  return st?.checked ? PEEK_DELAY_GRADED_MS : PEEK_DELAY_MS;
}

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

function blankPeekAnchorEl(el) {
  return el?.closest?.('.blank-wrap') || el;
}

/** 여러 줄 빈칸이라도 '첫 줄' 박스 기준 — 전체 높이 중심 금지 */
function blankPeekTopRect(el) {
  const anchor = blankPeekAnchorEl(el);
  if (!anchor) return null;
  try {
    const range = document.createRange();
    range.selectNodeContents(anchor);
    const rects = range.getClientRects();
    if (rects?.length) return rects[0];
  } catch {
    /* ignore */
  }
  return anchor.getBoundingClientRect();
}

function positionPeekGauge(input) {
  const gauge = ensurePeekGaugeEl();
  const r = blankPeekTopRect(input);
  if (!r) return gauge;
  gauge.style.left = `${r.right + window.scrollX + 4}px`;
  gauge.style.top = `${r.top + window.scrollY + Math.max(0, (r.height - 20) / 2)}px`;
  return gauge;
}

function setPeekGaugeProgress(progress) {
  const p = Math.min(Math.max(progress, 0), 1);
  ensurePeekGaugeEl().querySelector('.blank-peek-gauge__fill')?.style.setProperty(
    'stroke-dashoffset', String(PEEK_GAUGE_C * (1 - p)),
  );
}

function hidePeekGauge({ clearTarget = true } = {}) {
  if (peekGaugeRaf) cancelAnimationFrame(peekGaugeRaf);
  peekGaugeRaf = null;
  peekStartTime = 0;
  if (clearTarget) peekTargetInput = null;
  if (peekGaugeEl) {
    peekGaugeEl.classList.remove('show', 'ready');
    setPeekGaugeProgress(0);
  }
}

function hidePeek() {
  hidePeekGauge();
  peekStickyWrap = null;
  peekStickyUntil = 0;
  if (peekEl) peekEl.classList.remove('show');
}

function showPeekAnswer(input, answer) {
  // 게이지만 내리고 타깃은 유지 — 힌트 표시 중 peekTargetInput=null이면 타이핑 시 재시작 flicker
  hidePeekGauge({ clearTarget: false });
  peekTargetInput = input;
  const el = ensurePeekEl();
  el.textContent = answer;
  const anchor = blankPeekAnchorEl(input);
  const r = blankPeekTopRect(input);
  if (!r) return;
  const panel = anchor?.closest?.('.study-explanation-scroll')
    || anchor?.closest?.('.explanation-body')
    || anchor?.closest?.('.study-panel-body');
  const panelR = panel?.getBoundingClientRect();
  const left = r.left + window.scrollX;
  const maxRight = (panelR ? panelR.right : window.innerWidth - 12) + window.scrollX;
  el.style.maxWidth = `${Math.max(120, maxRight - left - 8)}px`;
  el.style.left = `${left}px`;
  el.classList.add('show');
  // 힌트 '아래쪽'이 빈칸 첫 줄 바로 위에 오도록 (아래로 커져서 가리지 않음)
  requestAnimationFrame(() => {
    const pr = el.getBoundingClientRect();
    let top = r.top + window.scrollY - pr.height - 6;
    if (top < window.scrollY + 4) {
      // 위 공간 부족 시에만 첫 줄 아래(빈칸을 덮지 않게 첫 줄 높이만큼 띄움)
      top = r.bottom + window.scrollY + 6;
    }
    el.style.top = `${top}px`;
  });
}

function tickPeekGauge() {
  if (!peekTargetInput) return;
  const elapsed = Date.now() - peekStartTime;
  const progress = elapsed / peekDelayMs;
  setPeekGaugeProgress(progress);
  ensurePeekGaugeEl().classList.add('show');

  if (progress >= 1) {
    peekGaugeRaf = null;
    ensurePeekGaugeEl().classList.add('ready');
    const order = Number(peekTargetInput.dataset.blankOrder);
    const answer = peekAnswerText(order);
    if (answer) showPeekAnswer(peekTargetInput, answer);
    return;
  }
  peekGaugeRaf = requestAnimationFrame(tickPeekGauge);
}

/** 빈칸 위 호버(게이지) → 정답 표시, 마우스를 떼면 숨김 */
export function handleBlankPeekOver(e) {
  const wrap = e.target.closest?.('.blank-wrap');
  const input = wrap?.querySelector?.('.blank-field') || e.target.closest?.('.blank-field');
  if (!input) return;
  const order = Number(input.dataset.blankOrder);
  if (!peekAnswerText(order)) return;

  peekPointer = { x: e.clientX, y: e.clientY };

  // 같은 칸에서 게이지·엿보기가 이미 진행 중이면 재시작하지 않음 (타이핑 리플로우 flicker 방지)
  if (peekTargetInput === input) {
    if (peekGaugeRaf || peekEl?.classList.contains('show')) return;
  }

  hidePeek();
  peekTargetInput = input;
  peekDelayMs = peekDelayFor(order);
  peekStartTime = Date.now();
  positionPeekGauge(wrap || input);
  setPeekGaugeProgress(0);
  peekGaugeRaf = requestAnimationFrame(tickPeekGauge);
}

export function handleBlankPeekMove(e) {
  if (!e.target.closest?.('.blank-wrap')) return;
  peekPointer = { x: e.clientX, y: e.clientY };
}

export function handleBlankPeekOut(e) {
  if (!e.target.closest?.('.blank-wrap') && !e.target.closest?.('.blank-field')) return;
  const fromWrap = e.target.closest?.('.blank-wrap');
  const to = e.relatedTarget;
  if (to?.closest?.('.blank-wrap') === fromWrap) return;
  // 타이핑으로 ○ 마스크가 줄어든 직후 가짜 leave
  if (fromWrap && fromWrap === peekStickyWrap && Date.now() < peekStickyUntil) return;
  hidePeek();
}

/** 마스크 DOM 바꾸기 직전에 호출 — 가짜 mouseout이 hidePeek를 못 타게 */
export function armBlankPeekSticky(field) {
  const wrap = field?.closest?.('.blank-wrap');
  if (!wrap) return;
  const active = peekTargetInput === field
    || peekStickyWrap === wrap
    || peekEl?.classList.contains('show')
    || !!peekGaugeRaf;
  if (!active) return;
  peekStickyWrap = wrap;
  peekStickyUntil = Date.now() + 400;
}

/**
 * ○○○ 마스크가 줄어든 뒤에도 마우스가 같은 빈칸 위에 있으면
 * 힌트를 딜레이 없이 유지·재표시 (사라졌다 다시 뜨는 깜빡임 방지)
 */
export function retainBlankPeekAfterEdit(field) {
  if (!field?.matches?.('.blank-field')) return;
  const wrap = field.closest('.blank-wrap');
  if (!wrap) return;
  const wasPeeking = peekTargetInput === field
    || peekStickyWrap === wrap
    || peekEl?.classList.contains('show');
  if (!wasPeeking) return;

  peekStickyWrap = wrap;
  peekStickyUntil = Date.now() + 400;

  requestAnimationFrame(() => {
    const under = document.elementFromPoint(peekPointer.x, peekPointer.y);
    if (under?.closest?.('.blank-wrap') !== wrap) return;
    const order = Number(field.dataset.blankOrder);
    const answer = peekAnswerText(order);
    if (!answer) return;
    if (peekGaugeRaf && peekTargetInput === field) {
      positionPeekGauge(field);
      return;
    }
    showPeekAnswer(field, answer);
  });
}

/**
 * 회독 성공 토스트 — 마지막으로 채점된 빈칸 옆에 떴다가 위로 사라진다.
 * 애니메이션이 끝나면 resolve하므로 호출부에서 다음 단계를 이어 붙일 수 있다.
 */
export function showRoundToast(order, text = '+1 회독 성공') {
  const anchor = document.getElementById(`blankWrap${order}`)
    || document.querySelector(`[data-blank-order="${order}"]`);
  if (!anchor) return Promise.resolve();

  const el = document.createElement('div');
  el.className = 'round-toast';
  el.textContent = text;
  const r = anchor.getBoundingClientRect();
  el.style.left = `${r.right + window.scrollX + 8}px`;
  el.style.top = `${r.top + window.scrollY}px`;
  document.body.appendChild(el);

  return new Promise((resolve) => {
    const done = () => { el.remove(); resolve(); };
    el.addEventListener('animationend', done, { once: true });
    setTimeout(done, 1600);
  });
}
