import { normalize, normalizeTight, splitChunks } from '../utils/text.js';

function levenshtein(A, B) {
  const n = A.length;
  const m = B.length;
  const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1),
      );
    }
  }
  return { dist: dp[n][m], dp };
}

function charSim(a, b) {
  const A = normalizeTight(a);
  const B = normalizeTight(b);
  if (!A && !B) return 1;
  if (!A || !B) return 0;
  if (A === B) return 1;
  const { dist } = levenshtein(A, B);
  return Math.max(0, 1 - dist / Math.max(A.length, B.length));
}

/**
 * 뭉치(띄어쓰기 단위) 유사도.
 * 공백을 지우고 통째로 비교하면 「피고는원고에게」도 정답이 되므로,
 * 힌트와 같이 칸을 나눈 뒤 뭉치끼리 맞추고, 틀린 뭉치만 글자 거리를 반영한다.
 */
export function similarity(a, b) {
  const U = splitChunks(a).chunks;
  const A = splitChunks(b).chunks;
  if (!U.length && !A.length) return 100;
  if (!U.length || !A.length) return 0;

  const n = U.length;
  const m = A.length;
  const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sub = dp[i - 1][j - 1] + (1 - charSim(U[i - 1].text, A[j - 1].text));
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, sub);
    }
  }

  const dist = dp[n][m];
  return Math.max(0, Math.round((1 - dist / Math.max(n, m)) * 100));
}

function isSpace(ch) {
  return /\s/.test(ch);
}

function glyphSignature(text) {
  return Array.from(String(text || '').normalize('NFC'))
    .map((ch) => (isSpace(ch) ? ' ' : 'x'))
    .join('');
}

function lettersEqual(a, b) {
  if (a === b) return true;
  if (isSpace(a) || isSpace(b)) return false;
  const A = normalizeTight(a);
  const B = normalizeTight(b);
  return Boolean(A) && A === B;
}

/** 정답 판정 — 유사도는 빈칸 통과 여부만. 글자가 더 있으면 통과시키지 않는다. */
export function checkAnswer(user, accepted, threshold) {
  if (accepted.some((a) => normalize(user) === normalize(a) && glyphSignature(user) === glyphSignature(a))) {
    return { correct: true, score: 100 };
  }
  const scores = accepted.map((a) => similarity(user, a));
  const best = scores.length ? Math.max(...scores) : 0;
  const bestAns = accepted[scores.indexOf(best)];
  const extra = bestAns != null
    ? normalizeTight(user).length - normalizeTight(bestAns).length
    : 0;
  const spaceOnly = accepted.some((a) => (
    normalizeTight(user) === normalizeTight(a) && glyphSignature(user) !== glyphSignature(a)
  ));
  const score = spaceOnly && best >= 100 ? 99 : best;
  return { correct: extra <= 0 && best >= threshold, score };
}

const DIFF_MAX_LEN = 300;
const RESYNC = 2;
const SKIP_MAX = 32;

function pushSeg(segments, kind, text) {
  if (kind === 'space-miss') {
    segments.push({ kind, text: '' });
    return;
  }
  if (text == null || text === '') return;
  const last = segments[segments.length - 1];
  if (last && last.kind === kind) last.text += text;
  else segments.push({ kind, text });
}

function segLen(segments, kind) {
  return segments.reduce((n, s) => n + (s.kind === kind ? s.text.length : 0), 0);
}

function isFormatMark(ch) {
  return ch === ',' || ch === '，';
}

function letterRun(U, i, A, j) {
  let n = 0;
  let letters = 0;
  while (i + n < U.length && j + n < A.length) {
    const u = U[i + n];
    const a = A[j + n];
    if (isSpace(u) && isSpace(a)) {
      n += 1;
      continue;
    }
    if (lettersEqual(u, a)) {
      n += 1;
      letters += 1;
      continue;
    }
    break;
  }
  return letters;
}

function extraCount(U, i, A, j) {
  if (j >= A.length || isSpace(A[j]) || isFormatMark(A[j])) return 0;
  const limit = Math.min(SKIP_MAX, U.length - i);
  for (let k = 1; k <= limit; k++) {
    if (letterRun(U, i + k, A, j) >= RESYNC) return k;
  }
  return 0;
}

function missingCount(U, i, A, j) {
  if (i >= U.length || isFormatMark(U[i])) return 0;
  const limit = Math.min(SKIP_MAX, A.length - j);
  for (let k = 1; k <= limit; k++) {
    if (letterRun(U, i, A, j + k) >= RESYNC) return k;
  }
  return 0;
}

