/**
 * 칩(chip) 기반 빈칸 에디터
 *
 * 저장 포맷은 기존과 동일: explanationText + blanks[].
 * 히스토리는 innerHTML 이 아니라 template/blanks + 외부 메타(서식·각주) 한 스냅샷.
 */
import { syncTemplateAndBlanks } from '../domain/blank.js';
import { uid, normalizeTight, normalizeNewlines, splitAnswers } from '../utils/text.js';

export const ALIAS_SEP = ' || ';
export function formatAliases(list) {
  return (list || []).filter(Boolean).join(ALIAS_SEP);
}
export function parseAliases(text) {
  return splitAnswers(text);
}

export const CHIP_CLASS = 'cz-chip';
const initialized = new Set();
const history = new Map();
const MAX_HIST = 100;
const extraCapture = new Map();
const extraRestore = new Map();

export function registerEditorHistoryExtra(id, capture, restore) {
  extraCapture.set(id, capture);
  extraRestore.set(id, restore);
}

function packBlankSide(b = {}) {
  return JSON.stringify({
    lastInput: b.lastInput || '',
    lastResult: b.lastResult ?? null,
    manualResult: b.manualResult ?? null,
  });
}

function unpackBlankSide(raw) {
  if (!raw) return { lastInput: '', lastResult: null, manualResult: null };
  try {
    const o = JSON.parse(raw);
    return {
      lastInput: o.lastInput || '',
      lastResult: o.lastResult ?? null,
      manualResult: o.manualResult ?? null,
    };
  } catch {
    return { lastInput: '', lastResult: null, manualResult: null };
  }
}

function isChip(node) {
  return node && node.nodeType === 1 && node.classList && node.classList.contains(CHIP_CLASS);
}

function isFnMark(node) {
  return node && node.nodeType === 1 && node.classList && node.classList.contains('tm-fn');
}

function isLineWrap(node) {
  return node && node.nodeType === 1 && node.classList && node.classList.contains('tm-line');
}

export function nextLineWrap(node) {
  let n = node?.nextSibling;
  while (n) {
    if (isLineWrap(n)) return n;
    if (!isFnMark(n) && !(n.nodeType === 3 && n.data === '')) return null;
    n = n.nextSibling;
  }
  return null;
}

export function prevLineWrap(node) {
  let n = node?.previousSibling;
  while (n) {
    if (isLineWrap(n)) return n;
    if (!isFnMark(n) && !(n.nodeType === 3 && n.data === '')) return null;
    n = n.previousSibling;
  }
  return null;
}

function isPlaceholderBr(node) {
  return !!(node && node.nodeType === 1 && node.nodeName === 'BR' && node.dataset.tmBr === '1');
}

function isVisuallyEmptyLine(node) {
  if (!isLineWrap(node)) return false;
  return ![...node.childNodes].some((c) => {
    if (isPlaceholderBr(c) || isFnMark(c)) return false;
    if (c.nodeType === 3 && !(c.nodeValue || '')) return false;
    return true;
  });
}

export function makeChipEl(answer, aliases = [], meta = {}) {
  const span = document.createElement('span');
  span.className = CHIP_CLASS;
  span.contentEditable = 'false';
  span.dataset.answer = answer || '';
  span.dataset.aliases = formatAliases(aliases);
  span.dataset.blankId = meta.id || uid('b');
  span.dataset.blankSide = packBlankSide(meta);
  span.appendChild(document.createTextNode(answer || ' '));
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'cz-chip-x';
  x.tabIndex = -1;
  x.dataset.chipRemove = '1';
  x.textContent = '×';
  span.appendChild(x);
  return span;
}

function setChipText(chip, answer) {
  chip.dataset.answer = answer || '';
  const first = chip.firstChild;
  if (first && first.nodeType === 3) first.nodeValue = answer || ' ';
  else chip.insertBefore(document.createTextNode(answer || ' '), chip.firstChild);
}

function captureModel(id) {
  const { template, blanks } = readChipEditor(id);
  const extra = extraCapture.get(id)?.() || {};
  return JSON.stringify({ template, blanks, extra });
}

