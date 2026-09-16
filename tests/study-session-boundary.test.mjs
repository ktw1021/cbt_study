import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setState, store } from '../js/core/store.js';
import { migrateState } from '../js/domain/migrate.js';
import { getPersistedStudySession } from '../js/services/study-session.js';

function bootLegacyStudySession() {
  const state = migrateState({
    users: [
      { id: 'uA', name: 'A', pin: '1111', createdAt: '2020-01-01T00:00:00.000Z' },
      { id: 'uB', name: 'B', pin: '2222', createdAt: '2020-01-01T00:00:00.000Z' },
    ],
    folders: [],
    cards: [
      {
        id: 'cA', userId: 'uA', title: 'A카드',
        displayText: '문제', explanationText: '해설 [[BLANK1]]',
        blanks: [{ id: 'bA', order: 1, answer: '답A' }],
      },
      {
        id: 'cB', userId: 'uB', title: 'B카드',
        displayText: '문제', explanationText: '해설 [[BLANK1]]',
        blanks: [{ id: 'bB', order: 1, answer: '답B' }],
      },
    ],
    activeUserId: 'uA',
    ui: {
      studySession: {
        cardIds: ['cA'],
        index: 0,
        cardProgress: {
          cA: {
            blankStatuses: [{ order: 1, checked: true, correct: true, user: '답A' }],
            attemptRecorded: true,
            roundRecorded: false,
          },
        },
      },
    },
  });
  setState(state);
  store.authenticatedUserId = 'uA';
  return state;
}

test('legacy ui.studySession migrates to the active user only', () => {
  const state = bootLegacyStudySession();
  const aSess = state.ui.studySessions?.uA;
  assert.ok(aSess?.cardIds?.includes('cA'));
  assert.equal(aSess.cardProgress.cA.attemptRecorded, true);
  assert.equal(state.ui.studySessions?.uB, undefined);
});

test('account B does not inherit leftover ui.studySession from A', () => {
  bootLegacyStudySession();
  store.authenticatedUserId = 'uB';
  store.data.activeUserId = 'uB';
  const bSess = getPersistedStudySession();
  assert.equal(bSess, null);
  assert.equal(store.data.ui.studySessions?.uB, undefined);
  assert.ok(store.data.ui.studySessions?.uA?.cardIds?.includes('cA'));
});

test('with leftover studySession cleared, switch keeps A and does not create B', () => {
  bootLegacyStudySession();
  store.data.ui.studySession = null;
  const aBefore = JSON.stringify(store.data.ui.studySessions.uA);
  store.authenticatedUserId = 'uB';
  store.data.activeUserId = 'uB';
  store.studyQueue = [];
  assert.equal(getPersistedStudySession(), null);
  assert.equal(JSON.stringify(store.data.ui.studySessions.uA), aBefore);
  store.authenticatedUserId = 'uA';
  store.data.activeUserId = 'uA';
  const again = getPersistedStudySession();
  assert.ok(again?.cardIds?.includes('cA'));
  assert.equal(JSON.stringify(store.data.ui.studySessions.uA), aBefore);
});
