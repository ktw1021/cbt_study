/** DOM 헬퍼 */
export function $(id) {
  return document.getElementById(id);
}

export function selectionRange(el) {
  return {
    start: el.selectionStart,
    end: el.selectionEnd,
    text: el.value.slice(el.selectionStart, el.selectionEnd),
  };
}

export function captureTextareaView(el) {
  return {
    scrollTop: el.scrollTop,
    scrollLeft: el.scrollLeft,
    start: el.selectionStart,
    end: el.selectionEnd,
  };
}

/** value 갱신 후 커서·스크롤 유지 */
export function writeTextarea(el, value, caret = null, scroll = null) {
  const scrollTop = scroll?.scrollTop ?? scroll?.top ?? el.scrollTop;
  const scrollLeft = scroll?.scrollLeft ?? scroll?.left ?? el.scrollLeft;
  const start = caret?.start ?? el.selectionStart;
  const end = caret?.end ?? el.selectionEnd;

  el.value = value;

  const safeStart = Math.max(0, Math.min(start, value.length));
  const safeEnd = Math.max(safeStart, Math.min(end, value.length));
  el.setSelectionRange(safeStart, safeEnd);
  el.scrollTop = scrollTop;
  el.scrollLeft = scrollLeft;

  try {
    el.focus({ preventScroll: true });
  } catch {
    el.focus();
  }
}

/** textarea 안 선택 구간이 보이도록 스크롤 */
export function scrollTextareaToRange(el, start, end = start) {
  if (!el) return;
  el.setSelectionRange(start, end);
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });

  const style = window.getComputedStyle(el);
  const lineHeight = parseFloat(style.lineHeight) || 22;
  const textBefore = el.value.slice(0, start);
  const lines = (textBefore.match(/\n/g) || []).length;
  el.scrollTop = Math.max(0, lines * lineHeight - el.clientHeight / 3);
}