function restoreModel(id, raw) {
  const h = history.get(id);
  if (!h) return;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  h.applying = true;
  if (parsed && typeof parsed === 'object' && 'template' in parsed) {
    setChipEditorContent(id, parsed.template, parsed.blanks || [], { resetHistory: false });
    extraRestore.get(id)?.(parsed.extra || {});
  } else if (typeof raw === 'string') {
    const el = document.getElementById(id);
    if (el) el.innerHTML = raw;
  }
  const el = document.getElementById(id);
  if (el) el.dispatchEvent(new Event('input', { bubbles: true }));
  h.applying = false;
}

function resetHistory(id) {
  history.set(id, {
    stack: [captureModel(id)],
    index: 0,
    timer: null,
    applying: false,
  });
}

export function snapshotEditor(id, immediate = false) {
  const el = document.getElementById(id);
  const h = history.get(id);
  if (!el || !h || h.applying) return;
  const rec = captureModel(id);
  const push = () => {
    if (h.stack[h.index] === rec) return;
    h.stack = h.stack.slice(0, h.index + 1);
    h.stack.push(rec);
    h.index = h.stack.length - 1;
    if (h.stack.length > MAX_HIST) { h.stack.shift(); h.index -= 1; }
  };
  clearTimeout(h.timer);
  h.timer = null;
  if (immediate) push();
  else h.timer = setTimeout(push, 250);
}

export function resetEditorHistory(id) {
  resetHistory(id);
}

function snapshot(id, immediate = false) {
  snapshotEditor(id, immediate);
}

function flushPendingSnapshot(id) {
  const h = history.get(id);
  if (!h?.timer) return;
  clearTimeout(h.timer);
  h.timer = null;
  snapshotEditor(id, true);
}

export function chipUndo(id) {
  const h = history.get(id);
  if (!h) return false;
  flushPendingSnapshot(id);
  if (h.index <= 0) return false;
  h.index -= 1;
  restoreModel(id, h.stack[h.index]);
  return true;
}

export function chipRedo(id) {
  const h = history.get(id);
  if (!h) return false;
  flushPendingSnapshot(id);
  if (h.index >= h.stack.length - 1) return false;
  h.index += 1;
  restoreModel(id, h.stack[h.index]);
  return true;
}

export function isChipEditorApplying(id) {
  return !!history.get(id)?.applying;
}

function rangeCrossesChip(range, root) {
  return [...root.querySelectorAll(`.${CHIP_CLASS}`)].some((chip) => range.intersectsNode(chip));
}

/** 가시 원문 = 텍스트 + 칩 정답. 각주 버튼·× 는 제외. */
export function editorVisibleText(el) {
  if (!el) return '';
  return visibleWalk(el).text;
}

export function editorVisibleAtoms(el) {
  if (!el) return [];
  return visibleWalk(el).atoms;
}

function visibleWalk(root) {
  let text = '';
  const atoms = [];
  const walk = (node) => {
    if (!node) return;
    if (node.nodeType === 3) {
      text += node.nodeValue || '';
      return;
    }
    if (node.nodeType !== 1) return;
    if (isFnMark(node) || node.classList.contains('cz-chip-x')) return;
    if (isChip(node)) {
      const answer = normalizeNewlines(node.dataset.answer || '');
      const start = text.length;
      text += answer;
      atoms.push({
        start,
        end: text.length,
        order: atoms.length + 1,
        el: node,
      });
      return;
    }
    if (node.nodeName === 'BR') {
      if (!isPlaceholderBr(node)) text += '\n';
      return;
    }
    const kids = [...node.childNodes];
    kids.forEach(walk);
    if (isLineWrap(node) && nextLineWrap(node)) {
      text += '\n';
    }
  };
  [...root.childNodes].forEach(walk);
  return { text: normalizeNewlines(text), atoms };
}

