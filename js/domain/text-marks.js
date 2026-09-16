/**
 * 서식·각주 순수 모델.
 * 원문(displayText / 가시 해설)과 같은 줄바꿈 정규화·UTF-16 인덱스를 쓴다.
 * NFC 를 좌표에 적용하지 않는다(결합 문자 위치가 어긋남).
 */
import { normalizeNewlines, splitAnswers } from '../utils/text.js';

export const MARK_TYPES = Object.freeze(['bold', 'color', 'hl', 'align']);
export const COLOR_VALUES = Object.freeze(['k', 'b', 'r', 'g']);
export const ALIGN_VALUES = Object.freeze(['left', 'center', 'right', 'justify']);
export const TEXT_FIELDS = Object.freeze(['display', 'explanation']);

const COLOR_SET = new Set(COLOR_VALUES);
const ALIGN_SET = new Set(ALIGN_VALUES);
const FIELD_SET = new Set(TEXT_FIELDS);
const TOKEN_RE = /\[\[BLANK(\d+)\]\]/g;

function asInt(n, fallback = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? (v | 0) : fallback;
}

function isLead(code) {
  return code >= 0xD800 && code <= 0xDBFF;
}
function isTrail(code) {
  return code >= 0xDC00 && code <= 0xDFFF;
}

/** UTF-16 코드 유닛 경계로 스냅. start 는 페어 앞, exclusive end 는 페어 뒤. */
export function snapUtf16(text, pos, role = 'start') {
  const s = String(text || '');
  const len = s.length;
  let p = asInt(pos, 0);
  if (p < 0) p = 0;
  if (p > len) p = len;
  if (p <= 0 || p >= len) return p;
  const c = s.charCodeAt(p);
  const prev = s.charCodeAt(p - 1);
  if (isTrail(c) && isLead(prev)) return role === 'end' ? p + 1 : p - 1;
  return p;
}

export function clampRange(start, end, length) {
  const len = Math.max(0, asInt(length, 0));
  let a = asInt(start, 0);
  let b = asInt(end, 0);
  if (a > b) [a, b] = [b, a];
  a = Math.max(0, Math.min(len, a));
  b = Math.max(0, Math.min(len, b));
  if (a > b) [a, b] = [b, a];
  return { start: a, end: b };
}

export function snapRangeUtf16(text, start, end) {
  const s = String(text || '');
  const r = clampRange(start, end, s.length);
  return {
    start: snapUtf16(s, r.start, 'start'),
    end: snapUtf16(s, r.end, 'end'),
  };
}

/** 선택이 걸친 줄들. exclusive end 는 줄 끝(개행 직전). */
export function lineRange(text, start, end) {
  const s = String(text || '');
  const r = clampRange(start, end, s.length);
  const from = r.start;
  const to = r.end > r.start ? r.end - 1 : r.start;
  let a = from;
  let b = to;
  while (a > 0 && s[a - 1] !== '\n') a -= 1;
  while (b < s.length && s[b] !== '\n') b += 1;
  return { start: a, end: b };
}

/** 해당 offset 의 실효 정렬. 마크 없으면 fallback (기본 왼쪽). */
export function markAlignAt(marks, index, fallback = '') {
  let v = '';
  (marks || []).forEach((m) => {
    if (m.type === 'align' && m.start <= index && index < m.end) v = m.value;
  });
  return v || fallback;
}

/** 선택이 걸친 문단. exclusive end 가 다음 문단 시작이면 앞 문단까지만. */
export function coveredParagraphSpans(text, start, end, atoms = []) {
  const src = String(text || '');
  const lr = lineRange(src, start, end);
  const collapsed = asInt(start, 0) === asInt(end, 0);
  return paragraphSpans(src, atoms).filter(([from, to]) => {
    if (from === to) {
      return collapsed ? lr.start === from : (from >= lr.start && from < lr.end);
    }
    return from < lr.end && to > lr.start;
  });
}

/**
 * 선택 구간의 실효 정렬 하나. 기본/명시 left 는 같음. 혼합이면 ''.
 */
