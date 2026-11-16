import Graph from 'graphology';
import type {
  MacroDomainId,
  Position3D,
  RelationshipRecord,
  RepositoryRecord,
  UniverseDataset,
} from '../data/types';
import { MACRO_DOMAINS } from '../data/domains';

export interface SpatialNode {
  id: string;
  tier: 'core' | 'domain' | 'category' | 'repository';
  label: string;
  labelAr?: string;
  parentId: string | null;
  domain?: MacroDomainId;
  category?: string;
  targetPos: Position3D;
  anchorPos: Position3D;
  repo?: RepositoryRecord;
  childCount: number;
}

export interface SpatialEdge {
  id: string;
  source: string;
  target: string;
  tier: 'hierarchy' | 'relationship';
  relationship?: RelationshipRecord;
}

export class GraphEngine {
  public readonly graph: Graph;
  public readonly nodes = new Map<string, SpatialNode>();
  public readonly edges: SpatialEdge[] = [];
  public readonly reposById = new Map<string, RepositoryRecord>();
  public readonly relationshipsByRepo = new Map<string, RelationshipRecord[]>();

  constructor(dataset: UniverseDataset) {
    this.graph = new Graph({ multi: false, type: 'undirected' });
    this.build(dataset);
  }

  private build(dataset: UniverseDataset): void {
    // 1. Core node
    this.addNode({
      id: 'atlas-core',
      tier: 'core',
      label: 'ATLAS',
      labelAr: 'نواة أطلس',
      parentId: null,
      targetPos: { x: 0, y: 0, z: 0 },
      anchorPos: { x: 0, y: 0, z: 0 },
      childCount: Object.keys(MACRO_DOMAINS).length,
    });

    // Count categories and repos per domain
    const catsByDomain = new Map<MacroDomainId, Set<string>>();
    const reposByCat = new Map<string, RepositoryRecord[]>();

    for (const repo of dataset.repositories) {
      this.reposById.set(repo.id, repo);
      if (!catsByDomain.has(repo.domain)) catsByDomain.set(repo.domain, new Set());
      catsByDomain.get(repo.domain)!.add(repo.category);

      if (!reposByCat.has(repo.category)) reposByCat.set(repo.category, []);
      reposByCat.get(repo.category)!.push(repo);
    }

    // 2. Macro-Domains
    for (const [domKey, meta] of Object.entries(MACRO_DOMAINS)) {
      const domainId = domKey as MacroDomainId;
      const domNodeId = `dom:${domainId}`;
      const coords = dataset.positions.domains[domainId] ?? meta.defaultPos;
      const cats = catsByDomain.get(domainId);
      const count = cats ? cats.size : 0;

      this.addNode({
        id: domNodeId,
        tier: 'domain',
        label: meta.labelEn,
        labelAr: meta.labelAr,
        parentId: 'atlas-core',
        domain: domainId,
        targetPos: { x: coords[0], y: coords[1], z: coords[2] },
        anchorPos: { x: 0, y: 0, z: 0 },
        childCount: count,
      });

      this.edges.push({
        id: `edge:core->${domNodeId}`,
        source: 'atlas-core',
        target: domNodeId,
        tier: 'hierarchy',
      });
    }

    // 3. Categories
    for (const [category, repos] of reposByCat.entries()) {
      const domain = repos[0].domain;
      const domNodeId = `dom:${domain}`;
      const domNode = this.nodes.get(domNodeId)!;
      const catNodeId = `cat:${category}`;
      const savedCatPos = dataset.positions.categories[category];
      const targetPos: Position3D = savedCatPos
        ? { x: savedCatPos.x, y: savedCatPos.y, z: savedCatPos.z }
        : {
            x: domNode.targetPos.x + 8,
            y: domNode.targetPos.y + 4,
            z: domNode.targetPos.z + 4,
          };

      this.addNode({
        id: catNodeId,
        tier: 'category',
        label: category,
        parentId: domNodeId,
        domain,
        category,
        targetPos,
        anchorPos: { ...domNode.targetPos },
        childCount: repos.length,
      });

      this.edges.push({
        id: `edge:${domNodeId}->${catNodeId}`,
        source: domNodeId,
        target: catNodeId,
        tier: 'hierarchy',
      });

      // 4. Repositories
      repos.forEach((repo, index) => {
        const repoNodeId = `repo:${repo.id}`;
        const savedRepoPos = dataset.positions.repositories[repo.id];
        const rPos: Position3D = savedRepoPos
          ? { x: savedRepoPos.x, y: savedRepoPos.y, z: savedRepoPos.z }
          : this.computeFallbackSphereOffset(targetPos, index, repos.length, 7.2);

        this.addNode({
          id: repoNodeId,
          tier: 'repository',
          label: repo.name,
          parentId: catNodeId,
          domain,
          category,
          targetPos: rPos,
          anchorPos: { ...targetPos },
          repo,
          childCount: 0,
        });

        this.edges.push({
          id: `edge:${catNodeId}->${repoNodeId}`,
          source: catNodeId,
          target: repoNodeId,
          tier: 'hierarchy',
        });
      });
    }

    // 5. Cross-Repository Knowledge Relationships
    for (const rel of dataset.relationships) {
      const srcNodeId = `repo:${rel.source}`;
      const tgtNodeId = `repo:${rel.target}`;
      if (!this.nodes.has(srcNodeId) || !this.nodes.has(tgtNodeId)) continue;

      this.edges.push({
        id: `rel:${rel.id}`,
        source: srcNodeId,
        target: tgtNodeId,
        tier: 'relationship',
        relationship: rel,
      });

      if (!this.relationshipsByRepo.has(rel.source)) {
        this.relationshipsByRepo.set(rel.source, []);
      }
      if (!this.relationshipsByRepo.has(rel.target)) {
        this.relationshipsByRepo.set(rel.target, []);
      }
      this.relationshipsByRepo.get(rel.source)!.push(rel);
      this.relationshipsByRepo.get(rel.target)!.push(rel);
    }
  }

  private addNode(node: SpatialNode): void {
    this.nodes.set(node.id, node);
    if (!this.graph.hasNode(node.id)) {
      this.graph.addNode(node.id, node);
    }
  }

  private computeFallbackSphereOffset(
    center: Position3D,
    index: number,
    total: number,
    radius: number
  ): Position3D {
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const y = 1 - (index / Math.max(total - 1, 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = goldenAngle * index;
    return {
      x: Number((center.x + Math.cos(theta) * r * radius).toFixed(3)),
      y: Number((center.y + y * radius).toFixed(3)),
      z: Number((center.z + Math.sin(theta) * r * radius).toFixed(3)),
    };
  }
}
