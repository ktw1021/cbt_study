/**
 * 제작·학습 편집기의 서식/각주 세션.
 * 본문은 칩 에디터 DOM, 서식·각주는 가시 offset 병렬 모델. 히스토리는 둘을 한 스냅샷으로 묶는다.
 */
import {
  addFootnote as addFn,
  addMark,
  applyTextEdit,
  clearMarksInRange,
  footnoteNumbers,
  normalizeCardTextMeta,
  normalizeFootnotes,
  normalizeMarks,
  selectionEffectiveAlign,
  removeFootnote as dropFn,
  toggleMark,
  updateFootnote as patchFn,
} from '../domain/text-marks.js';
import { normalizeNewlines } from '../utils/text.js';
import {
  editorVisibleAtoms,
  editorVisibleText,
  rebuildEditorVisibleText,
  getEditorSelectionOffsets,
  isChipEditorApplying,
  rangeToVisibleOffsets,
  registerEditorHistoryExtra,
  setVisibleSelection,
  snapshotEditor,
  resetEditorHistory,
  visibleOffsetFromPoint,
} from './chip-editor.js';
import { bindDelayedTooltips } from './delayed-tooltip.js';
import { renderMarkedHtml } from './mark-render.js';
import { pulseFootnote } from './footnote-feedback.js';
const sessions = new Map();
let colorChord = null;
let lastColor = 'k';
const COLOR_HEX = { k: '#111111', b: '#1d4ed8', r: '#dc2626', g: '#15803d' };
const metaListeners = [];
let chromeBound = false;

export function onEditorMetaChange(fn) {
  metaListeners.push(fn);
}

function emitEditorMeta() {
  metaListeners.forEach((fn) => {
    try { fn(); } catch { /* ignore */ }
  });
}

function fieldOf(id) {
  return id === 'promptTemplate' ? 'display' : 'explanation';
}

function session(id) {
  if (!sessions.has(id)) {
    const s = {
      id,
      field: fieldOf(id),
      marks: [],
      footnotes: [],
      composing: false,
      composeAt: 0,
      pending: null,
      prevText: null,
      lastSel: { start: 0, end: 0 },
      selOwned: false,
      toolbarArmed: false,
      bound: false,
    };
    sessions.set(id, s);
    registerEditorHistoryExtra(id, () => ({
      marks: s.marks,
      footnotes: s.footnotes,
      lastSel: s.lastSel,
      selOwned: s.selOwned,
    }), (extra) => {
      s.marks = normalizeMarks(extra?.marks, editorVisibleText(document.getElementById(id)));
      s.footnotes = Array.isArray(extra?.footnotes) ? extra.footnotes : [];
      if (extra?.lastSel) s.lastSel = extra.lastSel;
      s.selOwned = extra?.selOwned !== false && !!extra?.lastSel;
      paintEditor(id, { keepCaret: extra?.lastSel });
      emitEditorMeta();
    });
  }
  return sessions.get(id);
}

export function getEditorMeta(id) {
  const s = session(id);
  return {
    field: s.field,
    marks: s.marks,
    footnotes: s.footnotes.filter((f) => f.field === s.field),
  };
}

export function readAllEditorMeta() {
  const display = getEditorMeta('promptTemplate');
  const explanation = getEditorMeta('explanationTemplate');
  return {
    textMarks: { display: display.marks, explanation: explanation.marks },
    footnotes: [...display.footnotes, ...explanation.footnotes],
  };
}

function visibleNow(id) {
  return editorVisibleText(document.getElementById(id));
}

function atomsNow(id) {
  return editorVisibleAtoms(document.getElementById(id));
}

export function loadEditorMeta(id, cardOrDraft = {}, { field, paint = true, reset = true } = {}) {
  const s = session(id);
  s.field = field || fieldOf(id);
  const meta = normalizeCardTextMeta(cardOrDraft);
  s.marks = (meta.textMarks[s.field] || []).slice();
  s.footnotes = (meta.footnotes || []).filter((f) => f.field === s.field);
  bindEditor(id);
  if (paint) paintEditor(id);
  if (reset) resetEditorHistory(id);
}

export function loadPairedEditors(card, ids) {
  ids.forEach((id) => loadEditorMeta(id, card || {}, { field: fieldOf(id), paint: false, reset: false }));
  ids.forEach((id) => paintEditor(id));
  ids.forEach((id) => resetEditorHistory(id));
}