export function selectionEffectiveAlign(marks, text, start, end, atoms = []) {
  const src = String(text || '');
  const spans = coveredParagraphSpans(src, start, end, atoms);
  if (!spans.length) return 'left';
  const vals = [];
  spans.forEach(([from]) => {
    const at = from < src.length ? from : Math.max(0, src.length - 1);
    const v = markAlignAt(marks, at, 'left');
    if (!vals.includes(v)) vals.push(v);
  });
  return vals.length === 1 ? vals[0] : '';
}

function atomCoversNewline(atoms, i) {
  return (atoms || []).some((atom) => {
    const as = asInt(atom.start, 0);
    const ae = asInt(atom.end, 0);
    return ae > as && as <= i && i + 1 <= ae;
  });
}

/** 개행으로 나뉜 문단. 소프트 랩은 경계가 아님. 칩 안 개행은 건너뛴다. */
export function paragraphSpans(text, atoms = []) {
  const s = String(text || '');
  const breaks = [];
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === '\n' && !atomCoversNewline(atoms, i)) breaks.push(i);
  }
  const spans = [];
  let start = 0;
  breaks.forEach((br) => {
    spans.push([start, br]);
    start = br + 1;
  });
  spans.push([start, s.length]);
  return spans;
}

/** 칩(원자)과 부분 겹치면 전체를 포함하도록 확장. */
export function expandRangeToAtoms(start, end, atoms = []) {
  let a = start;
  let b = end;
  for (const atom of atoms) {
    const as = asInt(atom.start, 0);
    const ae = asInt(atom.end, 0);
    if (ae <= a || as >= b) continue;
    if (as < a) a = as;
    if (ae > b) b = ae;
  }
  return { start: a, end: b };
}

function markValue(type, value) {
  if (type === 'color') return COLOR_SET.has(value) ? value : null;
  if (type === 'align') return ALIGN_SET.has(value) ? value : null;
  return '';
}

function cleanMark(raw, text) {
  const type = String(raw?.type || '');
  if (!MARK_TYPES.includes(type)) return null;
  const value = markValue(type, raw.value);
  if (type === 'color' && !value) return null;
  if (type === 'align' && !value) return null;
  let range = snapRangeUtf16(text, raw.start, raw.end);
  if (type === 'align' && text) range = lineRange(text, range.start, range.end);
  if (range.start >= range.end) return null;
  const mark = { type, start: range.start, end: range.end };
  if (type === 'color' || type === 'align') mark.value = value;
  return mark;
}

function byStart(a, b) {
  return a.start - b.start || a.end - b.end || a.type.localeCompare(b.type) || String(a.value || '').localeCompare(String(b.value || ''));
}

/** 같은 type+value 인접/겹침 병합. color/align 은 한 지점에 하나(배열에서 뒤가 이김). */
export function mergeMarks(marks) {
  const list = marks || [];
  const booleans = list.filter((m) => m.type === 'bold' || m.type === 'hl');
  const exclusive = list.filter((m) => m.type === 'color' || m.type === 'align');
  return [...unionBoolean(booleans), ...lastWinsExclusive(exclusive)].sort(byStart);
}

function unionBoolean(marks) {
  const out = [];
  ['bold', 'hl'].forEach((type) => {
    const merged = [];
    marks.filter((m) => m.type === type).sort(byStart).forEach((m) => {
      const last = merged[merged.length - 1];
      if (last && m.start <= last.end) last.end = Math.max(last.end, m.end);
      else merged.push({ type, start: m.start, end: m.end });
    });
    out.push(...merged);
  });
  return out;
}

function lastWinsExclusive(marks) {
  const out = [];
  ['color', 'align'].forEach((type) => {
    const items = marks.filter((m) => m.type === type);
    if (!items.length) return;
    const cuts = new Set();
    items.forEach((m) => { cuts.add(m.start); cuts.add(m.end); });
    const pts = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (a >= b) continue;
      let winner = null;
      items.forEach((m) => {
        if (m.start <= a && m.end >= b) winner = m;
      });
      if (!winner) continue;
      const last = out[out.length - 1];
      if (last && last.type === type && last.value === winner.value && last.end === a) last.end = b;
      else out.push({ type, start: a, end: b, value: winner.value });
    }
  });
  return out;
}

export function normalizeMarks(raw, text = '') {
  const src = String(text || '');
  const cleaned = (Array.isArray(raw) ? raw : []).map((m) => cleanMark(m, src)).filter(Boolean);
  return mergeMarks(cleaned);
}

