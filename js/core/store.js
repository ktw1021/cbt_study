/** 앱 상태 + UI 세션 (런타임) */
export const store = {
  data: null,
  authenticatedUserId: null,
  authTab: 'login',
  pendingPinSetupUserId: null,
  currentSection: 'manage',
  studyQueue: [],
  studyIndex: 0,
  currentBlankStatuses: [],
  currentBlankFocus: null,
  studyAttemptRecorded: false,
  activeManageId: null,
  activeFolderId: null,
  autoBlankEditorId: 'explanationTemplate',
};

export function getState() {
  return store.data;
}

export function setState(next) {
  store.data = next;
}
