import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { GraphEngine, SpatialNode } from '../graph/GraphEngine';
import type { Lang, MacroDomainId, Position3D } from '../data/types';

export interface SceneCallbacks {
  onSelectNode: (node: SpatialNode) => void;
  onDeselect: () => void;
  onCameraZoomTierChange: (tier: 'universe' | 'domain' | 'constellation' | 'repository') => void;
}

interface AnimatedNodeState {
  node: SpatialNode;
  currentPos: THREE.Vector3;
  goalPos: THREE.Vector3;
  currentScale: number;
  goalScale: number;
  visible: boolean;
}

export class UniverseScene {
  private canvas: HTMLCanvasElement;
  private labelsLayer: HTMLElement;
  private graphEngine: GraphEngine;
  private callbacks: SceneCallbacks;

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;

  // Instanced meshes for high scalability (1000+ stars in single draw call)
  private nearStars = new THREE.IcosahedronGeometry(0.52, 1);
  private distantStars = new THREE.IcosahedronGeometry(0.52, 0);
  private starInstancedMesh!: THREE.InstancedMesh;
  private domainMeshes = new Map<string, THREE.Mesh>();
  private categoryMeshes = new Map<string, THREE.Mesh>();
  private coreGroup!: THREE.Group;

  // Edge line segments
  private hierarchyLines!: THREE.LineSegments;
  private hierarchyGeometry!: THREE.BufferGeometry;
  private relationshipLines!: THREE.LineSegments;
  private relationshipGeometry!: THREE.BufferGeometry;

  // Synaptic pulse particles for active trail / relationships
  private pulsePoints!: THREE.Points;
  private pulseGeometry!: THREE.BufferGeometry;
  private activeTrailPairs: Array<[THREE.Vector3, THREE.Vector3]> = [];

  // Node indexing & animation state
  private nodeStates = new Map<string, AnimatedNodeState>();
  private repoIdOrder: string[] = [];
  private instanceIdToRepoNode = new Map<number, SpatialNode>();
  private labelOrder: string[] = [];
  private labelElements = new Map<string, HTMLButtonElement>();

  // Expansion & selection state
  private expandedDomains = new Set<string>();
  private expandedCategories = new Set<string>();
  private selectedNodeId: string | null = null;
  private highlightedRepoIds = new Set<string>();
  private activeTrailRepoIds: string[] = [];
  private showAllConnections = false;

  // Camera smooth interpolation
  private camGoalPos: THREE.Vector3 | null = null;
  private camGoalTarget: THREE.Vector3 | null = null;
  private prefersReducedMotion = false;

  // Raycasting & pointer tracking
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private overviewFraming = true;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private resizeObserver = new ResizeObserver(() => this.onResize());
  private tapPointer: number | null = null;
  private pointerDownPos = { x: 0, y: 0 };
  private active = true;
  private rafId: number | null = null;
  private clock = new THREE.Clock();
  private lastZoomTier: 'universe' | 'domain' | 'constellation' | 'repository' = 'universe';

  // Reusable math helpers
  private dummy = new THREE.Object3D();
  private tempColor = new THREE.Color();
  private projVec = new THREE.Vector3();

  constructor(
    canvas: HTMLCanvasElement,
    labelsLayer: HTMLElement,
    graphEngine: GraphEngine,
    callbacks: SceneCallbacks
  ) {
    this.canvas = canvas;
    this.labelsLayer = labelsLayer;
    this.graphEngine = graphEngine;
    this.callbacks = callbacks;
    this.prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.initThree();
    this.buildVisualObjects();
    this.bindEvents();
    this.recomputeVisibilityGoals();
    this.startLoop();
  }

