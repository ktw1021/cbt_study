/**
 * 가시 원문을 조각낸 뒤 escape 하고, 허용된 span/style 만 만든다.
 * 원문 문자열을 innerHTML 로 넣지 않는다.
 */
import { escapeHtml } from '../utils/text.js';
import {
  normalizeMarks,
  normalizeFootnotes,
  visibleFromTemplate,
  footnoteNumbers,
  paragraphSpans,
  markAlignAt,
  compareFootnoteAnchors,
} from '../domain/text-marks.js';

const COLOR_CSS = Object.freeze({
  k: '#111111',
  b: '#1d4ed8',
  r: '#dc2626',
  g: '#15803d',
});
const HL_CSS = 'rgba(250, 204, 21, 0.55)';

function defaultAtom(atom) {
  const order = Number(atom?.order);
  const n = Number.isFinite(order) && order > 0 ? String(order) : '';
  return `<span class="tm-atom"${n ? ` data-blank-order="${n}"` : ''}></span>`;
}

/** 각주 버튼: 범위 원문·정답·body 를 title/aria/snippet 에 넣지 않는다. */
export function defaultFootnoteMarker(fn, index) {
  const n = Number(index) || 1;
  const id = escapeHtml(String(fn?.id || ''));
  return `<button type="button" class="tm-fn" data-fn-id="${id}" data-fn-index="${n}" aria-label="각주 ${n}"></button>`;
}

function stylesFor(marks, start, end) {
  const s = { bold: false, color: '', hl: false };
  const b = end > start ? end : start + 1;
  (marks || []).forEach((m) => {
    if (m.type === 'align') return;
    if (m.end <= start || m.start >= b) return;
    if (m.type === 'bold') s.bold = true;
    else if (m.type === 'hl') s.hl = true;
    else if (m.type === 'color' && m.value) s.color = m.value;
  });
  return s;
}

function wrapInline(html, styles) {
  let out = html;
  if (styles.hl) out = `<span class="tm-hl" style="background:${HL_CSS}">${out}</span>`;
  if (styles.color && COLOR_CSS[styles.color]) {
    out = `<span class="tm-color tm-color-${styles.color}" style="color:${COLOR_CSS[styles.color]}">${out}</span>`;
  }
  if (styles.bold) out = `<span class="tm-bold" style="font-weight:700">${out}</span>`;
  return out;
}

/** span+block — DIV 로 감싸면 편집기 읽기가 줄바꿈을 더한다. */
function wrapLine(inner, align) {
  const v = align || 'left';
  return `<span class="tm-line tm-align-${v}" style="display:block;text-align:${v}">${inner}</span>`;
}

function coveringAtom(atoms, start, end) {
  return (atoms || []).find((a) => a.end > a.start && a.start <= start && end <= a.end);
}

function hostAtomForPoint(atoms, pos) {
  return (atoms || []).find((a) => a.end > a.start && pos > a.start && pos <= a.end);
}

function insideAtom(atoms, p) {
  return (atoms || []).some((a) => a.end > a.start && a.start < p && p < a.end);
}

function splitPoints(from, to, marks, atoms, extra) {
  const pts = new Set([from, to]);
  extra.forEach((p) => {
    if (p > from && p < to && !insideAtom(atoms, p)) pts.add(p);
  });
  (marks || []).forEach((m) => {
    if (m.start > from && m.start < to && !insideAtom(atoms, m.start)) pts.add(m.start);
    if (m.end > from && m.end < to && !insideAtom(atoms, m.end)) pts.add(m.end);
  });
  (atoms || []).forEach((a) => {
    if (a.start > from && a.start < to) pts.add(a.start);
    if (a.end > from && a.end < to) pts.add(a.end);
    if (a.start === a.end && a.start > from && a.start < to) pts.add(a.start);
  });
  return [...pts].sort((a, b) => a - b);
}

function filterFootnotes(raw, src, field) {
  const list = (raw || []).filter((fn) => {
    if (!field) return true;
    const f = fn?.field;
    return !f || f === field;
  });
  return normalizeFootnotes(list, src, field)
    .slice()
    .sort(compareFootnoteAnchors);
}

