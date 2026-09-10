/**
 * 칩(chip) 기반 빈칸 에디터
 *
 * - 편집 표면은 contenteditable. 빈칸은 편집 불가한 "칩" 노드로 표시되어
 *   사용자가 [[BLANKn]] 토큰을 직접 보거나 깨뜨릴 수 없다.
 * - 저장 포맷은 기존과 동일: explanationText(= ...[[BLANK1]]...) + blanks[].
 *   읽을 때 토큰→칩, 저장할 때 칩→토큰으로 변환만 한다(데이터 호환).
 */
import { syncTemplateAndBlanks } from '../domain/blank.js';
import { normalizeTight, normalizeNewlines, splitAnswers } from '../utils/text.js';

/** 동의어는 칩 dataset에 `||`로 이어 담고, 읽을 때 배열로 되돌린다 */
export const ALIAS_SEP = ' || ';
export function formatAliases(list) {
  return (list || []).filter(Boolean).join(ALIAS_SEP);
}
export function parseAliases(text) {
  return splitAnswers(text);
}

const CHIP_CLASS = 'cz-chip';
const initialized = new Set();

/** 에디터별 편집 스냅샷 히스토리 (자체 Ctrl+Z) */
const history = new Map();
const MAX_HIST = 100;

function resetHistory(id) {
  const el = document.getElementById(id);
  history.set(id, { stack: el ? [el.innerHTML] : [''], index: 0, timer: null, applying: false });
}

function snapshot(id, immediate = false) {
  const el = document.getElementById(id);
  const h = history.get(id);
  if (!el || !h || h.applying) return;
  const html = el.innerHTML;
  const push = () => {
    if (h.stack[h.index] === html) return;
    h.stack = h.stack.slice(0, h.index + 1);
    h.stack.push(html);
    h.index = h.stack.length - 1;
    if (h.stack.length > MAX_HIST) { h.stack.shift(); h.index -= 1; }
  };
  clearTimeout(h.timer);
  if (immediate) push();
  else h.timer = setTimeout(push, 250);
}

function applyHistory(id, html) {
  const el = document.getElementById(id);
  const h = history.get(id);
  if (!el || !h) return;
  h.applying = true;
  el.innerHTML = html;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  h.applying = false;
}

export function chipUndo(id) {
  const h = history.get(id);
  if (!h || h.index <= 0) return false;
  clearTimeout(h.timer);
  h.index -= 1;
  applyHistory(id, h.stack[h.index]);
  return true;
}

export function chipRedo(id) {
  const h = history.get(id);
  if (!h || h.index >= h.stack.length - 1) return false;
  clearTimeout(h.timer);
  h.index += 1;
  applyHistory(id, h.stack[h.index]);
  return true;
}

function isChip(node) {
  return node && node.nodeType === 1 && node.classList && node.classList.contains(CHIP_CLASS);
}

/** 선택이 기존 칩을 걸치는가 — 칩을 반쯤 잘라내는 경우만 걸러낸다 */
function rangeCrossesChip(range, root) {
  return [...root.querySelectorAll(`.${CHIP_CLASS}`)].some((chip) => range.intersectsNode(chip));
}

function makeChipEl(answer, aliases = []) {
  const span = document.createElement('span');
  span.className = CHIP_CLASS;
  span.contentEditable = 'false';
  span.dataset.answer = answer || '';
  span.dataset.aliases = formatAliases(aliases);
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

/** 에디터 1회 초기화 — Enter/붙여넣기를 평문으로 강제해 DOM을 단순 유지 */
export function initChipEditor(id) {
  const el = document.getElementById(id);
  if (!el || initialized.has(id)) return;
  initialized.add(id);

  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      insertTextAtCaret(el, '\n');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    // 에디터 자체 되돌리기/다시하기 (글자 입력·빈칸 만들기·해제 모두 포함)
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

  el.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text');
    insertTextAtCaret(el, normalizeNewlines(text));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

  el.addEventListener('input', () => snapshot(id));
  resetHistory(id);
}

function insertTextAtCaret(el, text) {
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

/** 토큰 템플릿 + blanks → 칩 DOM */
export function setChipEditorContent(id, explanationText, blanks = []) {
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
    el.appendChild(makeChipEl(blank?.answer || '', blank?.aliases));
    last = m.index + m[0].length;
  }
  if (last < tmpl.length) el.appendChild(document.createTextNode(tmpl.slice(last)));
  resetHistory(id);
}

function nodeToTemplate(node, picked) {
  let out = '';
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3) {
      out += child.nodeValue;
    } else if (isChip(child)) {
      picked.push({
        answer: child.dataset.answer || '',
        aliases: parseAliases(child.dataset.aliases),
      });
      out += `[[BLANK${picked.length}]]`;
    } else if (child.nodeName === 'BR') {
      out += '\n';
    } else if (child.nodeType === 1) {
      // 브라우저가 삽입한 div/p 등 블록은 줄바꿈으로 취급
      if (out && !out.endsWith('\n') && /^(DIV|P)$/.test(child.nodeName)) out += '\n';
      out += nodeToTemplate(child, picked);
    }
  });
  return out;
}