export function visibleOffsetFromPoint(root, node, offset) {
  if (!root || !node) return 0;
  let pos = 0;
  let found = false;
  const walk = (n) => {
    if (found || !n) return;
    if (n === node && n.nodeType === 3) {
      pos += Math.max(0, Math.min(offset, (n.nodeValue || '').length));
      found = true;
      return;
    }
    if (n.nodeType === 3) {
      pos += (n.nodeValue || '').length;
      return;
    }
    if (n.nodeType !== 1) return;
    if (isFnMark(n) || n.classList.contains('cz-chip-x')) {
      if (n === node || n.contains(node)) found = true;
      return;
    }
    if (isChip(n)) {
      if (n === node || n.contains(node)) {
        const ans = normalizeNewlines(n.dataset.answer || '');
        pos += ans.length;
        found = true;
        return;
      }
      pos += normalizeNewlines(n.dataset.answer || '').length;
      return;
    }
    if (n.nodeName === 'BR') {
      if (isPlaceholderBr(n)) {
        if (n === node) found = true;
        return;
      }
      if (n === node) { found = true; return; }
      pos += 1;
      return;
    }
    if (n === node) {
      const kids = [...n.childNodes];
      const max = Math.max(0, Math.min(offset, kids.length));
      for (let i = 0; i < max; i += 1) walk(kids[i]);
      found = true;
      return;
    }
    const kids = [...n.childNodes];
    for (let i = 0; i < kids.length; i += 1) walk(kids[i]);
    if (isLineWrap(n) && nextLineWrap(n) && !found) {
      pos += 1;
    }
  };
  walk(root);
  return pos;
}

export function rangeToVisibleOffsets(root, range) {
  if (!root || !range) return { start: 0, end: 0 };
  const a = visibleOffsetFromPoint(root, range.startContainer, range.startOffset);
  const b = visibleOffsetFromPoint(root, range.endContainer, range.endOffset);
  return a <= b ? { start: a, end: b } : { start: b, end: a };
}

export function getEditorSelectionOffsets(id) {
  const el = document.getElementById(id);
  const sel = window.getSelection();
  if (!el || !sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) {
    const len = editorVisibleText(el).length;
    return { start: len, end: len };
  }
  return rangeToVisibleOffsets(el, sel.getRangeAt(0));
}

const caretGoalX = new WeakMap();

function lineHeightPx(el) {
  const cs = getComputedStyle(el);
  const lh = parseFloat(cs.lineHeight);
  if (Number.isFinite(lh) && lh > 0) return lh;
  return (parseFloat(cs.fontSize) || 16) * 1.9;
}

function isCaretLike(box) {
  return !!(box && box.height > 0 && box.height < 80 && box.width < 240);
}

function collapsedRect(node, offset) {
  try {
    const r = document.createRange();
    r.setStart(node, offset);
    r.collapse(true);
    const own = [...r.getClientRects()].find((box) => isCaretLike(box));
    if (own) return own;
    const box = r.getBoundingClientRect();
    if (isCaretLike(box)) return box;
    if (node.nodeType === 3) {
      const len = (node.nodeValue || '').length;
      if (len) {
        const e = document.createRange();
        if (offset < len) {
          e.setStart(node, offset);
          e.setEnd(node, Math.min(len, offset + 1));
        } else {
          e.setStart(node, Math.max(0, offset - 1));
          e.setEnd(node, offset);
        }
        const glyph = [...e.getClientRects()].find((g) => isCaretLike(g));
        if (glyph) return glyph;
      }
    }
    if (node.nodeType === 1) {
      const child = node.childNodes[offset] || node.childNodes[offset - 1];
      if (child?.nodeName === 'BR') {
        const br = child.getBoundingClientRect();
        if (br.height > 0 || br.width > 0) {
          return {
            top: br.top,
            bottom: br.top + Math.max(br.height, 2),
            left: br.left,
            right: br.right || br.left,
            height: Math.max(br.height, 2),
            width: br.width,
          };
        }
      }
      if (child?.nodeType === 3) {
        return collapsedRect(child, child === node.childNodes[offset] ? 0 : (child.nodeValue || '').length);
      }
    }
  } catch { /* ignore */ }
  return null;
}

function sameVisualLine(a, b) {
  if (!a || !b) return false;
  const mid = a.top + (a.height || 0) / 2;
  const bottom = b.bottom || (b.top + (b.height || 0));
  return mid >= b.top - 2 && mid <= bottom + 2;
}

function scrollCaretIntoEditor(el, node, offset) {
  const box = collapsedRect(node, offset);
  if (!box) return;
  const host = el.getBoundingClientRect();
  const margin = 28;
  if (box.bottom > host.bottom - margin) el.scrollTop += box.bottom - (host.bottom - margin);
  else if (box.top < host.top + margin) el.scrollTop -= (host.top + margin) - box.top;
}

