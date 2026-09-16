/**
 * 네이티브 title보다 짧은 지연의 공용 tooltip.
 * viewport에 붙여 집중편집·좁은 창에서 잘리지 않게 한다.
 */
const DELAY_MS = 350;
let timer = 0;
let current = null;
let tipEl = null;

function ensureTip() {
  if (tipEl) return tipEl;
  tipEl = document.createElement('div');
  tipEl.className = 'ui-delay-tip';
  tipEl.id = 'uiDelayTip';
  tipEl.setAttribute('role', 'tooltip');
  tipEl.hidden = true;
  document.body.appendChild(tipEl);
  return tipEl;
}

function tipSource(el) {
  return el?.closest?.('[data-tip]') || null;
}

function hideTip() {
  if (timer) {
    clearTimeout(timer);
    timer = 0;
  }
  current = null;
  if (tipEl) tipEl.hidden = true;
}

function placeTip(anchor) {
  const tip = ensureTip();
  const text = String(anchor.getAttribute('data-tip') || '').trim();
  if (!text) {
    hideTip();
    return;
  }
  tip.textContent = text;
  tip.hidden = false;
  const ar = anchor.getBoundingClientRect();
  const pad = 8;
  const gap = 6;
  let tr = tip.getBoundingClientRect();
  let top = ar.bottom + gap;
  if (top + tr.height > window.innerHeight - pad) top = ar.top - tr.height - gap;
  if (top < pad) top = pad;
  let left = ar.left + (ar.width - tr.width) / 2;
  left = Math.min(Math.max(pad, left), window.innerWidth - tr.width - pad);
  tip.style.top = `${Math.round(top)}px`;
  tip.style.left = `${Math.round(left)}px`;
  tr = tip.getBoundingClientRect();
  if (tr.right > window.innerWidth - pad) {
    tip.style.left = `${Math.max(pad, window.innerWidth - tr.width - pad)}px`;
  }
  if (tr.bottom > window.innerHeight - pad) {
    tip.style.top = `${Math.max(pad, ar.top - tr.height - gap)}px`;
  }
}

function showFor(el, immediate) {
  if (!el || current === el) {
    if (el && !ensureTip().hidden) placeTip(el);
    return;
  }
  hideTip();
  current = el;
  const run = () => {
    timer = 0;
    if (current === el && document.contains(el)) placeTip(el);
  };
  if (immediate) run();
  else timer = window.setTimeout(run, DELAY_MS);
}

let bound = false;

export function bindDelayedTooltips() {
  if (bound) return;
  bound = true;
  document.addEventListener('pointerover', (e) => {
    const el = tipSource(e.target);
    if (!el) return;
    showFor(el, false);
  });
  document.addEventListener('pointerout', (e) => {
    const el = tipSource(e.target);
    if (!el) return;
    const next = tipSource(e.relatedTarget);
    if (next === el) return;
    hideTip();
  });
  document.addEventListener('focusin', (e) => {
    const el = tipSource(e.target);
    if (!el) return;
    if (e.target.matches?.(':focus-visible')) showFor(el, true);
  });
  document.addEventListener('focusout', (e) => {
    const el = tipSource(e.target);
    if (!el) return;
    hideTip();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideTip();
  });
  document.addEventListener('scroll', hideTip, true);
  window.addEventListener('resize', hideTip);
}
