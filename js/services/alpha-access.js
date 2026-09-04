/**
 * 알파 테스터 접근 — env.alph 의 PRODUCT_PLANNER 와
 * 사용자가 입력한 base64 코드를 디코딩해 대조한다.
 * (정적 호스팅용 단순 관문. 소스를 보면 우회 가능 — 의도된 수준)
 *
 * 파일명에 선행 점(.)을 쓰지 않는다 — live-server / GitHub Pages 등이
 * .env* 를 404로 막는 경우가 많다.
 */

const COOKIE_KEY = 'cbt_alpha_code';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 400; // ~400일
const ENV_URL = './env.alph';

/** UTF-8 문자열 ↔ base64 */
export function encodeBase64Utf8(text) {
  const bytes = new TextEncoder().encode(String(text ?? ''));
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

export function decodeBase64Utf8(code) {
  try {
    const bin = atob(String(code || '').trim());
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes).normalize('NFC');
  } catch {
    return null;
  }
}

/** KEY=VALUE 형식 env.alph 파싱 */
export function parseAlphaEnvText(text) {
  const out = {};
  String(text || '').split(/\r?\n/).forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const i = t.indexOf('=');
    if (i < 0) return;
    const key = t.slice(0, i).trim();
    const val = t.slice(i + 1).trim();
    if (key) out[key] = val;
  });
  return out;
}

export async function loadAlphaEnv() {
  const res = await fetch(ENV_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`env.alph 로드 실패 (${res.status})`);
  const map = parseAlphaEnvText(await res.text());
  const productPlanner = String(map.PRODUCT_PLANNER || '').normalize('NFC').trim();
  if (!productPlanner) throw new Error('env.alph 에 PRODUCT_PLANNER 가 없습니다.');
  return {
    productPlanner,
    dev: String(map.DEV || '').normalize('NFC').trim(),
  };
}

function readCookie(name) {
  const prefix = `${name}=`;
  const hit = document.cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith(prefix));
  if (!hit) return '';
  try {
    return decodeURIComponent(hit.slice(prefix.length));
  } catch {
    return hit.slice(prefix.length);
  }
}

export function getStoredAlphaCode() {
  return readCookie(COOKIE_KEY);
}

export function storeAlphaCode(code) {
  const v = encodeURIComponent(String(code || '').trim());
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE_KEY}=${v}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

export function clearStoredAlphaCode() {
  document.cookie = `${COOKIE_KEY}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/** 저장된 코드(base64)를 풀어 PRODUCT_PLANNER 와 일치하는지 */
export function isAlphaCodeValid(code, productPlanner) {
  const decoded = decodeBase64Utf8(code);
  if (decoded == null) return false;
  return decoded === String(productPlanner || '').normalize('NFC').trim();
}

export function hasValidAlphaSession(productPlanner) {
  return isAlphaCodeValid(getStoredAlphaCode(), productPlanner);
}
