import { store } from '../core/store.js';

/** URL → 화면 매핑 (#/manage, #/create, #/create/:id, #/study, #/study/play/:index) */
export function parseRoute() {
  const raw = (location.hash.slice(1) || '/manage').replace(/^\//, '');
  const parts = raw.split('/').filter(Boolean);
  const root = parts[0] || 'manage';

  if (root === 'manage') return { page: 'manage' };
  if (root === 'create') return { page: 'create', cardId: parts[1] || null };
  if (root === 'study') {
    if (parts[1] === 'play') return { page: 'study-play', index: Number(parts[2] || 0) };
    return { page: 'study' };
  }
  return { page: 'manage' };
}

/** hash 변경 (뒤로가기 지원) */
export function navigate(path, { replace = false } = {}) {
  const hash = path.startsWith('#') ? path : `#/${path.replace(/^\//, '')}`;
  const current = location.hash || '#/manage';
  if (current === hash) return;
  if (replace) history.replaceState({ route: hash }, '', hash);
  else history.pushState({ route: hash }, '', hash);
}

export function routeToPath(page, extra = {}) {
  if (page === 'manage') return '/manage';
  if (page === 'create') return extra.cardId ? `/create/${extra.cardId}` : '/create';
  if (page === 'study') return '/study';
  if (page === 'study-play') return `/study/play/${extra.index ?? store.studyIndex ?? 0}`;
  return '/manage';
}

export function syncUrl(page, extra = {}, replace = false) {
  navigate(routeToPath(page, extra), { replace });
}
