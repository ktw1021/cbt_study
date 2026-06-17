/**
 * 입력창 커서 자동 스크롤
 *
 * textarea / contenteditable(칩 에디터)에서 글자 입력·Enter로 커서가 보이는
 * 영역을 벗어나면, 한글 워드프로세서처럼 커서를 따라 약간의 여백을 두고
 * 스크롤을 내려/올려준다. (사용자가 수동으로 스크롤할 필요 없음)
 */

const MARGIN = 28;

let mirrorEl = null;

function getMirror() {
  if (mirrorEl) return mirrorEl;
  mirrorEl = document.createElement('div');
  Object.assign(mirrorEl.style, {
    position: 'absolute',
    top: '-9999px',
    left: '-9999px',
    visibility: 'hidden',
    whiteSpace: 'pre-wrap',
    wordWrap: 'break-word',
    boxSizing: 'border-box',
  });
  mirrorEl.setAttribute('aria-hidden', 'true');
  document.body.appendChild(mirrorEl);
  return mirrorEl;
}

/** 스크롤 컨테이너(el)에서 [top, bottom] 픽셀(컨테이너 내부 좌표)이 보이도록 조정 */
function applyScroll(el, caretTop, caretBottom) {
  const view = el.clientHeight;
  if (caretBottom > el.scrollTop + view - MARGIN) {
    el.scrollTop = Math.ceil(caretBottom - view + MARGIN);
  } else if (caretTop < el.scrollTop + MARGIN) {
    el.scrollTop = Math.max(0, Math.floor(caretTop - MARGIN));
  }
}

/** textarea: 미러 div로 커서 y좌표를 측정해 스크롤 */
function scrollTextareaCaret(ta) {
  if (ta.scrollHeight <= ta.clientHeight) return;
  const mirror = getMirror();
  const cs = getComputedStyle(ta);
  const copy = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing',
    'textTransform', 'lineHeight', 'paddingTop', 'paddingRight', 'paddingBottom',
    'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth',
    'borderLeftWidth', 'wordBreak', 'tabSize',
  ];
  copy.forEach((p) => { mirror.style[p] = cs[p]; });
  mirror.style.width = `${ta.clientWidth}px`;

  const pos = ta.selectionEnd;
  mirror.textContent = ta.value.slice(0, pos);
  const marker = document.createElement('span');
  marker.textContent = ta.value.slice(pos) || '.';
  mirror.appendChild(marker);

  const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
  const caretTop = marker.offsetTop;
  applyScroll(ta, caretTop, caretTop + lh);
  mirror.textContent = '';
}

/** 보이지 않는 빈 줄 등 rect를 못 얻을 때 임시 마커로 측정 후 커서 복원 */
function measureWithMarker(range) {
  try {
    const sel = window.getSelection();
    const saved = [];
    if (sel) {
      for (let i = 0; i < sel.rangeCount; i++) {
        saved.push(sel.getRangeAt(i).cloneRange());
      }
    }
    const marker = document.createElement('span');
    marker.appendChild(document.createTextNode('\u200b'));
    range.insertNode(marker);
    const rect = marker.getBoundingClientRect();
    marker.remove();
    // selection은 스크롤 보조 기능이므로 절대 바꾸지 않는다
    if (sel && saved.length) {
      sel.removeAllRanges();
      saved.forEach((r) => sel.addRange(r));
    }
    return rect;
  } catch {
    return null;
  }
}

/** contenteditable: 선택 영역(커서) rect를 컨테이너 내부 좌표로 변환해 스크롤 */
function scrollContentEditableCaret(el) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return;

  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(false);

  let rect = range.getBoundingClientRect();
  if (!rect || (rect.top === 0 && rect.bottom === 0 && rect.height === 0)) {
    const rects = range.getClientRects();
    rect = rects[rects.length - 1];
  }
  if (!rect || (rect.top === 0 && rect.height === 0)) {
    rect = measureWithMarker(range);
  }
  if (!rect) return;

  const host = el.getBoundingClientRect();
  const caretTop = rect.top - host.top + el.scrollTop;
  const caretBottom = rect.bottom - host.top + el.scrollTop;
  applyScroll(el, caretTop, caretBottom);
}

/** 문서 전역 input 위임 — textarea·칩 에디터 모두 처리 */
export function initCaretAutoscroll() {
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!t || !t.tagName) return;
    if (t.tagName === 'TEXTAREA') {
      requestAnimationFrame(() => scrollTextareaCaret(t));
    } else if (t.isContentEditable && t.classList.contains('chip-editor')) {
      requestAnimationFrame(() => scrollContentEditableCaret(t));
    }
  });
}
