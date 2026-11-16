import type {
  DiscoveryTrail,
  Lang,
  MacroDomainId,
  RepositoryRecord,
  UniverseDataset,
  ViewMode,
  ZoomTier,
} from '../data/types';
import { GraphEngine, type SpatialNode } from '../graph/GraphEngine';
import { UniverseScene } from '../scene/UniverseScene';
import { SearchEngine } from '../features/SearchEngine';
import { buildShareableUrl, parseHashState, updateHashState } from '../features/DeepLinks';

export class AtlasApp {
  private dataset: UniverseDataset;
  private graphEngine: GraphEngine;
  private searchEngine: SearchEngine;
  private scene: UniverseScene | null = null;

  private lang: Lang = 'ar';
  private viewMode: ViewMode = '3d';
  private selectedRepo: RepositoryRecord | null = null;
  private activeDomain: MacroDomainId | null = null;
  private activeCategory: string | null = null;
  private activeTrail: DiscoveryTrail | null = null;
  private trailStepIndex = 0;
  private showConnections = false;
  private recentFilterDays: number | null = null;
  private hudVisible = true;
  private zoomTier: ZoomTier = 'universe';

  private hudRoot: HTMLElement;
  private fallbackRoot: HTMLElement;

  constructor(dataset: UniverseDataset) {
    this.dataset = dataset;
    this.graphEngine = new GraphEngine(dataset);
    this.searchEngine = new SearchEngine(dataset.repositories);
    this.hudRoot = document.getElementById('hud-root')!;
    this.fallbackRoot = document.getElementById('fallback-root')!;

    this.initSceneOrFallback();
    this.renderHud();
    this.applyInitialDeepLink();
    this.bindGlobalShortcuts();
  }

  private initSceneOrFallback(): void {
    const canvas = document.getElementById('universe-canvas') as HTMLCanvasElement | null;
    const labelsLayer = document.getElementById('labels-layer');

    if (canvas && labelsLayer && UniverseScene.isWebGLAvailable()) {
      this.scene = new UniverseScene(canvas, labelsLayer, this.graphEngine, {
        onSelectNode: (node) => this.handleNodeSelected(node),
        onDeselect: () => this.clearSelection(),
        onCameraZoomTierChange: (tier) => {
          this.zoomTier = tier;
        },
      });
      this.scene.setLanguage(this.lang);
    } else {
      // Automatic accessible fallback when WebGL is unavailable
      this.viewMode = 'list';
    }
  }

  private applyInitialDeepLink(): void {
    const state = parseHashState();
    if (state.repoId && this.graphEngine.reposById.has(state.repoId)) {
      const repo = this.graphEngine.reposById.get(state.repoId)!;
      this.selectRepository(repo, false);
    } else if (state.trailId) {
      const trail = this.dataset.trails.find((t) => t.id === state.trailId);
      if (trail) this.activateTrail(trail, false);
    } else if (state.category) {
      this.activeCategory = state.category;
      this.scene?.expandCategory(state.category, true);
      this.renderHud();
    } else if (state.domainId) {
      this.activeDomain = state.domainId as MacroDomainId;
      this.scene?.expandDomain(this.activeDomain, true);
      this.renderHud();
    }
  }

