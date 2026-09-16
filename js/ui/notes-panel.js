/**
 * 공용 각주/메모 패널. 제작·학습이 하나의 DOM을 옮겨 쓴다.
 * 각주 목록은 번호·출처만 보이고 원문 답을 자동인용하지 않는다.
 */
import { store } from '../core/store.js';
import { persist } from '../core/storage.js';
import { escapeHtml } from '../utils/text.js';
import { getOwnedCard } from '../domain/queries.js';
import { pulseFootnote, hideFootnoteHover } from './footnote-feedback.js';
import { normalizeCardTextMeta, footnoteNumbers, compareFootnoteAnchors } from '../domain/text-marks.js';
import {
  readAllEditorMeta,
  updateFootnoteBody,
  deleteFootnote,
  onEditorMetaChange,
  focusEditorFootnote,
} from './editor-surface.js';

function host() {
  return store._notesHost === 'create' ? 'create' : 'study';
}

function editorIdForFn(fn) {
  return fn.field === 'display' ? 'promptTemplate' : 'explanationTemplate';
}

function cardNotes(card) {
  if (!card) return [];
  return normalizeCardTextMeta(card).footnotes;
}

function currentFootnotes() {
  if (host() === 'create') return readAllEditorMeta().footnotes;
  const c = store.studyQueue[store.studyIndex];
  return cardNotes(c);
}

function notesKey() {
  if (host() === 'create') {
    return `create:${store.authenticatedUserId || ''}:${document.getElementById('cardId')?.value || 'draft'}`;
  }
  const c = store.studyQueue[store.studyIndex];
  return `study:${store.authenticatedUserId || ''}:${c?.id || ''}`;
}

function openFnIds() {
  if (!(store._openFnIds instanceof Set)) store._openFnIds = new Set();
  return store._openFnIds;
}

function knownFnIds() {
  if (!(store._fnExpandKnown instanceof Set)) store._fnExpandKnown = new Set();
  return store._fnExpandKnown;
}

function draftKey(field, id) {
  return `${field}:${id}`;
}

function footnoteInput(id, field) {
  return [...document.querySelectorAll('[data-fn-edit]')]
    .find(el => el.dataset.fnEdit === id && (!field || el.dataset.fnField === field));
}

function fnDrafts() {
  if (!store._fnEditDrafts || typeof store._fnEditDrafts !== 'object') store._fnEditDrafts = {};
  return store._fnEditDrafts;
}

function modelBodyFor(field, id) {
  const fn = readAllEditorMeta().footnotes.find((f) => f.id === id && f.field === field);
  return fn?.body ?? '';
}

function harvestFnEdits() {
  const drafts = fnDrafts();
  document.querySelectorAll('[data-fn-edit]').forEach((ta) => {
    const id = ta.getAttribute('data-fn-edit');
    const field = ta.getAttribute('data-fn-field') === 'explanation' ? 'explanation' : 'display';
    if (!id) return;
    const key = draftKey(field, id);
    const model = modelBodyFor(field, id);
    const val = ta.value;
    if (val === model) delete drafts[key];
    else drafts[key] = val;
  });
}

function clearFnDraft(field, id) {
  if (!field || !id) return;
  delete fnDrafts()[draftKey(field, id)];
}

/** editor Undo 등으로 모델 본문이 바뀌면 해당 cache 제거 — 미저장 초안(모델 미변경)은 유지 */
function reconcileFnDraftsWithModel() {
  const drafts = fnDrafts();
  const meta = readAllEditorMeta().footnotes;
  const modelByKey = new Map(meta.map((f) => [draftKey(f.field, f.id), String(f.body ?? '')]));
  if (!store._fnModelBodies || typeof store._fnModelBodies !== 'object') store._fnModelBodies = {};
  const prevBodies = store._fnModelBodies;
  modelByKey.forEach((body, key) => {
    const prev = prevBodies[key];
    if (prev !== undefined && prev !== body) delete drafts[key];
    prevBodies[key] = body;
  });
  Object.keys(prevBodies).forEach((key) => {
    if (!modelByKey.has(key)) delete prevBodies[key];
  });
  Object.keys(drafts).forEach((key) => {
    if (!modelByKey.has(key)) delete drafts[key];
    else if (drafts[key] === modelByKey.get(key)) delete drafts[key];
  });
}

