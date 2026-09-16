/**
 * 학습 화면 글자 크기 + 공용 각주/메모 패널 재수출.
 */
import { store } from '../core/store.js';
import { persist } from '../core/storage.js';
export {
  renderNotesPanel as renderStudyNotesPanel,
  setNotesTab as setStudyNotesTab,
  toggleNotesPanel as toggleStudyNotesPanel,
  toggleNotesFootnote as toggleStudyFootnote,
  toggleAllNotesFootnotes,
  openNotesFootnote as openStudyFootnote,
  openFootnoteReader,
  placeNotesPanel,
} from './notes-panel.js';

export function applyStudyFontScale() {
  const n = Number(store.data?.ui?.studyFontScale ?? 100);
  const clamped = Math.min(160, Math.max(80, Number.isFinite(n) ? n : 100));
  if (store.data?.ui) store.data.ui.studyFontScale = clamped;
  document.documentElement.style.setProperty('--study-font-scale', String(clamped / 100));
  const el = document.getElementById('studyFontScale');
  if (el && document.activeElement !== el) el.value = String(clamped);
  const lab = document.getElementById('studyFontScaleLabel');
  if (lab) lab.textContent = `${clamped}%`;
}

export function setStudyFontScale(value) {
  if (!store.data?.ui) return;
  store.data.ui.studyFontScale = Math.min(160, Math.max(80, Number(value) || 100));
  persist();
  applyStudyFontScale();
}
