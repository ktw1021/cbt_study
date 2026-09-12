import { store } from '../core/store.js';
import { persist } from '../core/storage.js';
import { syncUrl } from '../core/hash-router.js';
import { renderStudyMeta, renderStudySetup } from './study.js';
import { readCreateForm, makeCreateSnapshot, closeExplanationFocus } from './create.js';
import { closeChoice } from './choice-modal.js';
import { saveStudySession } from '../services/study-session.js';

/** 카드제작 화면을 떠날 때 — 내용이 있으면 초안 보존, 없으면 비움 */
function saveCreateDraftOnLeave() {
  try {
    const d = readCreateForm();
    const has = d.displayText.trim() || d.explanationText.trim() || (d.memo || '').trim()
      || d.blanks.length || d.outline?.items?.length
      || (d.title && d.title !== '제목 없음');
    store.data.ui.createDraft = has ? d : null;
  } catch { /* 폼 미존재 시 무시 */ }
}

const MOBILE_BP = 900;

export function isMobileLayout() {
  return window.matchMedia(`(max-width: ${MOBILE_BP}px)`).matches;
}

export function syncSidebarHeightToMain() {
  if (isMobileLayout()) return;
  const sidebar = document.querySelector('.sidebar');
  const main = document.querySelector('main.main');
  if (!sidebar || !main) return;

  // main이 짧으면 sidebar도 그 높이까지만(넘치면 sidebar 내부 스크롤)
  // main이 길면 제한 해제(페이지 스크롤로 자연스럽게)
  const mainH = Math.max(0, Math.floor(main.getBoundingClientRect().height));
  if (!mainH) return;

  // main이 너무 짧으면(sidebar가 “잘린 듯” 보임) 최소 높이를 보장
  const MIN_SIDEBAR_H = 720;
  const limitH = Math.max(mainH, MIN_SIDEBAR_H);

  // sidebar 내부 콘텐츠가 limit를 초과할 때만 제한
  if (sidebar.scrollHeight > limitH) {
    sidebar.style.maxHeight = `${limitH}px`;
  } else {
    sidebar.style.maxHeight = '';
  }
}

/** 학습 중(study-play)만 사이드바 접기 — store에는 저장 안 함 */
function applyStudyFocusSidebar(prevSection, nextSection) {
  if (isMobileLayout()) return;

  const wasPlay = prevSection === 'study-play';
  const isPlay = nextSection === 'study-play' && store.studyQueue.length > 0;

  if (isPlay && !wasPlay) {
    document.body.classList.add('sidebar-collapsed');
    updateSidebarToggleBtn();
    return;
  }

  if (wasPlay && !isPlay) {
    document.body.classList.toggle('sidebar-collapsed', !!store.data.ui.sidebarCollapsed);
    updateSidebarToggleBtn();
  }
}

/** 화면 섹션 전환 + URL 동기화 */
export function showSection(name, { urlExtra = {}, replaceUrl = false, fromHash = false } = {}) {
  const prevSection = store.currentSection;
  if (prevSection === 'create' && name !== 'create') {
    // 실제 변경이 있을 때만 경고 (마지막 저장/자동저장/진입 시 스냅샷과 비교)
    let shouldLeave = true;
    try {
      const d = readCreateForm();
      const snap = makeCreateSnapshot(d);
      const base = String(store.data.ui.createSavedSnapshot || '');
      const dirty = base
        ? snap !== base
        : !!(d.displayText.trim() || d.explanationText.trim() || (d.memo || '').trim()
          || d.blanks.length || d.outline?.items?.length
          || (d.title && d.title !== '제목 없음'));
      if (dirty && !fromHash) {
        shouldLeave = confirm('저장하지 않은 변경사항이 있을 수 있습니다.\n이동하면 작성 내용이 바뀌거나 사라질 수 있어요.\n그래도 이동할까요?');
      }
    } catch { /* ignore */ }
    if (!shouldLeave) return;
    saveCreateDraftOnLeave();
    closeExplanationFocus();
  }
  if (prevSection === 'study-play' && name !== 'study-play') saveStudySession();
  closeChoice();
  store.currentSection = name;
  store.data.ui.section = name.startsWith('study') ? 'study' : name;

  const isManage = name === 'manage';
  const isCreate = name === 'create';
  const isStudy = name === 'study' || name === 'study-play';
  const isPatch = name === 'patch';

  document.getElementById('manageSection').classList.toggle('hidden', !isManage);
  document.getElementById('createSection').classList.toggle('hidden', !isCreate);
  document.getElementById('studySection').classList.toggle('hidden', !isStudy);
  document.getElementById('patchSection').classList.toggle('hidden', !isPatch);

  document.body.classList.toggle('study-playing', name === 'study-play' && store.studyQueue.length > 0);
  document.body.classList.toggle('section-create', isCreate);
  document.body.classList.toggle('section-manage', isManage);
  document.body.classList.toggle('section-study', isStudy);
  document.body.classList.toggle('section-patch', isPatch);

  applyStudyFocusSidebar(prevSection, name);
  syncNavActive(name);
  if (isStudy) renderStudyMeta();
  if (name === 'study') renderStudySetup();
  if (isMobileLayout()) closeMobileMenu();

  if (!fromHash) {
    const page = name === 'study-play' ? 'study-play' : name;
    syncUrl(page, urlExtra, replaceUrl);
  }
  persist();
  syncSidebarHeightToMain();
}

