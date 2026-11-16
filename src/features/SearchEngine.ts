import Fuse from 'fuse.js';
import type { RepositoryRecord } from '../data/types';

export class SearchEngine {
  private fuse: Fuse<RepositoryRecord>;
  private allRepos: RepositoryRecord[];

  constructor(repositories: RepositoryRecord[]) {
    this.allRepos = repositories;
    this.fuse = new Fuse(repositories, {
      includeScore: true,
      threshold: 0.36,
      ignoreLocation: true,
      minMatchCharLength: 2,
      keys: [
        { name: 'name', weight: 3.0 },
        { name: 'category', weight: 2.0 },
        { name: 'domain', weight: 1.2 },
        { name: 'whatItDoes', weight: 1.8 },
        { name: 'howItHelps', weight: 1.5 },
        { name: 'whyUnique', weight: 1.3 },
        { name: 'useCase', weight: 1.1 },
        { name: 'targetAudience', weight: 1.0 },
      ],
    });
  }

  public search(query: string, limit = 20): RepositoryRecord[] {
    const trimmed = query.trim();
    if (!trimmed) return [];
    return this.fuse.search(trimmed, { limit }).map((res) => res.item);
  }

  public getRecentStars(days: number, referenceDateStr?: string): RepositoryRecord[] {
    const refTime = referenceDateStr
      ? new Date(`${referenceDateStr}T23:59:59Z`).getTime()
      : Date.now();
    const cutoff = refTime - days * 24 * 60 * 60 * 1000;

    return this.allRepos
      .filter((repo) => {
        if (!repo.addedAt) return false;
        const ts = new Date(`${repo.addedAt}T00:00:00Z`).getTime();
        return !Number.isNaN(ts) && ts >= cutoff;
      })
      .sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? ''));
  }
}
