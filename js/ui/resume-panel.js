import { escapeHtml, shorten } from '../utils/text.js';
import { getCard } from '../domain/queries.js';

/** 이어서 학습 부가 정보 — 카드 순서 · 채운 빈칸 수 · 제목 */
export function getResumeStudyDetail(sess) {
  if (!sess?.cardIds?.length) return '';
  const i = Math.min(Math.max(0, sess.index ?? 0), sess.cardIds.length - 1);
  const cardId = sess.cardIds[i];
  const cur = getCard(cardId);
  const title = cur ? shorten(cur.title || cur.displayText, 20) : '';
  const parts = [`${i + 1}/${sess.cardIds.length}장`];

  const prog = sess.cardProgress?.[cardId];
  if (prog?.blankStatuses?.length) {
    const n = prog.blankStatuses.length;
    const filled = prog.blankStatuses.filter((s) => s.checked).length;
    parts.push(`빈칸 ${filled}/${n}`);
  } else if (cur?.blanks?.length) {
    parts.push(`빈칸 0/${cur.blanks.length}`);
  }

  const top = parts.join(' · ');
  return title ? `${top}\n${title}` : top;
}

const MOUNTS = [
  { mountId: 'sidebarResumeMount', variant: 'sidebar' },
  { mountId: 'studyResumeMount', variant: 'study' },
];

function resumePanelHtml(variant, detail) {
  const htmlDetail = escapeHtml(detail).replace(/\n/g, '<br>');
  return `
    <div class="resume-panel resume-panel--${variant}">
      <div class="resume-panel__eyebrow">저장된 진행</div>
      <button type="button" class="resume-panel__btn" data-action="resume-study">이어서 학습</button>
      <div class="resume-panel__detail caption">${htmlDetail}</div>
    </div>`;
}

/** 마운트 지점에 이어서 학습 패널 렌더 (사이드바·학습 setup 공통) */
export function renderResumePanel({ mountId, variant, sess }) {
  const mount = document.getElementById(mountId);
  if (!mount) return;
  const has = !!sess?.cardIds?.length;
  mount.classList.toggle('hidden', !has);
  mount.innerHTML = has ? resumePanelHtml(variant, getResumeStudyDetail(sess)) : '';
}

/** 등록된 모든 이어서 학습 마운트 갱신 */
export function renderAllResumePanels(sess) {
  for (const { mountId, variant } of MOUNTS) {
    renderResumePanel({ mountId, variant, sess });
  }
}
