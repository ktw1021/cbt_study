import { store } from '../core/store.js';
import { getCard } from '../domain/queries.js';
import { renderSidebar } from './sidebar.js';
import {
  renderFolderTree, renderCardList, renderFolderSelects, renderManageDetail,
} from './manage.js';
import { renderCreatePreview, readCreateForm } from './create.js';
import { renderStudyMeta } from './study.js';
import { updateCreateSaveStamp } from '../app/actions.js';
import { syncSidebarHeightToMain } from './router.js';

export { renderManageDetail };
export { renderStudyCard } from './study.js';
export { renderCreateForm } from './create.js';

/** 전체 UI 리렌더 */
export function renderAll() {
  renderSidebar();
  renderFolderTree();
  renderFolderSelects();
  // 열어둔 카드는 선택 상태만 유지하고 내용은 다시 읽는다 (학습 중 바뀐 회독·오답 반영)
  if (store.activeManageId) renderManageDetail(store.activeManageId);
  else renderCardList();

  if (store.currentSection === 'create') {
    try {
      const cardId = document.getElementById('cardId').value;
      if (cardId && getCard(cardId)) {
        renderCreatePreview(getCard(cardId));
      } else {
        const draft = readCreateForm([]);
        renderCreatePreview({ displayText: draft.displayText, blanks: draft.blanks });
      }
    } catch {
      renderCreatePreview({ displayText: '', blanks: [] });
    }
    updateCreateSaveStamp();
  }

  renderStudyMeta();
  syncSidebarHeightToMain();
}
