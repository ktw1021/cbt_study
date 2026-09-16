import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setState, store } from '../js/core/store.js';
import { migrateCard, migrateState } from '../js/domain/migrate.js';
import {
  applyFolderImport,
  applyUsersImport,
  cardFingerprint,
  findDuplicates,
} from '../js/services/import-export.js';

function boot(userId = 'u1') {
  const state = migrateState({
    users: [{ id: userId, name: '테스터', pin: '1234', createdAt: '2020-01-01T00:00:00.000Z' }],
    folders: [{ id: 'f1', userId, name: '내폴더', parentId: null }],
    cards: [],
    activeUserId: userId,
  });
  setState(state);
  store.authenticatedUserId = userId;
  return state;
}

function sampleCard(overrides = {}) {
  return migrateCard({
    id: 'src-card',
    userId: 'src-user',
    folderId: 'src-folder',
    title: '반출카드',
    displayText: '문제 <원문> &',
    explanationText: '해설 [[BLANK1]] 끝',
    blanks: [{
      id: 'old-blank',
      order: 1,
      answer: '정답본문',
      aliases: ['동의1', '동의2'],
    }],
    memo: '메모원본',
    textMarks: {
      display: [{ type: 'bold', start: 0, end: 2 }],
      explanation: [{ type: 'hl', start: 0, end: 2 }],
    },
    footnotes: [
      { id: 'n1', field: 'display', start: 0, end: 2, body: '문제각주' },
      { id: 'n2', field: 'explanation', start: 0, end: 2, body: '해설각주' },
    ],
    ...overrides,
  });
}

test('folder import keeps marks/footnotes/aliases and remaps blank ids', () => {
  boot();
  const src = sampleCard();
  const payload = {
    format: 'cbt-blank-study',
    kind: 'folder',
    folderName: '공유폴더',
    folders: [{ id: 'src-folder', name: '공유폴더', parentId: null }],
    cards: [src],
  };
  const result = applyFolderImport(payload, { skipDuplicates: true });
  assert.equal(result.added, 1);
  const imported = store.data.cards[0];
  assert.notEqual(imported.id, src.id);
  assert.notEqual(imported.blanks[0].id, 'old-blank');
  assert.equal(imported.blanks[0].cardId, imported.id);
  assert.equal(imported.blanks[0].answer, src.blanks[0].answer);
  assert.deepEqual(imported.blanks[0].aliases, src.blanks[0].aliases);
  assert.deepEqual(imported.textMarks.display, src.textMarks.display);
  assert.deepEqual(imported.textMarks.explanation, src.textMarks.explanation);
  assert.equal(imported.footnotes.length, 2);
  assert.equal(imported.footnotes[0].body, '문제각주');
  assert.equal(imported.displayText, '문제 <원문> &');
});

test('duplicate policy: memo-only skip, footnotes differ keep, id-only duplicate', () => {
  const mine = sampleCard({ id: 'mine', userId: 'u1', folderId: 'f1' });
  boot();
  store.data.cards.push(mine);

  const memoOnly = sampleCard({ id: 'other', memo: '메모만다름' });
  assert.equal(cardFingerprint(mine), cardFingerprint(memoOnly));
  assert.equal(findDuplicates([memoOnly]).length, 1);
  const skipped = applyFolderImport({
    format: 'cbt-blank-study',
    kind: 'folder',
    folderName: '중복폴더',
    folders: [{ id: 'x', name: '중복폴더', parentId: null }],
    cards: [memoOnly],
  }, { skipDuplicates: true });
  assert.equal(skipped.added, 0);
  assert.equal(skipped.skipped, 1);

  const fnDiff = sampleCard({
    id: 'fn-diff',
    footnotes: [
      { id: 'n1', field: 'display', start: 0, end: 2, body: '다른각주' },
      { id: 'n2', field: 'explanation', start: 0, end: 2, body: '해설각주' },
    ],
  });
  assert.notEqual(cardFingerprint(mine), cardFingerprint(fnDiff));
  const added = applyFolderImport({
    format: 'cbt-blank-study',
    kind: 'folder',
    folderName: '각주폴더',
    folders: [{ id: 'y', name: '각주폴더', parentId: null }],
    cards: [fnDiff],
  }, { skipDuplicates: true });
  assert.equal(added.added, 1);

  const idOnly = sampleCard({ id: 'brand-new-id' });
  assert.equal(cardFingerprint(mine), cardFingerprint(idOnly));
});

test('user import remaps ids and keeps format metadata; current login unchanged', () => {
  boot('live');
  const liveName = store.data.users[0].name;
  const src = sampleCard({ userId: 'old-u', folderId: 'old-f' });
  const result = applyUsersImport({
    format: 'cbt-blank-study',
    kind: 'user',
    users: [{ id: 'old-u', name: '가져온유저', createdAt: '2020-01-01T00:00:00.000Z' }],
    folders: [{ id: 'old-f', userId: 'old-u', name: '가져온폴더', parentId: null }],
    cards: [src],
  });
  assert.equal(result.cards, 1);
  assert.equal(store.authenticatedUserId, 'live');
  assert.equal(store.data.users.find((u) => u.id === 'live').name, liveName);
  const imported = store.data.cards.find((c) => c.title === '반출카드');
  assert.ok(imported);
  assert.notEqual(imported.userId, 'old-u');
  assert.notEqual(imported.userId, 'live');
  assert.notEqual(imported.blanks[0].id, 'old-blank');
  assert.equal(imported.textMarks.display[0].type, 'bold');
  assert.equal(imported.footnotes.some((f) => f.body === '문제각주'), true);
  const newUser = store.data.users.find((u) => u.id === imported.userId);
  assert.equal(newUser.pin, null);
});

test('malformed/legacy migration keeps source text and drops invalid meta', () => {
  const card = migrateCard({
    originalText: '옛원문 <b>태그</b>',
    displayText: '표시원문',
    explanationText: '해설 [[BLANK1]]',
    blanks: [{ order: 1, answer: '답' }],
    textMarks: { display: [{ type: 'italic', start: 0, end: 2 }] },
    footnotes: [{ field: 'display', start: 99, end: 120, body: '범위밖' }],
    note: '구메모필드',
  });
  assert.equal(card.displayText, '표시원문');
  assert.equal(card.originalText.includes('옛원문'), true);
  assert.equal(card.displayText.includes('<b>'), false);
  assert.equal(card.textMarks.display.length, 0);
  assert.ok(card.footnotes.every((f) => f.start >= 0 && f.end <= card.displayText.length));
  assert.equal(card.memo, '구메모필드');
});
