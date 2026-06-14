import { store } from '../core/store.js';
import { persist } from '../core/storage.js';
import { syncUrl } from '../core/hash-router.js';
import { renderStudyMeta } from './study.js';

const MOBILE_BP = 900;

export function isMobileLayout() {
  return window.matchMedia(`(max-width: ${MOBILE_BP}px)`).matches;
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
  store.currentSection = name;
  store.data.ui.section = name.startsWith('study') ? 'study' : name;

  const isManage = name === 'manage';
  const isCreate = name === 'create';
  const isStudy = name === 'study' || name === 'study-play';

  document.getElementById('manageSection').classList.toggle('hidden', !isManage);
  document.getElementById('createSection').classList.toggle('hidden', !isCreate);
  document.getElementById('studySection').classList.toggle('hidden', !isStudy);

  document.body.classList.toggle('study-playing', name === 'study-play' && store.studyQueue.length > 0);

  if (name === 'manage' || name === 'create') {
    store.data.ui.studySession = null;
  }

  applyStudyFocusSidebar(prevSection, name);
  syncNavActive(name);
  if (isStudy) renderStudyMeta();
  if (isMobileLayout()) closeMobileMenu();

  if (!fromHash) {
    const page = name === 'study-play' ? 'study-play' : name;
    syncUrl(page, urlExtra, replaceUrl);
  }
  persist();
}

function syncNavActive(name) {
  const isManage = name === 'manage';
  const isCreate = name === 'create';
  const isStudy = name === 'study' || name === 'study-play';

  document.querySelectorAll('#navManage, #navCreate, #navStudy, .topbar-nav .nav-btn').forEach((el) => {
    el.classList.remove('active');
  });

  const add = (id) => document.getElementById(id)?.classList.add('active');
  if (isManage) add('navManage');
  if (isCreate) add('navCreate');
  if (isStudy) add('navStudy');

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
  const collapsed = !store.data.ui.sidebarCollapsed;
  store.data.ui.sidebarCollapsed = collapsed;
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  updateSidebarToggleBtn();
  persist();
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
