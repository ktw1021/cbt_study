/** 앱 전역 상수 */

/**
 * [데이터 안전 — 변경 금지]
 * 아래 3개 키는 사용자의 IndexedDB 저장 위치를 결정한다.
 * 값을 바꾸면 GitHub Pages 등에 새 버전을 배포했을 때 기존 사용자의
 * 카드·계정 데이터에 접근할 수 없게 된다(사실상 초기화처럼 보임).
 * 스키마가 바뀌더라도 키는 그대로 두고 domain/migrate.js 의 마이그레이션으로만 변환할 것.
 */
export const DB_NAME = 'cbt_blank_study_v1';
export const DB_STORE = 'appState';
export const STATE_KEY = 'main';

export const MAX_UNDO = 60;

export const STOPWORDS = new Set([
  '그리고', '그러나', '또한', '즉', '다만', '한다', '있는', '없는', '있다',
  '대한', '위한', '경우', '판례', '법원', '및', '것', '수', '등',
]);

export const EDITOR_IDS = {
  PROBLEM: 'promptTemplate',
  EXPLANATION: 'explanationTemplate',
  STUDY_EXPLANATION: 'studyEditExplanation',
};
