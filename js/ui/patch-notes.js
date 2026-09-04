/**
 * 패치노트 모달
 *
 * patch-notes-YYYY-MM-DD.md 파일들을 불러와 최신순(위)으로 렌더한다.
 * 새 패치를 추가하려면 PATCH_FILES 맨 위에 파일명을 넣으면 된다.
 */
import { escapeHtml } from '../utils/text.js';

const PATCH_FILES = [
  'patch-notes-2026-09-04.md',
  'patch-notes-2026-08-15.md',
  'patch-notes-2026-06-25.md',
  'patch-notes-2026-06-17.md',
  'patch-notes-2026-06-15.md',
];

function inline(s) {
  let t = escapeHtml(s);
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  return t;
}

/** 아주 작은 마크다운 → HTML (제목/목록/구분선/굵게/인라인코드) */
function renderMarkdown(md) {
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  let html = '';
  let inList = false;
  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (/^---+$/.test(line.trim())) { closeList(); html += '<hr/>'; continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeList(); const lv = h[1].length; html += `<h${lv}>${inline(h[2])}</h${lv}>`; continue; }

    const li = line.match(/^(\s*)[-*]\s+(.*)$/);
    if (li) {
      if (!inList) { html += '<ul>'; inList = true; }
      const indent = Math.floor(li[1].replace(/\t/g, '  ').length / 2);
      const ml = indent ? ` style="margin-left:${indent * 14}px"` : '';
      html += `<li${ml}>${inline(li[2])}</li>`;
      continue;
    }

    if (!line.trim()) { closeList(); continue; }
    closeList();
    html += `<p>${inline(line)}</p>`;
  }
  closeList();
  return html;
}

/** 패치노트 페이지 렌더 — 각 패치를 최신순 아코디언(공지사항형)으로 */
export async function renderPatchPage() {
  const body = document.getElementById('patchNotesBody');
  if (!body) return;
  body.innerHTML = '<div class="caption">불러오는 중…</div>';

  const entries = [];
  for (const file of PATCH_FILES) {
    try {
      const res = await fetch(file, { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      const md = await res.text();
      const lines = String(md).replace(/\r\n/g, '\n').split('\n');
      const tIdx = lines.findIndex((l) => /^#\s+/.test(l));
      let title = file;
      if (tIdx >= 0) { title = lines[tIdx].replace(/^#\s+/, '').trim(); lines.splice(tIdx, 1); }
      entries.push({ title, html: renderMarkdown(lines.join('\n')) });
    } catch {
      // 누락/실패한 파일은 건너뜀
    }
  }

  body.innerHTML = entries.length
    ? entries.map((e, i) => `
      <details class="patch-entry" ${i === 0 ? 'open' : ''}>
        <summary class="patch-summary">${escapeHtml(e.title)}</summary>
        <div class="patch-content">${e.html}</div>
      </details>`).join('')
    : '<div class="caption">패치노트를 불러오지 못했습니다. (file://로 직접 열면 막힐 수 있어요. 로컬 서버나 배포 환경에서 확인하세요.)</div>';
}