/** 제작 폼·dirty 비교용 — 패널 textarea 초안을 각주 본문에 반영 */
export function footnotesForCreateForm() {
  harvestFnEdits();
  const drafts = fnDrafts();
  return readAllEditorMeta().footnotes.map((f) => {
    const key = draftKey(f.field, f.id);
    if (Object.prototype.hasOwnProperty.call(drafts, key)) {
      return { ...f, body: drafts[key] };
    }
    return { ...f };
  });
}

function fnEditValue(fn) {
  const key = draftKey(fn.field, fn.id);
  const drafts = fnDrafts();
  if (Object.prototype.hasOwnProperty.call(drafts, key)) return drafts[key];
  return fn.body || '';
}

function resetExpandState() {
  store._openFnIds = new Set();
  store._fnExpandKnown = new Set();
}

function ensureOpenDefaults(notes) {
  const open = openFnIds();
  const known = knownFnIds();
  notes.forEach((fn) => {
    if (!known.has(fn.id)) {
      open.add(fn.id);
      known.add(fn.id);
    }
  });
}

function chevronSvg(down) {
  const d = down
    ? 'M3.2 5.4 8 10.2 12.8 5.4 11.4 4 8 7.4 4.6 4z'
    : 'M3.2 10.6 8 5.8l4.8 4.8-1.4 1.4L8 8.6 4.6 12z';
  return `<svg class="notes-chevron${down ? ' is-down' : ''}" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path fill="currentColor" d="${d}"/></svg>`;
}

export function notesTab() {
  if (host() === 'create') {
    return store._createNotesTab === 'memo' ? 'memo' : 'notes';
  }
  return store.data?.ui?.studyNotesTab === 'memo' ? 'memo' : 'notes';
}

export function notesField() {
  if (host() === 'create') {
    return store._createNotesField === 'display' ? 'display' : 'explanation';
  }
  return store.data?.ui?.studyNotesField === 'explanation' ? 'explanation' : 'display';
}

export function resetCreateNotesDefaults() {
  store._createNotesTab = 'notes';
  store._createNotesField = 'explanation';
}

export function setNotesTab(tab) {
  harvestFnEdits();
  const next = tab === 'memo' ? 'memo' : 'notes';
  if (host() === 'create') {
    store._createNotesTab = next;
    renderNotesPanel();
    return;
  }
  if (!store.data?.ui) return;
  store.data.ui.studyNotesTab = next;
  persist();
  renderNotesPanel();
}

export function setNotesField(field) {
  harvestFnEdits();
  const next = field === 'explanation' ? 'explanation' : 'display';
  if (host() === 'create') {
    store._createNotesField = next;
    renderNotesPanel();
    return;
  }
  if (!store.data?.ui) return;
  if (store.data.ui.studyNotesField === next) {
    renderNotesPanel();
    return;
  }
  store.data.ui.studyNotesField = next;
  persist();
  renderNotesPanel();
}

export function toggleNotesPanel(force) {
  if (!store.data?.ui) return;
  if (host() !== 'study') return;
  const open = force == null ? !store.data.ui.studyNotesOpen : !!force;
  store.data.ui.studyNotesOpen = open;
  persist();
  document.body.classList.toggle('study-notes-collapsed', !open);
}

function visibleNotesHost() {
  const sec = store.currentSection;
  if (sec === 'create') return 'create';
  if (sec === 'study-play') return 'study';
  return '';
}

function flushCreateMemoFromPanel() {
  const memo = document.getElementById('notesMemo');
  const hidden = document.getElementById('cardMemo');
  if (memo && hidden && store._notesHost === 'create') hidden.value = memo.value;
}

export function placeNotesPanel(nextHost) {
  const wanted = nextHost === 'create' ? 'create' : 'study';
  const visible = visibleNotesHost();
  if (!visible || wanted !== visible) return;
  const panel = document.getElementById('notesPanel');
  const mount = document.getElementById(wanted === 'create' ? 'createNotesMount' : 'studyNotesMount');
  if (!panel || !mount) return;
  flushCreateMemoFromPanel();
  harvestFnEdits();
  store._notesHost = wanted;
  panel.dataset.notesHost = wanted;
  if (panel.parentElement !== mount) mount.appendChild(panel);
  document.body.classList.toggle('study-notes-collapsed', wanted === 'study' && store.data?.ui?.studyNotesOpen === false);
  const memo = document.getElementById('notesMemo');
  if (memo && document.activeElement !== memo) {
    if (wanted === 'create') memo.value = document.getElementById('cardMemo')?.value || '';
    else memo.value = store.studyQueue[store.studyIndex]?.memo || '';
  }
  renderNotesPanel();
}