export function bindEditor(id) {
  const el = document.getElementById(id);
  const s = session(id);
  if (!el || s.bound) return;
  s.bound = true;

  const stash = (start, end, data, inputType) => {
    s.prevText = visibleNow(id);
    s.pending = {
      start: Math.min(start, end),
      end: Math.max(start, end),
      data: data == null ? '' : String(data),
      inputType: inputType || '',
    };
  };

  el.addEventListener('keydown', (e) => {
    if (!e.isComposing && !s.composing && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (handleFootnoteKey(el, e)) return;
    }
    if (e.key !== 'Enter' || e.isComposing || s.composing) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    snapshotEditor(id, true);
    const sel = getEditorSelectionOffsets(id);
    s.prevText = visibleNow(id);
    const edit = { start: sel.start, end: sel.end, inserted: '\n' };
    applyDomEdit(id, edit, { inherit: true, paint: false });
    snapshotEditor(id, true);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, true);

  el.addEventListener('paste', (e) => {
    const text = normalizeNewlines((e.clipboardData || window.clipboardData).getData('text'));
    const sel = getEditorSelectionOffsets(id);
    stash(sel.start, sel.end, text, 'insertFromPaste');
  }, true);

  el.addEventListener('beforeinput', (e) => {
    const kind = String(e.inputType || '');
    if (kind === 'formatBold') {
      e.preventDefault();
      applyFormat(id, { type: 'bold' });
      return;
    }
    if (kind.startsWith('format')) {
      e.preventDefault();
      return;
    }
    if (s.composing || kind === 'insertCompositionText' || isChipEditorApplying(id)) return;
    const sel = getEditorSelectionOffsets(id);
    const ranges = e.getTargetRanges?.() || [];
    const r = ranges[0];
    let start = sel.start;
    let end = sel.end;
    if (r) {
      const rs = visibleOffsetFromPoint(el, r.startContainer, r.startOffset);
      const re = visibleOffsetFromPoint(el, r.endContainer, r.endOffset);
      if (start !== end) {
        start = rs;
        end = re;
      } else if (rs === re) {
        const at = Math.max(rs, start);
        start = at;
        end = at;
      } else {
        start = rs;
        end = re;
      }
    }
    stash(start, end, e.data == null ? '' : String(e.data), e.inputType);
  }, true);

  el.addEventListener('compositionstart', () => {
    s.composing = true;
    const sel = getEditorSelectionOffsets(id);
    s.prevText = visibleNow(id);
    s.composeAt = sel.start;
    s.composeEnd = sel.end;
    s.pending = null;
  });

  el.addEventListener('compositionend', (e) => {
    const inserted = String(e.data || '');
    s.composing = false;
    applyDomEdit(id, {
      start: s.composeAt,
      end: s.composeEnd ?? s.composeAt,
      inserted,
    }, { inherit: true, paint: true });
    snapshotEditor(id, true);
    s.composeAt = 0;
    s.composeEnd = 0;
  });

  el.addEventListener('input', (e) => {
    if (s.composing || isChipEditorApplying(id) || e.isComposing) return;
    const p = s.pending;
    s.pending = null;
    if (!p) { rememberSel(id); return; }
    let inserted = p.data;
    if (p.inputType.startsWith('delete') || p.inputType === 'historyUndo' || p.inputType === 'historyRedo') {
      inserted = '';
    }
    if (p.inputType === 'insertParagraph' || p.inputType === 'insertLineBreak') inserted = '\n';
    applyDomEdit(id, { start: p.start, end: p.end, inserted }, { inherit: true, paint: false });
  }, true);

  el.addEventListener('keyup', () => rememberSel(id));
  el.addEventListener('mouseup', () => rememberSel(id));
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (sel?.anchorNode && nodeInEditor(el, sel.anchorNode) && editorFocusContext(id)) {
      rememberSel(id);
    } else if (!s.toolbarArmed) {
      s.selOwned = false;
    }
  });
}

function nodeInEditor(el, node) {
  if (!el || !node) return false;
  return el.contains(node.nodeType === 3 ? node : node);
}

function editorFocusContext(id) {
  const el = document.getElementById(id);
  const active = document.activeElement;
  if (!el || !active) return false;
  if (active === el || el.contains(active)) return true;
  const bar = document.querySelector(`.fmt-toolbar[data-fmt-for="${id}"]`);
  if (bar && (active === bar || bar.contains(active))) return true;
  return false;
}

