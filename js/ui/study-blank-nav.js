import { store } from '../core/store.js';

const CLOSE_DELAY_MS = 220;
let closeTimer = null;
let bound = false;
/** @type {'hover'|'click'|null} */
let openMode = null;
let focusBeforeOpen = null;
let suppressHoverUntil = 0;

function eventEl(e) {
  const t = e?.target;
  if (!t) return null;
  return t.nodeType === 1 ? t : t.parentElement;
}

function closestNav(node) {
  const el = node && node.nodeType === 1 ? node : node?.parentElement;
  return el?.closest?.('[data-study-blank-nav]') ?? null;
}

function navRoot() {
  return document.querySelector('[data-study-blank-nav]');
}

function triggerEl() {
  return navRoot()?.querySelector('.study-blank-nav-trigger') ?? null;
}

function panelEl() {
  return navRoot()?.querySelector('.study-blank-nav-panel') ?? null;
}

export function studyBlankNavHtml(blanks) {
  const items = blanks.map((b) =>
    `<button type="button" class="small ghost study-blank-nav-item" data-action="focus-blank" data-order="${b.order}">빈칸${b.order}</button>`,
  ).join('');
  return `<div class="study-blank-nav" data-study-blank-nav>
    <button type="button" class="small ghost study-blank-nav-trigger" data-action="blank-nav-trigger"
      aria-expanded="false" aria-controls="studyBlankNavPanel">
      빈칸 목록 <span class="study-blank-nav-summary" data-blank-nav-summary></span>
    </button>
    <div id="studyBlankNavPanel" class="study-blank-nav-panel" hidden>
      ${items}
    </div>
  </div>`;
}

export function isStudyBlankNavOpen() {
  return isOpen();
}

function isOpen() {
  const panel = panelEl();
  if (panel) return !panel.hidden;
  return navRoot()?.classList.contains('is-open') ?? false;
}

function setOpen(open) {
  const root = navRoot();
  if (!root) return;
  const trigger = triggerEl();
  const panel = panelEl();
  if (!trigger || !panel) return;
  if (open && !isOpen()) {
    const active = document.activeElement;
    if (!focusBeforeOpen || !document.contains(focusBeforeOpen) || focusBeforeOpen === trigger) {
      if (active && active !== trigger) focusBeforeOpen = active;
      else if (!focusBeforeOpen) focusBeforeOpen = active;
    }
  }
  root.classList.toggle('is-open', open);
  trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
  panel.hidden = !open;
  if (!open) openMode = null;
}

export function closeStudyBlankNav({ restoreFocus = false, suppressHoverMs = 320 } = {}) {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  const wasOpen = isOpen();
  setOpen(false);
  if (suppressHoverMs > 0) suppressHoverUntil = Date.now() + suppressHoverMs;
  if (wasOpen && restoreFocus) {
    const back = focusBeforeOpen;
    focusBeforeOpen = null;
    if (back && document.contains(back)) back.focus();
    else triggerEl()?.focus();
  }
}

function scheduleClose() {
  if (openMode === 'click') return;
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    closeTimer = null;
    if (openMode === 'hover') setOpen(false);
  }, CLOSE_DELAY_MS);
}

export function openStudyBlankNav(mode) {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  openMode = mode;
  setOpen(true);
}

/** 트리거 클릭 — hover로 열린 직후 첫 클릭은 닫지 않고 고정 */
export function clickStudyBlankNavTrigger() {
  const root = navRoot();
  if (!root) return;
  if (isOpen() && openMode === 'hover') {
    openMode = 'click';
    triggerEl()?.focus();
    return;
  }
  if (isOpen()) {
    closeStudyBlankNav({ restoreFocus: true });
    return;
  }
  const trigger = triggerEl();
  focusBeforeOpen = trigger;
  openStudyBlankNav('click');
  trigger?.focus();
}

export function syncStudyBlankNav(statuses, focusOrder) {
  const root = navRoot();
  if (!root) return;
  const summary = root.querySelector('[data-blank-nav-summary]');
  const total = statuses.length;
  const checked = statuses.filter((s) => s.checked).length;
  const ok = statuses.filter((s) => s.correct).length;
  if (summary) {
    summary.textContent = total
      ? (checked ? `채점 ${ok}/${total}` : `${total}개`)
      : '';
  }
  root.querySelectorAll('.study-blank-nav-item').forEach((btn) => {
    const order = Number(btn.dataset.order);
    const st = statuses.find((s) => s.order === order);
    btn.classList.toggle('is-current', focusOrder === order);
    btn.classList.toggle('ok', !!st?.correct);
    btn.classList.toggle('bad', !!(st?.checked && !st?.correct));
  });
}

export function bindStudyBlankNav() {
  if (bound) return;
  bound = true;

  document.addEventListener('pointerdown', (e) => {
    const el = eventEl(e);
    if (!el?.closest?.('.study-blank-nav-trigger')) return;
    if (!isOpen()) {
      const active = document.activeElement;
      if (active && active !== triggerEl()) focusBeforeOpen = active;
    }
  }, true);

  document.addEventListener('click', (e) => {
    if (!isOpen()) return;
    if (closestNav(e.target)) return;
    closeStudyBlankNav();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !isOpen()) return;
    e.preventDefault();
    e.stopPropagation();
    closeStudyBlankNav({ restoreFocus: true });
  }, true);

  document.addEventListener('mouseover', (e) => {
    const root = navRoot();
    if (!root || store.currentSection !== 'study-play') return;
    if (!closestNav(e.target)) return;
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    if (Date.now() < suppressHoverUntil) {
      const wait = Math.max(0, suppressHoverUntil - Date.now()) + 16;
      setTimeout(() => {
        const r = navRoot();
        if (!r || store.currentSection !== 'study-play') return;
        if (Date.now() < suppressHoverUntil) return;
        if (r.matches(':hover') && !isOpen()) openStudyBlankNav('hover');
      }, wait);
      return;
    }
    if (!isOpen()) openStudyBlankNav('hover');
  });

  document.addEventListener('mouseout', (e) => {
    const root = navRoot();
    if (!root || store.currentSection !== 'study-play') return;
    const from = closestNav(e.target);
    if (!from) return;
    const to = closestNav(e.relatedTarget);
    if (to) return;
    if (root.matches(':hover')) return;
    scheduleClose();
  });
}