/** contenteditable + br/tm-line 에서 화살표 키 리피트가 맨 끝으로 점프하지 않게 시각 줄 단위로 이동 */
export function moveChipEditorByVisualLine(el, dir, { extend = false, page = false } = {}) {
  if (!el || !dir) return false;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.focusNode || !el.contains(sel.focusNode)) return false;

  if (!sel.isCollapsed && !extend) {
    const range = sel.getRangeAt(0);
    if (dir > 0) sel.collapse(range.endContainer, range.endOffset);
    else sel.collapse(range.startContainer, range.startOffset);
  }

  const focusNode = sel.focusNode;
  const focusOffset = sel.focusOffset;
  const from = visibleOffsetFromPoint(el, focusNode, focusOffset);
  const fromRect = collapsedRect(focusNode, focusOffset) || rectAtVisibleOffset(el, from);
  if (!fromRect) return false;
  const lh = lineHeightPx(el);
  let goalX = caretGoalX.get(el);
  if (goalX == null) {
    goalX = fromRect.left + Math.min(1, fromRect.width / 2);
    caretGoalX.set(el, goalX);
  }

  const lines = page ? Math.max(2, Math.floor((el.clientHeight - lh * 2) / lh)) : 1;
  let pos = from;
  for (let i = 0; i < lines; i += 1) {
    const next = adjacentVisualLineOffset(el, pos, dir, goalX);
    if (next === pos) break;
    pos = next;
  }
  if (pos === from) return false;

  if (extend) {
    const loc = visibleLocation(el, pos);
    try { sel.extend(loc.node, loc.offset); } catch { return false; }
  } else {
    setVisibleSelection(el, pos, pos);
  }
  const placed = visibleLocation(el, pos);
  scrollCaretIntoEditor(el, placed.node, placed.offset);
  return true;
}

export function clearChipEditorCaretGoal(el) {
  if (el) caretGoalX.delete(el);
}

function visibleLocation(el, target) {
  const goal = Math.max(0, target);
  let pos = 0;
  let hit = null;
  const walk = (n) => {
    if (hit || !n) return;
    if (n.nodeType === 3) {
      const len = (n.nodeValue || '').length;
      if (pos + len >= goal) {
        hit = { node: n, offset: goal - pos };
        return;
      }
      pos += len;
      return;
    }
    if (n.nodeType !== 1) return;
    if (isFnMark(n) || n.classList.contains('cz-chip-x')) return;
    if (isChip(n)) {
      const len = normalizeNewlines(n.dataset.answer || '').length;
      if (goal <= pos + len) {
        const index = [...n.parentNode.childNodes].indexOf(n);
        hit = { node: n.parentNode, offset: index + (goal > pos ? 1 : 0) };
      }
      pos += len;
      return;
    }
    if (n.nodeName === 'BR') {
      if (isPlaceholderBr(n)) return;
      if (pos + 1 >= goal) {
        hit = { node: n.parentNode, offset: [...n.parentNode.childNodes].indexOf(n) + (goal > pos ? 1 : 0) };
        return;
      }
      pos += 1;
      return;
    }
    [...n.childNodes].forEach(walk);
    if (isLineWrap(n) && !hit && isVisuallyEmptyLine(n) && pos === goal) {
      hit = { node: n, offset: 0 };
      return;
    }
    if (isLineWrap(n) && nextLineWrap(n) && !hit) {
      pos += 1;
    }
  };
  walk(el);
  return hit || { node: el, offset: el.childNodes.length };
}

function rectAtVisibleOffset(el, offset) {
  const loc = visibleLocation(el, offset);
  return collapsedRect(loc.node, loc.offset);
}