export function renderNotesPanel() {
  const panel = document.getElementById('notesPanel');
  const list = document.getElementById('notesList');
  const memo = document.getElementById('notesMemo');
  if (!panel || !list) return;
  harvestFnEdits();
  reconcileFnDraftsWithModel();
  const activeEdit = document.activeElement?.getAttribute?.('data-fn-edit') || '';
  const selStart = activeEdit ? document.activeElement.selectionStart : 0;
  const selEnd = activeEdit ? document.activeElement.selectionEnd : 0;
  const tab = notesTab();
  const field = notesField();
  const createHost = host() === 'create';
  panel.querySelectorAll('[data-action="study-notes-tab"]').forEach((btn) => {
    const on = btn.dataset.tab === tab;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  panel.querySelectorAll('[data-action="notes-field-tab"]').forEach((btn) => {
    const on = btn.dataset.field === field;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  const notesBox = document.getElementById('notesBody');
  const memoBox = document.getElementById('notesMemoWrap');
  if (notesBox) notesBox.hidden = tab !== 'notes';
  if (memoBox) memoBox.hidden = tab !== 'memo';
  panel.querySelectorAll('[data-action="toggle-study-notes"]').forEach((btn) => {
    btn.hidden = createHost;
  });
  if (!createHost) {
    document.body.classList.toggle('study-notes-collapsed', store.data?.ui?.studyNotesOpen === false);
  }

  const notes = currentFootnotes().filter((fn) => fn.field === field).sort(compareFootnoteAnchors);
  const allNotes = currentFootnotes();
  const key = notesKey();
  if (store._notesKey !== key) {
    resetExpandState();
    store._fnEditDrafts = {};
  }
  ensureOpenDefaults(notes);

  if (!notes.length) {
    list.innerHTML = createHost
      ? '<div class="caption">이 칸에 각주가 없습니다. 본문을 선택하고 Alt+N.</div>'
      : '<div class="caption">이 칸에 각주가 없습니다. 제작 화면에서 선택 후 Alt+N.</div>';
  } else {
    const nums = footnoteNumbers(allNotes);
    const open = openFnIds();
    const allOpen = notes.every((fn) => open.has(fn.id));
    const allLabel = allOpen ? '각주 모두 접기' : '각주 모두 펼치기';
    const bar = `<div class="notes-fn-bar">
      <button type="button" class="ghost small notes-fn-all" data-action="toggle-all-notes-fn" title="${allLabel}" aria-label="${allLabel}" aria-pressed="${allOpen ? 'true' : 'false'}">${chevronSvg(!allOpen)}</button>
    </div>`;
    const items = notes.map((fn) => {
      const n = nums.get(fn.id) || '';
      const isOpen = open.has(fn.id);
      const src = fn.field === 'display' ? '문제' : '해설';
      const toggleLabel = isOpen ? `각주 ${n} 접기` : `각주 ${n} 펼치기`;
      let body = '';
      if (isOpen) {
        if (createHost) {
          body = `<div class="study-fn-body">
            <textarea class="sm notes-fn-edit" data-fn-edit="${escapeHtml(fn.id)}" data-fn-field="${escapeHtml(fn.field)}">${escapeHtml(fnEditValue(fn))}</textarea>
            <div class="toolbar notes-fn-actions">
              <button type="button" class="ghost small" data-action="save-note-fn" data-fn-id="${escapeHtml(fn.id)}" data-fn-field="${escapeHtml(fn.field)}">저장</button>
              <button type="button" class="danger small" data-action="delete-note-fn" data-fn-id="${escapeHtml(fn.id)}" data-fn-field="${escapeHtml(fn.field)}">삭제</button>
            </div>
          </div>`;
        } else {
          body = `<div class="study-fn-body">${escapeHtml(fn.body)}</div>`;
        }
      }
      return `<div class="study-fn-item${isOpen ? ' is-open' : ''}" data-note-id="${escapeHtml(fn.id)}" data-note-field="${escapeHtml(fn.field)}">
        <div class="study-fn-heading">
          <button type="button" class="ghost small study-fn-jump" data-action="jump-note-fn" data-fn-id="${escapeHtml(fn.id)}" data-fn-field="${escapeHtml(fn.field)}" title="각주 ${n} 위치로 이동">각주 ${n} · ${src}</button>
          <button type="button" class="ghost small study-fn-toggle" data-action="toggle-study-fn" data-fn-id="${escapeHtml(fn.id)}" title="${toggleLabel}" aria-label="${toggleLabel}" aria-expanded="${isOpen ? 'true' : 'false'}">${chevronSvg(isOpen)}</button>
        </div>
        ${body}
      </div>`;
    }).join('');
    list.innerHTML = bar + items;
  }

  if (memo && document.activeElement !== memo) {
    if (createHost) {
      if (store._notesKey !== key) memo.value = document.getElementById('cardMemo')?.value || '';
    } else {
      const c = store.studyQueue[store.studyIndex];
      if (store._notesKey !== key) memo.value = c?.memo || '';
    }
  }
  store._notesKey = key;
  if (activeEdit) {
    const ta = footnoteInput(activeEdit);
    if (ta) {
      ta.focus();
      try {
        const max = ta.value.length;
        ta.setSelectionRange(Math.min(selStart, max), Math.min(selEnd, max));
      } catch { /* ignore */ }
    }
  }
}

export function toggleNotesFootnote(fnId) {
  harvestFnEdits();
  if (!fnId) return;
  const open = openFnIds();
  if (open.has(fnId)) open.delete(fnId);
  else open.add(fnId);
  knownFnIds().add(fnId);
  const fn = currentFootnotes().find((f) => f.id === fnId);
  if (store.data?.ui) {
    if (host() === 'create') {
      store._createNotesTab = 'notes';
      if (fn?.field) store._createNotesField = fn.field === 'explanation' ? 'explanation' : 'display';
    } else {
      store.data.ui.studyNotesTab = 'notes';
      if (fn?.field) store.data.ui.studyNotesField = fn.field === 'explanation' ? 'explanation' : 'display';
      store.data.ui.studyNotesOpen = true;
    }
  }
  renderNotesPanel();
}

export function jumpToNoteFootnote(fnId, field) {
  const fn = findNoteFn(fnId, field);
  if (!fn) return;
  hideFootnoteHover();
  if (host() === 'create') {
    focusEditorFootnote(editorIdForFn(fn), fnId);
  } else {
    const root = document.getElementById(fn.field === 'display' ? 'studyPrompt' : 'studyExplanation');
    const marker = [...(root?.querySelectorAll('.tm-fn') || [])].find((n) => n.dataset.fnId === fnId);
    marker?.scrollIntoView({ block: 'center', inline: 'nearest' });
    marker?.focus({ preventScroll: true });
    pulseFootnote(marker);
  }
}

export function toggleAllNotesFootnotes() {
  harvestFnEdits();
  const field = notesField();
  const notes = currentFootnotes().filter((fn) => fn.field === field);
  if (!notes.length) return;
  const open = openFnIds();
  const allOpen = notes.every((fn) => open.has(fn.id));
  notes.forEach((fn) => {
    knownFnIds().add(fn.id);
    if (allOpen) open.delete(fn.id);
    else open.add(fn.id);
  });
  if (host() === 'create') store._createNotesTab = 'notes';
  else if (store.data?.ui) store.data.ui.studyNotesTab = 'notes';
  renderNotesPanel();
}

export function openNotesFootnote(fnId) {
  const all = currentFootnotes();
  const fn = all.find((f) => f.id === fnId);
  if (host() === 'study') {
    const c = store.studyQueue[store.studyIndex];
    if (c && !getOwnedCard(c.id)) return;
    if (c && !cardNotes(c).some((f) => f.id === fnId)) return;
    if (store.data?.ui) store.data.ui.studyNotesOpen = true;
    persist();
  } else if (!fn) {
    return;
  }
  harvestFnEdits();
  if (fnId) {
    openFnIds().add(fnId);
    knownFnIds().add(fnId);
  }
  if (host() === 'create') {
    store._createNotesTab = 'notes';
    if (fn?.field) store._createNotesField = fn.field === 'explanation' ? 'explanation' : 'display';
  } else if (store.data?.ui) {
    store.data.ui.studyNotesTab = 'notes';
    if (fn?.field) store.data.ui.studyNotesField = fn.field === 'explanation' ? 'explanation' : 'display';
  }
  renderNotesPanel();
  hideFootnoteHover();
  const item = [...document.querySelectorAll('#notesList [data-note-id]')]
    .find(n => n.dataset.noteId === fnId && n.dataset.noteField === fn?.field);
  item?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  pulseFootnote(item?.querySelector('.study-fn-heading') || item);
}

function findNoteFn(fnId, field) {
  const want = field === 'explanation' || field === 'display' ? field : notesField();
  return currentFootnotes().find((f) => f.id === fnId && f.field === want) || null;
}

const FN_DELETE_CONFIRM = '각주를 삭제하시겠습니까?';

export function saveNoteFootnote(fnId, field) {
  if (host() !== 'create') return false;
  harvestFnEdits();
  const fn = findNoteFn(fnId, field);
  if (!fn) return false;
  const key = draftKey(fn.field, fnId);
  const drafts = fnDrafts();
  const ta = footnoteInput(fnId, fn.field);
  const raw = ta ? ta.value : drafts[key];
  const body = String(raw ?? '').trim();
  const editorId = editorIdForFn(fn);
  if (!body) {
    if (!window.confirm(FN_DELETE_CONFIRM)) return false;
    clearFnDraft(fn.field, fnId);
    deleteFootnote(editorId, fnId);
    openFnIds().delete(fnId);
    knownFnIds().delete(fnId);
    renderNotesPanel();
    return true;
  }
  clearFnDraft(fn.field, fnId);
  updateFootnoteBody(editorId, fnId, body);
  renderNotesPanel();
  return true;
}

export function deleteNoteFootnote(fnId, field) {
  if (host() !== 'create') return false;
  harvestFnEdits();
  const fn = findNoteFn(fnId, field);
  if (!fn) return false;
  if (!window.confirm(FN_DELETE_CONFIRM)) return false;
  clearFnDraft(fn.field, fnId);
  deleteFootnote(editorIdForFn(fn), fnId);
  openFnIds().delete(fnId);
  knownFnIds().delete(fnId);
  renderNotesPanel();
  return true;
}

export function readNotesMemo() {
  flushCreateMemoFromPanel();
  if (host() === 'create' || visibleNotesHost() === 'create') {
    return document.getElementById('cardMemo')?.value || document.getElementById('notesMemo')?.value || '';
  }
  return document.getElementById('notesMemo')?.value || '';
}

export function writeNotesMemo(value) {
  const hidden = document.getElementById('cardMemo');
  if (hidden) hidden.value = value || '';
  if (host() !== 'create' || visibleNotesHost() !== 'create') return;
  const memo = document.getElementById('notesMemo');
  if (memo && document.activeElement !== memo) memo.value = value || '';
}

/** 관리·제작 미리보기 등 학습 큐와 다른 문맥의 각주 본문 */
export function openFootnoteReader(source, fnId) {
  const notes = cardNotes(source);
  const fn = notes.find((f) => f.id === fnId);
  if (!fn) return;
  const n = footnoteNumbers(notes).get(fn.id) || '';
  const root = document.getElementById('modalRoot');
  if (!root) return;
  root.innerHTML = `<div class="modal-backdrop" data-fn-reader>
    <div class="modal">
      <h3>각주 ${escapeHtml(String(n))}</h3>
      <div class="caption">${fn.field === 'display' ? '문제' : '해설'}</div>
      <div class="study-fn-body">${escapeHtml(fn.body)}</div>
      <div class="toolbar" style="margin-top:12px">
        <button type="button" class="ghost" data-action="close-modal">닫기</button>
      </div>
    </div>
  </div>`;
}

onEditorMetaChange(() => {
  if (host() === 'create' && document.getElementById('notesPanel')) renderNotesPanel();
});