/**
 * @param {string} text 가시 원문
 * @param {object} [opts]
 */
export function renderMarkedHtml(text, opts = {}) {
  const src = String(text || '');
  const marks = normalizeMarks(opts.marks, src);
  const field = opts.field || null;
  const footnotes = filterFootnotes(opts.footnotes, src, field);
  const nums = opts.fnNumbers || footnoteNumbers(opts.allFootnotes || opts.footnotes || footnotes);
  const atoms = (opts.atoms || [])
    .map((a) => ({
      ...a,
      start: Math.max(0, Math.min(src.length, Number(a.start) || 0)),
      end: Math.max(0, Math.min(src.length, Number(a.end) || 0)),
    }))
    .filter((a) => a.end >= a.start)
    .sort((a, b) => a.start - b.start || a.end - b.end || Number(a.order || 0) - Number(b.order || 0));

  const renderAtom = opts.renderAtom || defaultAtom;
  const renderFootnote = opts.renderFootnote || defaultFootnoteMarker;
  const hasAlign = marks.some((m) => m.type === 'align');
  const emittedFn = new Set();

  const numbered = footnotes.map((fn, i) => ({
    fn,
    index: nums.get(fn.id) ?? (i + 1),
  }));
  const byPos = new Map();
  numbered.forEach((item) => {
    const host = hostAtomForPoint(atoms, item.fn.end);
    const pos = host ? host.end : item.fn.end;
    if (!byPos.has(pos)) byPos.set(pos, []);
    byPos.get(pos).push(item);
  });

  const zerosAt = (pos) => atoms.filter((a) => a.start === a.end && a.start === pos);

  const markersAt = (pos) => (byPos.get(pos) || [])
    .filter((item) => {
      const key = item.fn.id || `${item.index}:${pos}`;
      if (emittedFn.has(key)) return false;
      emittedFn.add(key);
      return true;
    })
    .map((item) => renderFootnote(item.fn, item.index))
    .join('');

  const emitAtoms = (pos) => zerosAt(pos)
    .map((atom) => wrapInline(renderAtom(atom), stylesFor(marks, atom.start, atom.end)))
    .join('');

  const emitAt = (pos) => emitAtoms(pos) + markersAt(pos);

  if (!src) return emitAt(0);

  const renderRange = (from, to, withStart) => {
    const pts = splitPoints(from, to, marks, atoms, [...byPos.keys()]);
    let html = withStart ? emitAt(from) : '';
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i];
      const b = pts[i + 1];
      if (a >= b) continue;
      const atom = coveringAtom(atoms, a, b);
      if (atom) {
        if (a === atom.start) {
          html += wrapInline(renderAtom(atom), stylesFor(marks, atom.start, atom.end));
        }
        if (b === atom.end) html += emitAt(b);
        continue;
      }
      html += wrapInline(escapeHtml(src.slice(a, b)), stylesFor(marks, a, b));
      html += emitAt(b);
    }
    return html;
  };

  const spans = paragraphSpans(src, atoms);
  const chunks = spans.map((span, idx) => {
    const [from, to] = span;
    const inner = renderRange(from, to, true);
    if (hasAlign) {
      const at = from < src.length ? from : Math.max(0, src.length - 1);
      return wrapLine(inner, markAlignAt(marks, at, 'left'));
    }
    return inner + (idx < spans.length - 1 ? '<br>' : '');
  });
  return chunks.join('');
}

/** 해설 템플릿 + blanks → 가시 렌더. 기본 atom 은 정답 문자열을 넣지 않는다. */
export function renderTemplateHtml(template, blanks, opts = {}) {
  const { visible, tokens } = visibleFromTemplate(template, blanks);
  const atoms = tokens.map((t) => ({
    start: t.visStart,
    end: t.visEnd,
    order: t.order,
  }));
  const field = opts.field || 'explanation';
  const all = opts.allFootnotes || opts.footnotes || [];
  const footnotes = all.filter((f) => !f.field || f.field === field);
  return renderMarkedHtml(visible, {
    ...opts,
    footnotes,
    allFootnotes: all,
    atoms,
    field,
  });
}
