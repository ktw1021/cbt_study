/**
 * 정렬·각주 geometry 관측. Selection 을 바꾸지 않는다 (setVisibleSelection/measureLinesInPage 금지).
 */
export function observeEditorGeometry(arg) {
  const editorId = typeof arg === 'string' ? arg : arg?.editorId;
  const needles = typeof arg === 'string' ? [] : (arg?.needles || []);
  const el = document.getElementById(editorId);
  if (!el) return null;
  const box = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const padL = parseFloat(cs.paddingLeft) || 0;
  const padR = parseFloat(cs.paddingRight) || 0;
  const contentLeft = box.left + padL;
  const contentRight = box.right - padR;
  const contentWidth = contentRight - contentLeft;
  const lineHeight = parseFloat(cs.lineHeight);
  const fontSize = parseFloat(cs.fontSize) || 16;
  const lh = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : fontSize * 1.2;

  const skipText = (n) => !!(n.parentElement?.closest?.('.tm-fn, .cz-chip-x'));

  const rectsForNeedle = (needle) => {
    if (!needle) return null;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      if (skipText(node)) continue;
      const val = node.nodeValue || '';
      const i = val.indexOf(needle);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(node, i);
      r.setEnd(node, Math.min(val.length, i + needle.length));
      const rects = [...r.getClientRects()].filter((x) => Number.isFinite(x.left) && (x.width > 0 || x.height > 0));
      if (!rects.length) continue;
      const first = rects[0];
      const last = rects[rects.length - 1];
      return {
        needle,
        left: first.left,
        right: last.right,
        top: first.top,
        bottom: last.bottom,
        height: first.height,
        width: last.right - first.left,
        lineCount: rects.length,
        firstLineLeft: first.left,
        firstLineRight: first.right,
        lastLineLeft: last.left,
        lastLineRight: last.right,
        lastLineWidth: last.width,
      };
    }
    return { needle, missing: true };
  };

  const tm = [...el.querySelectorAll(':scope .tm-line')].map((n) => {
    const st = getComputedStyle(n);
    const nb = n.getBoundingClientRect();
    const ink = [];
    const walker = document.createTreeWalker(n, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest?.('.tm-fn, .cz-chip-x')) continue;
      const val = node.nodeValue || '';
      for (let i = 0; i < val.length; i += 1) {
        const ch = val[i];
        if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\u00A0') continue;
        if (ch === '\u200B' || ch === '\uFEFF') continue;
        const rr = document.createRange();
        rr.setStart(node, i);
        rr.setEnd(node, i + 1);
        const cr = rr.getClientRects()[0];
        if (cr && Number.isFinite(cr.left) && Number.isFinite(cr.right) && cr.width > 0) {
          ink.push(cr);
        }
      }
    }
    const lines = [];
    ink.forEach((x) => {
      const top = Math.round(x.top);
      let row = lines.find((g) => Math.abs(g.top - top) <= 2);
      if (!row) {
        row = { top, left: x.left, right: x.right };
        lines.push(row);
      } else {
        row.left = Math.min(row.left, x.left);
        row.right = Math.max(row.right, x.right);
      }
    });
    lines.sort((a, b) => a.top - b.top);
    const first = lines[0];
    const last = lines[lines.length - 1];
    const boxRight = nb.left + nb.width;
    const firstGap = first ? boxRight - first.right : null;
    const lastGap = last ? boxRight - last.right : null;
    const lineInkGaps = lines.map((row) => boxRight - row.right);
    return {
      align: st.textAlign,
      textAlignLast: st.textAlignLast,
      display: st.display,
      width: nb.width,
      left: nb.left,
      boxRight,
      text: (n.innerText || '').replace(/\u00a0/g, ' '),
      wrapCount: lines.length,
      firstLineLeft: first?.left,
      firstLineRight: first?.right,
      firstLineWidth: first ? first.right - first.left : 0,
      lastLineLeft: last?.left,
      lastLineRight: last?.right,
      lastLineWidth: last ? last.right - last.left : 0,
      firstLineRightGap: firstGap,
      lastLineRightGap: lastGap,
      lineInkGaps,
    };
  });

  const bar = document.querySelector(`.fmt-toolbar[data-fmt-for="${editorId}"]`);
  const alignBtns = [...(bar?.querySelectorAll('[data-action="fmt-align"]') || [])].map((b) => ({
    align: b.dataset.align,
    active: b.classList.contains('is-active'),
    pressed: b.getAttribute('aria-pressed'),
  }));

  const fns = [...el.querySelectorAll(':scope .tm-fn')].map((b) => {
    const r = b.getBoundingClientRect();
    const st = getComputedStyle(b);
    const parent = b.parentElement;
    const pcs = parent ? getComputedStyle(parent) : null;
    let prevCh = null;
    let sib = b.previousSibling;
    while (sib && sib.nodeType === 3 && !(sib.nodeValue || '')) sib = sib.previousSibling;
    if (sib && sib.nodeType === 3 && (sib.nodeValue || '').length) {
      const rr = document.createRange();
      const len = sib.nodeValue.length;
      rr.setStart(sib, Math.max(0, len - 1));
      rr.setEnd(sib, len);
      const cr = rr.getClientRects()[0];
      if (cr) prevCh = { right: cr.right, height: cr.height, top: cr.top };
    }
    let nextCh = null;
    sib = b.nextSibling;
    while (sib && sib.nodeType === 3 && !(sib.nodeValue || '')) sib = sib.nextSibling;
    if (sib && sib.nodeType === 3 && (sib.nodeValue || '').length) {
      const rr = document.createRange();
      rr.setStart(sib, 0);
      rr.setEnd(sib, 1);
      const cr = rr.getClientRects()[0];
      if (cr) nextCh = { left: cr.left, height: cr.height, top: cr.top };
    }
    return {
      id: b.dataset.fnId,
      index: b.dataset.fnIndex,
      w: r.width,
      h: r.height,
      left: r.left,
      right: r.right,
      top: r.top,
      display: st.display,
      va: st.verticalAlign,
      marginLeft: parseFloat(st.marginLeft) || 0,
      marginRight: parseFloat(st.marginRight) || 0,
      paddingLeft: parseFloat(st.paddingLeft) || 0,
      paddingRight: parseFloat(st.paddingRight) || 0,
      fontSize: parseFloat(st.fontSize) || 0,
      lineHeight: st.lineHeight,
      parentLineHeight: pcs ? parseFloat(pcs.lineHeight) : NaN,
      gapBefore: prevCh ? r.left - prevCh.right : null,
      gapAfter: nextCh ? nextCh.left - r.right : null,
      heightVsPrev: prevCh ? r.height - prevCh.height : null,
      heightVsParentLh: pcs && Number.isFinite(parseFloat(pcs.lineHeight))
        ? r.height - parseFloat(pcs.lineHeight)
        : null,
    };
  });

  const liveSel = (() => {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.startContainer) && range.startContainer !== el) return null;
    return { collapsed: range.collapsed, text: sel.toString() };
  })();

  const glyphs = {};
  for (const n of needles) glyphs[n] = rectsForNeedle(n);

  return {
    contentLeft,
    contentRight,
    contentWidth,
    lineHeight: lh,
    editorLineHeight: cs.lineHeight,
    tm,
    alignBtns,
    fns,
    liveSel,
    innerText: el.innerText || '',
    glyphs,
  };
}

export function glyphMidShift(before, after, contentWidth) {
  if (!before || !after || before.missing || after.missing) return null;
  const bMid = (before.left + before.right) / 2;
  const aMid = (after.left + after.right) / 2;
  const w = contentWidth || 1;
  return {
    leftDelta: after.left - before.left,
    midDelta: aMid - bMid,
    rightDelta: after.right - before.right,
    width: w,
  };
}