function liveSelectionIn(id) {
  const el = document.getElementById(id);
  const sel = window.getSelection();
  if (!el || !sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!nodeInEditor(el, range.startContainer) || !nodeInEditor(el, range.endContainer)) {
    return null;
  }
  return rangeToVisibleOffsets(el, range);
}

function clampSel(range, len) {
  const start = Math.max(0, Math.min(Number(range?.start) || 0, len));
  const end = Math.max(0, Math.min(Number(range?.end) || 0, len));
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

/** 이 편집기에 현재 유효한 caret/선택만. stale·타 편집기·본문 밖은 null. fallback 없음. */
function captureOwnedSelection(id) {
  if (!editorFocusContext(id)) return null;
  const s = session(id);
  const len = visibleNow(id).length;
  if (s.toolbarArmed && s.selOwned && s.lastSel) {
    return clampSel(s.lastSel, len);
  }
  const live = liveSelectionIn(id);
  if (live) {
    const range = clampSel(live, len);
    s.lastSel = range;
    s.selOwned = true;
    return range;
  }
  return null;
}

function rememberSel(id) {
  if (!editorFocusContext(id)) return;
  const s = session(id);
  const live = liveSelectionIn(id);
  if (!live) return;
  s.lastSel = live;
  s.selOwned = true;
  syncFormatToolbar(id);
}

function armToolbarSelection(id) {
  const s = session(id);
  const live = liveSelectionIn(id);
  if (!live) return;
  s.lastSel = live;
  s.selOwned = true;
  s.toolbarArmed = true;
}

function applyDomEdit(id, edit, { inherit = false, paint = false } = {}) {
  const s = session(id);
  const el = document.getElementById(id);
  const src = s.prevText != null ? s.prevText : visibleNow(id);
  const patched = applyTextEdit(src, { marks: s.marks, footnotes: s.footnotes }, edit, { inherit });
  s.marks = patched.marks;
  s.footnotes = patched.footnotes.map((f) => ({ ...f, field: f.field || s.field }));
  s.prevText = null;
  const delStart = Math.min(edit.start, edit.end);
  const delEnd = Math.max(edit.start, edit.end);
  const ins = String(edit.inserted || '');
  const nextCaret = { start: delStart + ins.length, end: delStart + ins.length };
  let rebuilt = false;
  if (!s.composing && el && patched.text !== editorVisibleText(el)) {
    rebuilt = rebuildEditorVisibleText(id, patched.text, nextCaret);
  }
  s.lastSel = nextCaret;
  const needsPaint = paint
    || rebuilt
    || (!s.composing && (ins.includes('\n') || delEnd > delStart) && s.marks.some((m) => m.type === 'align'));
  if (needsPaint && !s.composing) paintEditor(id, { keepCaret: nextCaret });
  else if (el && !s.composing) setVisibleSelection(el, nextCaret.start, nextCaret.end);
  syncFormatToolbar(id);
}

export function remapAnswerChange(id, order, prev, next) {
  const s = session(id);
  const vis = visibleNow(id);
  const atoms = atomsNow(id);
  const atom = atoms[Number(order) - 1];
  if (!atom) return;
  const start = atom.start;
  const nextLen = String(next || '').length;
  const before = vis.slice(0, start) + String(prev || '') + vis.slice(start + nextLen);
  const patched = applyTextEdit(
    before,
    { marks: s.marks, footnotes: s.footnotes },
    { start, end: start + String(prev || '').length, inserted: String(next || '') },
    { inherit: true },
  );
  s.marks = patched.marks;
  s.footnotes = patched.footnotes;
}

export function afterChipAnswer(id, order, prev, next) {
  remapAnswerChange(id, order, prev, next);
  snapshotEditor(id, true);
}

function pairedIds(id) {
  if (id === 'promptTemplate' || id === 'explanationTemplate') return ['promptTemplate', 'explanationTemplate'];
  return [id];
}

function paintPair(id, keepCaret) {
  paintEditor(id, { keepCaret });
  pairedIds(id).forEach((other) => {
    if (other === id) return;
    if (document.getElementById(other)) paintEditor(other);
  });
}

function paintEditor(id, { keepCaret } = {}) {
  const el = document.getElementById(id);
  const s = session(id);
  if (!el || s.composing) return;
  // Capture once before touching DOM. Never resolve offsets against partially
  // wrapped paragraphs: their implied newlines shift every subsequent boundary.
  const vis = visibleNow(id);
  const atoms = atomsNow(id);
  const scrollTop = el.scrollTop;
  const scrollLeft = el.scrollLeft;
  el.innerHTML = renderMarkedHtml(vis, {
    marks: s.marks,
    footnotes: s.footnotes,
    field: s.field,
    allFootnotes: allFootnotesFor(id),
    atoms,
    // outerHTML is DOM-escaped; keep blank ids, aliases and study history intact.
    renderAtom: (atom) => atom.el.outerHTML,
  });
  el.querySelectorAll('.tm-fn').forEach((n) => {
    n.contentEditable = 'false';
    n.tabIndex = -1;
  });
  el.querySelectorAll('.tm-line').forEach((line) => {
    if (![...line.childNodes].some((n) => n.nodeType === 3 ? n.data.length : !n.classList?.contains('tm-fn'))) {
      const br = document.createElement('br');
      br.dataset.tmBr = '1';
      line.appendChild(br);
    }
  });
  if (keepCaret) setVisibleSelection(el, keepCaret.start, keepCaret.end);
  el.scrollTop = scrollTop;
  el.scrollLeft = scrollLeft;
  syncFormatToolbar(id);
}

function allFootnotesFor(id) {
  if (id === 'promptTemplate' || id === 'explanationTemplate') return readAllEditorMeta().footnotes;
  return session(id).footnotes;
}

export function applyFormat(id, spec) {
  const el = document.getElementById(id);
  if (!el) return false;
  const range = captureOwnedSelection(id);
  if (!range) {
    closeColorMenus();
    return false;
  }
  snapshotEditor(id, true);
  const s = session(id);
  const vis = visibleNow(id);
  const atoms = atomsNow(id);
  if (range.start === range.end && spec.type !== 'align' && !spec.clear) {
    closeColorMenus();
    return false;
  }
  const next = spec.clear
    ? clearMarksInRange(s.marks, range, { text: vis })
    : spec.toggle === false
      ? addMark(s.marks, { ...spec, ...range }, { text: vis, atoms })
      : toggleMark(s.marks, { ...spec, ...range }, { text: vis, atoms });
  s.marks = next;
  s.lastSel = range;
  s.selOwned = true;
  if (spec.type === 'color' && spec.value) lastColor = spec.value;
  paintEditor(id, { keepCaret: range });
  snapshotEditor(id, true);
  syncFormatToolbar(id);
  closeColorMenus();
  return true;
}

export function applyLastColor(id) {
  return applyFormat(id, { type: 'color', value: lastColor, toggle: false });
}

function addFootnoteAtRange(id, range, body) {
  const s = session(id);
  const vis = visibleNow(id);
  if (!body || !range) return null;
  const used = new Set(allFootnotesFor(id).map((f) => String(f.id || '')));
  let n = 1;
  while (used.has(`n${n}`)) n += 1;
  const list = addFn(s.footnotes, {
    id: `n${n}`,
    field: s.field,
    start: range.start,
    end: range.end,
    body,
  }, vis);
  s.footnotes = list.filter((f) => f.field === s.field);
  s.lastSel = range;
  s.selOwned = true;
  paintPair(id, range);
  snapshotEditor(id, true);
  emitEditorMeta();
  return s.footnotes.find((f) => f.start === range.start && f.end === range.end && f.body === body)
    || s.footnotes[s.footnotes.length - 1]
    || null;
}

export function addFootnoteAtSelection(id, body) {
  const range = captureOwnedSelection(id);
  if (!range) return null;
  return addFootnoteAtRange(id, range, body);
}

export function updateFootnoteBody(id, fnId, body) {
  const s = session(id);
  const vis = visibleNow(id);
  s.footnotes = patchFn(s.footnotes, fnId, { body }, vis);
  snapshotEditor(id, true);
  emitEditorMeta();
}

export function deleteFootnote(id, fnId) {
  const s = session(id);
  s.footnotes = dropFn(s.footnotes, fnId);
  paintPair(id, s.lastSel);
  snapshotEditor(id, true);
  emitEditorMeta();
}

export function listEditorFootnotes(id) {
  return getEditorMeta(id).footnotes.slice();
}

// Native contenteditable stops at the text end, before/after the non-editable
// button, and the next text start. Treat the visible marker as one keyboard step.
function adjacentLeaf(root, node, offset, direction) {
  if (!node || !root.contains(node)) return null;
  let candidate;
  if (node.nodeType === 3) {
    if (direction > 0 ? offset < node.length : offset > 0) return null;
  } else {
    candidate = node.childNodes[direction > 0 ? offset : offset - 1];
  }
  let current = node;
  while (true) {
    if (!candidate) {
      if (current === root || current.classList?.contains('tm-line')) return null;
      candidate = direction > 0 ? current.nextSibling : current.previousSibling;
      if (!candidate) { current = current.parentNode; continue; }
    }
    if (candidate.nodeType === 3 && candidate.length) return candidate;
    if (candidate.nodeType === 1) {
      if (candidate.matches('.tm-fn, .cz-chip, .tm-line, br')) return candidate;
      const child = direction > 0 ? candidate.firstChild : candidate.lastChild;
      if (child) { candidate = child; continue; }
    }
    current = candidate;
    candidate = null;
  }
}

function markerSide(el, marker, direction) {
  const parent = marker.parentNode;
  const offset = [...parent.childNodes].indexOf(marker) + (direction > 0 ? 1 : 0);
  const next = adjacentLeaf(el, parent, offset, direction);
  return next?.nodeType === 3
    ? { node: next, offset: direction > 0 ? 0 : next.length }
    : { node: parent, offset };
}

function handleFootnoteKey(el, e) {
  const sel = window.getSelection();
  if (!sel?.rangeCount || !el.contains(sel.focusNode)) return false;
  const direction = ['ArrowRight', 'Delete'].includes(e.key) ? 1
    : ['ArrowLeft', 'Backspace'].includes(e.key) ? -1 : 0;
  if (!direction) return false;
  const deleting = e.key === 'Delete' || e.key === 'Backspace';
  const range = sel.getRangeAt(0);
  let markers = [];
  if (sel.isCollapsed || (!deleting && e.shiftKey)) {
    const next = adjacentLeaf(el, sel.focusNode, sel.focusOffset, direction);
    if (next?.classList?.contains('tm-fn')) markers = [next];
  } else if (deleting) {
    const offsets = rangeToVisibleOffsets(el, range);
    if (offsets.start === offsets.end) {
      markers = [...el.querySelectorAll('.tm-fn')].filter(n => range.intersectsNode(n));
    }
  }
  if (!markers.length) return false;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (deleting) {
    const saved = range.cloneRange();
    if (!window.confirm('각주를 삭제하시겠습니까?')) {
      el.focus({ preventScroll: true });
      sel.removeAllRanges(); sel.addRange(saved);
      return true;
    }
    snapshotEditor(el.id, true);
    session(el.id).lastSel = rangeToVisibleOffsets(el, range);
    markers.forEach(n => deleteFootnote(el.id, n.dataset.fnId));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    const point = markerSide(el, markers[0], direction);
    if (e.shiftKey) sel.extend(point.node, point.offset);
    else sel.collapse(point.node, point.offset);
    rememberSel(el.id);
  }
  return true;
}

export function focusEditorFootnote(id, fnId) {
  const el = document.getElementById(id);
  const s = session(id);
  const fn = s.footnotes.find((f) => f.id === fnId);
  if (!el || !fn) return;
  el.focus({ preventScroll: true });
  setVisibleSelection(el, fn.end, fn.end);
  rememberSel(id);
  const marker = [...el.querySelectorAll('.tm-fn')].find((n) => n.dataset.fnId === fnId);
  marker?.scrollIntoView({ block: 'center', inline: 'nearest' });
  pulseFootnote(marker);
}

export function formatToolbarHtml(editorId, { blanks = false } = {}) {
  const icon = (kind) => {
    const lines = {
      justify: [[2, 3, 12], [2, 6.2, 12], [2, 9.4, 12], [2, 12.6, 12]],
      left: [[2, 3, 12], [2, 6.2, 8], [2, 9.4, 11], [2, 12.6, 7]],
      center: [[2, 3, 12], [4, 6.2, 8], [2.5, 9.4, 11], [4.5, 12.6, 7]],
      right: [[2, 3, 12], [6, 6.2, 8], [3, 9.4, 11], [7, 12.6, 7]],
    }[kind] || [];
    return `<svg class="fmt-align-icon" viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" focusable="false">${
      lines.map(([x, y, w]) => `<rect x="${x}" y="${y}" width="${w}" height="1.8" rx="0.4" fill="currentColor"/>`).join('')
    }</svg>`;
  };
  const alignBtn = (kind, label) => `<button type="button" class="ghost small fmt-align-btn" data-action="fmt-align" data-editor="${editorId}" data-align="${kind}" data-tip="${label}" aria-label="${label}" aria-pressed="false">${icon(kind)}</button>`;
  const blankTip = '선택 → 빈칸 (Ctrl+B)';
  const blankBtn = blanks
    ? `<button type="button" class="secondary small" data-action="make-blank" data-editor="${editorId}" data-tip="${blankTip}" aria-label="${blankTip}">선택 → 빈칸 (Ctrl+B)</button>`
    : '';
  return `<div class="fmt-toolbar" data-fmt-for="${editorId}" onmousedown="event.preventDefault()">
    <div class="fmt-group fmt-group-text">
      <button type="button" class="ghost small" data-action="fmt-bold" data-editor="${editorId}" data-tip="굵게 (Ctrl+Shift+B)" aria-label="굵게 (Ctrl+Shift+B)">B</button>
      <div class="fmt-color-wrap" data-fmt-color-for="${editorId}">
        <button type="button" class="ghost small fmt-color-trigger" data-action="fmt-color-menu" data-editor="${editorId}" data-tip="글자색" aria-label="글자색" aria-haspopup="listbox" aria-expanded="false">
          <span class="fmt-color-swatch" data-color="k"></span>
          <span class="fmt-color-caret" aria-hidden="true">▾</span>
        </button>
        <div class="fmt-color-menu" hidden role="listbox">
          <button type="button" class="fmt-color-opt" data-action="fmt-color" data-editor="${editorId}" data-color="k" data-tip="검정" aria-label="검정" role="option"><span class="fmt-color-swatch" data-color="k" aria-hidden="true"></span></button>
          <button type="button" class="fmt-color-opt" data-action="fmt-color" data-editor="${editorId}" data-color="b" data-tip="파랑" aria-label="파랑" role="option"><span class="fmt-color-swatch" data-color="b" aria-hidden="true"></span></button>
          <button type="button" class="fmt-color-opt" data-action="fmt-color" data-editor="${editorId}" data-color="r" data-tip="빨강" aria-label="빨강" role="option"><span class="fmt-color-swatch" data-color="r" aria-hidden="true"></span></button>
          <button type="button" class="fmt-color-opt" data-action="fmt-color" data-editor="${editorId}" data-color="g" data-tip="초록" aria-label="초록" role="option"><span class="fmt-color-swatch" data-color="g" aria-hidden="true"></span></button>
        </div>
      </div>
      <button type="button" class="ghost small fmt-hl-btn" data-action="fmt-hl" data-editor="${editorId}" data-tip="형광펜 (F3)" aria-label="형광펜 (F3)"><span class="fmt-hl-label">형광</span></button>
    </div>
    <div class="fmt-group fmt-group-align">
      ${alignBtn('justify', '양쪽 정렬 (Ctrl+Shift+M)')}
      ${alignBtn('left', '왼쪽 정렬 (Ctrl+Shift+L)')}
      ${alignBtn('center', '가운데 정렬 (Ctrl+Shift+C)')}
      ${alignBtn('right', '오른쪽 정렬 (Ctrl+Shift+R)')}
    </div>
    <div class="fmt-group fmt-group-notes">
      <button type="button" class="ghost small fmt-fn-btn" data-action="fmt-footnote" data-editor="${editorId}" data-tip="각주 (Alt+N)" aria-label="각주 (Alt+N)">각주</button>
      <button type="button" class="ghost small fmt-clear-btn" data-action="fmt-clear" data-editor="${editorId}" data-tip="선택 서식 해제" aria-label="선택 서식 해제">해제</button>
      ${blankBtn}
    </div>
  </div>`;
}

function colorAtOffset(marks, offset) {
  let c = 'k';
  (marks || []).forEach((m) => {
    if (m.type === 'color' && m.start <= offset && offset < m.end) c = m.value;
  });
  return c || 'k';
}

function selectionColor(id) {
  const s = session(id);
  const vis = visibleNow(id);
  const { start, end } = s.lastSel || { start: 0, end: 0 };
  if (!vis.length) return 'k';
  if (start === end) {
    const pos = start < vis.length ? start : Math.max(0, vis.length - 1);
    return colorAtOffset(s.marks, pos);
  }
  let found = null;
  for (let i = start; i < end; i += 1) {
    const c = colorAtOffset(s.marks, i);
    if (found == null) found = c;
    else if (found !== c) return 'k';
  }
  return found || 'k';
}

function selectionHasBold(id) {
  const s = session(id);
  const { start, end } = s.lastSel || { start: 0, end: 0 };
  const a = start === end ? (start > 0 ? start - 1 : start) : start;
  const b = start === end ? Math.max(a + 1, end) : end;
  return (s.marks || []).some((m) => m.type === 'bold' && m.end > a && m.start < b);
}

function selectionHasHl(id) {
  const s = session(id);
  const { start, end } = s.lastSel || { start: 0, end: 0 };
  const a = start === end ? (start > 0 ? start - 1 : start) : start;
  const b = start === end ? Math.max(a + 1, end) : end;
  return (s.marks || []).some((m) => m.type === 'hl' && m.end > a && m.start < b);
}

function selectionAlign(id) {
  const s = session(id);
  if (!s.selOwned && !s.toolbarArmed) return '';
  const vis = visibleNow(id);
  const atoms = atomsNow(id);
  const { start, end } = s.lastSel || { start: 0, end: 0 };
  return selectionEffectiveAlign(s.marks, vis, start, end, atoms);
}

function syncFormatToolbar(id) {
  const bar = document.querySelector(`.fmt-toolbar[data-fmt-for="${id}"]`);
  if (!bar) return;
  const color = selectionColor(id);
  const swatch = bar.querySelector('.fmt-color-swatch');
  if (swatch) {
    swatch.dataset.color = color;
    swatch.style.background = COLOR_HEX[color] || COLOR_HEX.k;
  }
  bar.querySelectorAll('.fmt-color-opt').forEach((btn) => {
    btn.classList.toggle('is-current', btn.dataset.color === color);
  });
  bar.querySelector('[data-action="fmt-bold"]')?.classList.toggle('is-active', selectionHasBold(id));
  bar.querySelector('.fmt-hl-btn')?.classList.toggle('is-active', selectionHasHl(id));
  bar.querySelector('.fmt-fn-btn')?.classList.remove('is-active');
  bar.querySelector('.fmt-clear-btn')?.classList.remove('is-active');
  const align = selectionAlign(id);
  bar.querySelectorAll('[data-action="fmt-align"]').forEach((btn) => {
    const on = !!align && btn.dataset.align === align;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function closeColorMenus(exceptWrap = null) {
  document.querySelectorAll('.fmt-color-wrap').forEach((wrap) => {
    if (wrap === exceptWrap) return;
    wrap.classList.remove('is-open');
    const menu = wrap.querySelector('.fmt-color-menu');
    const trigger = wrap.querySelector('.fmt-color-trigger');
    if (menu) menu.hidden = true;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  });
}

function toggleColorMenu(wrap, editorId) {
  if (!wrap) return;
  const willOpen = !wrap.classList.contains('is-open');
  closeColorMenus(willOpen ? wrap : null);
  if (!willOpen) {
    wrap.classList.remove('is-open');
    wrap.querySelector('.fmt-color-menu').hidden = true;
    wrap.querySelector('.fmt-color-trigger')?.setAttribute('aria-expanded', 'false');
    return;
  }
  rememberSel(editorId);
  wrap.classList.add('is-open');
  const menu = wrap.querySelector('.fmt-color-menu');
  const trigger = wrap.querySelector('.fmt-color-trigger');
  if (menu) menu.hidden = false;
  if (trigger) trigger.setAttribute('aria-expanded', 'true');
}

export function bindFormatChrome() {
  if (chromeBound) return;
  chromeBound = true;
  bindDelayedTooltips();
  document.addEventListener('mousedown', (e) => {
    const bar = e.target.closest?.('.fmt-toolbar');
    if (!bar) return;
    const id = bar.getAttribute('data-fmt-for');
    if (id) armToolbarSelection(id);
  }, true);
  document.addEventListener('mouseup', () => {
    window.setTimeout(() => {
      sessions.forEach((s) => { s.toolbarArmed = false; });
    }, 0);
  }, true);
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest?.('[data-action="fmt-color-menu"]');
    if (trigger) {
      e.preventDefault();
      e.stopPropagation();
      const editorId = trigger.dataset.editor;
      toggleColorMenu(trigger.closest('.fmt-color-wrap'), editorId);
      return;
    }
    if (!e.target.closest?.('.fmt-color-wrap')) closeColorMenus();
  });
  document.addEventListener('keydown', (e) => {
    const wrap = document.querySelector('.fmt-color-wrap.is-open');
    if (!wrap) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      const editorId = wrap.dataset.fmtColorFor;
      closeColorMenus();
      if (editorId) document.getElementById(editorId)?.focus();
      return;
    }
    const opts = [...wrap.querySelectorAll('.fmt-color-opt')];
    const idx = opts.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      opts[(idx + 1 + opts.length) % opts.length]?.focus();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      opts[(idx - 1 + opts.length) % opts.length]?.focus();
    }
  });
}