function cleanFootnote(raw, text, forcedField) {
  const src = String(text || '');
  const field = forcedField || String(raw?.field || '');
  if (!FIELD_SET.has(field)) return null;
  const body = String(raw?.body ?? '');
  const range = snapRangeUtf16(src, raw.start, raw.end);
  const pin = range.start === range.end;
  if (pin && !body) return null;
  if (range.start > src.length || range.end > src.length) return null;
  const id = String(raw?.id || '').trim();
  return {
    id,
    field,
    start: range.start,
    end: range.end,
    body,
  };
}

function assignFootnoteIds(list) {
  const used = new Set();
  let n = 1;
  const nextId = () => {
    while (used.has(`n${n}`)) n += 1;
    const id = `n${n}`;
    n += 1;
    return id;
  };
  return list.map((f) => {
    let id = f.id;
    if (!id || used.has(id)) id = nextId();
    used.add(id);
    return { ...f, id };
  });
}

export function normalizeFootnotes(raw, text = '', field = null) {
  const src = String(text || '');
  const cleaned = (Array.isArray(raw) ? raw : [])
    .map((fn) => cleanFootnote(fn, src, field))
    .filter(Boolean)
    .sort(compareFootnoteAnchors);
  return assignFootnoteIds(cleaned);
}

export function normalizeCardTextMeta(card = {}) {
  const display = normalizeNewlines(String(card.displayText || ''));
  const { visible } = visibleFromTemplate(card.explanationText, card.blanks);
  const rawMarks = card.textMarks && typeof card.textMarks === 'object' ? card.textMarks : {};
  const textMarks = {
    display: normalizeMarks(rawMarks.display, display),
    explanation: normalizeMarks(rawMarks.explanation, visible),
  };
  const rawFns = Array.isArray(card.footnotes) ? card.footnotes : [];
  const footnotes = assignFootnoteIds([
    ...normalizeFootnotes(rawFns.filter((f) => f && f.field === 'display'), display, 'display'),
    ...normalizeFootnotes(rawFns.filter((f) => f && f.field === 'explanation'), visible, 'explanation'),
  ]);
  return { textMarks, footnotes };
}

export function visibleFromTemplate(template, blanks = []) {
  const src = normalizeNewlines(String(template || ''));
  const byOrder = new Map((blanks || []).map((b) => [Number(b.order), b]));
  const tokens = [];
  let visible = '';
  let last = 0;
  const re = new RegExp(TOKEN_RE.source, 'g');
  let m;
  while ((m = re.exec(src)) !== null) {
    visible += src.slice(last, m.index);
    const order = Number(m[1]);
    const answer = normalizeNewlines(String(byOrder.get(order)?.answer || ''));
    const visStart = visible.length;
    visible += answer;
    tokens.push({
      order,
      tmplStart: m.index,
      tmplEnd: m.index + m[0].length,
      visStart,
      visEnd: visible.length,
    });
    last = m.index + m[0].length;
  }
  visible += src.slice(last);
  return { visible, tokens };
}

function editSpan(edit) {
  const start = Math.max(0, asInt(edit.start, 0));
  const end = Math.max(start, asInt(edit.end, start));
  const ins = typeof edit.inserted === 'string'
    ? edit.inserted.length
    : Math.max(0, asInt(edit.insertedLength, 0));
  return { start, end, ins, delta: ins - (end - start) };
}

/**
 * 마크: 기본은 교체 구간을 무서식으로 분할(잔여만 남김).
 * inherit:true 이면 서식 구간 안(또는 끝)에서 입력한 글자가 같은 서식을 이어받는다.
 * 각주: 본문 유지. 범위가 통째로 지워지면 start===end 핀(orphan pin).
 */