/** 칩 DOM → { template, blanks }  (기존 저장 포맷) */
export function readChipEditor(id) {
  const el = document.getElementById(id);
  if (!el) return { template: '', blanks: [] };
  const picked = [];
  const template = normalizeNewlines(nodeToTemplate(el, picked));
  const blanks = picked.map((p, i) => ({
    order: i + 1,
    answer: normalizeNewlines(p.answer),
    aliases: p.aliases,
  }));
  return syncTemplateAndBlanks(template, blanks);
}

/** 빈칸 없는 순수 텍스트 (자동 후보 추출용) */
export function readChipPlainText(id) {
  return readChipEditor(id).template.replace(/\[\[BLANK\d+\]\]/g, ' ');
}

/** 현재 선택 영역을 칩으로 (Ctrl+B / 버튼) */
export function chipMakeBlank(id) {
  const el = document.getElementById(id);
  if (!el) return false;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.commonAncestorContainer)) return false;

  // 선택이 없으면(커서만 있으면) 커서 주변 단어를 자동으로 선택
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

  // 빈칸을 해제한 자리는 별도 텍스트 노드로 남아, 그 구간을 다시 묶으면 선택이 여러 노드에 걸친다.
  // 그래서 "한 텍스트 노드 안"이 아니라 "칩을 걸치지 않을 것"만 조건으로 둔다.
  if (rangeCrossesChip(range, el)) return false;

  const original = normalizeNewlines(range.toString());
  const leadingWs = (original.match(/^\s*/)?.[0]) ?? '';
  const trailingWs = (original.match(/\s*$/)?.[0]) ?? '';
  let text = original.trim();
  if (!text) return false;

  // 조사/접미사 분리 (긴 것부터)
  // - 커서 기반 자동 선택일 때만 적용 (드래그로 포함하려는 경우를 존중)
  // - 조사/접미사는 "삭제"가 아니라 칩 뒤에 남긴다
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
  return true;
}

/** 칩 엘리먼트 제거 → 정답 텍스트로 복구 */
export function chipRemoveEl(chipEl) {
  if (!isChip(chipEl)) return;
  // 칩에도 contenteditable="false"가 붙어 있어, [contenteditable]로 찾으면 칩 자신이 잡힌다.
  // 그러면 아래 dispatch가 분리된 노드에서 일어나 미리보기·정답 슬롯이 갱신되지 않는다.
  const editor = chipEl.closest('[contenteditable="true"]');
  chipEl.replaceWith(document.createTextNode(chipEl.dataset.answer || ''));
  if (!editor) return;
  editor.normalize();
  editor.dispatchEvent(new Event('input', { bubbles: true }));
}

/** order번째(등장순) 칩 제거 */
export function chipRemoveByOrder(id, order) {
  const el = document.getElementById(id);
  if (!el) return;
  const chips = [...el.querySelectorAll(`.${CHIP_CLASS}`)];
  const chip = chips[Number(order) - 1];
  if (chip) chipRemoveEl(chip);
}

/** 에디터 내 빈칸(칩) 개수 */
export function chipBlankCount(id) {
  const el = document.getElementById(id);
  return el ? el.querySelectorAll(`.${CHIP_CLASS}`).length : 0;
}

/** 모든 빈칸(칩) 해제 — 정답을 본문 텍스트로 복구 */
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
  return chips.length;
}

/** 현재 커서/선택 위치 주변의 칩 제거 (툴바 "빈칸 해제") */
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
    // 텍스트 노드 시작이면 이전 형제, 끝이면 다음 형제 칩
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

/** order번째 칩의 정답 갱신 (정답 슬롯 편집과 동기화) */
export function chipSetAnswer(id, order, answer) {
  const el = document.getElementById(id);
  if (!el) return;
  const chips = [...el.querySelectorAll(`.${CHIP_CLASS}`)];
  const chip = chips[Number(order) - 1];
  if (chip) setChipText(chip, answer);
}

/** order번째 칩의 동의어 갱신 — 본문 단어는 건드리지 않는다 */
export function chipSetAliases(id, order, text) {
  const el = document.getElementById(id);
  if (!el) return;
  const chips = [...el.querySelectorAll(`.${CHIP_CLASS}`)];
  const chip = chips[Number(order) - 1];
  if (chip) chip.dataset.aliases = formatAliases(parseAliases(text));
}

/** order번째 칩으로 스크롤·강조 */
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

/** 자동 빈칸: 최상위 텍스트 노드에서 토큰 첫 등장을 칩으로 감싼다 */
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