function visualLineStart(el, from, startRect) {
  let lo = 0;
  let hi = from;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const rect = rectAtVisibleOffset(el, mid);
    if (rect && sameVisualLine(startRect, rect)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function visualLineEnd(el, from, startRect, visLen) {
  let lo = from;
  let hi = visLen;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    const rect = rectAtVisibleOffset(el, mid);
    if (rect && sameVisualLine(startRect, rect)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function closestOffsetOnLine(el, start, end, goalX, fallback) {
  let best = fallback;
  let bestDx = Infinity;
  let lo = start;
  let hi = end;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const rect = rectAtVisibleOffset(el, mid);
    if (!rect) break;
    const dx = Math.abs(rect.left - goalX);
    if (dx < bestDx) {
      bestDx = dx;
      best = mid;
    }
    if (rect.left < goalX) lo = mid + 1;
    else if (rect.left > goalX) hi = mid - 1;
    else return mid;
  }
  return best;
}

function adjacentVisualLineOffset(el, from, dir, goalX) {
  const visLen = editorVisibleText(el).length;
  const startRect = rectAtVisibleOffset(el, from);
  if (!startRect || visLen <= 0) return from;
  const step = dir > 0 ? 1 : -1;
  const limit = dir > 0 ? visLen : 0;
  let seed = from;
  for (let i = 0; i < 400; i += 1) {
    seed += step;
    if (dir > 0 ? seed > limit : seed < limit) return from;
    const rect = rectAtVisibleOffset(el, seed);
    if (rect && !sameVisualLine(startRect, rect)) {
      const a = visualLineStart(el, seed, rect);
      const b = visualLineEnd(el, seed, rect, visLen);
      return closestOffsetOnLine(el, a, b, goalX, seed);
    }
  }
  return from;
}

export function setVisibleSelection(el, start, end) {
  if (!el) return;
  const sel = window.getSelection();
  const range = document.createRange();
  const a = Math.max(0, start);
  const b = Math.max(a, end);
  const sa = visibleLocation(el, a);
  const sb = visibleLocation(el, b);
  try {
    range.setStart(sa.node, sa.offset);
    range.setEnd(sb.node, sb.offset);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch { /* ignore */ }
}

export function initChipEditor(id) {
  const el = document.getElementById(id);
  if (!el || initialized.has(id)) return;
  initialized.add(id);
  let composing = false;
  el.addEventListener('compositionstart', () => { composing = true; });
  el.addEventListener('compositionend', () => { composing = false; });

  el.addEventListener('keydown', (e) => {
    if (composing || e.isComposing) return;
    if (e.key === 'Enter') {
      if (extraCapture.has(id) || e.isComposing) return;
      e.preventDefault();
      insertTextAtCaret(el, '\n');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const vertical = e.key === 'ArrowDown' || e.key === 'ArrowUp'
      || e.key === 'PageDown' || e.key === 'PageUp';
    if (vertical && !e.ctrlKey && !e.altKey && !e.metaKey && !e.isComposing) {
      e.preventDefault();
      const dir = (e.key === 'ArrowDown' || e.key === 'PageDown') ? 1 : -1;
      moveChipEditorByVisualLine(el, dir, {
        extend: e.shiftKey,
        page: e.key === 'PageDown' || e.key === 'PageUp',
      });
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
      caretGoalX.delete(el);
    }
    if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) chipRedo(id);
      else chipUndo(id);
      return;
    }
    if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      chipRedo(id);
    }
  });
  el.addEventListener('mousedown', () => caretGoalX.delete(el));

  el.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text');
    insertTextAtCaret(el, normalizeNewlines(text));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

  el.addEventListener('input', (e) => {
    if (e.isComposing) return;
    if (history.get(id)?.applying) return;
    snapshot(id);
  });
  resetHistory(id);
}

export function insertTextAtCaret(el, text) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) {
    el.appendChild(document.createTextNode(text));
    el.normalize();
    return;
  }
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  el.normalize();
}

export function setChipEditorContent(id, explanationText, blanks = [], opts = {}) {
  const el = document.getElementById(id);
  if (!el) return;
  initChipEditor(id);
  el.innerHTML = '';

  const tmpl = normalizeNewlines(explanationText || '');
  const blankMap = new Map((blanks || []).map((b) => [Number(b.order), b]));
  const re = /\[\[BLANK(\d+)\]\]/g;
  let last = 0;
  let m;
  while ((m = re.exec(tmpl)) !== null) {
    if (m.index > last) el.appendChild(document.createTextNode(tmpl.slice(last, m.index)));
    const blank = blankMap.get(Number(m[1]));
    el.appendChild(makeChipEl(blank?.answer || '', blank?.aliases, blank || {}));
    last = m.index + m[0].length;
  }
  if (last < tmpl.length) el.appendChild(document.createTextNode(tmpl.slice(last)));
  if (opts.resetHistory !== false) resetHistory(id);
}

