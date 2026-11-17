import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
// @vitest-environment jsdom
import { resolve } from 'node:path';
import { loadUniverseDataset, validateRepository, validateSafeUrl, sanitizeString } from '../src/data/loader';
import { GraphEngine } from '../src/graph/GraphEngine';
import { SearchEngine } from '../src/features/SearchEngine';
import { parseHashState, buildShareableUrl } from '../src/features/DeepLinks';
import type { UniverseDataset } from '../src/data/types';

function loadDiskDataset(): UniverseDataset {
  const root = resolve(process.cwd(), 'public/data');
  const repositories = JSON.parse(readFileSync(resolve(root, 'repositories.json'), 'utf-8'));
  const relationships = JSON.parse(readFileSync(resolve(root, 'relationships.json'), 'utf-8'));
  const trails = JSON.parse(readFileSync(resolve(root, 'trails.json'), 'utf-8'));
  const positions = JSON.parse(readFileSync(resolve(root, 'positions.json'), 'utf-8'));
  const metadata = JSON.parse(readFileSync(resolve(root, 'metadata.json'), 'utf-8'));
  return { repositories, relationships, trails, positions, metadata };
}

describe('ATLAS Data Integrity & Schema Validation', () => {
  it('loads valid verified repositories with non-empty categories and 3D coordinates', () => {
    const dataset = loadDiskDataset();
    expect(dataset.repositories.length).toBeGreaterThanOrEqual(16);

    const ids = new Set<string>();
    for (const repo of dataset.repositories) {
      const validated = validateRepository(repo);
      expect(validated).not.toBeNull();
      expect(ids.has(repo.id)).toBe(false);
      ids.add(repo.id);

      const pos = dataset.positions.repositories[repo.id];
      expect(pos).toBeDefined();
      expect(typeof pos.x).toBe('number');
      expect(typeof pos.y).toBe('number');
      expect(typeof pos.z).toBe('number');
    }
  });

  it('sanitizes XSS tags and rejects unsafe javascript: URLs', () => {
    expect(sanitizeString('<script>alert(1)</script>Agent8088')).toBe('alert(1)Agent8088');
    expect(validateSafeUrl('javascript:alert(1)')).toBeNull();
    expect(validateSafeUrl('https://github.com/block/goose')).toBe('https://github.com/block/goose');
  });
});

describe('ATLAS 3D Spatial Graph & Bilingual Search', () => {
  it('builds a connected 4-tier hierarchy from ATLAS core down to every repository', () => {
    const dataset = loadDiskDataset();
    const engine = new GraphEngine(dataset);

    expect(engine.nodes.has('atlas-core')).toBe(true);
    for (const repo of dataset.repositories) {
      const node = engine.nodes.get(`repo:${repo.id}`);
      expect(node).toBeDefined();
      expect(node?.parentId).toBe(`cat:${repo.category}`);
    }
  });

  it('supports Arabic and English fuzzy search across repository descriptions', () => {
    const repo = { ...loadDiskDataset().repositories[0], whatItDoes: 'ذاكرة طويلة المدى', name: 'TestEngine' };
    const search = new SearchEngine([repo]);
    expect(search.search('ذاكرة طويلة المدى')[0]?.id).toBe(repo.id);
    expect(search.search('TestEngine')[0]?.id).toBe(repo.id);
  });

  it('parses and serializes deep-link hash routes accurately', () => {
    const parsed = parseHashState('#repo=block__goose');
    expect(parsed.repoId).toBe('block__goose');

    const url = buildShareableUrl({ trailId: 'trail-isolated-infra' });
    expect(url).toContain('#trail=trail-isolated-infra');
  });
});

it.each(['network', 'invalid JSON', '404'])('loads repositories when optional data fails: %s', async failure => {
  const dataset = loadDiskDataset();
  vi.stubGlobal('fetch', async (url: string) => {
    const key = url.split('/').pop()!.replace('.json', '') as keyof UniverseDataset;
    if (key === 'relationships' || key === 'trails') {
      if (failure === 'network') throw new TypeError('Network error');
      return new Response('invalid', {status: failure === '404' ? 404 : 200});
    }
    return new Response(JSON.stringify(dataset[key]));
  });
  try {
    const result = await loadUniverseDataset('/atlas/');
    expect(result.repositories).toHaveLength(dataset.repositories.length);
    expect(result.relationships).toEqual([]);
    expect(result.trails).toEqual([]);
  } finally {
    vi.unstubAllGlobals();
  }
});
