import { uid, shorten, stripBlankMarkers } from '../utils/text.js';
import { syncTemplateAndBlanks } from './blank.js';
import { normalizeOutline } from './outline.js';

/** 빈 초기 상태 — 사용자·카드 없음 */
export function createDefaultState() {
  return {
    version: 2,
    users: [],
    activeUserId: null,
    folders: [],
    cards: [],
    selectedIds: [],
    settings: { gradingThreshold: 80 },
    ui: {
      treeExpanded: {}, section: 'manage', sidebarCollapsed: false,
      outlineSummaryExpanded: false,
      createSavedSnapshot: '',
      lastAutoSaveAt: '',
      lastSavedAt: '',
      studyConfig: { scope: 'all', order: 'created', folderId: null, flag: 1 },
      createDraft: null,
      filterFlag: 'all',
      filterFolderId: null,
      studySessions: {},
      studySession: null,
    },
  };
}

export function migrateUser(raw) {
  const name = String(raw.name || '').trim().normalize('NFC') || '이름 없음';
  return {
    id: raw.id || uid('u'),
    name,
    pin: raw.pin || null,
    createdAt: raw.createdAt || new Date().toISOString(),
  };
}

/** 레거시·부분 데이터 정규화 */
export function migrateCard(raw) {
  let displayText = raw.displayText || raw.promptTemplate || raw.originalText || '';
  let explanationText = raw.explanationText || '';
  let blanks = Array.isArray(raw.blanks) ? raw.blanks : [];

  if (blanks.length && !blanks[0].id) {
    blanks = blanks.map((b, i) => ({
      id: b.id || uid('b'),
      cardId: raw.id,
      order: b.order || b.key || i + 1,
      placeholder: b.placeholder || `빈칸${b.order || b.key || i + 1}`,
      answer: String(b.answer || ''),
      aliases: b.aliases || [],
      lastInput: '',
      lastResult: null,
      manualResult: null,
    }));
  }

  // 예전 카드: 빈칸이 문제(displayText)에 남아 있으면 해설로 옮기거나 제거
  if (/\[\[BLANK\d+\]\]/.test(displayText)) {
    if (!explanationText.trim()) {
      explanationText = displayText;
      displayText = stripBlankMarkers(raw.originalText || displayText);
    } else {
      displayText = stripBlankMarkers(displayText);
    }
  }

  const synced = syncTemplateAndBlanks(explanationText, blanks);
  explanationText = synced.template;
  blanks = synced.blanks;
  displayText = stripBlankMarkers(displayText);

  return {
    id: raw.id || uid('c'),
    userId: raw.userId || '',
    folderId: raw.folderId || null,
    title: raw.title || shorten(stripBlankMarkers(explanationText || displayText), 40) || '제목 없음',
    originalText: stripBlankMarkers(raw.originalText || displayText),
    displayText,
    explanationText,
    blanks,
    memo: raw.memo || raw.note || '',
    flagColor: Number(raw.flagColor ?? raw.flag ?? 0),
    rounds: Math.max(0, Number(raw.rounds || 0)),
    wrongCount: Number(raw.wrongCount || 0),
    lastResult: raw.lastResult || null,
    isSample: !!raw.isSample,
    outline: normalizeOutline(raw.outline),
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

export function migrateState(raw) {
  if (!raw) return createDefaultState();

  const merged = {
    ...createDefaultState(),
    ...raw,
    version: 2,
  };

  merged.users = (raw.users || []).map(migrateUser);
  merged.folders = raw.folders || [];
  merged.cards = (raw.cards || []).map(migrateCard);
  merged.selectedIds = [...new Set(raw.selectedIds || [])];
  merged.settings = { gradingThreshold: 80, ...(raw.settings || {}) };
  merged.ui = {
    treeExpanded: {},
    section: 'manage',
    sidebarCollapsed: false,
    outlineSummaryExpanded: false,
    createSavedSnapshot: '',
    lastAutoSaveAt: '',
    lastSavedAt: '',
    studyConfig: { scope: 'all', order: 'created', folderId: null, flag: 1 },
    createDraft: null,
    filterFlag: 'all',
    filterFolderId: null,
    studySessions: {},
    studySession: null,
    ...(raw.ui || {}),
  };
  merged.ui.studyConfig = { scope: 'all', order: 'created', folderId: null, flag: 1, ...(merged.ui.studyConfig || {}) };
  if (merged.ui.filterFlag == null) merged.ui.filterFlag = 'all';
  if (merged.ui.filterFolderId === undefined) merged.ui.filterFolderId = null;
  if (!merged.ui.studySessions) merged.ui.studySessions = {};
  if (merged.ui.studySession?.cardIds?.length && merged.activeUserId) {
    if (!merged.ui.studySessions[merged.activeUserId]) {
      merged.ui.studySessions[merged.activeUserId] = merged.ui.studySession;
    }
  }

  const validActive = merged.users.some((u) => u.id === merged.activeUserId);
  merged.activeUserId = validActive ? merged.activeUserId : null;

  return merged;
}