function nodeToTemplate(node, picked) {
  let out = '';
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3) {
      out += child.nodeValue;
    } else if (isChip(child)) {
      const side = unpackBlankSide(child.dataset.blankSide);
      picked.push({
        id: child.dataset.blankId || '',
        answer: child.dataset.answer || '',
        aliases: parseAliases(child.dataset.aliases),
        lastInput: side.lastInput,
        lastResult: side.lastResult,
        manualResult: side.manualResult,
      });
      out += `[[BLANK${picked.length}]]`;
    } else if (isFnMark(child) || child.classList?.contains('cz-chip-x')) {
      /* skip */
    } else if (child.nodeName === 'BR') {
      if (!isPlaceholderBr(child)) out += '\n';
    } else if (isLineWrap(child)) {
      if (prevLineWrap(child)) out += '\n';
      else if (out && !out.endsWith('\n')) out += '\n';
      out += nodeToTemplate(child, picked);
    } else if (child.nodeType === 1) {
      if (out && !out.endsWith('\n') && /^(DIV|P)$/.test(child.nodeName)) out += '\n';
      out += nodeToTemplate(child, picked);
    }
  });
  return out;
}

export function remapVisiblePoint(pos, delStart, delEnd, insLen, side = 'right') {
  const p = Math.max(0, pos | 0);
  const d0 = Math.min(delStart, delEnd);
  const d1 = Math.max(delStart, delEnd);
  const delta = insLen - (d1 - d0);
  if (p < d0 || (p === d0 && side === 'left')) return p;
  if (p >= d1) return p + delta;
  return d0 + insLen;
}

/** 현재 가시 원문(cur)에서 목표(next)로 가는 단일 치환 구간. */
export function visibleTextDiff(from, to) {
  const a = normalizeNewlines(from ?? '');
  const b = normalizeNewlines(to ?? '');
  if (a === b) return { start: 0, end: 0, inserted: '' };
  let pre = 0;
  const minLen = Math.min(a.length, b.length);
  while (pre < minLen && a[pre] === b[pre]) pre += 1;
  let suf = 0;
  while (
    suf < a.length - pre
    && suf < b.length - pre
    && a[a.length - 1 - suf] === b[b.length - 1 - suf]
  ) suf += 1;
  const start = pre;
  const end = a.length - suf;
  const inserted = b.slice(pre, b.length - suf);
  return { start, end, inserted };
}

/** 가시 원문이 canonical 과 다를 때 칩·빈칸 메타는 유지하고 DOM 을 맞춘다. */
export function rebuildEditorVisibleText(id, visibleText, caret) {
  const el = document.getElementById(id);
  if (!el) return false;
  const next = normalizeNewlines(visibleText ?? '');
  const cur = editorVisibleText(el);
  if (cur === next) {
    if (caret) setVisibleSelection(el, caret.start, caret.end);
    return false;
  }
  const patch = visibleTextDiff(cur, next);
  const insLen = patch.inserted.length;
  const { blanks } = readChipEditor(id);
  const atoms = editorVisibleAtoms(el)
    .filter((atom) => !(patch.end > patch.start && atom.start < patch.end && atom.end > patch.start))
    .map((atom) => ({
      ...atom,
      start: remapVisiblePoint(atom.start, patch.start, patch.end, insLen),
      end: remapVisiblePoint(atom.end, patch.start, patch.end, insLen, 'left'),
    }));
  let template = next;
  [...atoms].sort((a, b) => b.start - a.start || b.order - a.order).forEach((atom) => {
    const a = Math.max(0, Math.min(template.length, atom.start));
    const b = Math.max(a, Math.min(template.length, atom.end));
    template = `${template.slice(0, a)}[[BLANK${atom.order}]]${template.slice(b)}`;
  });
  const h = history.get(id);
  const wasApplying = h?.applying;
  if (h) h.applying = true;
  setChipEditorContent(id, template, blanks, { resetHistory: false });
  if (h) h.applying = wasApplying;
  if (caret) setVisibleSelection(el, caret.start, caret.end);
  return true;
}

