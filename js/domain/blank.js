import { STOPWORDS } from '../config.js';
import { uid, normalizeTight, splitAnswers, normalizeNewlines } from '../utils/text.js';
import { writeTextarea, scrollTextareaToRange } from '../utils/dom.js';
import { findOutlineBlankCandidates } from './outline.js';

/**
 * 이 빈칸에서 정답으로 인정되는 표현 전부.
 * answer는 해설 본문의 단어(주 정답), aliases는 따로 등록한 동의어.
 * 예전 카드는 answer에 `||` 로 동의어를 넣었고, 줄바꿈은 한 정답의 문단으로 둔다.
 */
export function acceptedAnswers(blank) {
  const list = [...splitAnswers(blank?.answer || ''), ...(blank?.aliases || [])];
  const seen = new Set();
  return list.filter((a) => {
    const key = normalizeTight(a);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 1. 2. 가) 처럼 이어지는 목차 줄 */
const OUTLINE_ANSWER_LINE = /^(?:[0-9]+|[가-힣]|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+)\s*[\.)]/;

/**
 * 예전 카드: 줄바꿈으로 동의어를 넣었으면 aliases 로 옮긴다.
 * 1. / 2. 처럼 이어지는 문단은 한 정답으로 남긴다.
 */
export function migrateBlankAnswer(blank) {
  const aliases = [...(blank?.aliases || [])];
  let answer = normalizeNewlines(String(blank?.answer || ''));
  const byPipe = answer.split(/\s*\|\|\s*/).map((v) => v.trim()).filter(Boolean);
  if (byPipe.length > 1) {
    answer = byPipe[0];
    byPipe.slice(1).forEach((p) => { if (!aliases.includes(p)) aliases.push(p); });
    return { ...blank, answer, aliases };
  }
  const lines = answer.split('\n').map((v) => v.trim()).filter(Boolean);
  const numbered = lines.filter((ln) => OUTLINE_ANSWER_LINE.test(ln)).length;
  if (lines.length > 1 && numbered < 2) {
    answer = lines[0];
    lines.slice(1).forEach((ln) => { if (!aliases.includes(ln)) aliases.push(ln); });
  }
  return { ...blank, answer, aliases };
}

/** 원문 토큰과 blanks 배열 동기화 — 등장 순서대로 번호 재정렬 */
export function syncTemplateAndBlanks(template, currentBlanks = []) {
  const oldMap = new Map(currentBlanks.map((b) => [Number(b.order || b.key), b]));
  const found = [];

  let temp = String(template || '').replace(/\[\[BLANK(\d+)\]\]/g, (_, n) => {
    found.push(Number(n));
    return `§§T${found.length - 1}§§`;
  });

  temp = temp.replace(/§§T(\d+)§§/g, (_, i) => `[[BLANK${Number(i) + 1}]]`);

  const blanks = found.map((oldNum, idx) => {
    const prev = oldMap.get(oldNum) || {};
    return {
      id: prev.id || uid('b'),
      cardId: prev.cardId || '',
      order: idx + 1,
      placeholder: `빈칸${idx + 1}`,
      answer: String(prev.answer || ''),
      aliases: prev.aliases || [],
      lastInput: prev.lastInput || '',
      lastResult: prev.lastResult ?? null,
      manualResult: prev.manualResult ?? null,
    };
  });

  return { template: temp, blanks };
}

/** 자동 빈칸 제외 규칙 */
export function isAutoBlankExcluded(token, fullText) {
  if (!token || token.length < 2) return true;
  if (/\d/.test(token)) return true;
  if (STOPWORDS.has(token)) return true;
  if (/^\[.*\d.*\]$/.test(token)) return true;
  if (/^\d{4}[가-힣]+\d+$/.test(token)) return true;
  if (/^제\d+조$/.test(token)) return true;
  if (/^\d+항$/.test(token)) return true;
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`\\[\\d{4}${esc}\\]|\\d{4}${esc}`).test(fullText)) return true;
  return false;
}

/** 자동 빈칸 후보 추출 — 카드 목차 제목을 우선 포함 */
export function findAutoCandidates(text, existingBlanks, outline = null) {
  const occupied = new Set(existingBlanks.map((b) => normalizeTight(b.answer)));
  const seen = new Map();

  for (const [token, index] of findOutlineBlankCandidates(outline, existingBlanks)) {
    if (!seen.has(token)) seen.set(token, index);
  }

  const re = /[A-Za-z가-힣][A-Za-z가-힣·\-]{1,}/g;
  let match;

  while ((match = re.exec(text)) !== null) {
    const token = match[0];
    if (isAutoBlankExcluded(token, text)) continue;
    if (occupied.has(normalizeTight(token))) continue;
    if (!seen.has(token)) seen.set(token, match.index);
  }

  return [...seen.entries()].sort((a, b) => b[0].length - a[0].length).slice(0, 20);
}

