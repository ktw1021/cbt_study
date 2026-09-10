/** 문자열·HTML 유틸 */
export function uid(prefix = 'id') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function deepCopy(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function shorten(text, len = 56) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > len ? s.slice(0, len) + '…' : s;
}

/** 윈도우 붙여넣기의 CR+LF 를 LF 하나로 맞춘다. CR 이 남으면 줄이 두 번 접히고 빈 줄에 커서가 안 잡힌다. */
export function normalizeNewlines(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function foldFullwidth(text) {
  return String(text || '').replace(/[\uFF01-\uFF5E]/g, (ch) => (
    String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
  ));
}

export function normalize(text) {
  // 콤마·숫자·괄호·가운뎃점은 정답의 일부로 본다. 따옴표·장식 기호만 공백으로 접는다.
  return foldFullwidth(normalizeNewlines(text).normalize('NFC'))
    .replace(/[""''']/g, '')
    .replace(/[·・･]/g, '·')
    .replace(/[#!$%^&*;{}=_`~\[\]?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function normalizeTight(text) {
  return normalize(text).replace(/\s+/g, '');
}

/** 띄어쓰기로 나눈 뭉치. 힌트 ○○○ ○○○ 와 같은 경계. */
export function splitChunks(text) {
  const raw = normalizeNewlines(String(text || ''));
  const chunks = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(raw))) {
    chunks.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return { raw, chunks };
}

/**
 * normalizeTight 결과 + 정규화된 각 글자가 원문 몇 번째 글자에서 왔는지.
 * 채점은 정규화 문자열로 하고 표시는 원문으로 해야 하는 곳(오답 하이라이트)에서 쓴다.
 * 규칙이 갈라지지 않도록 normalizeTight 를 글자 단위로 그대로 적용한다.
 * @returns {{chars: string[], text: string, map: number[]}} map[i] = text[i] 의 chars 인덱스
 */
export function normalizeTightWithMap(text) {
  const chars = Array.from(String(text || '').normalize('NFC'));
  const map = [];
  let out = '';
  chars.forEach((ch, i) => {
    const piece = normalizeTight(ch);
    for (let k = 0; k < piece.length; k++) map.push(i);
    out += piece;
  });
  return { chars, text: out, map };
}

/** 문제 텍스트 등에서 [[BLANKn]] 토큰 제거 */
export function stripBlankMarkers(text) {
  return String(text || '').replace(/\[\[BLANK\d+\]\]/g, '');
}

/** 동의어 구분. 줄바꿈은 한 정답의 문단이고, || 만 다른 표현이다. */
export function splitAnswers(answer) {
  return normalizeNewlines(answer)
    .split(/\s*\|\|\s*/)
    .map((v) => v.trim())
    .filter(Boolean);
}

/** 정답 길이·띄어쓰기 힌트 — 글자는 ○, 공백·줄바꿈은 칸 사이로 */
export function blankShapeHint(answer) {
  const raw = splitAnswers(answer)[0] ?? String(answer || '');
  if (!raw) return '○○○';
  let out = '';
  for (const ch of normalizeNewlines(raw)) {
    if (ch === '\n') out += ' ';
    else out += /\s/.test(ch) ? ch : '○';
  }
  return out || '○○○';
}

export function shuffle(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
