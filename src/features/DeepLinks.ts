export interface DeepLinkState {
  repoId?: string;
  domainId?: string;
  category?: string;
  trailId?: string;
}

export function parseHashState(hashStr = window.location.hash): DeepLinkState {
  const clean = hashStr.replace(/^#/, '').trim();
  if (!clean) return {};
  const params = new URLSearchParams(clean);
  const state: DeepLinkState = {};
  const repo = params.get('repo');
  const domain = params.get('domain');
  const category = params.get('category');
  const trail = params.get('trail');

  if (repo) state.repoId = repo;
  if (domain) state.domainId = domain;
  if (category) state.category = category;
  if (trail) state.trailId = trail;
  return state;
}

export function updateHashState(state: DeepLinkState, pushHistory = true): void {
  const params = new URLSearchParams();
  if (state.repoId) params.set('repo', state.repoId);
  if (state.domainId) params.set('domain', state.domainId);
  if (state.category) params.set('category', state.category);
  if (state.trailId) params.set('trail', state.trailId);

  const serialized = params.toString();
  const nextHash = serialized ? `#${serialized}` : window.location.pathname + window.location.search;
  if (pushHistory) {
    window.history.pushState(state, '', nextHash);
  } else {
    window.history.replaceState(state, '', nextHash);
  }
}

export function buildShareableUrl(state: DeepLinkState): string {
  const url = new URL(window.location.href);
  const params = new URLSearchParams();
  if (state.repoId) params.set('repo', state.repoId);
  if (state.domainId) params.set('domain', state.domainId);
  if (state.category) params.set('category', state.category);
  if (state.trailId) params.set('trail', state.trailId);
  url.hash = params.toString();
  return url.toString();
}
