import { test } from 'node:test';
import assert from 'node:assert/strict';
import { store, setState } from '../js/core/store.js';
import { reconcileEditedCardProgress } from '../js/services/study-session.js';

const old = [
  { id: 'a', order: 1, answer: '정답', aliases: [] },
  { id: 'b', order: 2, answer: '둘째', aliases: [] },
];
function setup() {
  const statuses = [
    { order: 1, user: '정답', checked: true, correct: true, score: 100 },
    { order: 2, user: '입력중', checked: false, correct: false, score: 0 },
  ];
  const progress = { blankStatuses: structuredClone(statuses), focus: 2, attemptRecorded: true, roundRecorded: false };
  setState({ users: [{ id: 'u' }], activeUserId: 'u', ui: { studySessions: { u: { cardIds: ['c'], cardProgress: { c: progress } } } } });
  store.authenticatedUserId = 'u'; store._studyCardId = 'c';
  store.currentBlankStatuses = statuses; store.currentBlankFocus = 2;
  return progress;
}

test('editing reorders/adds blanks by id while keeping inputs and attempt guards', () => {
  const progress = setup();
  reconcileEditedCardProgress('c', old, [{ ...old[1], order: 1 }, { id: 'new', order: 2, answer: '새답' }, { ...old[0], order: 3 }]);
  assert.deepEqual(store.currentBlankStatuses.map(s => s.user), ['입력중', '', '정답']);
  assert.deepEqual(progress.blankStatuses, store.currentBlankStatuses);
  assert.equal(progress.focus, 1);
  assert.equal(store.currentBlankFocus, 1);
  assert.equal(progress.attemptRecorded, true);
  assert.equal(progress.roundRecorded, false);
  assert.equal(store.currentBlankStatuses[2].correct, true);
});

test('removed/changed answers cannot retain obsolete grading or focus', () => {
  const progress = setup();
  reconcileEditedCardProgress('c', old, [{ ...old[0], answer: '변경' }]);
  assert.equal(progress.blankStatuses.length, 1);
  assert.equal(progress.blankStatuses[0].checked, false);
  assert.equal(progress.blankStatuses[0].user, '');
  assert.equal(progress.focus, null);
});
