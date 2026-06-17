import { escapeHtml } from '../utils/text.js';
import {
  parseOutlineFromText,
  diffOutlineItems,
  normalizeOutline,
} from '../domain/outline.js';

function cloneItems(items) {
  return (items || []).map((it) => ({ ...it }));
}

function cssEscape(id) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(String(id));
  return String(id).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** input value 속성용 — 줄바꿈·따옴표 등 HTML attribute 깨짐 방지 */
function attrValue(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/\r\n|\n|\r|\t/g, ' ');
}

function resolveItemTitle(it) {
  const t = String(it?.title ?? '').trim();
  if (t) return t;
  const raw = String(it?.rawLine ?? '').trim();
  if (!raw) return '';
  const label = String(it?.label ?? '').trim();
  if (label && raw.startsWith(label)) return raw.slice(label.length).trim();
  return raw;
}

function copyPreviewToWorking(previewItems) {
  return (previewItems || []).map((it) => ({
    ...it,
    title: resolveItemTitle(it),
    enabled: it.enabled !== false,
  }));
}

function saveScrollPositions(root) {
  return {
    working: root.querySelector('.outline-pane-working .outline-tree-scroll')?.scrollTop ?? 0,
    preview: root.querySelector('.outline-pane-preview .outline-tree-scroll')?.scrollTop ?? 0,
  };
}

function restoreScrollPositions(root, saved) {
  requestAnimationFrame(() => {
    const w = root.querySelector('.outline-pane-working .outline-tree-scroll');
    const p = root.querySelector('.outline-pane-preview .outline-tree-scroll');
    if (w && saved) w.scrollTop = saved.working;
    if (p && saved) p.scrollTop = saved.preview;
  });
}

/** innerHTML 후 state → input.value 직접 반영 (value 속성 파싱 이슈 회피) */
function hydrateWorkingFromState(root, items) {
  for (const it of items || []) {
    const id = it.id;
    if (!id) continue;
    const sel = cssEscape(id);
    const titleEl = root.querySelector(`[data-working-title][data-id="${sel}"]`);
    if (titleEl) titleEl.value = resolveItemTitle(it);
    const lineEl = root.querySelector(`[data-working-line][data-id="${sel}"]`);
    if (lineEl) lineEl.value = String((Number(it.lineIndex) || 0) + 1);
    const chk = root.querySelector(`[data-working-enabled][data-id="${sel}"]`);
    if (chk) chk.checked = it.enabled !== false;
  }
}

/** 위계 트리 — working: 제목·행 편집 / preview: 읽기 전용 */
function renderOutlineTree(items, { mode, diff = null }) {
  const emptyWorking = '항목 없음 — 오른쪽 결과 확인 후 「왼쪽에 반영」하세요.';
  const emptyPreview = '해설에서 목차 줄을 찾지 못했습니다. 형식·빈 줄을 확인하세요.';

  if (!items?.length) {
    return `<div class="outline-tree-empty caption">${mode === 'working' ? emptyWorking : emptyPreview}</div>`;
  }

  const addedKeys = diff ? new Set(diff.added.map((it) => itemKey(it))) : null;

  return items.map((it) => {
    const key = itemKey(it);
    let rowCls = 'outline-tree-row';
    if (addedKeys?.has(key)) rowCls += ' is-new';

    const title = resolveItemTitle(it);
    const lineNo = (Number(it.lineIndex) || 0) + 1;
    const id = it.id;

    if (mode === 'working') {
      return `
    <div class="outline-tree-node" style="--ol-level:${Math.min(it.level || 0, 5)}" data-working-id="${attrValue(id)}">
      <div class="${rowCls}">
        <span class="outline-tree-badge">${escapeHtml(it.label || '·')}</span>
        <input type="text" class="outline-tree-title" data-working-title data-id="${attrValue(id)}"
          placeholder="목차 제목 (이 줄에서 쓸 부분)" title="목차로 쓸 텍스트 — 줄 뒤쪽 [행종연] 등은 잘라내도 됩니다" />
        <label class="outline-tree-check" title="자동 빈칸 후보에 포함">
          <input type="checkbox" data-working-enabled data-id="${attrValue(id)}" ${it.enabled !== false ? 'checked' : ''} />
        </label>
        <button type="button" class="ghost small outline-tree-del" data-action="outline-item-del" data-outline-del-id="${attrValue(id)}" title="목차에서 제외">×</button>
        <input type="number" class="outline-tree-line-input" data-working-line data-id="${attrValue(id)}"
          min="1" title="해설 행 번호" aria-label="해설 행" />
      </div>
    </div>`;
    }

    return `
    <div class="outline-tree-node" style="--ol-level:${Math.min(it.level || 0, 5)}">
      <div class="${rowCls}">
        <span class="outline-tree-badge">${escapeHtml(it.label || '·')}</span>
        <span class="outline-tree-title-read">${escapeHtml(title)}</span>
        <span class="outline-tree-line-num" title="해설 ${lineNo}행">${lineNo}행</span>
      </div>
    </div>`;
  }).join('');
}

function itemKey(it) {
  return `${it.lineIndex}:${it.label}:${resolveItemTitle(it)}`;
}

