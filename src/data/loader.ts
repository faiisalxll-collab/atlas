import type {
  PositionsManifest,
  RelationshipRecord,
  RepositoryRecord,
  UniverseDataset,
  UniverseMetadata,
  DiscoveryTrail,
} from './types';
import { resolveDomain } from './domains';

export function sanitizeString(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/<[^>]*>/g, '').trim();
}

export function validateSafeUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

export function validateRepository(raw: unknown): RepositoryRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = sanitizeString(r.id);
  const name = sanitizeString(r.name);
  const category = sanitizeString(r.category);
  if (!id || !name || !category) return null;

  const addedRaw = sanitizeString(r.addedAt);
  const addedAt = /^\d{4}-\d{2}-\d{2}$/.test(addedRaw) ? addedRaw : null;

  return {
    id,
    name,
    category,
    domain: resolveDomain(category),
    whatItDoes: sanitizeString(r.whatItDoes),
    howItHelps: sanitizeString(r.howItHelps),
    whyUnique: sanitizeString(r.whyUnique),
    useCase: sanitizeString(r.useCase),
    targetAudience: sanitizeString(r.targetAudience),
    githubUrl: validateSafeUrl(r.githubUrl),
    addedAt,
    sheetRow: typeof r.sheetRow === 'number' ? r.sheetRow : undefined,
  };
}

export async function loadUniverseDataset(basePath = import.meta.env.BASE_URL): Promise<UniverseDataset> {
  const prefix = basePath.endsWith('/') ? basePath : `${basePath}/`;

  const [reposRes, relsRes, trailsRes, posRes, metaRes] = await Promise.all([
    fetch(`${prefix}data/repositories.json`),
    fetch(`${prefix}data/relationships.json`),
    fetch(`${prefix}data/trails.json`),
    fetch(`${prefix}data/positions.json`),
    fetch(`${prefix}data/metadata.json`),
  ]);

  if (!reposRes.ok || !posRes.ok || !metaRes.ok) {
    throw new Error(`Failed to load ATLAS universe data (HTTP ${reposRes.status})`);
  }

  const rawRepos = (await reposRes.json()) as unknown[];
  const rawRels = relsRes.ok ? ((await relsRes.json()) as RelationshipRecord[]) : [];
  const rawTrails = trailsRes.ok ? ((await trailsRes.json()) as DiscoveryTrail[]) : [];
  const positions = (await posRes.json()) as PositionsManifest;
  const metadata = (await metaRes.json()) as UniverseMetadata;

  if (!Array.isArray(rawRepos)) {
    throw new Error('Invalid repositories.json schema: expected array.');
  }

  const seen = new Set<string>();
  const repositories: RepositoryRecord[] = [];
  for (const item of rawRepos) {
    const validated = validateRepository(item);
    if (validated && !seen.has(validated.id)) {
      seen.add(validated.id);
      repositories.push(validated);
    }
  }

  if (repositories.length === 0) {
    throw new Error('No valid repository records found in dataset.');
  }

  const validRepoIds = new Set(repositories.map((r) => r.id));
  const relationships = (Array.isArray(rawRels) ? rawRels : []).filter(
    (rel) => validRepoIds.has(rel.source) && validRepoIds.has(rel.target)
  );

  const trails = (Array.isArray(rawTrails) ? rawTrails : [])
    .map((trail) => ({
      ...trail,
      steps: trail.steps.filter((s) => validRepoIds.has(s.repoId)),
    }))
    .filter((trail) => trail.steps.length >= 2);

  return {
    repositories,
    relationships,
    trails,
    positions,
    metadata,
  };
}
