import { escapeHtml } from '../utils/text.js';

/** 빈칸 후보 선택 모달 */
export function openAutoBlankModal(candidates, onApply, {
  hasOutline = false,
  checkedCount = null,
} = {}) {
  const root = document.getElementById('modalRoot');
  const outlineNote = hasOutline
    ? ' <strong>저장된 목차</strong> 제목이 앞쪽에 표시됩니다.'
    : '';
  const list = candidates.length
    ? candidates.map(([token], i) => {
      const checked = checkedCount == null || i < checkedCount;
      return `<label class="candidate-row"><input type="checkbox" ${checked ? 'checked' : ''} data-auto-token="${escapeHtml(token)}" /> ${escapeHtml(token)}</label>`;
    }).join('')
    : '<div class="caption">후보 없음</div>';

  root.innerHTML = `<div class="modal-backdrop">
    <div class="modal">
      <h3>빈칸 후보 (${candidates.length}개)</h3>
      <div class="caption">적용할 항목을 고르세요. 이미 빈칸인 정답·중복은 목록에 없습니다. 숫자·조항 단독 토큰은 제외됩니다.${outlineNote}</div>
      <div class="candidate-list">${list}</div>
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