/** 커서 위치의 [[BLANKn]] 토큰 */
export function findBlankTokenAtCursor(text, pos) {
  const re = /\[\[BLANK(\d+)\]\]/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (pos >= start && pos <= end) {
      return { start, end, order: Number(match[1]) };
    }
  }
  return null;
}

/** 텍스트에서 [[BLANKn]] 구간 */
export function findBlankTokenRange(text, order) {
  const re = /\[\[BLANK(\d+)\]\]/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (Number(match[1]) === order) {
      return { start: match.index, end: match.index + match[0].length };
    }
  }
  return null;
}

/** textarea에서 [[BLANKn]] 선택 + 해당 위치로 스크롤 */
export function selectBlankToken(el, order) {
  const range = findBlankTokenRange(el.value, order);
  if (!range) return false;
  writeTextarea(el, el.value, { start: range.start, end: range.end }, { scrollTop: 0, scrollLeft: 0 });
  scrollTextareaToRange(el, range.start, range.end);
  return true;
}

function blankCaretAfter(text, nearIndex) {
  const re = /\[\[BLANK(\d+)\]\]/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match.index >= nearIndex) {
      const end = match.index + match[0].length;
      return { start: end, end };
    }
  }
  re.lastIndex = 0;
  while ((match = re.exec(text)) !== null) {
    const end = match.index + match[0].length;
    if (match.index <= nearIndex && end >= nearIndex) {
      return { start: end, end };
    }
  }
  return { start: nearIndex, end: nearIndex };
}

/** order번 빈칸 제거 */
export function removeBlankAtOrder(template, blanks, order) {
  const re = new RegExp(`\\[\\[BLANK${order}\\]\\]`);
  const idx = template.search(re);
  if (idx < 0) {
    return syncTemplateAndBlanks(template, blanks.filter((b) => b.order !== order));
  }
  const blank = blanks.find((b) => b.order === order);
  const token = `[[BLANK${order}]]`;
  const next = template.slice(0, idx) + (blank?.answer || '') + template.slice(idx + token.length);
  const norm = syncTemplateAndBlanks(next, blanks.filter((b) => b.order !== order));
  const pos = idx + (blank?.answer || '').length;
  return { ...norm, caret: { start: pos, end: pos } };
}

/** 선택 영역 → [[BLANKn]] */
export function makeBlankInText(template, blanks, start, end, selectedText) {
  const nextOrder = blanks.length + 1;
  const token = `[[BLANK${nextOrder}]]`;
  const next = String(template || '').slice(0, start) + token + String(template || '').slice(end);
  const norm = syncTemplateAndBlanks(next, [
    ...blanks,
    { order: nextOrder, answer: selectedText.trim() },
  ]);
  return { ...norm, caret: blankCaretAfter(norm.template, start) };
}

/** [[BLANKn]] → 정답 복구 */
export function removeBlankFromText(template, blanks, start, end, order) {
  const blank = blanks.find((b) => b.order === order);
  const answer = blank?.answer || '';
  const next = String(template || '').slice(0, start) + answer + String(template || '').slice(end);
  const norm = syncTemplateAndBlanks(next, blanks.filter((b) => b.order !== order));
  const pos = start + answer.length;
  return { ...norm, caret: { start: pos, end: pos } };
}

/** 자동 빈칸 후보를 템플릿에 적용 */
export function applyAutoBlankTokens(template, blanks, tokens) {
  let nextTemplate = template;
  let nextBlanks = blanks.slice();
  const sorted = tokens.slice().sort((a, b) => b.length - a.length);

  sorted.forEach((token) => {
    const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?<![A-Za-z가-힣0-9])(${esc})(?![A-Za-z가-힣0-9])`);
    const m = nextTemplate.match(regex);
    if (!m) return;
    const idx = m.index;
    const nextOrder = nextBlanks.length + 1;
    nextTemplate = nextTemplate.slice(0, idx) + `[[BLANK${nextOrder}]]` + nextTemplate.slice(idx + token.length);
    nextBlanks.push({ order: nextOrder, answer: token });
  });

  return syncTemplateAndBlanks(nextTemplate, nextBlanks);
}
