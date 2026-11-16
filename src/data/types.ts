export type MacroDomainId =
  | 'Intelligence'
  | 'Infrastructure'
  | 'Engineering'
  | 'Perception'
  | 'Creative Systems'
  | 'Security'
  | 'Frontier Research';

export type RelationshipKind =
  | 'documented_integration'
  | 'documented_dependency'
  | 'functional_similarity'
  | 'shared_technology'
  | 'proposed_integration';

export interface RepositoryRecord {
  id: string;
  name: string;
  category: string;
  domain: MacroDomainId;
  whatItDoes: string;
  howItHelps: string;
  whyUnique: string;
  useCase: string;
  targetAudience: string;
  githubUrl: string | null;
  addedAt: string | null;
  sheetRow?: number;
}

export interface RelationshipRecord {
  id: string;
  source: string;
  target: string;
  kind: RelationshipKind;
  labelAr: string;
  labelEn: string;
  reasonAr: string;
  reasonEn: string;
  evidenceSource: string;
  verifiedAt: string | null;
}

export interface DiscoveryTrail {
  id: string;
  titleAr: string;
  titleEn: string;
  goalAr: string;
  goalEn: string;
  steps: {
    repoId: string;
    roleAr: string;
    roleEn: string;
  }[];
  compatibilityNoteAr: string;
  compatibilityNoteEn: string;
}

export interface Position3D {
  x: number;
  y: number;
  z: number;
}

export interface PositionsManifest {
  domains: Record<MacroDomainId, [number, number, number]>;
  categories: Record<string, Position3D & { domain: MacroDomainId }>;
  repositories: Record<string, Position3D & { category: string }>;
}

export interface UniverseMetadata {
  totalRepositories: number;
  totalCategories: number;
  lastSyncedAt: string;
  sourceSheet: string;
  featuredRepoId?: string;
  dataMode: 'live_sync' | 'snapshot_seed';
}

export interface UniverseDataset {
  repositories: RepositoryRecord[];
  relationships: RelationshipRecord[];
  trails: DiscoveryTrail[];
  positions: PositionsManifest;
  metadata: UniverseMetadata;
}

export type Lang = 'ar' | 'en';
export type ViewMode = '3d' | '2d' | 'list';
export type ZoomTier = 'universe' | 'domain' | 'constellation' | 'repository';
