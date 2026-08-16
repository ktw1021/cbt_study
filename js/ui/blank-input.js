import { store } from '../core/store.js';

/**
 * 학습 화면의 빈칸 input ↔ currentBlankStatuses 접근 지점.
 * study.js와 study-session.js가 함께 쓰므로 순환 참조를 피해 따로 둔다.
 */

export function getBlankInputValue(order) {
  return document.querySelector(`[data-blank-order="${order}"]`)?.value?.trim() || '';
}

/** DOM 입력값 → 모델 흡수 (단일 출처 유지). 채점 후에도 수정·삭제할 수 있도록 항상 보존 */
export function syncDraftFromDOM() {
  store.currentBlankStatuses.forEach((s) => {
    const input = document.querySelector(`[data-blank-order="${s.order}"]`);
    if (input) s.user = input.value;
  });
}