export function remapMarks(marks, edit, { inherit = false, text = '' } = {}) {
  const { start: es, end: ee, ins, delta } = editSpan(edit);
  const out = [];
  (marks || []).forEach((m) => {
    const leftEnd = Math.min(m.end, es);
    if (m.start < es && leftEnd > m.start) {
      out.push({ ...m, start: m.start, end: leftEnd });
    }
    if (m.end > ee && Math.max(m.start, ee) < m.end) {
      out.push({
        ...m,
        start: Math.max(m.start, ee) + delta,
        end: m.end + delta,
      });
    }
    if (inherit && ins > 0) {
      const sticky = m.start < es && es <= m.end;
      const overlapped = m.start < ee && m.end > es;
      const src = String(text || '');
      const continuesAlign = m.type === 'align'
        && src
        && m.end < es
        && src.slice(m.end, es) === '\n'
        && es === m.end + 1;
      if (sticky || overlapped || continuesAlign) {
        out.push({ ...m, start: es, end: es + ins });
      }
    }
  });
  return mergeMarks(out);
}

export function remapFootnotes(footnotes, edit) {
  const { start: es, end: ee, ins, delta } = editSpan(edit);
  return (footnotes || []).map((fn) => {
    const a = fn.start;
    const b = fn.end;
    if (b <= es) return { ...fn };
    if (a >= ee) return { ...fn, start: a + delta, end: b + delta };
    if (a >= es && b <= ee) {
      return { ...fn, start: es, end: es };
    }
    const na = a < es ? a : es + ins;
    const nb = b > ee ? b + delta : es + ins;
    if (na >= nb) return { ...fn, start: es, end: es };
    return { ...fn, start: na, end: nb };
  });
}

export function applyTextEdit(text, meta, edit, opts = {}) {
  const src = String(text || '');
  const { start, end } = editSpan(edit);
  const s = Math.max(0, Math.min(src.length, start));
  const e = Math.max(s, Math.min(src.length, end));
  const inserted = typeof edit.inserted === 'string' ? edit.inserted : '';
  const next = src.slice(0, s) + inserted + src.slice(e);
  const patch = { start: s, end: e, inserted };
  return {
    text: next,
    marks: remapMarks(meta?.marks, patch, { ...opts, text: src }),
    footnotes: remapFootnotes(meta?.footnotes, patch),
  };
}

function coverageComplete(marks, spec) {
  const want = (marks || []).filter((m) => m.type === spec.type && (m.value || '') === (spec.value || ''));
  let pos = spec.start;
  const hits = want.filter((m) => m.end > spec.start && m.start < spec.end).sort(byStart);
  for (const m of hits) {
    if (m.start > pos) return false;
    pos = Math.max(pos, m.end);
    if (pos >= spec.end) return true;
  }
  return pos >= spec.end;
}

export function addMark(marks, spec, { text = '', atoms = [] } = {}) {
  const src = String(text || '');
  let range = snapRangeUtf16(src, spec.start, spec.end);
  if (spec.type === 'align') range = lineRange(src, range.start, range.end);
  else range = expandRangeToAtoms(range.start, range.end, atoms);
  const next = cleanMark({ ...spec, ...range }, src);
  if (!next) return normalizeMarks(marks, src);
  return mergeMarks([...normalizeMarks(marks, src), next]);
}

export function removeMarkRange(marks, spec, { text = '' } = {}) {
  const src = String(text || '');
  let range = snapRangeUtf16(src, spec.start, spec.end);
  if (spec.type === 'align') range = lineRange(src, range.start, range.end);
  const out = [];
  normalizeMarks(marks, src).forEach((m) => {
    if (m.type !== spec.type) { out.push(m); return; }
    if ((spec.value != null && spec.value !== '') && (m.value || '') !== spec.value) {
      out.push(m);
      return;
    }
    if (m.end <= range.start || m.start >= range.end) { out.push(m); return; }
    if (m.start < range.start) out.push({ ...m, end: range.start });
    if (m.end > range.end) out.push({ ...m, start: range.end });
  });
  return mergeMarks(out);
}

export function toggleMark(marks, spec, { text = '', atoms = [] } = {}) {
  const src = String(text || '');
  let range = snapRangeUtf16(src, spec.start, spec.end);
  if (spec.type === 'align') range = lineRange(src, range.start, range.end);
  else range = expandRangeToAtoms(range.start, range.end, atoms);
  const probe = { ...spec, ...range };
  const cur = normalizeMarks(marks, src);
  if (coverageComplete(cur, probe)) return removeMarkRange(cur, probe, { text: src });
  return addMark(cur, probe, { text: src, atoms });
}

