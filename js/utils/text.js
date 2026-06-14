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

export function normalize(text) {
  return String(text || '')
    .normalize('NFC')
    .replace(/[""''']/g, '')
    .replace(/[.,/#!$%^&*;:{}=_`~()\[\]?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function normalizeTight(text) {
  return normalize(text).replace(/\s+/g, '');
}

/** 문제 텍스트 등에서 [[BLANKn]] 토큰 제거 */
export function stripBlankMarkers(text) {
  return String(text || '').replace(/\[\[BLANK\d+\]\]/g, '');
}

export function splitAnswers(answer) {
  return String(answer || '').split(/\n|\|\|/).map((v) => v.trim()).filter(Boolean);
}

/** 정답 길이·띄어쓰기 힌트 — 글자는 ○, 공백은 그대로 (예: "형 법" → "○ ○") */
export function blankShapeHint(answer) {
  const raw = splitAnswers(answer)[0] ?? String(answer || '');
  if (!raw) return '○○○';
  let out = '';
  for (const ch of raw) {
    out += /\s/.test(ch) ? ch : '○';
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
