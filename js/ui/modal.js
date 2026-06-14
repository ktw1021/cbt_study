import { escapeHtml } from '../utils/text.js';
import { findAutoCandidates } from '../domain/blank.js';

/** 자동 빈칸 후보 모달 */
export function openAutoBlankModal(candidates, onApply) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="modal-backdrop" data-action="close-modal">
    <div class="modal">
      <h3>자동 빈칸 후보 (${candidates.length}개)</h3>
      <div class="caption">적용할 항목을 선택하세요. 숫자·판례번호·조항은 제외됩니다.</div>
      <div class="candidate-list">${candidates.map(([token]) =>
        `<label class="candidate-row"><input type="checkbox" checked data-auto-token="${escapeHtml(token)}" /> ${escapeHtml(token)}</label>`).join('')}
      </div>
      <div class="toolbar" style="margin-top:12px">
        <button class="primary" data-action="apply-auto-blank">선택 적용</button>
        <button class="ghost" data-action="close-modal">취소</button>
      </div>
    </div>
  </div>`;

  root._onApplyAutoBlank = onApply;
}

export function closeModal() {
  const root = document.getElementById('modalRoot');
  root.innerHTML = '';
  delete root._onApplyAutoBlank;
}

export function getSelectedAutoTokens() {
  return [...document.querySelectorAll('#modalRoot [data-auto-token]')]
    .filter((el) => el.checked)
    .map((el) => el.dataset.autoToken);
}
