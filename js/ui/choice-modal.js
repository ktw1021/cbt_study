import { escapeHtml } from '../utils/text.js';

/**
 * 확인·선택 모달 (native confirm 대체).
 * 첫 번째 선택지에 포커스가 놓여 Enter로 바로 확정된다. Esc·배경 클릭은 취소.
 * 학습 흐름처럼 애니메이션과 이어져야 하는 곳에서 blocking confirm 대신 쓴다.
 */

const ROOT_ID = 'choiceRoot';

let close = null;

function ensureRoot() {
  let root = document.getElementById(ROOT_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = ROOT_ID;
    document.body.appendChild(root);
  }
  return root;
}

export function isChoiceOpen() {
  return !!close;
}

/** 열려 있으면 취소로 닫는다 (화면 전환 등으로 모달이 남는 것 방지) */
export function closeChoice() {
  close?.(null);
}

/**
 * @param {object} opts
 * @param {string} opts.title 제목
 * @param {string} [opts.message] 보조 설명
 * @param {{value: string|null, label: string, tone?: string}[]} opts.choices 첫 항목이 기본 선택
 * @returns {Promise<string|null>} 선택한 value (취소 시 null)
 */
export function openChoice({ title, message = '', choices }) {
  closeChoice();

  const root = ensureRoot();
  const buttons = choices.map((c, i) => {
    const tone = c.tone || (i === 0 ? 'primary' : 'ghost');
    return `<button type="button" class="${tone}" data-choice-index="${i}">${escapeHtml(c.label)}</button>`;
  }).join('');

  root.innerHTML = `<div class="modal-backdrop choice-backdrop">
    <div class="modal choice-modal" role="dialog" aria-modal="true">
      <h3>${escapeHtml(title)}</h3>
      ${message ? `<div class="caption choice-message">${escapeHtml(message)}</div>` : ''}
      <div class="toolbar choice-actions">${buttons}</div>
    </div>
  </div>`;

  return new Promise((resolve) => {
    const backdrop = root.querySelector('.choice-backdrop');

    const finish = (value) => {
      if (!close) return;
      close = null;
      document.removeEventListener('keydown', onKeydown, true);
      root.innerHTML = '';
      resolve(value);
    };
    close = finish;

    function onKeydown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(null);
      }
    }

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        finish(null);
        return;
      }
      const btn = e.target.closest('[data-choice-index]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      finish(choices[Number(btn.dataset.choiceIndex)].value);
    });

    // capture 단계 — 학습 화면의 Enter(채점) 핸들러보다 먼저 Esc를 받는다
    document.addEventListener('keydown', onKeydown, true);

    // 포커스를 빈칸 입력에서 확실히 떼어내야 Enter가 채점으로 새지 않는다
    root.querySelector('[data-choice-index]')?.focus();
  });
}
