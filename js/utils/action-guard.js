/**
 * data-action 클릭 — 동일 작업이 겹쳐 실행되지 않도록 (저장 더블클릭 등)
 * 대상이 다른 클릭(다른 폴더·카드)은 막지 않도록 키를 나눈다.
 */
const inflight = new Set();

/** 버튼마다 별도 잠금이 필요한 액션 */
const TARGET_SCOPED = new Set([
  'select-folder',
  'select-card',
  'edit-card',
  'study-one',
  'delete-card',
  'pick-flag',
  'filter-flag',
  'pick-study-flag',
  'focus-blank',
  'toggle-tree',
  'rename-folder',
  'delete-folder',
  'jump-blank',
  'remove-blank-order',
]);

export function actionGuardKey(action, el) {
  if (!TARGET_SCOPED.has(action)) return action;
  const tag = [
    el?.dataset?.id,
    el?.dataset?.flag,
    el?.dataset?.order,
    el?.dataset?.parent,
  ].find((v) => v != null && v !== '');
  return tag != null ? `${action}:${tag}` : action;
}

export function runGuardedClick(key, fn) {
  if (inflight.has(key)) return;
  inflight.add(key);
  let result;
  try {
    result = fn();
  } catch (err) {
    inflight.delete(key);
    throw err;
  }
  const done = () => { inflight.delete(key); };
  if (result && typeof result.then === 'function') {
    result.then(done, done);
  } else {
    done();
  }
}