function syncWorkingFromDom(root, st) {
  st.workingItems = st.workingItems.map((it) => {
    const id = it.id;
    const sel = cssEscape(id);
    const titleEl = root.querySelector(`[data-working-title][data-id="${sel}"]`);
    const lineEl = root.querySelector(`[data-working-line][data-id="${sel}"]`);
    const lineVal = Number(lineEl?.value);
    const enabledEl = root.querySelector(`[data-working-enabled][data-id="${sel}"]`);
    return {
      ...it,
      title: titleEl ? titleEl.value.trim() : resolveItemTitle(it),
      lineIndex: Number.isFinite(lineVal) && lineVal >= 1 ? lineVal - 1 : it.lineIndex,
      enabled: enabledEl ? enabledEl.checked : it.enabled !== false,
    };
  });
}

function renderBody(root, scrollRestore = null) {
  const st = root._outlineState;
  const saved = scrollRestore ?? saveScrollPositions(root);
  const hasSaved = st.savedItems.length > 0;
  const hasPreview = !!st.previewItems?.length;
  const diff = hasPreview ? diffOutlineItems(st.workingItems, st.previewItems) : null;

  root.innerHTML = `<div class="modal-backdrop outline-backdrop">
    <div class="modal modal-wide outline-modal" role="dialog" aria-modal="true">
      <h3>목차 관리</h3>
      <p class="caption outline-help">
        <strong>Ⅰ. / 1. / 가. …</strong> 로 잡힌 줄의 <strong>제목</strong>과 <strong>행 번호</strong>는 왼쪽에서 고칠 수 있습니다.
        제목을 줄이면 그만큼만 목차·빈칸 후보로 씁니다. 해설을 바꿨으면 오른쪽 <strong>다시 인식</strong>.
      </p>

      <div class="outline-split">
        <section class="outline-pane outline-pane-working">
          <div class="outline-pane-head">
            <span>저장할 목차</span>
            <span class="pill">${st.workingItems.length}개</span>
          </div>
          <p class="caption outline-pane-hint">${hasSaved ? '제목·행 번호 수정, × 로 제외.' : '오른쪽과 맞으면 「왼쪽에 반영」 후 제목을 다듬으세요.'}</p>
          <div class="outline-tree-scroll outline-tree-scroll-working">${renderOutlineTree(st.workingItems, { mode: 'working' })}</div>
        </section>

        <section class="outline-pane outline-pane-preview">
          <div class="outline-pane-head">
            <span>자동 인식</span>
            <span class="pill">${hasPreview ? st.previewItems.length : '—'}개</span>
          </div>
          <p class="caption outline-pane-hint">열 때마다 현재 해설을 읽어 표시합니다.</p>
          <div class="outline-tree-scroll outline-tree-scroll-preview">${renderOutlineTree(st.previewItems || [], { mode: 'preview', diff })}</div>
          <div class="toolbar outline-pane-tools">
            <button type="button" class="primary small" data-action="outline-adopt-preview" ${hasPreview ? '' : 'disabled'}>← 왼쪽에 반영</button>
            <button type="button" class="ghost small" data-action="outline-run-preview">다시 인식</button>
          </div>
        </section>
      </div>

      <div class="toolbar outline-modal-foot">
        <button type="button" class="primary" data-action="apply-outline">목차 저장</button>
        <button type="button" class="ghost" data-action="outline-modal-cancel">취소</button>
      </div>
    </div>
  </div>`;

  hydrateWorkingFromState(root, st.workingItems);
  restoreScrollPositions(root, saved);
}

function runPreview(st) {
  const text = st.refreshExplanation?.() ?? '';
  st.previewItems = parseOutlineFromText(text).items;
}

/**
 * @param {{ explanationText: string, outline: object|null, refreshExplanation?: () => string, onApply: (outline) => void }} opts
 */
export function openOutlineModal({ explanationText, outline, refreshExplanation, onApply }) {
  const root = document.getElementById('modalRoot');
  const current = normalizeOutline(outline);
  const savedItems = cloneItems(current?.items);

  const st = {
    savedItems,
    workingItems: cloneItems(savedItems),
    previewItems: null,
    sourceOutline: current,
    refreshExplanation,
    onApply,
  };
  runPreview(st);

  root._outlineState = st;
  renderBody(root, { working: 0, preview: 0 });
}

export function handleOutlineModalAction(action, el) {
  const root = document.getElementById('modalRoot');
  const st = root._outlineState;
  if (!st) return false;

  const scroll = saveScrollPositions(root);

  if (action === 'outline-run-preview') {
    syncWorkingFromDom(root, st);
    runPreview(st);
    renderBody(root, scroll);
    return true;
  }

  if (action === 'outline-adopt-preview') {
    if (!st.previewItems?.length) return true;
    st.workingItems = copyPreviewToWorking(st.previewItems);
    renderBody(root, scroll);
    return true;
  }

  if (action === 'outline-item-del') {
    const id = el?.dataset?.outlineDelId;
    if (!id) return true;
    syncWorkingFromDom(root, st);
    st.workingItems = st.workingItems.filter((it) => it.id !== id);
    renderBody(root, scroll);
    return true;
  }

  if (action === 'apply-outline') {
    syncWorkingFromDom(root, st);
    const items = st.workingItems.filter((it) => String(it.title || '').trim());
    const now = new Date().toISOString();
    const outline = items.length
      ? {
        version: 1,
        items,
        updatedAt: now,
        generatedAt: st.sourceOutline?.generatedAt || now,
      }
      : null;
    st.onApply?.(outline);
    closeOutlineModal();
    return true;
  }

  if (action === 'outline-modal-cancel') {
    closeOutlineModal();
    return true;
  }

  return false;
}

export function isOutlineModalOpen() {
  return !!document.getElementById('modalRoot')?._outlineState;
}

export function closeOutlineModal() {
  const root = document.getElementById('modalRoot');
  delete root._outlineState;
  root.innerHTML = '';
}