export function handleFormatAction(action, editorId, extra = {}) {
  if (!editorId) return;
  try {
    if (action === 'fmt-bold') applyFormat(editorId, { type: 'bold' });
    else if (action === 'fmt-hl') applyFormat(editorId, { type: 'hl' });
    else if (action === 'fmt-color') applyFormat(editorId, { type: 'color', value: extra.color, toggle: false });
    else if (action === 'fmt-align') applyFormat(editorId, { type: 'align', value: extra.align, toggle: false });
    else if (action === 'fmt-clear') applyFormat(editorId, { clear: true });
    else if (action === 'fmt-footnote') promptFootnote(editorId);
  } finally {
    const s = sessions.get(editorId);
    if (s) s.toolbarArmed = false;
  }
}

export function promptFootnote(editorId) {
  const range = captureOwnedSelection(editorId);
  if (!range) {
    alert('각주를 넣을 곳을 선택해 주세요.');
    return;
  }
  const body = window.prompt('각주 (수정 이유·취지). 카드 전체 메모와 별개입니다.');
  if (body == null) return;
  const trimmed = String(body).trim();
  if (!trimmed) return;
  addFootnoteAtRange(editorId, range, trimmed);
}

function chordColor(e) {
  const code = String(e.code || '');
  if (code === 'KeyK') return 'k';
  if (code === 'KeyB') return 'b';
  if (code === 'KeyR') return 'r';
  if (code === 'KeyG') return 'g';
  return '';
}