  private initThree(): void {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x050608, 1);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x050608, 0.0028);

    this.camera = new THREE.PerspectiveCamera(
      48,
      1,
      0.1,
      600
    );
    this.onResize();
    this.camera.position.set(0, 26, this.overviewDistance());

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.rotateSpeed = 0.72;
    this.controls.zoomSpeed = 0.85;
    this.controls.panSpeed = 0.75;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 210;
    this.controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };

    // Cancel automatic camera flight when user manually interacts
    this.controls.addEventListener('start', () => {
      this.overviewFraming = false;
      this.camGoalPos = null;
      this.camGoalTarget = null;
    });

    // Subtle deep-space ambient dust (static buffer points)
    const dustCount = 450;
    const dustPos = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      const r = 70 + ((i * 73) % 130);
      const theta = i * 2.39996;
      const phi = Math.acos(1 - (2 * ((i + 0.5) / dustCount)));
      dustPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      dustPos[i * 3 + 1] = r * Math.cos(phi);
      dustPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    const dustMat = new THREE.PointsMaterial({
      color: 0xf6f5f1,
      size: 0.25,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
    });
    this.scene.add(new THREE.Points(dustGeo, dustMat));
  }

  private buildVisualObjects(): void {
    // 1. ATLAS Core Geometry
    this.coreGroup = new THREE.Group();
    const coreSphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.55, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0xfff2d8, fog: false })
    );
    const ringGeo = new THREE.RingGeometry(2.45, 2.65, 64);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xc6b79b,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.35,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = Math.PI / 2.3;
    const haloCanvas = document.createElement('canvas');
    haloCanvas.width = haloCanvas.height = 64;
    const ctx = haloCanvas.getContext('2d');
    if (ctx) {
      const light = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      light.addColorStop(0, 'rgba(255,235,192,.85)');
      light.addColorStop(.25, 'rgba(249,206,144,.46)');
      light.addColorStop(.6, 'rgba(207,159,98,.12)');
      light.addColorStop(1, 'rgba(207,159,98,0)');
      ctx.fillStyle = light;
      ctx.fillRect(0, 0, 64, 64);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(haloCanvas), blending: THREE.AdditiveBlending,
        depthWrite: false, fog: false
      }));
      halo.scale.setScalar(12);
      this.coreGroup.add(halo);
    }
    this.coreGroup.add(coreSphere, ringMesh);
    this.scene.add(this.coreGroup);

    const coreNode = this.graphEngine.nodes.get('atlas-core')!;
    this.nodeStates.set('atlas-core', {
      node: coreNode,
      currentPos: new THREE.Vector3(0, 0, 0),
      goalPos: new THREE.Vector3(0, 0, 0),
      currentScale: 1,
      goalScale: 1,
      visible: true,
    });

    // 2. Domain Nodes & Category Nodes
    const domGeo = new THREE.OctahedronGeometry(1.05, 1);
    const catGeo = new THREE.OctahedronGeometry(0.62, 0);

    for (const node of this.graphEngine.nodes.values()) {
      if (node.tier === 'domain') {
        const mat = new THREE.MeshBasicMaterial({
          color: 0xf6f5f1,
          transparent: true,
          opacity: 0.92,
        });
        const mesh = new THREE.Mesh(domGeo, mat);
        mesh.position.set(node.targetPos.x, node.targetPos.y, node.targetPos.z);
        mesh.userData = { nodeId: node.id };
        this.scene.add(mesh);
        this.domainMeshes.set(node.id, mesh);

        this.nodeStates.set(node.id, {
          node,
          currentPos: new THREE.Vector3(node.targetPos.x, node.targetPos.y, node.targetPos.z),
          goalPos: new THREE.Vector3(node.targetPos.x, node.targetPos.y, node.targetPos.z),
          currentScale: 1,
          goalScale: 1,
          visible: true,
        });
        this.createLabelElement(node);
      } else if (node.tier === 'category') {
        const mat = new THREE.MeshBasicMaterial({
          color: 0xc6b79b,
          wireframe: true,
          transparent: true,
          opacity: 0.85,
        });
        const mesh = new THREE.Mesh(catGeo, mat);
        mesh.position.set(node.anchorPos.x, node.anchorPos.y, node.anchorPos.z);
        mesh.scale.setScalar(0.001);
        mesh.userData = { nodeId: node.id };
        this.scene.add(mesh);
        this.categoryMeshes.set(node.id, mesh);

        this.nodeStates.set(node.id, {
          node,
          currentPos: new THREE.Vector3(node.anchorPos.x, node.anchorPos.y, node.anchorPos.z),
          goalPos: new THREE.Vector3(node.anchorPos.x, node.anchorPos.y, node.anchorPos.z),
          currentScale: 0.001,
          goalScale: 0.001,
          visible: false,
        });
        this.createLabelElement(node);
      } else if (node.tier === 'repository') {
        this.repoIdOrder.push(node.id);
        this.nodeStates.set(node.id, {
          node,
          currentPos: new THREE.Vector3(node.anchorPos.x, node.anchorPos.y, node.anchorPos.z),
          goalPos: new THREE.Vector3(node.anchorPos.x, node.anchorPos.y, node.anchorPos.z),
          currentScale: 0.001,
          goalScale: 0.001,
          visible: false,
        });
      }
    }

    // 3. InstancedMesh for Repository Stars (Single Draw Call)
    const starMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.starInstancedMesh = new THREE.InstancedMesh(
      this.nearStars,
      starMat,
      Math.max(this.repoIdOrder.length, 1)
    );
    this.starInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    this.starInstancedMesh.count = 0;
    // Bound all interpolated centers for both culling and ray picking.
    const bounds = new THREE.Box3();
    for (const node of this.graphEngine.nodes.values()) {
      for (const p of [node.anchorPos, node.targetPos]) bounds.expandByPoint(new THREE.Vector3(p.x, p.y, p.z));
    }
    this.starInstancedMesh.boundingSphere = bounds.expandByScalar(3).getBoundingSphere(new THREE.Sphere());
    this.scene.add(this.starInstancedMesh);

    // 4. Hierarchy Lines Buffer
    const hierarchyEdges = this.graphEngine.edges.filter((e) => e.tier === 'hierarchy');
    this.hierarchyGeometry = new THREE.BufferGeometry();
    this.hierarchyGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(hierarchyEdges.length * 6), 3)
    );
    this.hierarchyLines = new THREE.LineSegments(
      this.hierarchyGeometry,
      new THREE.LineBasicMaterial({
        color: 0xf6f5f1,
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
      })
    );
    this.hierarchyLines.frustumCulled = false;
    this.scene.add(this.hierarchyLines);

    // 5. Cross-Repository Relationship Lines Buffer
    const relEdges = this.graphEngine.edges.filter((e) => e.tier === 'relationship');
    this.relationshipGeometry = new THREE.BufferGeometry();
    this.relationshipGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(Math.max(relEdges.length, 1) * 6), 3)
    );
    this.relationshipLines = new THREE.LineSegments(
      this.relationshipGeometry,
      new THREE.LineBasicMaterial({
        color: 0xc6b79b,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      })
    );
    this.relationshipLines.frustumCulled = false;
    this.scene.add(this.relationshipLines);

    // 6. Synaptic Pulse Particles for Discovery Trails & Active Links
    this.pulseGeometry = new THREE.BufferGeometry();
    this.pulseGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(60 * 3), 3)
    );
    this.pulsePoints = new THREE.Points(
      this.pulseGeometry,
      new THREE.PointsMaterial({
        color: 0xc6b79b,
        size: 0.65,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      })
    );
    this.pulsePoints.frustumCulled = false;
    this.scene.add(this.pulsePoints);
  }

  private createLabelElement(node: SpatialNode): void {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.display = 'none';
    btn.className = `atlas-3d-label tier-${node.tier}`;
    btn.dataset.nodeId = node.id;
    btn.textContent = node.label;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleNodeActivation(node);
    });
    this.labelsLayer.appendChild(btn);
    this.labelElements.set(node.id, btn);
  }

  public setLanguage(lang: Lang): void {
    for (const [id, el] of this.labelElements.entries()) {
      const node = this.graphEngine.nodes.get(id);
      if (!node) continue;
      if (node.tier === 'domain') {
        el.textContent = lang === 'ar' && node.labelAr ? node.labelAr : node.label;
      } else if (node.tier === 'category') {
        el.textContent = `${node.label} (${node.childCount})`;
      } else {
        el.textContent = node.label;
      }
    }
  }

  public expandDomain(domainId: MacroDomainId, flyTo = true): void {
    const domNodeId = `dom:${domainId}`;
    this.expandedDomains.add(domNodeId);
    this.recomputeVisibilityGoals();
    const node = this.graphEngine.nodes.get(domNodeId);
    if (node && flyTo) {
      this.flyToPosition(node.targetPos, 38);
    }
  }

  public expandCategory(category: string, flyTo = true): void {
    const catNodeId = `cat:${category}`;
    const catNode = this.graphEngine.nodes.get(catNodeId);
    if (!catNode) return;
    if (catNode.parentId) {
      this.expandedDomains.add(catNode.parentId);
    }
    this.expandedCategories.add(catNodeId);
    this.recomputeVisibilityGoals();
    if (flyTo) {
      this.flyToPosition(catNode.targetPos, 24);
    }
  }

  public focusRepository(repoId: string, flyTo = true): void {
    const repoNodeId = `repo:${repoId}`;
    const repoNode = this.graphEngine.nodes.get(repoNodeId);
    if (!repoNode) return;

    if (repoNode.domain) this.expandedDomains.add(`dom:${repoNode.domain}`);
    if (repoNode.category) this.expandedCategories.add(`cat:${repoNode.category}`);
    this.selectedNodeId = repoNodeId;
    this.recomputeVisibilityGoals();

    if (flyTo) {
      this.flyToPosition(repoNode.targetPos, 14);
    }
  }

  public expandAll(): void {
    for (const node of this.graphEngine.nodes.values()) {
      if (node.tier === 'domain') this.expandedDomains.add(node.id);
      if (node.tier === 'category') this.expandedCategories.add(node.id);
    }
    this.recomputeVisibilityGoals();
  }

  public collapseAll(): void {
    this.expandedDomains.clear();
    this.expandedCategories.clear();
    this.selectedNodeId = null;
    this.recomputeVisibilityGoals();
    this.resetCamera();
  }

  public setHighlightedRepos(repoIds: string[]): void {
    this.highlightedRepoIds = new Set(repoIds);
    if (repoIds.length > 0) {
      for (const rid of repoIds) {
        const repo = this.graphEngine.reposById.get(rid);
        if (repo) {
          this.expandedDomains.add(`dom:${repo.domain}`);
          this.expandedCategories.add(`cat:${repo.category}`);
        }
      }
    }
    this.recomputeVisibilityGoals();
  }

  public setActiveTrail(repoIds: string[]): void {
    this.activeTrailRepoIds = repoIds;
    this.setHighlightedRepos(repoIds);
    if (repoIds.length > 0) {
      this.focusRepository(repoIds[0], true);
    }
  }

  public setShowAllConnections(enabled: boolean): void {
    this.showAllConnections = enabled;
    if (enabled) {
      this.expandAll();
    }
  }

  private overviewDistance(): number {
    return Math.min(200, 98 / Math.min(1, this.camera.aspect));
  }

  public resetCamera(): void {
    this.flyToPosition({ x: 0, y: 0, z: 0 }, this.overviewDistance());
    this.overviewFraming = true;
  }

  public zoomStep(deltaFactor: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const nextDist = THREE.MathUtils.clamp(
      offset.length() * deltaFactor,
      this.controls.minDistance,
      this.controls.maxDistance
    );
    this.flyToPosition(this.controls.target, nextDist);
  }

  public flyToPosition(target: Position3D, distance: number): void {
    this.overviewFraming = false;
    const goalT = new THREE.Vector3(target.x, target.y, target.z);
    const dir = this.camera.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 0.001) dir.set(0, 0.3, 1);
    dir.normalize();
    const goalP = goalT.clone().addScaledVector(dir, distance);

    if (this.prefersReducedMotion) {
      this.controls.target.copy(goalT);
      this.camera.position.copy(goalP);
      this.controls.update();
      return;
    }

    this.camGoalTarget = goalT;
    this.camGoalPos = goalP;
  }

  private recomputeVisibilityGoals(): void {
    for (const [id, state] of this.nodeStates.entries()) {
      const node = state.node;
      if (node.tier === 'core' || node.tier === 'domain') {
        state.visible = true;
        state.goalPos.set(node.targetPos.x, node.targetPos.y, node.targetPos.z);
        state.goalScale = 1;
      } else if (node.tier === 'category') {
        const isOpen = node.parentId ? this.expandedDomains.has(node.parentId) : false;
        state.visible = isOpen;
        if (isOpen) {
          state.goalPos.set(node.targetPos.x, node.targetPos.y, node.targetPos.z);
          state.goalScale = 1;
        } else {
          state.goalPos.set(node.anchorPos.x, node.anchorPos.y, node.anchorPos.z);
          state.goalScale = 0.001;
        }
      } else if (node.tier === 'repository') {
        const isOpen = node.parentId ? this.expandedCategories.has(node.parentId) : false;
        state.visible = isOpen;
        if (isOpen) {
          state.goalPos.set(node.targetPos.x, node.targetPos.y, node.targetPos.z);
          if (!this.labelElements.has(id)) this.createLabelElement(node);
          const isSelected = this.selectedNodeId === id;
          const isHighlighted =
            this.highlightedRepoIds.size > 0 && node.repo && this.highlightedRepoIds.has(node.repo.id);
          state.goalScale = isSelected ? 1.85 : isHighlighted ? 1.45 : 1.0;
        } else {
          state.goalPos.set(node.anchorPos.x, node.anchorPos.y, node.anchorPos.z);
          state.goalScale = 0.001;
        }
      }
    }
    const priority = (id: string): number => id === this.selectedNodeId ? 0 :
      id.startsWith('dom:') ? 1 : id.startsWith('cat:') ? 2 : 3;
    this.labelOrder = [];
    for (const [id, el] of this.labelElements) {
      if (this.nodeStates.get(id)?.visible) this.labelOrder.push(id);
      else el.style.display = 'none';
    }
    this.labelOrder.sort((a, b) => priority(a) - priority(b));
  }

  private handleNodeActivation(node: SpatialNode): void {
    if (node.tier === 'core') {
      this.collapseAll();
      this.callbacks.onDeselect();
      return;
    }
    if (node.tier === 'domain') {
      if (this.expandedDomains.has(node.id)) {
        this.expandedDomains.delete(node.id);
        for (const catNode of this.graphEngine.nodes.values()) {
          if (catNode.tier === 'category' && catNode.parentId === node.id) {
            this.expandedCategories.delete(catNode.id);
          }
        }
        this.recomputeVisibilityGoals();
      } else {
        this.expandDomain(node.domain!, true);
      }
      this.callbacks.onSelectNode(node);
      return;
    }
    if (node.tier === 'category') {
      if (this.expandedCategories.has(node.id)) {
        this.expandedCategories.delete(node.id);
        this.recomputeVisibilityGoals();
      } else {
        this.expandCategory(node.category!, true);
      }
      this.callbacks.onSelectNode(node);
      return;
    }
    if (node.tier === 'repository' && node.repo) {
      this.focusRepository(node.repo.id, true);
      this.callbacks.onSelectNode(node);
    }
  }

  private bindEvents(): void {
    this.resizeObserver.observe(this.canvas);
    window.visualViewport?.addEventListener('resize', this.onResize);
    window.addEventListener('resize', this.onResize);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
  }

  private onResize = (): void => {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (!width || !height) return;
    const ratio = Math.min(devicePixelRatio || 1, 2, Math.sqrt(2_000_000 / (width * height)), 4096 / Math.max(width, height));
    if (width === this.viewportWidth && height === this.viewportHeight && ratio === this.renderer.getPixelRatio()) return;
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.renderer.setDrawingBufferSize(width, height, ratio);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.controls && this.overviewFraming) {
      // Mobile WebKit can report the initial layout viewport before the CSS viewport settles.
      this.camGoalPos = null;
      this.camGoalTarget = null;
      this.controls.target.set(0, 0, 0);
      this.camera.position.set(0, 26, this.overviewDistance());
      this.controls.update();
    }
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.tapPointer = e.isPrimary ? e.pointerId : null;
    this.pointerDownPos = { x: e.clientX, y: e.clientY };
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.tapPointer !== e.pointerId) return;
    this.tapPointer = null;
    const moveDist = Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y);
    if (moveDist > 6) return; // Ignore drag orbit gestures

    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    // 1. Check Instanced Stars first
    const starHits = this.raycaster.intersectObject(this.starInstancedMesh);
    if (starHits.length > 0 && starHits[0].instanceId !== undefined) {
      const hitNode = this.instanceIdToRepoNode.get(starHits[0].instanceId);
      const st = hitNode ? this.nodeStates.get(hitNode.id) : undefined;
      if (hitNode && st && st.visible) {
        this.handleNodeActivation(hitNode);
        return;
      }
    }

    // At overview distances a rendered star can be smaller than a fingertip.
    // Resolve a near miss against visible instance centers in CSS pixels.
    if (e.pointerType === 'touch') {
      let closest: SpatialNode | undefined;
      let radius = 11;
      for (let i = 0; i < this.starInstancedMesh.count; i++) {
        const node = this.instanceIdToRepoNode.get(i)!;
        const state = this.nodeStates.get(node.id)!;
        if (!state.visible) continue;
        this.projVec.copy(state.currentPos).project(this.camera);
        if (Math.abs(this.projVec.z) > 1) continue;
        const distance = Math.hypot((this.projVec.x - this.pointer.x) * rect.width / 2,
          (this.projVec.y - this.pointer.y) * rect.height / 2);
        if (distance < radius) {
          radius = distance;
          closest = node;
        }
      }
      if (closest) {
        this.handleNodeActivation(closest);
        return;
      }
    }

    // 2. Check Domain and Category meshes
    const interactiveMeshes: THREE.Object3D[] = [
      ...this.domainMeshes.values(),
      ...this.categoryMeshes.values(),
    ];
    const meshHits = this.raycaster.intersectObjects(interactiveMeshes, false);
    if (meshHits.length > 0) {
      const nodeId = meshHits[0].object.userData.nodeId as string | undefined;
      const node = nodeId ? this.graphEngine.nodes.get(nodeId) : undefined;
      const st = node ? this.nodeStates.get(node.id) : undefined;
      if (node && st && st.visible) {
        this.handleNodeActivation(node);
        return;
      }
    }
  };

  public setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    this.labelsLayer.hidden = !active;
    if (active) {
      this.clock.start();
      this.startLoop();
    } else if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private startLoop(): void {
    const tick = (): void => {
      this.rafId = requestAnimationFrame(tick);
      const dt = Math.min(this.clock.getDelta(), 0.05);
      const elapsed = this.clock.getElapsedTime();

      this.updateCameraFlight(dt);
      this.controls.update();
      this.updateNodeAnimations(dt);
      this.updateLinesAndPulses(this.prefersReducedMotion ? 0 : elapsed);
      this.updateProjectedLabels();
      this.updateSemanticZoomTier();

      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }

  private updateCameraFlight(dt: number): void {
    if (!this.camGoalPos || !this.camGoalTarget) return;
    const alpha = 1 - Math.exp(-5.2 * dt);
    this.camera.position.lerp(this.camGoalPos, alpha);
    this.controls.target.lerp(this.camGoalTarget, alpha);

    if (
      this.camera.position.distanceTo(this.camGoalPos) < 0.08 &&
      this.controls.target.distanceTo(this.camGoalTarget) < 0.08
    ) {
      this.camera.position.copy(this.camGoalPos);
      this.controls.target.copy(this.camGoalTarget);
      this.camGoalPos = null;
      this.camGoalTarget = null;
    }
  }

  private updateNodeAnimations(dt: number): void {
    const lerpSpeed = this.prefersReducedMotion ? 1 : 1 - Math.exp(-8.5 * dt);

    for (const [id, st] of this.nodeStates.entries()) {
      st.currentPos.lerp(st.goalPos, lerpSpeed);
      st.currentScale += (st.goalScale - st.currentScale) * lerpSpeed;

      if (st.node.tier === 'domain') {
        const mesh = this.domainMeshes.get(id);
        if (mesh) {
          mesh.position.copy(st.currentPos);
          if (!this.prefersReducedMotion) mesh.rotation.y += dt * 0.22;
        }
      } else if (st.node.tier === 'category') {
        const mesh = this.categoryMeshes.get(id);
        if (mesh) {
          mesh.position.copy(st.currentPos);
          mesh.scale.setScalar(Math.max(st.currentScale, 0.001));
          mesh.visible = st.currentScale > 0.02;
          if (!this.prefersReducedMotion) mesh.rotation.y -= dt * 0.35;
        }
      }
    }

    // Update InstancedMesh matrices & colors
    let needsMatrixUpdate = false;
    let needsColorUpdate = false;
    const hasFilter = this.highlightedRepoIds.size > 0;

    let count = 0;
    this.repoIdOrder.forEach((nodeId) => {
      const st = this.nodeStates.get(nodeId)!;
      if (!st.visible && st.currentScale < 0.02) return;
      const idx = count++;
      this.instanceIdToRepoNode.set(idx, st.node);
      this.dummy.position.copy(st.currentPos);
      this.dummy.scale.setScalar(Math.max(st.currentScale, 0.001));
      this.dummy.updateMatrix();
      this.starInstancedMesh.setMatrixAt(idx, this.dummy.matrix);
      needsMatrixUpdate = true;

      const repoId = st.node.repo?.id ?? '';
      const isSelected = this.selectedNodeId === nodeId;
      const isMatch = hasFilter && this.highlightedRepoIds.has(repoId);

      if (isSelected || isMatch) {
        this.tempColor.setHex(0xc6b79b);
      } else if (hasFilter) {
        this.tempColor.setHex(0x3a3f4b);
      } else {
        this.tempColor.setHex(0xf6f5f1);
      }
      this.starInstancedMesh.setColorAt(idx, this.tempColor);
      needsColorUpdate = true;
    });

    this.starInstancedMesh.geometry = count > 250 && this.camera.position.distanceTo(this.controls.target) > 68
      ? this.distantStars : this.nearStars;
    this.starInstancedMesh.count = count;
    if (needsMatrixUpdate) this.starInstancedMesh.instanceMatrix.needsUpdate = true;
    if (needsColorUpdate && this.starInstancedMesh.instanceColor) {
      this.starInstancedMesh.instanceColor.needsUpdate = true;
    }
  }

  private updateLinesAndPulses(elapsed: number): void {
    // 1. Hierarchy Edges
    const hPos = this.hierarchyGeometry.attributes.position as THREE.BufferAttribute;
    let hIdx = 0;
    for (const edge of this.graphEngine.edges) {
      if (edge.tier !== 'hierarchy') continue;
      const src = this.nodeStates.get(edge.source);
      const tgt = this.nodeStates.get(edge.target);
      if (!src || !tgt || tgt.currentScale < 0.04) {
        continue;
      } else {
        hPos.setXYZ(hIdx++, src.currentPos.x, src.currentPos.y, src.currentPos.z);
        hPos.setXYZ(hIdx++, tgt.currentPos.x, tgt.currentPos.y, tgt.currentPos.z);
      }
    }
    this.hierarchyGeometry.setDrawRange(0, hIdx);
    hPos.needsUpdate = hIdx > 0;

    // 2. Cross-Repository Relationships & Active Trail Edges
    const rPos = this.relationshipGeometry.attributes.position as THREE.BufferAttribute;
    let rIdx = 0;
    this.activeTrailPairs = [];

    for (const edge of this.graphEngine.edges) {
      if (edge.tier !== 'relationship') continue;
      const src = this.nodeStates.get(edge.source);
      const tgt = this.nodeStates.get(edge.target);
      const isConnectedToSelected =
        this.selectedNodeId === edge.source || this.selectedNodeId === edge.target;
      const showEdge =
        src &&
        tgt &&
        src.currentScale > 0.2 &&
        tgt.currentScale > 0.2 &&
        (this.showAllConnections || isConnectedToSelected);

      if (showEdge) {
        rPos.setXYZ(rIdx++, src.currentPos.x, src.currentPos.y, src.currentPos.z);
        rPos.setXYZ(rIdx++, tgt.currentPos.x, tgt.currentPos.y, tgt.currentPos.z);
        if (isConnectedToSelected) {
          this.activeTrailPairs.push([src.currentPos, tgt.currentPos]);
        }
      }
    }
    this.relationshipGeometry.setDrawRange(0, rIdx);
    rPos.needsUpdate = rIdx > 0;

    // Add Discovery Trail step pairs to pulse animation
    if (this.activeTrailRepoIds.length >= 2) {
      for (let i = 0; i < this.activeTrailRepoIds.length - 1; i++) {
        const a = this.nodeStates.get(`repo:${this.activeTrailRepoIds[i]}`);
        const b = this.nodeStates.get(`repo:${this.activeTrailRepoIds[i + 1]}`);
        if (a && b && a.visible && b.visible) {
          this.activeTrailPairs.push([a.currentPos, b.currentPos]);
        }
      }
    }

    // 3. Animate Synaptic Pulse Particles
    const pPos = this.pulseGeometry.attributes.position as THREE.BufferAttribute;
    const totalParticles = pPos.count;
    if (this.activeTrailPairs.length === 0 || this.prefersReducedMotion) {
      this.pulsePoints.visible = false;
    } else {
      this.pulsePoints.visible = true;
      for (let i = 0; i < totalParticles; i++) {
        const pair = this.activeTrailPairs[i % this.activeTrailPairs.length];
        const phase = (elapsed * 0.65 + i * 0.17) % 1;
        const x = pair[0].x + (pair[1].x - pair[0].x) * phase;
        const y = pair[0].y + (pair[1].y - pair[0].y) * phase;
        const z = pair[0].z + (pair[1].z - pair[0].z) * phase;
        pPos.setXYZ(i, x, y, z);
      }
    }
    pPos.needsUpdate = this.pulsePoints.visible;
  }

  private updateProjectedLabels(): void {
    const width = this.viewportWidth;
    const height = this.viewportHeight;
    const camDist = this.camera.position.distanceTo(this.controls.target);

    const topbar = document.querySelector('.atlas-topbar')?.getBoundingClientRect();
    const subbar = document.querySelector('.atlas-subbar')?.getBoundingClientRect();
    const labelTop = Math.max(topbar?.bottom ?? 0, subbar?.bottom ?? 0) + 4;
    const labelBottom = (document.querySelector('.atlas-controls-dock')?.getBoundingClientRect().top ?? height) - 34;

    // Collision avoidance grid (screen-space bounding boxes)
    const placedBoxes: Array<{ left: number; right: number; top: number; bottom: number }> = [];

    for (const id of this.labelOrder) {
      const el = this.labelElements.get(id)!;
      const st = this.nodeStates.get(id);
      if (!st || !st.visible || st.currentScale < 0.25) {
        if (el.style.display !== 'none') el.style.display = 'none';
        continue;
      }

      // Semantic Zoom LOD thresholds with hysteresis
      if (st.node.tier === 'repository' && camDist > 68 && id !== this.selectedNodeId) {
        if (el.style.display !== 'none') el.style.display = 'none';
        continue;
      }

      this.projVec.copy(st.currentPos).project(this.camera);
      // Behind camera check
      if (Math.abs(this.projVec.z) > 1) {
        if (el.style.display !== 'none') el.style.display = 'none';
        continue;
      }

      const sx = (this.projVec.x * 0.5 + 0.5) * width;
      const sy = (-this.projVec.y * 0.5 + 0.5) * height;

      if (sx < 0 || sx > width || sy < labelTop || sy > labelBottom) {
        if (el.style.display !== 'none') el.style.display = 'none';
        continue;
      }

      // Prevent label overlap on screen
      const boxW = st.node.tier === 'domain' ? 135 : 105;
      const boxH = 24;
      const labelX = st.node.tier === 'domain'
        ? THREE.MathUtils.clamp(sx, boxW / 2 + 4, width - boxW / 2 - 4)
        : sx;
      const box = {
        left: labelX - boxW / 2,
        right: labelX + boxW / 2,
        top: sy + 8,
        bottom: sy + 8 + boxH,
      };

      const isSelected = id === this.selectedNodeId;
      const overlaps =
        !isSelected &&
        placedBoxes.some(
          (other) =>
            !(
              box.right < other.left ||
              box.left > other.right ||
              box.bottom < other.top ||
              box.top > other.bottom
            )
        );

      if (overlaps) {
        if (el.style.display !== 'none') el.style.display = 'none';
        continue;
      }

      placedBoxes.push(box);
      if (el.style.display !== 'block') el.style.display = 'block';
      const transform = `translate3d(${labelX.toFixed(1)}px, ${(sy + 10).toFixed(1)}px, 0) translateX(-50%)`;
      if (el.style.transform !== transform) el.style.transform = transform;
      el.classList.toggle('is-selected', isSelected);
    }
  }

  private updateSemanticZoomTier(): void {
    const dist = this.camera.position.distanceTo(this.controls.target);
    let nextTier: 'universe' | 'domain' | 'constellation' | 'repository' = this.lastZoomTier;

    // Hysteresis bands prevent rapid flickering at boundaries
    if (dist > 72) nextTier = 'universe';
    else if (dist > 36 && dist < 68) nextTier = 'domain';
    else if (dist > 17 && dist < 33) nextTier = 'constellation';
    else if (dist < 15) nextTier = 'repository';

    if (nextTier !== this.lastZoomTier) {
      this.lastZoomTier = nextTier;
      this.callbacks.onCameraZoomTierChange(nextTier);
    }
  }

  public dispose(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    window.visualViewport?.removeEventListener('resize', this.onResize);
    window.removeEventListener('resize', this.onResize);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.controls.dispose();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse(object => {
      if (object instanceof THREE.Sprite) {
        object.material.map?.dispose();
        materials.add(object.material);
      } else if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
        geometries.add(object.geometry);
        for (const material of [object.material].flat()) materials.add(material);
      }
    });
    this.starInstancedMesh.dispose();
    geometries.add(this.nearStars);
    geometries.add(this.distantStars);
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    this.renderer.dispose();
  }
}