  private bindGlobalShortcuts(): void {
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const input = document.getElementById('atlas-search-input') as HTMLInputElement | null;
        input?.focus();
      } else if (e.key === 'Escape') {
        if (this.selectedRepo) {
          this.clearSelection();
        }
      }
    });

    window.addEventListener('popstate', () => {
      this.applyInitialDeepLink();
    });
  }

  private handleNodeSelected(node: SpatialNode): void {
    if (node.tier === 'domain' && node.domain) {
      this.activeDomain = node.domain;
      this.activeCategory = null;
      this.selectedRepo = null;
      updateHashState({ domainId: node.domain });
    } else if (node.tier === 'category' && node.category) {
      this.activeDomain = node.domain ?? null;
      this.activeCategory = node.category;
      this.selectedRepo = null;
      updateHashState({ category: node.category });
    } else if (node.tier === 'repository' && node.repo) {
      this.selectRepository(node.repo, true);
      return;
    }
    this.renderHud();
  }

  public selectRepository(repo: RepositoryRecord, pushHistory = true): void {
    this.selectedRepo = repo;
    this.activeDomain = repo.domain;
    this.activeCategory = repo.category;
    this.scene?.focusRepository(repo.id, true);
    if (pushHistory) {
      updateHashState({ repoId: repo.id });
    }
    this.renderHud();
  }

  public clearSelection(): void {
    this.selectedRepo = null;
    updateHashState({});
    this.renderHud();
  }

  public activateTrail(trail: DiscoveryTrail | null, pushHistory = true): void {
    this.activeTrail = trail;
    this.trailStepIndex = 0;
    if (!trail) {
      this.scene?.setActiveTrail([]);
      if (pushHistory) updateHashState({});
      this.renderHud();
      return;
    }

    const repoIds = trail.steps.map((s) => s.repoId);
    this.scene?.setActiveTrail(repoIds);
    const firstRepo = this.graphEngine.reposById.get(repoIds[0]);
    if (firstRepo) {
      this.selectedRepo = firstRepo;
      this.activeDomain = firstRepo.domain;
      this.activeCategory = firstRepo.category;
    }
    if (pushHistory) {
      updateHashState({ trailId: trail.id });
    }
    this.renderHud();
  }

  private renderHud(): void {
    const isAr = this.lang === 'ar';
    document.documentElement.lang = isAr ? 'ar' : 'en';
    document.documentElement.dir = isAr ? 'rtl' : 'ltr';

    const totalCount = this.dataset.repositories.length;
    const syncDate = this.dataset.metadata.lastSyncedAt.slice(0, 10);

    this.hudRoot.innerHTML = `
      <header class="atlas-topbar" role="banner">
        <div class="atlas-brand">
          <span class="atlas-logo-dot"></span>
          <span class="atlas-title">ATLAS</span>
          <span class="atlas-badge">${totalCount} ${isAr ? 'مستودع' : 'Stars'}</span>
          <span class="atlas-badge" title="Last Sync">${syncDate}</span>
        </div>

        <div class="atlas-search-wrap">
          <input
            id="atlas-search-input"
            class="atlas-search-input"
            type="search"
            autocomplete="off"
            placeholder="${isAr ? 'ابحث في المستودعات أو المجالات... (⌘K)' : 'Search repositories or domains... (⌘K)'}"
            aria-label="${isAr ? 'بحث' : 'Search'}"
          />
          <div id="atlas-search-dropdown" class="atlas-search-results" hidden></div>
        </div>

        <div class="atlas-actions">
          <button type="button" class="atlas-btn ${this.recentFilterDays === 7 ? 'is-active' : ''}" id="btn-new-stars">
            ${isAr ? '✨ أحدث الإضافات (7 أيام)' : '✨ New Stars (7d)'}
          </button>
          <button type="button" class="atlas-btn ${this.viewMode === '3d' ? 'is-active' : ''}" id="btn-view-3d">3D</button>
          <button type="button" class="atlas-btn ${this.viewMode === 'list' ? 'is-active' : ''}" id="btn-view-list">
            ${isAr ? 'القائمة' : 'List'}
          </button>
          <button type="button" class="atlas-btn" id="btn-toggle-lang">
            ${isAr ? 'EN' : 'عربي'}
          </button>
        </div>
      </header>

      ${
        this.hudVisible
          ? `
      <div class="atlas-subbar">
        <nav class="atlas-breadcrumb" aria-label="Breadcrumb">
          <button type="button" class="atlas-crumb-btn" id="crumb-root">ATLAS</button>
          ${this.activeDomain ? `<span>/</span><button type="button" class="atlas-crumb-btn" id="crumb-domain">${this.activeDomain}</button>` : ''}
          ${this.activeCategory ? `<span>/</span><button type="button" class="atlas-crumb-btn" id="crumb-category">${this.activeCategory}</button>` : ''}
          ${this.selectedRepo ? `<span>/</span><span class="atlas-crumb-btn current">${this.selectedRepo.name}</span>` : ''}
        </nav>

        <div class="atlas-trails-bar">
          <label for="trail-select" style="color: var(--accent-sand); font-weight: 600;">
            ${isAr ? 'مسارات الاستكشاف:' : 'Discovery Trails:'}
          </label>
          <select id="trail-select" class="atlas-btn" style="background: #050608;">
            <option value="">${isAr ? '— اختر مسارًا معرفيًا —' : '— Select a Trail —'}</option>
            ${this.dataset.trails
              .map(
                (t) =>
                  `<option value="${t.id}" ${this.activeTrail?.id === t.id ? 'selected' : ''}>${
                    isAr ? t.titleAr : t.titleEn
                  }</option>`
              )
              .join('')}
          </select>
        </div>
      </div>
      `
          : ''
      }

      ${this.renderInspectorHtml(isAr)}
      ${this.viewMode === 'list' ? this.renderListViewHtml(isAr) : ''}

      <div class="atlas-controls-dock" role="toolbar" aria-label="Universe Controls">
        <button type="button" class="atlas-btn" id="ctrl-zoom-in" title="Zoom In">+</button>
        <button type="button" class="atlas-btn" id="ctrl-zoom-out" title="Zoom Out">−</button>
        <button type="button" class="atlas-btn" id="ctrl-reset">${isAr ? 'إعادة الضبط' : 'Reset'}</button>
        <button type="button" class="atlas-btn" id="ctrl-expand-all">${isAr ? 'توسيع الكل' : 'Expand All'}</button>
        <button type="button" class="atlas-btn" id="ctrl-collapse-all">${isAr ? 'طي الكل' : 'Collapse All'}</button>
        <button type="button" class="atlas-btn ${this.showConnections ? 'is-active' : ''}" id="ctrl-connections">
          ${isAr ? 'العلاقات' : 'Connections'}
        </button>
        <button type="button" class="atlas-btn" id="ctrl-toggle-hud">
          ${this.hudVisible ? (isAr ? 'إخفاء الواجهة' : 'Focus Mode') : isAr ? 'إظهار الواجهة' : 'Show HUD'}
        </button>
      </div>
    `;

    this.attachHudListeners();
  }

  private renderInspectorHtml(isAr: boolean): string {
    if (!this.selectedRepo) return '';
    const r = this.selectedRepo;
    const rels = this.graphEngine.relationshipsByRepo.get(r.id) ?? [];

    return `
      <aside class="atlas-inspector" role="dialog" aria-label="${r.name}">
        <div class="atlas-inspector-header">
          <div>
            <span class="atlas-badge">${r.domain} / ${r.category}</span>
            <h2 style="font-size: 18px; margin-top: 6px; font-family: var(--font-mono);">${r.name}</h2>
            ${
              r.addedAt
                ? `<small style="color: var(--text-secondary);">${isAr ? 'تاريخ الإضافة:' : 'Added:'} ${r.addedAt}</small>`
                : ''
            }
          </div>
          <button type="button" class="atlas-btn" id="btn-close-inspector" aria-label="Close">✕</button>
        </div>

        <div class="atlas-inspector-body">
          ${
            this.activeTrail
              ? `
            <div class="atlas-rel-card" style="border-color: var(--accent-sand);">
              <span class="atlas-rel-badge">${isAr ? 'محطة ضمن المسار' : 'Trail Station'} (${this.trailStepIndex + 1}/${this.activeTrail.steps.length})</span>
              <p>${isAr ? this.activeTrail.steps[this.trailStepIndex]?.roleAr : this.activeTrail.steps[this.trailStepIndex]?.roleEn}</p>
              <small style="color: var(--text-secondary);">${isAr ? this.activeTrail.compatibilityNoteAr : this.activeTrail.compatibilityNoteEn}</small>
              <div style="display:flex; gap:6px; margin-top:6px;">
                <button type="button" class="atlas-btn" id="btn-trail-prev" ${this.trailStepIndex === 0 ? 'disabled' : ''}>${isAr ? 'السابق' : 'Prev'}</button>
                <button type="button" class="atlas-btn" id="btn-trail-next" ${this.trailStepIndex >= this.activeTrail.steps.length - 1 ? 'disabled' : ''}>${isAr ? 'المحطة التالية' : 'Next'}</button>
              </div>
            </div>
          `
              : ''
          }

          ${r.whatItDoes ? `<div class="atlas-field-block"><h4>${isAr ? 'وش يسوي؟' : 'What it does'}</h4><p>${r.whatItDoes}</p></div>` : ''}
          ${r.howItHelps ? `<div class="atlas-field-block"><h4>${isAr ? 'وش يفيدك؟' : 'How it helps'}</h4><p>${r.howItHelps}</p></div>` : ''}
          ${r.whyUnique ? `<div class="atlas-field-block"><h4>${isAr ? 'ليش مميز؟' : 'Why it is unique'}</h4><p>${r.whyUnique}</p></div>` : ''}
          ${r.useCase ? `<div class="atlas-field-block"><h4>${isAr ? 'مثال استخدام' : 'Use Case'}</h4><p>${r.useCase}</p></div>` : ''}
          ${r.targetAudience ? `<div class="atlas-field-block"><h4>${isAr ? 'لمن يفيد؟' : 'Target Audience'}</h4><p>${r.targetAudience}</p></div>` : ''}

          ${
            rels.length > 0
              ? `
            <div class="atlas-field-block">
              <h4>${isAr ? 'العلاقات المعرفية المرتبطة' : 'Knowledge Relationships'} (${rels.length})</h4>
              <div style="display:flex; flex-direction:column; gap:8px; margin-top:6px;">
                ${rels
                  .map((rel) => {
                    const peerId = rel.source === r.id ? rel.target : rel.source;
                    const peer = this.graphEngine.reposById.get(peerId);
                    return `
                      <div class="atlas-rel-card">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                          <strong>${peer?.name ?? peerId}</strong>
                          <span class="atlas-rel-badge">${isAr ? rel.labelAr : rel.labelEn}</span>
                        </div>
                        <p style="font-size:12px; color:var(--text-secondary);">${isAr ? rel.reasonAr : rel.reasonEn}</p>
                        <small style="color:var(--text-muted);">${isAr ? 'المصدر:' : 'Evidence:'} ${rel.evidenceSource}</small>
                      </div>
                    `;
                  })
                  .join('')}
              </div>
            </div>
          `
              : ''
          }
        </div>

        <div class="atlas-inspector-footer">
          ${
            r.githubUrl
              ? `<a class="atlas-primary-link" href="${r.githubUrl}" target="_blank" rel="noopener noreferrer">Open GitHub ↗</a>`
              : ''
          }
          <button type="button" class="atlas-btn" id="btn-copy-link">${isAr ? 'نسخ الرابط المباشر' : 'Copy Link'}</button>
          <button type="button" class="atlas-btn" id="btn-back-cat">${isAr ? 'العودة للتصنيف' : 'Back to Category'}</button>
        </div>
      </aside>
    `;
  }

  private renderListViewHtml(isAr: boolean): string {
    const items = this.recentFilterDays
      ? this.searchEngine.getRecentStars(this.recentFilterDays, this.dataset.metadata.lastSyncedAt.slice(0, 10))
      : this.dataset.repositories;

    return `
      <section class="atlas-listview-overlay" aria-label="Repositories Directory">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h3>${isAr ? 'فهرس المكتبة الكامل' : 'Complete Repository Directory'} (${items.length})</h3>
          ${
            !this.scene
              ? `<span class="atlas-badge">${isAr ? 'وضع القائمة التلقائي (WebGL غير متاح)' : 'Accessible List Mode'}</span>`
              : ''
          }
        </div>
        <div class="atlas-list-grid">
          ${items
            .map(
              (repo) => `
            <article class="atlas-list-card" data-repo-id="${repo.id}">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <strong style="font-family:var(--font-mono);">${repo.name}</strong>
                <span class="atlas-badge">${repo.category}</span>
              </div>
              <p style="font-size:12.5px; color:var(--text-secondary);">${repo.whatItDoes}</p>
              ${repo.addedAt ? `<small style="color:var(--text-muted);">${repo.addedAt}</small>` : ''}
            </article>
          `
            )
            .join('')}
        </div>
      </section>
    `;
  }

  private attachHudListeners(): void {
    const searchInput = document.getElementById('atlas-search-input') as HTMLInputElement | null;
    const dropdown = document.getElementById('atlas-search-dropdown');

    searchInput?.addEventListener('input', () => {
      const q = searchInput.value;
      if (!q.trim() || !dropdown) {
        if (dropdown) dropdown.hidden = true;
        this.scene?.setHighlightedRepos([]);
        return;
      }
      const hits = this.searchEngine.search(q, 12);
      this.scene?.setHighlightedRepos(hits.map((h) => h.id));
      dropdown.hidden = false;
      dropdown.innerHTML =
        hits.length === 0
          ? `<div class="atlas-search-item"><small>${this.lang === 'ar' ? 'لا توجد نتائج مطابقة' : 'No matching repositories'}</small></div>`
          : hits
              .map(
                (item) => `
              <button type="button" class="atlas-search-item" data-hit-id="${item.id}">
                <strong>${item.name}</strong>
                <small>${item.domain} · ${item.category}</small>
              </button>
            `
              )
              .join('');

      dropdown.querySelectorAll<HTMLButtonElement>('[data-hit-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const repo = this.graphEngine.reposById.get(btn.dataset.hitId!);
          if (repo) {
            dropdown.hidden = true;
            this.selectRepository(repo, true);
          }
        });
      });
    });

    document.getElementById('btn-toggle-lang')?.addEventListener('click', () => {
      this.lang = this.lang === 'ar' ? 'en' : 'ar';
      this.scene?.setLanguage(this.lang);
      this.renderHud();
    });

    document.getElementById('btn-view-3d')?.addEventListener('click', () => {
      this.viewMode = '3d';
      this.renderHud();
    });

    document.getElementById('btn-view-list')?.addEventListener('click', () => {
      this.viewMode = 'list';
      this.renderHud();
    });

    document.getElementById('btn-new-stars')?.addEventListener('click', () => {
      this.recentFilterDays = this.recentFilterDays === 7 ? null : 7;
      if (this.recentFilterDays) {
        const recent = this.searchEngine.getRecentStars(
          7,
          this.dataset.metadata.lastSyncedAt.slice(0, 10)
        );
        this.scene?.setHighlightedRepos(recent.map((r) => r.id));
      } else {
        this.scene?.setHighlightedRepos([]);
      }
      this.renderHud();
    });

    document.getElementById('crumb-root')?.addEventListener('click', () => {
      this.activeDomain = null;
      this.activeCategory = null;
      this.selectedRepo = null;
      this.scene?.collapseAll();
      updateHashState({});
      this.renderHud();
    });

    document.getElementById('crumb-domain')?.addEventListener('click', () => {
      if (this.activeDomain) {
        this.activeCategory = null;
        this.selectedRepo = null;
        this.scene?.expandDomain(this.activeDomain, true);
        updateHashState({ domainId: this.activeDomain });
        this.renderHud();
      }
    });

    document.getElementById('crumb-category')?.addEventListener('click', () => {
      if (this.activeCategory) {
        this.selectedRepo = null;
        this.scene?.expandCategory(this.activeCategory, true);
        updateHashState({ category: this.activeCategory });
        this.renderHud();
      }
    });

    const trailSelect = document.getElementById('trail-select') as HTMLSelectElement | null;
    trailSelect?.addEventListener('change', () => {
      const chosen = this.dataset.trails.find((t) => t.id === trailSelect.value) ?? null;
      this.activateTrail(chosen, true);
    });

    document.getElementById('btn-trail-prev')?.addEventListener('click', () => {
      if (this.activeTrail && this.trailStepIndex > 0) {
        this.trailStepIndex--;
        const repo = this.graphEngine.reposById.get(this.activeTrail.steps[this.trailStepIndex].repoId);
        if (repo) this.selectRepository(repo, false);
      }
    });

    document.getElementById('btn-trail-next')?.addEventListener('click', () => {
      if (this.activeTrail && this.trailStepIndex < this.activeTrail.steps.length - 1) {
        this.trailStepIndex++;
        const repo = this.graphEngine.reposById.get(this.activeTrail.steps[this.trailStepIndex].repoId);
        if (repo) this.selectRepository(repo, false);
      }
    });

    document.getElementById('btn-close-inspector')?.addEventListener('click', () => {
      this.clearSelection();
    });

    document.getElementById('btn-copy-link')?.addEventListener('click', async () => {
      if (!this.selectedRepo) return;
      const url = buildShareableUrl({ repoId: this.selectedRepo.id });
      await navigator.clipboard?.writeText(url);
      const btn = document.getElementById('btn-copy-link');
      if (btn) btn.textContent = this.lang === 'ar' ? '✓ تم النسخ' : '✓ Copied';
    });

    document.getElementById('btn-back-cat')?.addEventListener('click', () => {
      if (this.selectedRepo) {
        const cat = this.selectedRepo.category;
        this.selectedRepo = null;
        this.scene?.expandCategory(cat, true);
        this.renderHud();
      }
    });

    document.getElementById('ctrl-zoom-in')?.addEventListener('click', () => this.scene?.zoomStep(0.75));
    document.getElementById('ctrl-zoom-out')?.addEventListener('click', () => this.scene?.zoomStep(1.3));
    document.getElementById('ctrl-reset')?.addEventListener('click', () => this.scene?.resetCamera());
    document.getElementById('ctrl-expand-all')?.addEventListener('click', () => this.scene?.expandAll());
    document.getElementById('ctrl-collapse-all')?.addEventListener('click', () => {
      this.activeDomain = null;
      this.activeCategory = null;
      this.selectedRepo = null;
      this.scene?.collapseAll();
      this.renderHud();
    });

    document.getElementById('ctrl-connections')?.addEventListener('click', () => {
      this.showConnections = !this.showConnections;
      this.scene?.setShowAllConnections(this.showConnections);
      this.renderHud();
    });

    document.getElementById('ctrl-toggle-hud')?.addEventListener('click', () => {
      this.hudVisible = !this.hudVisible;
      this.renderHud();
    });

    document.querySelectorAll<HTMLElement>('.atlas-list-card[data-repo-id]').forEach((card) => {
      card.addEventListener('click', () => {
        const repo = this.graphEngine.reposById.get(card.dataset.repoId!);
        if (repo) {
          this.viewMode = '3d';
          this.selectRepository(repo, true);
        }
      });
    });
  }
}