export function onEditorShortcut(e, editorId) {
  const el = document.getElementById(editorId);
  if (!el || document.activeElement !== el) return false;
  if (e.isComposing) return false;
  const ctrl = e.ctrlKey || e.metaKey;
  const shift = e.shiftKey;
  const alt = e.altKey;
  const code = String(e.code || '');

  if (colorChord && Date.now() < colorChord.until) {
    const col = chordColor(e);
    if (col && editorId === colorChord.editorId) {
      e.preventDefault();
      colorChord = null;
      applyFormat(editorId, { type: 'color', value: col, toggle: false });
      return true;
    }
    colorChord = null;
  }

  if (alt && !ctrl && code === 'KeyN') {
    e.preventDefault();
    promptFootnote(editorId);
    session(editorId).toolbarArmed = false;
    return true;
  }
  if (ctrl && shift && code === 'KeyB') {
    e.preventDefault();
    applyFormat(editorId, { type: 'bold' });
    return true;
  }
  if (ctrl && shift && code === 'KeyL') {
    e.preventDefault();
    applyFormat(editorId, { type: 'align', value: 'left', toggle: false });
    return true;
  }
  if (ctrl && shift && code === 'KeyC') {
    e.preventDefault();
    applyFormat(editorId, { type: 'align', value: 'center', toggle: false });
    return true;
  }
  if (ctrl && shift && code === 'KeyR') {
    e.preventDefault();
    applyFormat(editorId, { type: 'align', value: 'right', toggle: false });
    return true;
  }
  if (ctrl && shift && code === 'KeyM') {
    e.preventDefault();
    applyFormat(editorId, { type: 'align', value: 'justify', toggle: false });
    return true;
  }
  if (ctrl && !shift && !alt && code === 'KeyM') {
    e.preventDefault();
    colorChord = { editorId, until: Date.now() + 1500 };
    return true;
  }
  if (e.key === 'F2') {
    e.preventDefault();
    applyLastColor(editorId);
    return true;
  }
  if (e.key === 'F3') {
    e.preventDefault();
    applyFormat(editorId, { type: 'hl' });
    return true;
  }
  return false;
}

export function focusedEditorId() {
  const a = document.activeElement;
  if (!a?.id) return '';
  if (['promptTemplate', 'explanationTemplate'].includes(a.id)) {
    return a.id;
  }
  return '';
}