/** 선택 구간의 모든 서식 제거. */
export function clearMarksInRange(marks, spec, { text = '' } = {}) {
  const src = String(text || '');
  let cur = normalizeMarks(marks, src);
  MARK_TYPES.forEach((type) => {
    cur = removeMarkRange(cur, { type, start: spec.start, end: spec.end }, { text: src });
  });
  return cur;
}

export function addFootnote(footnotes, spec, text = '') {
  const src = String(text || '');
  const field = spec.field;
  const next = {
    id: String(spec.id || ''),
    field,
    start: spec.start,
    end: spec.end,
    body: String(spec.body ?? ''),
  };
  const rest = (footnotes || []).filter((f) => f && f.field !== field);
  return [
    ...rest,
    ...normalizeFootnotes([...(footnotes || []).filter((f) => f && f.field === field), next], src, field),
  ];
}

export function updateFootnote(footnotes, id, patch, text = '') {
  const src = String(text || '');
  const list = (footnotes || []).map((f) => (f.id === id ? { ...f, ...patch, id: f.id } : f));
  const field = list.find((f) => f.id === id)?.field;
  if (!field) return normalizeFootnotes(list, src);
  const rest = list.filter((f) => f.field !== field);
  return [...rest, ...normalizeFootnotes(list.filter((f) => f.field === field), src, field)];
}

export function removeFootnote(footnotes, id) {
  return (footnotes || []).filter((f) => f.id !== id);
}

/** 번호가 실제 표시되는 위치(end) 순서. 선택 범위가 겹쳐도 번호가 역전되지 않는다. */
export function compareFootnoteAnchors(a, b) {
  return a.end - b.end || a.start - b.start || String(a.id || '').localeCompare(String(b.id || ''), 'en', { numeric: true });
}

/** 필드별 각주 번호. 문제·해설이 각각 1부터. id·원문 범위는 그대로. */
export function footnoteNumbers(footnotes = []) {
  const map = new Map();
  TEXT_FIELDS.forEach((field) => {
    const ordered = (footnotes || [])
      .filter((fn) => fn && fn.field === field)
      .slice()
      .sort(compareFootnoteAnchors);
    ordered.forEach((fn, i) => { if (fn?.id) map.set(fn.id, i + 1); });
  });
  return map;
}

function fingerprintAliases(aliases) {
  const list = typeof aliases === 'string' ? splitAnswers(aliases) : (aliases || []);
  return [...list]
    .map((a) => String(a || '').trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'ko'));
}

/** 기존 cardFingerprint 과 동일한 본문·빈칸 의미(생성 id 제외). */
export function contentFingerprint(card = {}) {
  const blanks = (card.blanks || [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((b) => `${b.order}:${String(b.answer || '').trim()}:${fingerprintAliases(b.aliases).join('||')}`)
    .join('|');
  return [
    String(card.title || '').trim(),
    normalizeNewlines(String(card.displayText || '')).trim(),
    normalizeNewlines(String(card.explanationText || '')).trim(),
    blanks,
  ].join('\u0001');
}

function fingerprintMarks(textMarks) {
  const parts = [];
  TEXT_FIELDS.forEach((field) => {
    (textMarks?.[field] || []).forEach((m) => {
      parts.push(`${field}:${m.type}:${m.start}:${m.end}:${m.value || ''}`);
    });
  });
  return parts.sort((a, b) => a.localeCompare(b, 'ko')).join('|');
}

function fingerprintFootnotes(footnotes) {
  return (footnotes || [])
    .map((f) => `${f.field}:${f.start}:${f.end}:${f.body}`)
    .sort((a, b) => a.localeCompare(b, 'ko'))
    .join('|');
}

/**
 * 서식·각주 내용을 반영. id 제외.
 * 메타가 비어 있으면 contentFingerprint 과 같다.
 */
export function semanticFingerprint(card = {}) {
  const base = contentFingerprint(card);
  const { textMarks, footnotes } = normalizeCardTextMeta(card);
  const markPart = fingerprintMarks(textMarks);
  const fnPart = fingerprintFootnotes(footnotes);
  if (!markPart && !fnPart) return base;
  return `${base}\u0001${markPart}\u0001${fnPart}`;
}
