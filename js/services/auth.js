/** 4자리 PIN — 로컬 JSON 저장 (민감 정보 아님, 평문 비교) */
export function validatePin(pin) {
  return /^\d{4}$/.test(String(pin || ''));
}

export function verifyPin(pin, user) {
  return !!user?.pin && user.pin === pin;
}

/** 예전 해시 계정·PIN 미설정 */
export function userNeedsPinSetup(user) {
  return user && !user.pin;
}
