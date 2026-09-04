/** 앱 상태 + UI 세션 (런타임) */
export const store = {
  data: null,
  authenticatedUserId: null,
  authTab: 'login',
  pendingPinSetupUserId: null,
  pinSetupQueue: [],
  pinSetupResumeUserId: null,
  currentSection: 'manage',
  studyQueue: [],
  studyIndex: 0,
  _studyCardId: null,
  currentBlankStatuses: [],
  currentBlankFocus: null,
  // 시도당 1회만 집계하기 위한 가드 (오답 횟수 / 회독)
  studyAttemptRecorded: false,
  studyRoundRecorded: false,
  activeManageId: null,
  activeFolderId: null,
  autoBlankEditorId: 'explanationTemplate',
  studySetupCheckedIds: null,
  studySetupPoolKey: null,
};

export function getState() {
  return store.data;
}

export function setState(next) {
  store.data = next;
}
