/** 앱 전역 상수 */
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