export function readChipEditor(id) {
  const el = document.getElementById(id);
  if (!el) return { template: '', blanks: [] };
  const picked = [];
  const template = normalizeNewlines(nodeToTemplate(el, picked));
  const blanks = picked.map((p, i) => ({
    id: p.id || uid('b'),
    order: i + 1,
    answer: normalizeNewlines(p.answer),
    aliases: p.aliases,
    lastInput: p.lastInput || '',
    lastResult: p.lastResult ?? null,
    manualResult: p.manualResult ?? null,
  }));
  const synced = syncTemplateAndBlanks(template, blanks);
  synced.blanks = synced.blanks.map((b, i) => ({
    ...b,
    id: blanks[i]?.id || b.id,
    lastInput: blanks[i]?.lastInput || b.lastInput || '',
    lastResult: blanks[i]?.lastResult ?? b.lastResult ?? null,
    manualResult: blanks[i]?.manualResult ?? b.manualResult ?? null,
  }));
  return synced;
}

export function readChipPlainText(id) {
  return readChipEditor(id).template.replace(/\[\[BLANK\d+\]\]/g, ' ');
}

export function chipMakeBlank(id) {
  const el = document.getElementById(id);
  if (!el) return false;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.commonAncestorContainer)) return false;

  const autoPicked = range.collapsed;
  if (range.collapsed) {
    const node = range.startContainer;
    if (node?.nodeType !== 3) return false;
    const full = node.nodeValue || '';
    const pos = range.startOffset;
    const isWord = (ch) => /[A-Za-z0-9가-힣·\-]/.test(ch || '');
    let s = pos;
    let e = pos;
    while (s > 0 && isWord(full[s - 1])) s -= 1;
    while (e < full.length && isWord(full[e])) e += 1;
    if (s === e) return false;
    range.setStart(node, s);
    range.setEnd(node, e);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  if (rangeCrossesChip(range, el)) return false;

  // Range.toString() omits paragraph/BR boundaries (and can include UI text).
  // Use the same visible source and offsets as formatting and footnotes.
  const selected = rangeToVisibleOffsets(el, range);
  const original = editorVisibleText(el).slice(selected.start, selected.end);
  const leadingWs = (original.match(/^\s*/)?.[0]) ?? '';
  const trailingWs = (original.match(/\s*$/)?.[0]) ?? '';
  let text = original.trim();
  if (!text) return false;

  let suffixText = '';
  if (autoPicked) {
    const SUFFIXES = [
      '으로부터', '로부터', '까지', '부터',
      '으로', '로', '에게서', '에게', '에서', '으로서', '로서', '와', '과',
      '은', '는', '이', '가', '을', '를', '의', '도', '만',
    ];
    for (const suf of SUFFIXES) {
      if (text.length > suf.length + 1 && text.endsWith(suf)) {
        suffixText = suf;
        text = text.slice(0, -suf.length).trim();
        break;
      }
    }
  }
  if (text.length < 2) return false;

  const chip = makeChipEl(text.trim());
  range.deleteContents();
  const frag = document.createDocumentFragment();
  if (leadingWs) frag.appendChild(document.createTextNode(leadingWs));
  frag.appendChild(chip);
  if (suffixText || trailingWs) frag.appendChild(document.createTextNode(`${suffixText}${trailingWs}`));
  range.insertNode(frag);
  el.normalize();

  const after = document.createRange();
  after.setStartAfter(chip);
  after.collapse(true);
  sel.removeAllRanges();
  sel.addRange(after);

  el.dispatchEvent(new Event('input', { bubbles: true }));
  snapshot(id, true);
  return true;
}

export function chipRemoveEl(chipEl) {
  if (!isChip(chipEl)) return;
  const editor = chipEl.closest('[contenteditable="true"]');
  chipEl.replaceWith(document.createTextNode(chipEl.dataset.answer || ''));
  if (!editor) return;
  editor.normalize();
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  if (editor.id) snapshot(editor.id, true);
}

export function chipRemoveByOrder(id, order) {
  const el = document.getElementById(id);
  if (!el) return;
  const chips = [...el.querySelectorAll(`.${CHIP_CLASS}`)];
  const chip = chips[Number(order) - 1];
  if (chip) chipRemoveEl(chip);
}

export function chipBlankCount(id) {
  const el = document.getElementById(id);
  return el ? el.querySelectorAll(`.${CHIP_CLASS}`).length : 0;
}

