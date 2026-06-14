import { normalizeTight } from '../utils/text.js';

/** Levenshtein 기반 유사도 (글자 순서 고려) */
export function similarity(a, b) {
  const A = normalizeTight(a);
  const B = normalizeTight(b);
  if (!A || !B) return 0;
  if (A === B) return 100;

  const dp = Array.from({ length: A.length + 1 }, () => Array(B.length + 1).fill(0));
  for (let i = 0; i <= A.length; i++) dp[i][0] = i;
  for (let j = 0; j <= B.length; j++) dp[0][j] = j;

  for (let i = 1; i <= A.length; i++) {
    for (let j = 1; j <= B.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1),
      );
    }
  }

  const dist = dp[A.length][B.length];
  return Math.max(0, Math.round((1 - dist / Math.max(A.length, B.length)) * 100));
}

/** 정답 판정 */
export function checkAnswer(user, accepted, threshold) {
  if (accepted.some((a) => normalizeTight(user) === normalizeTight(a))) {
    return { correct: true, score: 100 };
  }
  const scores = accepted.map((a) => similarity(user, a));
  const best = scores.length ? Math.max(...scores) : 0;
  return { correct: best >= threshold, score: best };
}
