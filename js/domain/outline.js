import { uid, normalizeTight } from '../utils/text.js';

/** 법학 답안 목차 — Ⅰ. → 1. → 가. → 1) → 가) → (1) (동그라미 번호는 제외) */
const LEVEL_PATTERNS = [
  { level: 0, re: /^([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+)\.\s*(.*)$/u },
  { level: 1, re: /^(\d+)\.\s*(.*)$/ },
  { level: 2, re: /^([가-힣])\.\s*(.*)$/ },
  { level: 3, re: /^(\d+)\)\s*(.*)$/ },
  { level: 4, re: /^([가-힣])\)\s*(.*)$/ },
  { level: 5, re: /^\((\d+)\)\s*(.*)$/ },
];

/** ①~⑳, ⓐ~ⓩ 등 — 목차로 거의 안 씀 */
const CIRCLED_PREFIX = /^[\u2460-\u2473\u3251-\u325Fⓐ-ⓩ]/;

const OUTLINE_VERSION = 1;
/** 목차 제목으로 보기 어려운 길이 — 이보다 길면 본문 나열(1) …) 쪽으로 간주 */
const MAX_TITLE_LEN = 72;
const HARD_REJECT_TITLE_LEN = 120;

/** 본문·메모 줄 — 목차 prefix가 있어도 제외 */
function isOutlineExcludedLine(trimmed) {
  if (/^[-–—•*]/.test(trimmed)) return true;
  if (/^\[[^\]]+\]\s*$/.test(trimmed)) return true;
  if (/^\[(제\d|단축|행종|본\.|욕심)/.test(trimmed)) return true;
  if (/^\(축약|^\(욕심/i.test(trimmed)) return true;
  return false;
}

function matchOutlineLine(trimmed) {
  if (!trimmed || CIRCLED_PREFIX.test(trimmed)) return null;
  if (isOutlineExcludedLine(trimmed)) return null;
  for (const { level, re } of LEVEL_PATTERNS) {
    const m = trimmed.match(re);
    if (!m) continue;
    const title = String(m[2] || '').trim();
    const label = trimmed.slice(0, trimmed.length - m[2].length).trimEnd();
    return { level, label, title };
  }
  return null;
}

function lineWasOutline(lines, idx) {
  if (idx < 0 || idx >= lines.length) return false;
  return !!matchOutlineLine(lines[idx].trim());
}

function isBlankLine(line) {
  return !String(line ?? '').trim();
}

/** 앞뒤 빈 줄이면 독립 목차 블록 */
function isIsolatedLine(lines, idx) {
  const prevBlank = idx === 0 || isBlankLine(lines[idx - 1]);
  const nextBlank = idx === lines.length - 1 || isBlankLine(lines[idx + 1]);
  return prevBlank && nextBlank;
}

function scoreOutlineCandidate(lines, idx, parsed) {
  let score = 2;
  if (isIsolatedLine(lines, idx)) score += 3;
  else if (idx > 0 && (isBlankLine(lines[idx - 1]) || lineWasOutline(lines, idx - 1))) score += 2;

  const len = parsed.title.length;
  if (!len) score -= 3;
  else if (len <= 36) score += 1;
  if (len > MAX_TITLE_LEN) score -= 2;
  if (len > HARD_REJECT_TITLE_LEN) score -= 5;

  // 1) / 가) / (1) — 본문 속 열거는 보통 한 줄이 김 → 짧거나(소제목) 독립 줄만
  if (parsed.level >= 3) {
    if (len > 42) score -= 2;
    if (len > 42 && !isIsolatedLine(lines, idx)) score -= 2;
  }

  return score;
}

/** 해설 평문에서 목차 항목 추출 */
export function parseOutlineFromText(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n');
  const rawLines = normalized.split('\n');
  const items = [];

  rawLines.forEach((raw, lineIndex) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const parsed = matchOutlineLine(trimmed);
    if (!parsed) return;
    if (scoreOutlineCandidate(rawLines, lineIndex, parsed) < 3) return;
    if (parsed.title.length > HARD_REJECT_TITLE_LEN) return;

    items.push({
      id: uid('ol'),
      lineIndex,
      level: parsed.level,
      label: parsed.label,
      title: parsed.title,
      rawLine: trimmed,
      enabled: true,
    });
  });

  return { version: OUTLINE_VERSION, items, generatedAt: new Date().toISOString() };
}

/** 카드에 저장된 outline 정규화 */
export function normalizeOutline(raw) {
  if (!raw || !Array.isArray(raw.items)) {
    return raw?.items?.length ? null : null;
  }
  const items = raw.items
    .filter((it) => it && String(it.title ?? '').trim())
    .map((it) => ({
      id: it.id || uid('ol'),
      lineIndex: Number(it.lineIndex) || 0,
      level: Number(it.level) || 0,
      label: String(it.label || '').trim(),
      title: String(it.title || '').trim(),
      rawLine: String(it.rawLine || it.title || '').trim(),
      enabled: it.enabled !== false,
    }));

  if (!items.length) return null;

  return {
    version: OUTLINE_VERSION,
    items,
    generatedAt: raw.generatedAt || null,
    updatedAt: raw.updatedAt || null,
  };
}

export function emptyOutline() {
  return null;
}

/** 괄호 안 조문만 있는 괄호는 제목 본문만 빈칸 후보로 (예: 살인죄 성부(형법 제250조) → 살인죄 성부) */
export function extractOutlineBlankToken(title) {
  const t = String(title || '').trim();
  if (!t) return '';
  const m = t.match(/^(.+?)\s*\([^)]*제\s*\d+\s*조[^)]*\)\s*$/);
  if (m) return m[1].trim();
  return t;
}

/** 저장된 목차 항목 → 빈칸 토큰 목록 (중복·enabled=false 제외) */
export function listOutlineTokens(outline) {
  const norm = normalizeOutline(outline);
  if (!norm?.items?.length) return [];

  const seen = new Set();
  const out = [];
  for (const item of norm.items) {
    if (item.enabled === false) continue;
    const token = extractOutlineBlankToken(item.title);
    if (token.length < 2) continue;
    const key = normalizeTight(token);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ token, item });
  }
  return out;
}

/** 저장된 목차 → 자동 빈칸 후보 [token, lineIndex][] */
export function findOutlineBlankCandidates(outline, existingBlanks = []) {
  const norm = normalizeOutline(outline);
  if (!norm?.items?.length) return [];

  const occupied = new Set(existingBlanks.map((b) => normalizeTight(b.answer)));
  const out = [];

  for (const { token, item } of listOutlineTokens(norm)) {
    if (occupied.has(normalizeTight(token))) continue;
    out.push([token, item.lineIndex]);
  }

  return out.sort((a, b) => b[0].length - a[0].length);
}

/** 기존·새 목차 비교 (미리보기용) */
export function diffOutlineItems(oldItems = [], newItems = []) {
  const key = (it) => `${it.lineIndex}:${it.label}:${normalizeTight(it.title)}`;
  const oldKeys = new Set(oldItems.map(key));
  const newKeys = new Set(newItems.map(key));

  return {
    kept: newItems.filter((it) => oldKeys.has(key(it))),
    added: newItems.filter((it) => !oldKeys.has(key(it))),
    removed: oldItems.filter((it) => !newKeys.has(key(it))),
  };
}

export function formatOutlineItemLabel(item) {
  const prefix = '  '.repeat(Math.min(item.level || 0, 4));
  return `${prefix}${item.label || ''} ${item.title || ''}`.trim();
}

export function outlineItemCount(outline) {
  return normalizeOutline(outline)?.items?.length || 0;
}