export function chipRemoveAll(id) {
  const el = document.getElementById(id);
  if (!el) return 0;
  const chips = [...el.querySelectorAll(`.${CHIP_CLASS}`)];
  if (!chips.length) return 0;
  chips.forEach((chip) => {
    chip.replaceWith(document.createTextNode(chip.dataset.answer || ''));
  });
  el.normalize();
  el.dispatchEvent(new Event('input', { bubbles: true }));
  snapshot(id, true);
  return chips.length;
}

export function chipRemoveAtCaret(id) {
  const el = document.getElementById(id);
  if (!el) return false;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) {
    alert('해제할 빈칸 안이나 바로 옆에 커서를 두거나, 빈칸의 × 를 누르세요.');
    return false;
  }
  const range = sel.getRangeAt(0);
  let node = range.startContainer;
  let chip = null;

  if (isChip(node)) chip = node;
  else if (node.nodeType === 1) {
    chip = node.childNodes[range.startOffset - 1] && isChip(node.childNodes[range.startOffset - 1])
      ? node.childNodes[range.startOffset - 1]
      : (isChip(node.childNodes[range.startOffset]) ? node.childNodes[range.startOffset] : null);
  } else if (node.nodeType === 3) {
    if (range.startOffset === 0 && isChip(node.previousSibling)) chip = node.previousSibling;
    else if (range.startOffset === node.nodeValue.length && isChip(node.nextSibling)) chip = node.nextSibling;
  }

  if (!chip) {
    alert('해제할 빈칸 안이나 바로 옆에 커서를 두거나, 빈칸의 × 를 누르세요.');
    return false;
  }
  chipRemoveEl(chip);
  return true;
}

export function chipSetAnswer(id, order, answer) {
  const el = document.getElementById(id);
  if (!el) return;
  const chips = [...el.querySelectorAll(`.${CHIP_CLASS}`)];
  const chip = chips[Number(order) - 1];
  if (!chip) return;
  const prev = chip.dataset.answer || '';
  setChipText(chip, answer);
  return { prev, next: answer || '', chip };
}

export function chipSetAliases(id, order, text) {
  const el = document.getElementById(id);
  if (!el) return;
  const chips = [...el.querySelectorAll(`.${CHIP_CLASS}`)];
  const chip = chips[Number(order) - 1];
  if (chip) chip.dataset.aliases = formatAliases(parseAliases(text));
}

export function chipJump(id, order) {
  const el = document.getElementById(id);
  if (!el) return false;
  const chips = [...el.querySelectorAll(`.${CHIP_CLASS}`)];
  const chip = chips[Number(order) - 1];
  if (!chip) return false;
  chips.forEach((c) => c.classList.remove('cz-chip-active'));
  chip.classList.add('cz-chip-active');
  chip.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => chip.classList.remove('cz-chip-active'), 1200);
  return true;
}

export function chipApplyTokens(id, tokens) {
  const el = document.getElementById(id);
  if (!el) return;
  const sorted = tokens.slice().sort((a, b) => b.length - a.length);
  const occupied = new Set(
    [...el.querySelectorAll(`.${CHIP_CLASS}`)].map((c) => normalizeTight(c.dataset.answer)),
  );

  sorted.forEach((token) => {
    if (occupied.has(normalizeTight(token))) return;
    if (wrapFirstOccurrence(el, token)) occupied.add(normalizeTight(token));
  });

  el.dispatchEvent(new Event('input', { bubbles: true }));
  snapshot(id, true);
}

function wrapFirstOccurrence(el, token) {
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![A-Za-z가-힣0-9])(${esc})(?![A-Za-z가-힣0-9])`);
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.parentElement?.closest(`.${CHIP_CLASS}`)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  let node;
  while ((node = walker.nextNode())) {
    const match = node.nodeValue.match(re);
    if (!match) continue;
    const idx = match.index;
    const before = node.nodeValue.slice(0, idx);
    const after = node.nodeValue.slice(idx + token.length);
    const chip = makeChipEl(token);
    const frag = document.createDocumentFragment();
    if (before) frag.appendChild(document.createTextNode(before));
    frag.appendChild(chip);
    if (after) frag.appendChild(document.createTextNode(after));
    node.replaceWith(frag);
    return true;
  }
  return false;
}

export function focusChipEditor(id) {
  const el = document.getElementById(id);
  if (el) el.focus();
}
