import { store } from '../core/store.js';
import { getCard } from '../domain/queries.js';
import { renderSidebar } from './sidebar.js';
import { renderFolderTree, renderCardList, renderFolderSelects } from './manage.js';
import { renderCreatePreview, readCreateForm } from './create.js';
import { renderStudyMeta } from './study.js';
import { updateCreateSaveStamp } from '../app/actions.js';
import { syncSidebarHeightToMain } from './router.js';

export { renderManageDetail } from './manage.js';
export { renderStudyCard } from './study.js';
export { renderCreateForm } from './create.js';

/** 전체 UI 리렌더 */
export function renderAll() {
  renderSidebar();
  renderFolderTree();
  renderFolderSelects();
  renderCardList();

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