function syncNavActive(name) {
  const isManage = name === 'manage';
  const isCreate = name === 'create';
  const isStudy = name === 'study' || name === 'study-play';

  document.querySelectorAll('#navManage, #navCreate, #navStudy, #navPatch, .topbar-nav .nav-btn').forEach((el) => {
    el.classList.remove('active');
  });

  const add = (id) => document.getElementById(id)?.classList.add('active');
  if (isManage) add('navManage');
  if (isCreate) add('navCreate');
  if (isStudy) add('navStudy');
  if (name === 'patch') add('navPatch');

  document.querySelectorAll('.topbar-nav .nav-btn').forEach((btn) => {
    const action = btn.dataset.action;
    if (isManage && action === 'nav-manage') btn.classList.add('active');
    if (isCreate && action === 'nav-create') btn.classList.add('active');
    if (isStudy && action === 'nav-study') btn.classList.add('active');
  });
}

/** 데스크톱 — 사이드바 접기/펼치기 */
export function toggleSidebar() {
  if (isMobileLayout()) return;
  // 다음 상태는 "현재 화면"을 기준으로 계산한다.
  // (학습 중 자동 접힘처럼 화면만 접혀 있고 저장값은 펼침일 수 있어,
  //  저장값 기준으로 계산하면 첫 클릭이 먹통이 된다.)
  const collapsed = !document.body.classList.contains('sidebar-collapsed');
  store.data.ui.sidebarCollapsed = collapsed;
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  updateSidebarToggleBtn();
  persist();
}

/**
 * 학습 중 문제칸 가리기/펼치기.
 * 정답을 문제칸에 적어두고 외우다가 시험처럼 풀어보고 싶을 때 카드를 고치지 않고 가린다.
 */
export function toggleStudyPrompt() {
  const collapsed = !document.body.classList.contains('study-prompt-collapsed');
  store.data.ui.studyPromptCollapsed = collapsed;
  document.body.classList.toggle('study-prompt-collapsed', collapsed);
  persist();
}

export function applyStudyPromptState() {
  document.body.classList.toggle('study-prompt-collapsed', !!store.data.ui.studyPromptCollapsed);
}

/** 모바일 — 햄버거 메뉴 */
export function toggleMobileMenu() {
  if (!isMobileLayout()) return;
  const open = !document.body.classList.contains('mobile-menu-open');
  document.body.classList.toggle('mobile-menu-open', open);
  const btn = document.getElementById('hamburgerBtn');
  if (btn) {
    btn.textContent = open ? '✕' : '☰';
    btn.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴');
  }
}

export function closeMobileMenu() {
  document.body.classList.remove('mobile-menu-open');
  const btn = document.getElementById('hamburgerBtn');
  if (btn) {
    btn.textContent = '☰';
    btn.setAttribute('aria-label', '메뉴');
  }
}

function updateSidebarToggleBtn() {
  const btn = document.getElementById('sidebarToggle');
  if (!btn) return;
  const collapsed = !!store.data.ui.sidebarCollapsed;
  btn.textContent = collapsed ? '▶' : '◀';
  btn.title = collapsed ? '사이드바 펼치기' : '사이드바 접기';
}

export function applySidebarState() {
  if (isMobileLayout()) {
    document.body.classList.remove('sidebar-collapsed');
    closeMobileMenu();
    return;
  }
  document.body.classList.toggle('sidebar-collapsed', !!store.data.ui.sidebarCollapsed);
  updateSidebarToggleBtn();
}

/** 뷰포트 변경 시 레이아웃 정리 */
export function handleViewportChange() {
  if (isMobileLayout()) {
    document.body.classList.remove('sidebar-collapsed');
    closeMobileMenu();
  } else {
    document.body.classList.remove('mobile-menu-open');
    document.body.classList.toggle('sidebar-collapsed', !!store.data.ui.sidebarCollapsed);
    updateSidebarToggleBtn();
  }
}