function applyExtras(segments, U, i, n) {
  for (let k = 0; k < n; k++) {
    pushSeg(segments, isSpace(U[i + k]) ? 'space-extra' : 'extra', U[i + k]);
  }
}

function answerSkipIsSpaces(A, j, n) {
  for (let k = 0; k < n; k++) {
    if (!isSpace(A[j + k])) return false;
  }
  return n > 0;
}

/**
 * 첨삭: 앞에서부터 맞추고, 어긋나면 추가(입력 건너뛰기) 또는 누락(정답 건너뛰기)으로
 * 지금 위치에 다시 붙인다. 한 글자 대치로 나머지를 밀지 않는다.
 */
export function proofread(user, answer) {
  const U = Array.from(String(user ?? '').normalize('NFC'));
  const A = Array.from(String(answer ?? '').normalize('NFC'));
  const segments = [];
  let i = 0;
  let j = 0;
  while (i < U.length && j < A.length) {
    const u = U[i];
    const a = A[j];
    if (lettersEqual(u, a) || (isSpace(u) && isSpace(a))) {
      pushSeg(segments, isSpace(u) ? 'skip' : 'same', u);
      i += 1;
      j += 1;
      continue;
    }
    if (isSpace(a) && !isSpace(u) && j + 1 < A.length && lettersEqual(u, A[j + 1])) {
      pushSeg(segments, 'space-miss', '');
      j += 1;
      continue;
    }
    if (isSpace(u) && !isSpace(a) && i + 1 < U.length && lettersEqual(U[i + 1], a)) {
      pushSeg(segments, 'space-extra', u);
      i += 1;
      continue;
    }
    if (isFormatMark(a)) {
      if (letterRun(U, i, A, j + 1) >= 1) {
        j += 1;
        continue;
      }
      const extraAfterComma = extraCount(U, i, A, j + 1);
      if (extraAfterComma) {
        j += 1;
        applyExtras(segments, U, i, extraAfterComma);
        i += extraAfterComma;
        continue;
      }
    }
    if (isFormatMark(u) && letterRun(U, i + 1, A, j) >= 1) {
      pushSeg(segments, 'extra', u);
      i += 1;
      continue;
    }
    const extra = extraCount(U, i, A, j);
    const miss = missingCount(U, i, A, j);
    if (extra && miss) {
      const extraRun = letterRun(U, i + extra, A, j);
      const missRun = letterRun(U, i, A, j + miss);
      if (extraRun > missRun || (extraRun === missRun && extra <= miss)) {
        applyExtras(segments, U, i, extra);
        i += extra;
      } else {
        if (answerSkipIsSpaces(A, j, miss)) pushSeg(segments, 'space-miss', '');
        j += miss;
      }
      continue;
    }
    if (extra) {
      applyExtras(segments, U, i, extra);
      i += extra;
      continue;
    }
    if (miss) {
      if (answerSkipIsSpaces(A, j, miss)) pushSeg(segments, 'space-miss', '');
      j += miss;
      continue;
    }
    if (isSpace(u) && !isSpace(a)) {
      pushSeg(segments, 'space-extra', u);
      i += 1;
      continue;
    }
    if (isSpace(a) && !isSpace(u)) {
      pushSeg(segments, 'extra', u);
      i += 1;
      continue;
    }
    pushSeg(segments, 'diff', u);
    i += 1;
    j += 1;
  }
  while (i < U.length) {
    pushSeg(segments, isSpace(U[i]) ? 'space-extra' : 'extra', U[i]);
    i += 1;
  }
  return { segments, covered: j };
}

function proofreadRank(result) {
  return segLen(result.segments, 'same') * 1000 + result.covered - segLen(result.segments, 'extra') * 10;
}

/**
 * 어디에 뭐가 틀렸는지는 첨삭만 쓴다. 유사도는 빈칸 통과 여부(checkAnswer) 전용.
 */
export function diffAgainstAnswer(user, accepted = []) {
  const answers = (accepted || []).filter(Boolean);
  if (!answers.length) return null;

  const raw = String(user ?? '').normalize('NFC');
  if (!raw) return null;

  let best = answers[0];
  let bestResult = proofread(raw, best);
  let bestRank = proofreadRank(bestResult);
  answers.forEach((a) => {
    if (String(a).length > DIFF_MAX_LEN * 2 || raw.length > DIFF_MAX_LEN * 2) return;
    const result = proofread(raw, a);
    const rank = proofreadRank(result);
    if (rank > bestRank) {
      bestRank = rank;
      best = a;
      bestResult = result;
    }
  });

  return { answer: best, segments: bestResult.segments, covered: bestResult.covered };
}
