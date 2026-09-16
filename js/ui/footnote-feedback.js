import { store } from '../core/store.js';
import { getOwnedCard } from '../domain/queries.js';
import { normalizeCardTextMeta } from '../domain/text-marks.js';

const pulseTimers = new WeakMap();
export function pulseFootnote(el) {
  if (!el) return;
  clearTimeout(pulseTimers.get(el));
  el.classList.add('note-pulse');
  pulseTimers.set(el, setTimeout(() => {
    el.classList.remove('note-pulse');
    pulseTimers.delete(el);
  }, 1300));
}

let bound = false;
let timer;
let active;
let tooltip;

export function hideFootnoteHover() {
  clearTimeout(timer);
  active?.removeAttribute('aria-describedby');
  active = null;
  if (tooltip) tooltip.hidden = true;
}

function studyMarker(node) {
  return node?.closest?.('#studyPrompt .tm-fn, #studyExplanation .tm-fn') || null;
}

function show(marker) {
  const current = store.studyQueue[store.studyIndex];
  const owned = current && getOwnedCard(current.id);
  if (!owned || !marker.isConnected || store.currentSection !== 'study-play') return hideFootnoteHover();
  const field = marker.closest('#studyPrompt') ? 'display' : 'explanation';
  const fn = normalizeCardTextMeta(owned).footnotes.find(f => f.id === marker.dataset.fnId && f.field === field);
  if (!fn) return hideFootnoteHover();
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'footnoteHover';
    tooltip.className = 'footnote-hover';
    tooltip.setAttribute('role', 'tooltip');
    document.body.appendChild(tooltip);
  }
  tooltip.textContent = fn.body;
  tooltip.hidden = false;
  marker.setAttribute('aria-describedby', tooltip.id);
  const box = marker.getBoundingClientRect();
  const tip = tooltip.getBoundingClientRect();
  const left = Math.max(8, Math.min(box.left, innerWidth - tip.width - 8));
  const top = box.bottom + 7 + tip.height <= innerHeight - 8
    ? box.bottom + 7 : Math.max(8, box.top - tip.height - 7);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

export function bindFootnoteFeedback() {
  if (bound) return;
  bound = true;
  const enter = (marker, delay) => {
    if (active === marker && marker) { clearTimeout(timer); return; }
    if (!marker) return;
    hideFootnoteHover();
    active = marker;
    timer = setTimeout(() => { if (active === marker) show(marker); }, delay);
  };
  document.addEventListener('pointerover', e => {
    if (tooltip?.contains(e.target)) { clearTimeout(timer); return; }
    enter(studyMarker(e.target), 180);
  });
  document.addEventListener('pointerout', e => {
    if (tooltip?.contains(e.relatedTarget) || studyMarker(e.relatedTarget) === active) return;
    if (studyMarker(e.target) || tooltip?.contains(e.target)) {
      clearTimeout(timer);
      timer = setTimeout(hideFootnoteHover, 120);
    }
  });
  document.addEventListener('focusin', e => {
    if (e.target.matches?.(':focus-visible')) enter(studyMarker(e.target), 0);
  });
  document.addEventListener('focusout', e => { if (studyMarker(e.target)) hideFootnoteHover(); });
  document.addEventListener('click', hideFootnoteHover, true);
  document.addEventListener('scroll', e => {
    if (!tooltip?.contains(e.target)) hideFootnoteHover();
  }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hideFootnoteHover(); });
  window.addEventListener('resize', hideFootnoteHover);
  window.addEventListener('hashchange', hideFootnoteHover);
}
