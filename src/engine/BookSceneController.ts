import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import gsap from 'gsap';
import { BOOK_TIMING, SITE_CONFIG, type CameraPreset, type SceneTheme } from '../config/theme';
import {
  BOOK_SPREADS,
  PHYSICAL_SPREAD_COUNT,
  type PageSlot,
  type ProjectItem,
} from '../data/projects';
import { createBookRig, type BookRig } from './BookMesh';
import {
  beginClose,
  beginDragTurn,
  beginOpen,
  computeCursorCameraOffset,
  computePageSupersampleScale,
  computePhaseLighting,
  computeTurnPlan,
  createInitialBookState,
  finishClose,
  finishDragTurn,
  finishOpen,
  finishTurn,
  getStepTarget,
  requestSpreadNavigation,
  resolveDragRelease,
  type BookControllerState,
  type PageSide,
} from './bookState';
import {
  computeBookFocusPoint,
  computeDofProfile,
  computeLinearFocusDistance,
} from './dof';
import { DepthOfFieldPass, VignetteGradingShader } from './shaders';
import {
  createBookStaticTextures,
  createPageTextureHandle,
  type BookStaticTextureSet,
  type PageTextureHandle,
} from './textures';
import { DeskEnvironment } from '../scene/environments/DeskEnvironment';
import { PondEnvironment } from '../scene/environments/PondEnvironment';
import {
  DEFAULT_ENVIRONMENT,
  type EnvironmentId,
  type SceneEnvironment,
} from '../scene/environments/types';

export interface BookSceneCallbacks {
  onStateChange: (state: BookControllerState) => void;
  onHoverProject: (project: ProjectItem | null, side: PageSide | null) => void;
  onCursorInteractiveChange?: (interactive: boolean) => void;
  onCardHoverChange?: (hovered: boolean, screenPos?: { x: number; y: number }) => void;
  onOpenContact?: () => void;
  onSelectProject: (project: ProjectItem) => void;
  onWebGLFailed: (reason: string) => void;
  onReady: () => void;
}

export class BookSceneController {
  private static readonly SURFACE_Y = 0;

  private container: HTMLElement;
  private theme: SceneTheme;
  private callbacks: BookSceneCallbacks;
  private reducedMotion: boolean;

  private renderer!: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private dofPass: DepthOfFieldPass | null = null;
  private gradingPass: ShaderPass | null = null;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private bookRig!: BookRig;
  private staticTextures!: BookStaticTextureSet;
  private environments = new Map<EnvironmentId, SceneEnvironment>();
  private initializedEnvs = new Set<EnvironmentId>();
  private activeEnvId: EnvironmentId = DEFAULT_ENVIRONMENT;
  private keyLight!: THREE.DirectionalLight;
  private deskLamp!: THREE.SpotLight;
  private hemiLight!: THREE.HemisphereLight;
  private rimLight!: THREE.DirectionalLight;

  private isSoftwareGl = false;
  private renderBusy = false;
  private renderDirty = false;
  private frameId = 0;
  private afterDrawTimerId = 0;
  private pondTickId = 0;
  private envStartMs = 0;
  private lastEnvUpdateMs = 0;
  private lastPondShadowMs = 0;
  private previewAnimId = 0;
  private parallaxAnimId = 0;
  private parallaxLastMs = 0;
  private preloadQueueTimer = 0;
  private disposed = false;
  private isDocumentHidden = false;

  private static readonly AXIS_Y = new THREE.Vector3(0, 1, 0);
  private static readonly AXIS_X = new THREE.Vector3(1, 0, 0);
  private tmpCamBase = new THREE.Vector3();
  private tmpCamTarget = new THREE.Vector3();
  private tmpCamOffset = new THREE.Vector3();
  private tmpFocusPoint = { x: 0, y: 0, z: 0 };
  private tmpBoundCorners = Array.from({ length: 8 }, () => new THREE.Vector3());

  private pageHandles = new Map<string, PageTextureHandle>();
  private state: BookControllerState;

  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();
  private cursorTargetNdc = new THREE.Vector2(0, 0);
  private cursorCurrentNdc = new THREE.Vector2(0, 0);
  private lastRaycastMs = 0;
  private hoveredSide: PageSide | null = null;
  private hoveredContentsProjectId: string | null = null;
  private hoveredCover = false;
  private cursorInteractive = false;
  private previewStartMs = 0;
  private activePreviewSide: PageSide | null = null;
  private dragState: {
    active: boolean;
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastTimeMs: number;
    lastStepMs: number;
    velocityPxPerMs: number;
    direction: 'next' | 'prev' | null;
    fromSpread: number;
    toSpread: number;
    targetProgress: number;
    currentProgress: number;
  } | null = null;
  private dragTickId = 0;
  private dragTween: gsap.core.Tween | null = null;
  private suppressNextClick = false;

  private animProxy = {
    openProgress: 0,
    camX: 0,
    camY: 2.75,
    camZ: 2.25,
    targetX: 0,
    targetY: 0.02,
    targetZ: -0.14,
    fov: 35,
  };
  private hoverProxy = { angle: 0 };
  private hoverTween: gsap.core.Tween | null = null;
  private activeTimeline: gsap.core.Timeline | null = null;
  private cleanupFns: Array<() => void> = [];

  constructor(
    container: HTMLElement,
    theme: SceneTheme,
    callbacks: BookSceneCallbacks,
    options: {
      autostart?: boolean;
      reducedMotion?: boolean;
      initialEnvironment?: EnvironmentId;
    } = {},
  ) {
    this.container = container;
    this.theme = theme;
    this.callbacks = callbacks;
    this.reducedMotion = Boolean(options.reducedMotion);
    this.activeEnvId = options.initialEnvironment ?? DEFAULT_ENVIRONMENT;
    this.state = createInitialBookState(
      BOOK_SPREADS.length,
      Boolean(options.autostart),
      PHYSICAL_SPREAD_COUNT,
    );

    this.init();
  }

  private detectSoftwareWebGL(): boolean {
    try {
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl2') || probe.getContext('webgl');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param) || '');
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    } catch {
      return true;
    }
  }

  private getSlotKey(spreadIdx: number, side: PageSide): string {
    return `${spreadIdx}:${side}`;
  }

  private getPageSlot(spreadIdx: number, side: PageSide): PageSlot {
    const spread = BOOK_SPREADS[spreadIdx] ?? BOOK_SPREADS[0];
    return side === 'left' ? spread.left : spread.right;
  }

  private getReadingSupersampleScale(): number {
    const width = Math.max(1, this.container.clientWidth || window.innerWidth);
    const dpr = window.devicePixelRatio || 1;
    const maxTextureSize = this.renderer?.capabilities.maxTextureSize ?? 4096;
    const computed = computePageSupersampleScale({
      phase: 'open',
      viewportWidth: width,
      dpr,
      isSoftwareGl: this.isSoftwareGl,
      maxTextureSize,
    });
    // Cap at 1.75x (~3360x1890) on high-DPI GPU so crispness remains high with half the upload bandwidth of 4K
    return this.isSoftwareGl ? computed : Math.min(1.75, computed);
  }

  private invalidateShadows() {
    if (this.renderer) {
      this.renderer.shadowMap.needsUpdate = true;
    }
  }

  private syncPageSupersampling() {
    const targetScale = this.getReadingSupersampleScale();
    let changed = false;
    this.pageHandles.forEach((handle) => {
      if (handle.setSupersampleScale(targetScale)) {
        this.renderer?.initTexture?.(handle.texture);
        changed = true;
      }
    });
    if (changed && this.bookRig) {
      const contentsH = this.getOrCreatePageHandle(0, 'left');
      this.bookRig.setContentsTexture(contentsH.texture);
      const leftH = this.getOrCreatePageHandle(this.state.currentSpread, 'left');
      const rightH = this.getOrCreatePageHandle(this.state.currentSpread, 'right');
      this.bookRig.setSpreadTextures(leftH.texture, rightH.texture);
      this.requestRender();
    }
  }

  private getOrCreatePageHandle(spreadIdx: number, side: PageSide): PageTextureHandle {
    const key = this.getSlotKey(spreadIdx, side);
    const existing = this.pageHandles.get(key);
    if (existing) return existing;

    const slot = this.getPageSlot(spreadIdx, side);
    const maxAniso = this.renderer ? Math.min(8, this.renderer.capabilities.getMaxAnisotropy()) : 4;
    const handle = createPageTextureHandle(
      slot,
      side,
      SITE_CONFIG.brandName,
      maxAniso,
      () => {
        if (!this.disposed) this.requestRender();
      },
      this.getReadingSupersampleScale(),
    );
    this.renderer?.initTexture?.(handle.texture);
    this.pageHandles.set(key, handle);
    return handle;
  }

  private scheduleIdlePreload(centerSpread: number) {
    if (this.disposed) return;
    if (this.preloadQueueTimer) {
      clearTimeout(this.preloadQueueTimer);
      this.preloadQueueTimer = 0;
    }

    const pending: Array<{ spreadIdx: number; side: PageSide }> = [];
    const order = [centerSpread + 1, centerSpread - 1].filter(
      (i) => i >= 0 && i < BOOK_SPREADS.length,
    );
    for (const idx of order) {
      if (!this.pageHandles.has(this.getSlotKey(idx, 'left'))) {
        pending.push({ spreadIdx: idx, side: 'left' });
      }
      if (!this.pageHandles.has(this.getSlotKey(idx, 'right'))) {
        pending.push({ spreadIdx: idx, side: 'right' });
      }
    }
    if (pending.length === 0) return;

    const processNext = () => {
      this.preloadQueueTimer = 0;
      if (this.disposed || this.isDocumentHidden) return;
      if (this.activeTimeline?.isActive() || this.dragState?.active) {
        this.preloadQueueTimer = window.setTimeout(processNext, 140);
        return;
      }
      const next = pending.shift();
      if (!next) return;
      this.getOrCreatePageHandle(next.spreadIdx, next.side);
      if (pending.length > 0) {
        this.preloadQueueTimer = window.setTimeout(processNext, this.isSoftwareGl ? 120 : 32);
      }
    };

    this.preloadQueueTimer = window.setTimeout(processNext, this.isSoftwareGl ? 160 : 60);
  }

  private getViewportTier(): 'desktop' | 'tablet' | 'mobile' {
    const w = this.container.clientWidth || window.innerWidth;
    if (w < 680) return 'mobile';
    if (w < 1080) return 'tablet';
    return 'desktop';
  }

  private getTargetCameraPreset(): CameraPreset {
    const tier = this.getViewportTier();
    const isClosed = this.state.phase === 'closed' || this.state.phase === 'closing';
    if (tier === 'mobile') {
      if (isClosed) return this.theme.camera.mobileClosed;
      return this.state.mobileSide === 'left'
        ? this.theme.camera.mobileOpenLeft
        : this.theme.camera.mobileOpenRight;
    }
    if (tier === 'tablet') {
      return isClosed ? this.theme.camera.tabletClosed : this.theme.camera.tabletOpen;
    }
    return isClosed ? this.theme.camera.desktopClosed : this.theme.camera.desktopOpen;
  }

  private applyCameraFromProxy() {
    this.tmpCamBase.set(this.animProxy.camX, this.animProxy.camY, this.animProxy.camZ);
    this.tmpCamTarget.set(
      this.animProxy.targetX,
      this.animProxy.targetY,
      this.animProxy.targetZ,
    );

    if (!this.reducedMotion && this.getViewportTier() !== 'mobile') {
      const { yawRad, pitchRad } = computeCursorCameraOffset(
        this.cursorCurrentNdc.x,
        this.cursorCurrentNdc.y,
        this.theme.interaction.cursorYawMaxRad,
        this.theme.interaction.cursorPitchMaxRad,
      );
      this.tmpCamOffset.copy(this.tmpCamBase).sub(this.tmpCamTarget);
      this.tmpCamOffset.applyAxisAngle(BookSceneController.AXIS_Y, yawRad);
      this.tmpCamOffset.applyAxisAngle(BookSceneController.AXIS_X, pitchRad);
      this.tmpCamBase.copy(this.tmpCamTarget).add(this.tmpCamOffset);
    }

    this.camera.position.copy(this.tmpCamBase);
    this.camera.lookAt(this.tmpCamTarget);
    if (Math.abs(this.camera.fov - this.animProxy.fov) > 0.05) {
      this.camera.fov = this.animProxy.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private syncPropsForViewport() {
    const tier = this.getViewportTier();
    const activeEnv = this.environments.get(this.activeEnvId);
    if (activeEnv && this.initializedEnvs.has(this.activeEnvId)) {
      activeEnv.applyViewportLayout?.(tier);
      this.invalidateShadows();
    }
  }

  private getActiveEnvironment() {
    return this.environments.get(this.activeEnvId);
  }

  private ensureEnvironmentInitialized(id: EnvironmentId) {
    const env = this.environments.get(id);
    if (!env || this.initializedEnvs.has(id)) return env;
    this.initializedEnvs.add(id);
    const maxAniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    env.init({
      scene: this.scene,
      renderer: this.renderer,
      camera: this.camera,
      surfaceY: BookSceneController.SURFACE_Y,
      isSoftwareGl: this.isSoftwareGl,
      maxAnisotropy: maxAniso,
      lampPosition: this.theme.lighting.spotPosition,
      bookGroup: this.bookRig.group,
      getBookOpenProgress: () => this.animProxy.openProgress,
      onOpenContact: () => this.callbacks.onOpenContact?.(),
      onCardHoverChange: (hovered, screenPos) =>
        this.callbacks.onCardHoverChange?.(hovered, screenPos),
      onCursorInteractiveChange: (interactive) => this.setCursorInteractive(interactive),
      onRequestRender: () => this.requestRender(),
    });
    env.applyViewportLayout?.(this.getViewportTier());
    return env;
  }

  private configureShadowFrustum(id: EnvironmentId) {
    if (!this.keyLight) return;
    if (id === 'pond') {
      this.keyLight.shadow.camera.left = -4.0;
      this.keyLight.shadow.camera.right = 4.0;
      this.keyLight.shadow.camera.top = 3.0;
      this.keyLight.shadow.camera.bottom = -3.0;
      this.keyLight.shadow.camera.near = 0.5;
      this.keyLight.shadow.camera.far = 11.5;
      this.keyLight.shadow.bias = -0.00035;
      this.keyLight.shadow.normalBias = 0.02;
      this.keyLight.shadow.radius = 4.2;
    } else {
      this.keyLight.shadow.camera.left = -2.6;
      this.keyLight.shadow.camera.right = 2.6;
      this.keyLight.shadow.camera.top = 1.7;
      this.keyLight.shadow.camera.bottom = -1.7;
      this.keyLight.shadow.camera.near = 0.6;
      this.keyLight.shadow.camera.far = 8.5;
      this.keyLight.shadow.bias = -0.00025;
      this.keyLight.shadow.normalBias = 0.0028;
      this.keyLight.shadow.radius = 4.5;
    }
    this.keyLight.shadow.camera.updateProjectionMatrix();
  }

  private applyEnvironmentAtmosphere(id: EnvironmentId) {
    if (!this.scene || !this.keyLight || !this.deskLamp || !this.hemiLight || !this.rimLight) {
      return;
    }
    if (id === 'pond') {
      const pondBg = '#071012';
      this.scene.background = new THREE.Color(pondBg);
      this.scene.fog = new THREE.FogExp2(pondBg, 0.064);
      this.keyLight.color.set('#f4f9ef');
      this.deskLamp.color.set('#fff4e4');
      this.hemiLight.color.set('#8dbab5');
      this.hemiLight.groundColor.set('#0d1b19');
      this.rimLight.color.set('#c4dfd9');
    } else {
      this.scene.background = new THREE.Color(this.theme.palette.background);
      this.scene.fog = new THREE.FogExp2(this.theme.palette.background, 0.072);
      this.keyLight.color.set(this.theme.lighting.keyColor);
      this.deskLamp.color.set(this.theme.lighting.spotColor);
      this.hemiLight.color.set(this.theme.lighting.hemiSkyColor);
      this.hemiLight.groundColor.set(this.theme.lighting.hemiGroundColor);
      this.rimLight.color.set(this.theme.lighting.rimColor);
    }
    this.configureShadowFrustum(id);
    this.applyPhaseLighting(this.animProxy.openProgress);
  }

  public setEnvironment(id: EnvironmentId) {
    if (this.disposed || id === this.activeEnvId) return;
    const prevEnv = this.environments.get(this.activeEnvId);
    prevEnv?.clearHover?.();
    prevEnv?.setActive(false);

    this.stopPondLoop();
    this.activeEnvId = id;
    this.callbacks.onCardHoverChange?.(false);

    const nextEnv = this.ensureEnvironmentInitialized(id);
    if (nextEnv) {
      nextEnv.applyViewportLayout?.(this.getViewportTier());
      nextEnv.setActive(true);
    }
    this.applyEnvironmentAtmosphere(id);
    this.invalidateShadows();
    this.lastEnvUpdateMs = performance.now();

    if (id === 'pond' && !this.isDocumentHidden) {
      this.startPondLoop();
    }
    this.requestRender();
  }

  private startPondLoop() {
    if (this.pondTickId || this.disposed || this.activeEnvId !== 'pond' || this.isDocumentHidden) {
      return;
    }
    const tick = () => {
      this.pondTickId = 0;
      if (this.disposed || this.activeEnvId !== 'pond' || this.isDocumentHidden) return;
      this.requestRender();
    };
    this.pondTickId = requestAnimationFrame(tick);
  }

  private stopPondLoop() {
    if (this.pondTickId) {
      cancelAnimationFrame(this.pondTickId);
      this.pondTickId = 0;
    }
  }

  private createLamplitStudioEnvScene(): THREE.Scene {
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x0b0908);

    // Overhead warm desk-lamp softbox placed upper-right so curved turns catch coated sheen without glaring over flat Contents ink
    const softboxGeo = new THREE.PlaneGeometry(3.0, 1.6);
    const softboxMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.45, 1.32, 1.15), side: THREE.DoubleSide });
    const softbox = new THREE.Mesh(softboxGeo, softboxMat);
    softbox.position.set(1.85, 5.2, -0.35);
    softbox.lookAt(0, 0, 0);
    envScene.add(softbox);

    // Focused filament core inside the overhead lamp shade for specular highlights along curled sheets
    const coreGeo = new THREE.CircleGeometry(0.55, 24);
    const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.8, 2.5, 2.15), side: THREE.DoubleSide });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.position.set(1.75, 5.05, -0.3);
    core.lookAt(0, 0, 0);
    envScene.add(core);

    // Subtle cool skylight bounce strip behind the desk for crisp page-edge & brushed-metal separation
    const rimStripGeo = new THREE.PlaneGeometry(7.0, 1.4);
    const rimStripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 1.32, 1.5), side: THREE.DoubleSide });
    const rimStrip = new THREE.Mesh(rimStripGeo, rimStripMat);
    rimStrip.position.set(1.8, 2.4, -4.0);
    rimStrip.lookAt(0, 0, 0);
    envScene.add(rimStrip);

    // Side highlight strip for polished metallic spoon & brass ferrule gleams
    const metalStripGeo = new THREE.PlaneGeometry(1.4, 3.6);
    const metalStripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.05, 1.85), side: THREE.DoubleSide });
    const metalStrip = new THREE.Mesh(metalStripGeo, metalStripMat);
    metalStrip.position.set(-2.8, 3.2, 1.6);
    metalStrip.lookAt(0, 0, 0);
    envScene.add(metalStrip);

    // Broad soft studio ceiling & opposite-side fill cards so metallic concave spoon bowl reflects natural silver gradients
    const metalFillGeo = new THREE.PlaneGeometry(5.6, 3.6);
    const metalFillMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.72, 0.74, 0.78), side: THREE.DoubleSide });
    const metalFill = new THREE.Mesh(metalFillGeo, metalFillMat);
    metalFill.position.set(0.4, 4.8, 2.4);
    metalFill.lookAt(0, 0, 0);
    envScene.add(metalFill);

    const metalSideGeo = new THREE.PlaneGeometry(2.6, 2.2);
    const metalSideMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.58, 0.55, 0.52), side: THREE.DoubleSide });
    const metalSide = new THREE.Mesh(metalSideGeo, metalSideMat);
    metalSide.position.set(3.6, 2.4, 1.5);
    metalSide.lookAt(0, 0, 0);
    envScene.add(metalSide);

    // Warm dark oak ambient floor bounce so underside of lifted page curls gets warm fill
    const bounceGeo = new THREE.PlaneGeometry(8.0, 6.0);
    const bounceMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.32, 0.24, 0.18), side: THREE.DoubleSide });
    const bounce = new THREE.Mesh(bounceGeo, bounceMat);
    bounce.position.set(0, -1.5, 0);
    bounce.rotation.x = -Math.PI / 2;
    envScene.add(bounce);

    return envScene;
  }

  private updateBookShaderBounds() {
    if (!this.gradingPass || !this.bookRig || !this.camera) return;
    this.camera.updateMatrixWorld();
    this.bookRig.group.updateMatrixWorld(true);

    const openFactor = this.animProxy.openProgress;
    const halfW = this.theme.bookDimensions.pageWidth + this.theme.bookDimensions.coverOverhang;
    const minLocalX = openFactor > 0.08 ? -halfW : -0.04;
    const maxLocalX = halfW;
    const halfH = this.theme.bookDimensions.pageHeight * 0.5 + this.theme.bookDimensions.coverOverhang;
    const maxY = 0.16;

    const c = this.tmpBoundCorners;
    c[0].set(minLocalX, 0, -halfH);
    c[1].set(maxLocalX, 0, -halfH);
    c[2].set(minLocalX, 0, halfH);
    c[3].set(maxLocalX, 0, halfH);
    c[4].set(minLocalX, maxY, -halfH);
    c[5].set(maxLocalX, maxY, -halfH);
    c[6].set(minLocalX, maxY, halfH);
    c[7].set(maxLocalX, maxY, halfH);

    let uMin = 1;
    let vMin = 1;
    let uMax = 0;
    let vMax = 0;

    for (let i = 0; i < 8; i++) {
      const pt = c[i];
      pt.applyMatrix4(this.bookRig.group.matrixWorld);
      pt.project(this.camera);
      const u = pt.x * 0.5 + 0.5;
      const v = pt.y * 0.5 + 0.5;
      uMin = Math.min(uMin, u);
      vMin = Math.min(vMin, v);
      uMax = Math.max(uMax, u);
      vMax = Math.max(vMax, v);
    }

    this.gradingPass.uniforms.uBookBounds.value.set(
      Math.max(0, Math.min(1, uMin)),
      Math.max(0, Math.min(1, vMin)),
      Math.max(0, Math.min(1, uMax)),
      Math.max(0, Math.min(1, vMax)),
    );
    const isReading =
      this.state.phase === 'open' || this.state.phase === 'turning' || openFactor > 0.7;
    this.gradingPass.uniforms.uBookSharpen.value = isReading ? 0.85 : 0.28;
  }

  private updateDepthOfFieldUniforms() {
    if (!this.dofPass || !this.camera) return;
    const isMobile = this.getViewportTier() === 'mobile';
    const focusPoint = computeBookFocusPoint(
      {
        openProgress: this.animProxy.openProgress,
        isMobile,
        mobileSide: this.state.mobileSide,
        surfaceY: BookSceneController.SURFACE_Y,
        pageWidth: this.theme.bookDimensions.pageWidth,
      },
      this.tmpFocusPoint,
    );
    const focusDist = computeLinearFocusDistance({
      cameraPos: this.camera.position,
      cameraTarget: this.tmpCamTarget,
      focusPoint,
    });
    const profile = computeDofProfile({
      openProgress: this.animProxy.openProgress,
      isMobile,
      environmentId: this.activeEnvId,
    });

    const u = this.dofPass.uniforms;
    u.uCameraNear.value = this.camera.near;
    u.uCameraFar.value = this.camera.far;
    u.uFocusDist.value = focusDist;
    u.uNearDeadzone.value = profile.nearDeadzone;
    u.uFarDeadzone.value = profile.farDeadzone;
    u.uNearBlurRange.value = profile.nearBlurRange;
    u.uFarBlurRange.value = profile.farBlurRange;
    u.uMaxBlurPx.value = profile.maxBlurPx;
  }

  private applyPhaseLighting(openProgress: number) {
    if (!this.deskLamp || !this.keyLight || !this.hemiLight || !this.rimLight) return;
    const vals = computePhaseLighting(openProgress, this.theme.lighting);
    if (this.activeEnvId === 'pond') {
      this.deskLamp.intensity = vals.spotIntensity * 0.56;
      this.deskLamp.angle = vals.spotAngle;
      this.deskLamp.penumbra = vals.spotPenumbra;
      this.keyLight.intensity = vals.keyIntensity * 1.48;
      // Angle afternoon sunlight from upper-right through the bamboo grove onto boulders & pond water
      this.keyLight.position.set(1.92, 4.15, -1.18);
      this.hemiLight.intensity = Math.max(0.32, vals.hemiIntensity * 1.38);
      this.rimLight.intensity = vals.rimIntensity * 0.88;
      this.scene.environmentIntensity = Math.max(0.28, vals.environmentIntensity * 0.78);
      return;
    }
    this.deskLamp.intensity = vals.spotIntensity;
    this.deskLamp.angle = vals.spotAngle;
    this.deskLamp.penumbra = vals.spotPenumbra;
    this.keyLight.intensity = vals.keyIntensity;
    this.keyLight.position.set(vals.keyPosX, vals.keyPosY, vals.keyPosZ);
    this.hemiLight.intensity = vals.hemiIntensity;
    this.rimLight.intensity = vals.rimIntensity;
    this.scene.environmentIntensity = vals.environmentIntensity;
  }

  private init() {
    try {
      this.isSoftwareGl = this.detectSoftwareWebGL();
      const width = Math.max(1, this.container.clientWidth || window.innerWidth);
      const height = Math.max(1, this.container.clientHeight || window.innerHeight);

      this.renderer = new THREE.WebGLRenderer({
        antialias: !this.isSoftwareGl,
        powerPreference: 'high-performance',
      });
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = this.theme.lighting.exposure;
      // Cap DPR up to 1.5 on GPU (matches 4x MSAA composer headroom smoothly), or 1 on software WebGL
      this.renderer.setPixelRatio(
        this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 1.5),
      );
      this.renderer.setSize(width, height);
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.autoUpdate = false;
      this.renderer.shadowMap.type = THREE.PCFShadowMap;
      this.renderer.domElement.style.display = 'block';
      this.renderer.domElement.style.width = '100%';
      this.renderer.domElement.style.height = '100%';
      this.renderer.domElement.setAttribute('aria-hidden', 'true');
      this.container.appendChild(this.renderer.domElement);

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(this.theme.palette.background);
      this.scene.fog = new THREE.FogExp2(this.theme.palette.background, 0.072);

      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const envScene = this.createLamplitStudioEnvScene();
      const envRT = pmrem.fromScene(envScene, 0.04);
      this.scene.environment = envRT.texture;
      envScene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
      pmrem.dispose();

      const initialPreset = this.getTargetCameraPreset();
      this.camera = new THREE.PerspectiveCamera(initialPreset.fov, width / height, 0.1, 40);
      this.animProxy = {
        openProgress: this.state.phase === 'open' ? 1 : 0,
        camX: initialPreset.position.x,
        camY: initialPreset.position.y,
        camZ: initialPreset.position.z,
        targetX: initialPreset.target.x,
        targetY: initialPreset.target.y,
        targetZ: initialPreset.target.z,
        fov: initialPreset.fov,
      };
      this.applyCameraFromProxy();

      // Lighting rig: warm overhead desk SpotLight + angled shadow-casting keyLight mapped dynamically to book phase
      this.keyLight = new THREE.DirectionalLight(
        this.theme.lighting.keyColor,
        this.theme.lighting.keyIntensity,
      );
      this.keyLight.position.set(
        this.theme.lighting.keyPosition.x,
        this.theme.lighting.keyPosition.y,
        this.theme.lighting.keyPosition.z,
      );
      this.keyLight.castShadow = true;
      this.keyLight.shadow.mapSize.set(2048, 2048);
      this.configureShadowFrustum(this.activeEnvId);
      this.scene.add(this.keyLight);

      this.deskLamp = new THREE.SpotLight(
        this.theme.lighting.spotColor,
        this.theme.lighting.spotIntensity,
        14.0,
        this.theme.lighting.spotAngle,
        this.theme.lighting.spotPenumbra,
        this.theme.lighting.spotDecay,
      );
      this.deskLamp.position.set(
        this.theme.lighting.spotPosition.x,
        this.theme.lighting.spotPosition.y,
        this.theme.lighting.spotPosition.z,
      );
      this.deskLamp.target.position.set(
        this.theme.lighting.spotTarget.x,
        this.theme.lighting.spotTarget.y,
        this.theme.lighting.spotTarget.z,
      );
      this.deskLamp.castShadow = false;
      this.scene.add(this.deskLamp.target);
      this.scene.add(this.deskLamp);

      this.hemiLight = new THREE.HemisphereLight(
        this.theme.lighting.hemiSkyColor,
        this.theme.lighting.hemiGroundColor,
        this.theme.lighting.hemiIntensity,
      );
      this.scene.add(this.hemiLight);

      this.rimLight = new THREE.DirectionalLight(
        this.theme.lighting.rimColor,
        this.theme.lighting.rimIntensity,
      );
      this.rimLight.position.set(
        this.theme.lighting.rimPosition.x,
        this.theme.lighting.rimPosition.y,
        this.theme.lighting.rimPosition.z,
      );
      this.scene.add(this.rimLight);

      this.applyPhaseLighting(this.animProxy.openProgress);

      // Post-processing composer with 4x MSAA on GPU: RenderPass -> DepthOfFieldPass -> VignetteGradingShader -> OutputPass
      const composerDpr = this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);
      const rtW = Math.max(1, Math.round(width * composerDpr));
      const rtH = Math.max(1, Math.round(height * composerDpr));
      const composerDepthTexture = new THREE.DepthTexture(rtW, rtH, THREE.UnsignedIntType);
      composerDepthTexture.format = THREE.DepthFormat;
      composerDepthTexture.minFilter = THREE.NearestFilter;
      composerDepthTexture.magFilter = THREE.NearestFilter;

      const composerTarget = new THREE.WebGLRenderTarget(rtW, rtH, {
        samples: this.isSoftwareGl ? 0 : 4,
        type: THREE.HalfFloatType,
        depthTexture: composerDepthTexture,
      });
      this.composer = new EffectComposer(this.renderer, composerTarget);
      this.composer.setPixelRatio(composerDpr);
      this.composer.setSize(width, height);
      this.composer.addPass(new RenderPass(this.scene, this.camera));

      this.dofPass = new DepthOfFieldPass();
      this.dofPass.uniforms.uResolution.value.set(width, height);
      this.updateDepthOfFieldUniforms();
      this.composer.addPass(this.dofPass);

      this.gradingPass = new ShaderPass(VignetteGradingShader);
      const u = this.gradingPass.uniforms;
      u.uResolution.value.set(width, height);
      u.uVignetteRadius.value = this.theme.shader.vignetteRadius;
      u.uVignetteSoftness.value = this.theme.shader.vignetteSoftness;
      u.uVignetteStrength.value = this.theme.shader.vignetteStrength;
      u.uSaturation.value = this.theme.shader.saturation;
      u.uContrast.value = this.theme.shader.contrast;
      u.uWarmth.value = this.theme.shader.warmth;
      u.uGrainAmount.value = this.theme.shader.grainAmount;
      this.composer.addPass(this.gradingPass);
      this.composer.addPass(new OutputPass());

      const maxAniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      this.staticTextures = createBookStaticTextures(this.theme, SITE_CONFIG.brandName, maxAniso);

      // Book rig sitting cleanly atop SURFACE_Y = 0 (shared seamlessly by Desk & Koi Pond environments)
      this.bookRig = createBookRig(this.theme, this.staticTextures, BOOK_TIMING.maxBatchSheets);
      this.bookRig.group.position.y = BookSceneController.SURFACE_Y + 0.0036;
      this.scene.add(this.bookRig.group);

      // Instantiate switchable environments; initialize only the active one lazily (0% inactive GPU cost)
      this.environments.set('desk', new DeskEnvironment(this.theme, this.staticTextures));
      this.environments.set('pond', new PondEnvironment(this.theme, this.staticTextures));
      const initialEnv = this.ensureEnvironmentInitialized(this.activeEnvId);
      initialEnv?.setActive(true);
      this.applyEnvironmentAtmosphere(this.activeEnvId);

      // Build current spread at reading scale upfront (eliminates CPU/GPU texture upload spikes on openBook)
      const contentsH = this.getOrCreatePageHandle(0, 'left');
      this.bookRig.setContentsTexture(contentsH.texture);
      const leftH = this.getOrCreatePageHandle(this.state.currentSpread, 'left');
      const rightH = this.getOrCreatePageHandle(this.state.currentSpread, 'right');
      this.bookRig.setSpreadTextures(leftH.texture, rightH.texture);
      this.bookRig.setOpenProgress(this.animProxy.openProgress);
      this.bookRig.setStackHeights(
        this.state.currentSpread,
        PHYSICAL_SPREAD_COUNT,
        this.animProxy.openProgress,
      );

      // Pre-compile all book shaders (including turning sheet materials) before first interaction
      if (!this.isSoftwareGl) {
        const sheet0 = this.bookRig.turningSheets[0];
        if (sheet0) sheet0.mesh.visible = true;
        this.renderer.compile(this.scene, this.camera);
        if (sheet0) sheet0.mesh.visible = false;
      }
      this.invalidateShadows();

      this.envStartMs = performance.now();
      this.lastEnvUpdateMs = this.envStartMs;
      this.bindEvents();
      this.requestRender();
      if (this.activeEnvId === 'pond' && !this.isDocumentHidden) {
        this.startPondLoop();
      }
      this.callbacks.onStateChange({ ...this.state });
      this.callbacks.onReady();
      this.scheduleIdlePreload(this.state.currentSpread);

      this.cleanupFns.push(() => {
        envRT.dispose();
        composerDepthTexture.dispose();
        composerTarget.dispose();
        this.staticTextures.dispose();
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'WebGL initialization failed';
      this.callbacks.onWebGLFailed(msg);
    }
  }

  private bindEvents() {
    const canvas = this.renderer.domElement;

    const onContextLost = (e: Event) => {
      e.preventDefault();
      this.callbacks.onWebGLFailed('WebGL rendering context was lost.');
    };
    canvas.addEventListener('webglcontextlost', onContextLost);

    const onResize = () => {
      if (this.disposed) return;
      const w = Math.max(1, this.container.clientWidth || window.innerWidth);
      const h = Math.max(1, this.container.clientHeight || window.innerHeight);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
      this.composer?.setSize(w, h);
      this.dofPass?.uniforms.uResolution.value.set(w, h);
      this.gradingPass?.uniforms.uResolution.value.set(w, h);
      this.environments.forEach((env, envId) => {
        if (this.initializedEnvs.has(envId)) {
          env.onResize?.(w, h, this.renderer.getPixelRatio());
        }
      });
      this.syncPropsForViewport();
      this.syncPageSupersampling();

      // Smoothly reframe camera when resizing across viewport tiers
      if (this.state.phase === 'closed' || this.state.phase === 'open') {
        const preset = this.getTargetCameraPreset();
        this.animProxy.camX = preset.position.x;
        this.animProxy.camY = preset.position.y;
        this.animProxy.camZ = preset.position.z;
        this.animProxy.targetX = preset.target.x;
        this.animProxy.targetY = preset.target.y;
        this.animProxy.targetZ = preset.target.z;
        this.animProxy.fov = preset.fov;
        this.applyCameraFromProxy();
      }
      this.requestRender();
    };
    window.addEventListener('resize', onResize);

    const onWindowPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || this.reducedMotion || this.dragState?.active) return;
      const w = Math.max(1, window.innerWidth);
      const h = Math.max(1, window.innerHeight);
      this.cursorTargetNdc.set((e.clientX / w) * 2 - 1, -((e.clientY / h) * 2 - 1));
      this.ensureParallaxLoop();
    };
    window.addEventListener('pointermove', onWindowPointerMove, { passive: true });

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || this.disposed) return;
      this.updateNdcFromClient(e.clientX, e.clientY);
      this.raycaster.setFromCamera(this.pointerNdc, this.camera);
      const activeEnv = this.getActiveEnvironment();

      if (this.state.phase === 'closed') {
        const coverHits = this.raycaster.intersectObjects(this.bookRig.closedHitTargets, false);
        if (coverHits.length === 0) {
          activeEnv?.onPointerDown?.(this.raycaster, this.pointerNdc);
        }
        return;
      }

      if (this.state.phase !== 'open') return;

      const leftSurface =
        this.state.currentSpread === 0 ? this.bookRig.insideCoverSurface : this.bookRig.leftPageSurface;
      const hits = this.raycaster.intersectObjects(
        [leftSurface, this.bookRig.rightPageSurface],
        false,
      );
      if (hits.length === 0) {
        activeEnv?.onPointerDown?.(this.raycaster, this.pointerNdc);
        return;
      }

      this.dragState = {
        active: false,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastTimeMs: performance.now(),
        lastStepMs: performance.now(),
        velocityPxPerMs: 0,
        direction: null,
        fromSpread: this.state.currentSpread,
        toSpread: this.state.currentSpread,
        targetProgress: 0,
        currentProgress: 0,
      };
    };
    canvas.addEventListener('pointerdown', onPointerDown);

    const onPointerMove = (e: PointerEvent) => {
      if (this.dragState && e.pointerId === this.dragState.pointerId) {
        this.handleDragPointerMove(e);
        return;
      }
      if (e.pointerType === 'touch' || this.activeTimeline?.isActive()) return;
      const now = performance.now();
      const throttleMs = this.activeEnvId === 'pond' ? 22 : 40;
      if (now - this.lastRaycastMs < throttleMs) return;
      this.lastRaycastMs = now;
      this.handleHoverRaycast(e);
    };
    canvas.addEventListener('pointermove', onPointerMove);

    const onPointerUpOrCancel = (e: PointerEvent) => {
      if (!this.dragState || e.pointerId !== this.dragState.pointerId) return;
      this.finishDragGesture(e);
    };
    canvas.addEventListener('pointerup', onPointerUpOrCancel);
    canvas.addEventListener('pointercancel', onPointerUpOrCancel);

    const onPointerLeave = () => {
      if (!this.dragState?.active) {
        this.clearHoverState();
      }
      this.getActiveEnvironment()?.clearHover?.();
    };
    canvas.addEventListener('pointerleave', onPointerLeave);

    const onClick = (e: MouseEvent) => {
      if (this.suppressNextClick) {
        this.suppressNextClick = false;
        return;
      }
      this.handleCanvasClick(e);
    };
    canvas.addEventListener('click', onClick);

    const onVisibility = () => {
      this.isDocumentHidden = document.hidden;
      if (this.isDocumentHidden) {
        this.stopPreviewLoop();
        this.stopPondLoop();
      } else {
        if (this.activePreviewSide) {
          this.startPreviewLoop(this.activePreviewSide);
        }
        if (this.activeEnvId === 'pond') {
          this.lastEnvUpdateMs = performance.now();
          this.startPondLoop();
          this.requestRender();
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    this.cleanupFns.push(() => {
      canvas.removeEventListener('webglcontextlost', onContextLost);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onWindowPointerMove);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUpOrCancel);
      canvas.removeEventListener('pointercancel', onPointerUpOrCancel);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('click', onClick);
      document.removeEventListener('visibilitychange', onVisibility);
    });
  }

  private ensureParallaxLoop() {
    if (
      this.parallaxAnimId ||
      this.disposed ||
      this.reducedMotion ||
      this.activeTimeline?.isActive() ||
      this.dragState?.active
    ) {
      return;
    }
    this.parallaxLastMs = performance.now();
    const tick = (now: number) => {
      this.parallaxAnimId = 0;
      if (
        this.disposed ||
        this.reducedMotion ||
        this.activeTimeline?.isActive() ||
        this.dragState?.active
      ) {
        return;
      }
      const dtSec = Math.min(0.05, Math.max(0.004, (now - this.parallaxLastMs) / 1000));
      this.parallaxLastMs = now;

      const dx = this.cursorTargetNdc.x - this.cursorCurrentNdc.x;
      const dy = this.cursorTargetNdc.y - this.cursorCurrentNdc.y;
      const alpha = this.isSoftwareGl ? 0.35 : 1 - Math.exp(-12 * dtSec);
      this.cursorCurrentNdc.x += dx * alpha;
      this.cursorCurrentNdc.y += dy * alpha;

      this.applyCameraFromProxy();
      this.requestRender();

      if (Math.abs(dx) > 0.0025 || Math.abs(dy) > 0.0025) {
        this.parallaxAnimId = requestAnimationFrame(tick);
      } else {
        this.cursorCurrentNdc.copy(this.cursorTargetNdc);
        this.applyCameraFromProxy();
      }
    };
    this.parallaxAnimId = requestAnimationFrame(tick);
  }

  private updateNdcFromClient(clientX: number, clientY: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  }

  private setCursorInteractive(interactive: boolean) {
    if (this.cursorInteractive === interactive) return;
    this.cursorInteractive = interactive;
    this.callbacks.onCursorInteractiveChange?.(interactive);
  }

  private tweenCoverHoverLift(hovered: boolean) {
    const targetAngle = hovered ? this.theme.interaction.hoverCoverAngleRad : 0;
    const durationSec = this.reducedMotion ? 0.05 : this.theme.interaction.hoverCoverTweenMs / 1000;
    this.hoverTween?.kill();
    this.hoverTween = gsap.to(this.hoverProxy, {
      angle: targetAngle,
      duration: durationSec,
      ease: 'power2.out',
      onUpdate: () => {
        this.bookRig.setHoverLiftAngle(this.hoverProxy.angle);
        this.invalidateShadows();
        this.requestRender();
      },
    });
  }

  private clearBookHoverOnly() {
    if (this.hoveredCover) {
      this.hoveredCover = false;
      this.tweenCoverHoverLift(false);
    }
    if (this.hoveredContentsProjectId) {
      const contentsHandle = this.pageHandles.get(this.getSlotKey(0, 'left'));
      contentsHandle?.render(0, false, null);
      this.hoveredContentsProjectId = null;
    }
    if (this.hoveredSide) {
      this.restoreStaticPageTexture(this.hoveredSide);
      this.hoveredSide = null;
      this.callbacks.onHoverProject(null, null);
    }
    this.stopPreviewLoop();
  }

  private handleHoverRaycast(e: PointerEvent) {
    if (this.disposed) return;
    this.updateNdcFromClient(e.clientX, e.clientY);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const activeEnv = this.getActiveEnvironment();

    if (this.state.phase === 'closed') {
      const hits = this.raycaster.intersectObjects(this.bookRig.closedHitTargets, false);
      const isHover = hits.length > 0;
      if (isHover !== this.hoveredCover) {
        this.hoveredCover = isHover;
        this.tweenCoverHoverLift(isHover);
      }
      if (isHover) {
        activeEnv?.clearHover?.();
        this.setCursorInteractive(true);
        return;
      }
      const envHandled = activeEnv?.onPointerMove?.(this.raycaster, this.pointerNdc) ?? false;
      if (!envHandled) {
        this.setCursorInteractive(false);
      }
      return;
    }

    if (this.state.phase !== 'open') {
      this.clearHoverState();
      return;
    }

    const leftSurface =
      this.state.currentSpread === 0 ? this.bookRig.insideCoverSurface : this.bookRig.leftPageSurface;
    const hits = this.raycaster.intersectObjects(
      [leftSurface, this.bookRig.rightPageSurface],
      false,
    );

    if (hits.length === 0) {
      this.clearBookHoverOnly();
      const envHandled = activeEnv?.onPointerMove?.(this.raycaster, this.pointerNdc) ?? false;
      if (!envHandled) {
        this.setCursorInteractive(false);
      }
      this.requestRender();
      return;
    }

    activeEnv?.clearHover?.();

    const hit = hits[0];
    const side: PageSide = hit.object === leftSurface ? 'left' : 'right';
    const slot = this.getPageSlot(this.state.currentSpread, side);

    if (slot.kind === 'contents' && hit.uv) {
      const handle = this.getOrCreatePageHandle(this.state.currentSpread, 'left');
      const box = handle.contentsHitboxes.find(
        (b) =>
          hit.uv!.x >= b.uMin &&
          hit.uv!.x <= b.uMax &&
          hit.uv!.y >= b.vMin &&
          hit.uv!.y <= b.vMax,
      );
      const nextId = box?.projectId ?? null;
      this.setCursorInteractive(Boolean(box));
      if (nextId !== this.hoveredContentsProjectId) {
        this.hoveredContentsProjectId = nextId;
        handle.render(0, false, nextId);
        this.requestRender();
      }
      this.setActiveHoverProject(null, null);
      return;
    }

    if (this.hoveredContentsProjectId) {
      const contentsHandle = this.pageHandles.get(this.getSlotKey(0, 'left'));
      contentsHandle?.render(0, false, null);
      this.hoveredContentsProjectId = null;
    }

    if (slot.kind === 'project') {
      this.setCursorInteractive(true);
      this.setActiveHoverProject(slot.project, side);
    } else {
      this.setCursorInteractive(false);
      this.setActiveHoverProject(null, null);
    }
  }

  private restoreStaticPageTexture(side: PageSide) {
    const handle = this.pageHandles.get(this.getSlotKey(this.state.currentSpread, side));
    if (!handle) return;
    handle.render(0, false);
    const surface = side === 'left' ? this.bookRig.leftPageSurface : this.bookRig.rightPageSurface;
    const mat = surface.material as THREE.MeshStandardMaterial;
    if (mat.map !== handle.texture) {
      mat.map = handle.texture;
      mat.needsUpdate = true;
    }
  }

  private setActiveHoverProject(project: ProjectItem | null, side: PageSide | null) {
    if (this.hoveredSide === side && this.activePreviewSide === side) return;

    // Reset previous hovered page back to full 1920x1080 static poster
    if (this.hoveredSide && this.hoveredSide !== side) {
      this.restoreStaticPageTexture(this.hoveredSide);
    }

    this.hoveredSide = side;
    this.callbacks.onHoverProject(project, side);

    if (project && side && project.hasAnimatedPreview && !this.reducedMotion) {
      this.startPreviewLoop(side);
    } else {
      this.stopPreviewLoop();
      if (side) {
        const h = this.pageHandles.get(this.getSlotKey(this.state.currentSpread, side));
        h?.render(0, true);
      }
      this.requestRender();
    }
  }

  private clearHoverState() {
    this.setCursorInteractive(false);
    this.clearBookHoverOnly();
    this.getActiveEnvironment()?.clearHover?.();
    this.requestRender();
  }

  private startPreviewLoop(side: PageSide) {
    this.stopPreviewLoop();
    if (this.reducedMotion || this.isDocumentHidden || this.state.phase !== 'open') return;

    this.activePreviewSide = side;
    this.previewStartMs = performance.now();

    const surface = side === 'left' ? this.bookRig.leftPageSurface : this.bookRig.rightPageSurface;
    const mat = surface.material as THREE.MeshStandardMaterial;

    const step = () => {
      if (this.disposed || this.isDocumentHidden || this.activePreviewSide !== side) return;
      const elapsedSec = (performance.now() - this.previewStartMs) / 1000;
      const handle = this.pageHandles.get(this.getSlotKey(this.state.currentSpread, side));
      if (handle) {
        const liveTex = handle.renderLiveFrame(elapsedSec, true);
        if (mat.map !== liveTex) {
          mat.map = liveTex;
          mat.needsUpdate = true;
        }
        this.requestRender();
      }
      const interval = this.isSoftwareGl ? 200 : 62;
      this.previewAnimId = window.setTimeout(() => {
        if (!this.disposed) step();
      }, interval);
    };
    step();
  }

  private stopPreviewLoop() {
    if (this.previewAnimId) {
      clearTimeout(this.previewAnimId);
      this.previewAnimId = 0;
    }
    if (this.activePreviewSide) {
      this.restoreStaticPageTexture(this.activePreviewSide);
    }
    this.activePreviewSide = null;
  }

  public triggerManualPreview(side: PageSide | null) {
    if (side === null) {
      this.clearHoverState();
      return;
    }
    const slot = this.getPageSlot(this.state.currentSpread, side);
    if (slot.kind !== 'project') return;
    this.setActiveHoverProject(slot.project, side);
  }

  private handleDragPointerMove(e: PointerEvent) {
    const drag = this.dragState;
    if (!drag || this.disposed) return;

    const now = performance.now();
    const dt = Math.max(8, now - drag.lastTimeMs);
    const instantV = (e.clientX - drag.lastX) / dt;
    drag.velocityPxPerMs = drag.velocityPxPerMs * 0.65 + instantV * 0.35;
    drag.lastX = e.clientX;
    drag.lastTimeMs = now;

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;

    if (!drag.active) {
      if (Math.hypot(dx, dy) < 14) return;
      if (Math.abs(dx) < Math.abs(dy) * 0.65) {
        this.dragState = null;
        return;
      }

      const direction: 'next' | 'prev' = dx < 0 ? 'next' : 'prev';
      const isMobile = this.getViewportTier() === 'mobile';
      const startRes = beginDragTurn(this.state, direction, isMobile);

      if (startRes.sameSpreadMobileSide) {
        this.suppressNextClick = true;
        this.dragState = null;
        this.setMobileSide(startRes.sameSpreadMobileSide);
        return;
      }

      if (!startRes.startedSheetDrag) {
        this.dragState = null;
        return;
      }

      this.clearHoverState();
      this.dragTween?.kill();
      this.state = startRes.nextState;
      this.callbacks.onStateChange({ ...this.state });

      const prevLeftH = this.getOrCreatePageHandle(startRes.fromSpread, 'left');
      const prevRightH = this.getOrCreatePageHandle(startRes.fromSpread, 'right');
      const nextLeftH = this.getOrCreatePageHandle(startRes.toSpread, 'left');
      const nextRightH = this.getOrCreatePageHandle(startRes.toSpread, 'right');

      const slot = this.bookRig.turningSheets[0];
      if (!slot) {
        this.state = finishDragTurn(this.state, false);
        this.callbacks.onStateChange({ ...this.state });
        this.dragState = null;
        return;
      }

      if (direction === 'next') {
        this.bookRig.setSpreadTextures(prevLeftH.texture, nextRightH.texture);
        slot.frontMaterial.map = prevRightH.texture;
        slot.backMaterial.map = nextLeftH.texture;
        slot.progress = 0;
      } else {
        this.bookRig.setSpreadTextures(nextLeftH.texture, prevRightH.texture);
        slot.frontMaterial.map = nextRightH.texture;
        slot.backMaterial.map = prevLeftH.texture;
        slot.progress = 1;
      }
      slot.frontMaterial.needsUpdate = true;
      slot.backMaterial.needsUpdate = true;
      slot.mesh.visible = true;

      try {
        this.renderer.domElement.setPointerCapture(e.pointerId);
      } catch {
        // Ignore if pointer capture is unavailable
      }

      drag.active = true;
      drag.direction = direction;
      drag.fromSpread = startRes.fromSpread;
      drag.toSpread = startRes.toSpread;
      drag.lastStepMs = now;
      this.setCursorInteractive(true);

      const dragSpanPx = Math.max(320, Math.min(620, window.innerWidth * 0.42));
      const initialRaw =
        direction === 'next' ? -dx / dragSpanPx : 1 - dx / dragSpanPx;
      drag.targetProgress = Math.max(0.001, Math.min(0.999, initialRaw));
      drag.currentProgress =
        direction === 'next'
          ? Math.max(0.018, Math.min(0.18, drag.targetProgress))
          : Math.min(0.982, Math.max(0.82, drag.targetProgress));
      this.applyDragTurnVisuals(drag.fromSpread, drag.toSpread, drag.direction, drag.currentProgress);
      this.ensureDragSmoothingLoop();
      return;
    }

    if (drag.active && drag.direction) {
      const dragSpanPx = Math.max(320, Math.min(620, window.innerWidth * 0.42));
      const raw =
        drag.direction === 'next'
          ? -dx / dragSpanPx
          : 1 - dx / dragSpanPx;
      drag.targetProgress = Math.max(0.001, Math.min(0.999, raw));
      this.ensureDragSmoothingLoop();
    }
  }

  private updateDragTurnMesh(
    fromSpread: number,
    toSpread: number,
    direction: 'next' | 'prev',
    progress: number,
  ) {
    const slot = this.bookRig.turningSheets[0];
    if (!slot) return;
    const blend = direction === 'next' ? progress : 1 - progress;
    const spreadPos = fromSpread + (toSpread - fromSpread) * blend;
    this.bookRig.setStackHeights(spreadPos, PHYSICAL_SPREAD_COUNT, 1);
    slot.leftStackY = this.bookRig.leftPageSurface.position.y + 0.0028;
    slot.rightStackY = this.bookRig.rightPageSurface.position.y + 0.0028;
    slot.progress = progress;
    this.bookRig.updateTurningSheetGeometry(0);
  }

  private applyDragTurnVisuals(
    fromSpread: number,
    toSpread: number,
    direction: 'next' | 'prev',
    progress: number,
  ) {
    this.updateDragTurnMesh(fromSpread, toSpread, direction, progress);
    this.invalidateShadows();
    this.requestRender();
  }

  private stepActiveDragSmoothing() {
    const drag = this.dragState;
    if (!drag || !drag.active || !drag.direction) return false;
    const now = performance.now();
    const dtSec = Math.min(0.12, Math.max(0.004, (now - drag.lastStepMs) / 1000));
    drag.lastStepMs = now;
    const diff = drag.targetProgress - drag.currentProgress;
    if (Math.abs(diff) <= 0.0015) {
      if (drag.currentProgress !== drag.targetProgress) {
        drag.currentProgress = drag.targetProgress;
        this.updateDragTurnMesh(drag.fromSpread, drag.toSpread, drag.direction, drag.currentProgress);
      }
      return false;
    }
    const alpha = 1 - Math.exp(-16 * dtSec);
    drag.currentProgress += diff * alpha;
    this.updateDragTurnMesh(drag.fromSpread, drag.toSpread, drag.direction, drag.currentProgress);
    return Math.abs(drag.targetProgress - drag.currentProgress) > 0.0015;
  }

  private ensureDragSmoothingLoop() {
    if (this.dragTickId || this.disposed || !this.dragState?.active) return;
    const step = () => {
      this.dragTickId = 0;
      const drag = this.dragState;
      if (this.disposed || !drag || !drag.active || !drag.direction) return;

      const needsMore = this.stepActiveDragSmoothing();
      this.requestRender();

      if (needsMore) {
        this.dragTickId = window.setTimeout(step, this.isSoftwareGl ? 24 : 16);
      }
    };
    this.dragTickId = window.setTimeout(step, 16);
  }

  private finishDragGesture(e: PointerEvent) {
    const drag = this.dragState;
    this.dragState = null;
    clearTimeout(this.dragTickId);
    this.dragTickId = 0;

    if (!drag) return;
    try {
      if (this.renderer.domElement.hasPointerCapture(e.pointerId)) {
        this.renderer.domElement.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore if pointer capture is already released
    }

    if (!drag.active || !drag.direction) return;

    this.setCursorInteractive(false);
    this.suppressNextClick = true;
    window.setTimeout(() => {
      this.suppressNextClick = false;
    }, 60);

    const releaseAgeMs = performance.now() - drag.lastTimeMs;
    const releaseVelocity = releaseAgeMs > 120 ? 0 : drag.velocityPxPerMs;
    const { committed, endProgress } = resolveDragRelease({
      direction: drag.direction,
      progress: drag.currentProgress,
      velocityPxPerMs: releaseVelocity,
    });

    const slot = this.bookRig.turningSheets[0];
    if (!slot) {
      this.state = finishDragTurn(this.state, committed);
      this.callbacks.onStateChange({ ...this.state });
      return;
    }

    const proxy = { progress: drag.currentProgress };
    const remaining = Math.abs(endProgress - drag.currentProgress);
    const durationSec = this.reducedMotion ? 0.08 : Math.max(0.28, Math.min(0.85, remaining * 0.85));

    this.dragTween?.kill();
    this.dragTween = gsap.to(proxy, {
      progress: endProgress,
      duration: durationSec,
      ease: 'power2.out',
      onUpdate: () => {
        this.applyDragTurnVisuals(drag.fromSpread, drag.toSpread, drag.direction!, proxy.progress);
      },
      onComplete: () => {
        slot.mesh.visible = false;
        this.state = finishDragTurn(this.state, committed);
        const settledLeft = this.getOrCreatePageHandle(this.state.currentSpread, 'left');
        const settledRight = this.getOrCreatePageHandle(this.state.currentSpread, 'right');
        this.bookRig.setSpreadTextures(settledLeft.texture, settledRight.texture);
        this.bookRig.setStackHeights(this.state.currentSpread, PHYSICAL_SPREAD_COUNT, 1);
        this.invalidateShadows();
        this.callbacks.onStateChange({ ...this.state });
        this.scheduleIdlePreload(this.state.currentSpread);
        this.requestRender();
      },
    });
  }

  private handleCanvasClick(e: MouseEvent) {
    if (this.disposed || this.suppressNextClick) return;
    this.updateNdcFromClient(e.clientX, e.clientY);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const activeEnv = this.getActiveEnvironment();

    if (this.state.phase === 'closed') {
      const hits = this.raycaster.intersectObjects(this.bookRig.closedHitTargets, false);
      if (hits.length > 0) {
        this.openBook();
        return;
      }
      activeEnv?.onPointerClick?.(this.raycaster, this.pointerNdc);
      return;
    }

    if (this.state.phase !== 'open') return;

    const leftSurface =
      this.state.currentSpread === 0 ? this.bookRig.insideCoverSurface : this.bookRig.leftPageSurface;
    const hits = this.raycaster.intersectObjects(
      [leftSurface, this.bookRig.rightPageSurface],
      false,
    );
    if (hits.length === 0) {
      activeEnv?.onPointerClick?.(this.raycaster, this.pointerNdc);
      return;
    }

    const hit = hits[0];
    const side: PageSide = hit.object === leftSurface ? 'left' : 'right';
    const slot = this.getPageSlot(this.state.currentSpread, side);

    if (slot.kind === 'contents' && hit.uv) {
      const handle = this.getOrCreatePageHandle(this.state.currentSpread, 'left');
      const box = handle.contentsHitboxes.find(
        (b) =>
          hit.uv!.x >= b.uMin &&
          hit.uv!.x <= b.uMax &&
          hit.uv!.y >= b.vMin &&
          hit.uv!.y <= b.vMax,
      );
      if (box) {
        this.goToSpread(box.spreadIndex, box.side);
      }
      return;
    }

    if (slot.kind === 'project') {
      this.callbacks.onSelectProject(slot.project);
    }
  }

  public setReducedMotion(reduced: boolean) {
    this.reducedMotion = reduced;
    if (reduced) {
      this.stopPreviewLoop();
    }
  }

  public openBook() {
    if (this.state.phase !== 'closed') return;
    this.clearHoverState();
    this.hoverTween?.kill();
    this.hoverProxy.angle = 0;
    this.bookRig.setHoverLiftAngle(0);
    if (this.parallaxAnimId) {
      cancelAnimationFrame(this.parallaxAnimId);
      this.parallaxAnimId = 0;
    }

    this.state = beginOpen(this.state);
    this.callbacks.onStateChange({ ...this.state });

    // Spread 0 is pre-rendered & GPU-uploaded at reading resolution during init — zero frame-0 texture upload spike
    const leftH = this.getOrCreatePageHandle(0, 'left');
    const rightH = this.getOrCreatePageHandle(0, 'right');
    this.bookRig.setSpreadTextures(leftH.texture, rightH.texture);

    const targetCam = this.getTargetCameraPreset();
    const durationSec = this.reducedMotion
      ? BOOK_TIMING.reducedMotionFadeMs / 1000
      : BOOK_TIMING.openDurationMs / 1000;

    this.activeTimeline?.kill();
    const tl = gsap.timeline({
      onUpdate: () => {
        this.bookRig.setOpenProgress(this.animProxy.openProgress);
        this.bookRig.setStackHeights(0, PHYSICAL_SPREAD_COUNT, this.animProxy.openProgress);
        this.applyPhaseLighting(this.animProxy.openProgress);
        this.applyCameraFromProxy();
        this.invalidateShadows();
        this.requestRender();
      },
      onComplete: () => {
        this.applyPhaseLighting(1);
        this.state = finishOpen(this.state);
        this.invalidateShadows();
        this.callbacks.onStateChange({ ...this.state });
        this.scheduleIdlePreload(0);
        this.requestRender();
      },
    });

    tl.to(
      this.animProxy,
      {
        openProgress: 1,
        camX: targetCam.position.x,
        camY: targetCam.position.y,
        camZ: targetCam.position.z,
        targetX: targetCam.target.x,
        targetY: targetCam.target.y,
        targetZ: targetCam.target.z,
        fov: targetCam.fov,
        duration: durationSec,
        ease: 'power3.inOut',
      },
      0,
    );
    this.activeTimeline = tl;
  }

  public closeBook() {
    if (this.state.phase !== 'open') return;
    this.dragTween?.kill();
    this.clearHoverState();
    const startingSpread = this.state.currentSpread;
    this.state = beginClose(this.state);
    this.callbacks.onStateChange({ ...this.state });

    const targetCam = this.getTargetCameraPreset();
    const closeSec = this.reducedMotion
      ? BOOK_TIMING.reducedMotionFadeMs / 1000
      : BOOK_TIMING.closeDurationMs / 1000;

    this.activeTimeline?.kill();

    const tl = gsap.timeline({
      onComplete: () => {
        this.bookRig.turningSheets.forEach((slot) => {
          slot.mesh.visible = false;
        });
        const leftH = this.getOrCreatePageHandle(0, 'left');
        const rightH = this.getOrCreatePageHandle(0, 'right');
        this.bookRig.setSpreadTextures(leftH.texture, rightH.texture);
        this.bookRig.setOpenProgress(0);
        this.bookRig.setStackHeights(0, PHYSICAL_SPREAD_COUNT, 0);
        this.applyPhaseLighting(0);
        this.state = finishClose(this.state);
        this.invalidateShadows();
        this.callbacks.onStateChange({ ...this.state });
        this.requestRender();
      },
    });

    let foldStartSec = 0;

    // Multi-stage physical close: if past Spread 0, sweep turned sheets back right first
    if (!this.reducedMotion && startingSpread > 0) {
      const sweepCount = Math.min(BOOK_TIMING.maxBatchSheets, startingSpread);
      const sweepDurSec = BOOK_TIMING.closeSweepDurationMs / 1000;
      const staggerSec = 0.11;

      const curLeftH = this.getOrCreatePageHandle(startingSpread, 'left');
      const curRightH = this.getOrCreatePageHandle(startingSpread, 'right');
      const spread1LeftH = this.getOrCreatePageHandle(Math.min(1, startingSpread), 'left');
      const homeLeftH = this.getOrCreatePageHandle(0, 'left');
      const homeRightH = this.getOrCreatePageHandle(0, 'right');

      // Show Spread 0 underneath left stack while sheets sweep back onto right stack
      this.bookRig.setContentsTexture(homeLeftH.texture);
      this.bookRig.setSpreadTextures(homeLeftH.texture, curRightH.texture);

      const syncCloseSweepStackHeights = () => {
        const curLeftTop = this.bookRig.leftPageSurface.position.y + 0.0028;
        const curRightTop = this.bookRig.rightPageSurface.position.y + 0.0028;
        for (let k = 0; k < sweepCount; k++) {
          const s = this.bookRig.turningSheets[k];
          if (!s) continue;
          s.leftStackY = curLeftTop + (sweepCount - 1 - k) * 0.0028;
          s.rightStackY = curRightTop + k * 0.0028;
          if (s.mesh.visible) {
            this.bookRig.updateTurningSheetGeometry(k);
          }
        }
      };

      const sweepEndSec = sweepDurSec + (sweepCount - 1) * staggerSec;
      const stackTween = { spreadPos: startingSpread };

      for (let i = 0; i < sweepCount; i++) {
        const slot = this.bookRig.turningSheets[i];
        if (!slot) continue;
        const isLeading = i === 0;
        const isTrailing = i === sweepCount - 1;
        slot.frontMaterial.map = isTrailing ? homeRightH.texture : curRightH.texture;
        slot.backMaterial.map = isLeading ? curLeftH.texture : spread1LeftH.texture;
        slot.frontMaterial.needsUpdate = true;
        slot.backMaterial.needsUpdate = true;
        slot.progress = 1;
        slot.mesh.visible = true;
      }
      syncCloseSweepStackHeights();

      tl.to(
        stackTween,
        {
          spreadPos: 0,
          duration: sweepEndSec,
          ease: 'power2.inOut',
          onUpdate: () => {
            this.bookRig.setStackHeights(stackTween.spreadPos, PHYSICAL_SPREAD_COUNT, 1);
            syncCloseSweepStackHeights();
            this.invalidateShadows();
            this.requestRender();
          },
        },
        0,
      );

      for (let i = 0; i < sweepCount; i++) {
        const slot = this.bookRig.turningSheets[i];
        if (!slot) continue;

        tl.to(
          slot,
          {
            progress: 0,
            duration: sweepDurSec,
            ease: 'power2.inOut',
            onUpdate: () => {
              this.bookRig.updateTurningSheetGeometry(i);
              this.invalidateShadows();
              this.requestRender();
            },
          },
          i * staggerSec,
        );
      }

      foldStartSec = sweepEndSec;
      tl.call(
        () => {
          this.bookRig.turningSheets.forEach((slot) => {
            slot.mesh.visible = false;
          });
          this.bookRig.setSpreadTextures(homeLeftH.texture, homeRightH.texture);
          this.bookRig.setStackHeights(0, PHYSICAL_SPREAD_COUNT, 1);
          this.invalidateShadows();
          this.requestRender();
        },
        undefined,
        foldStartSec,
      );
    }

    const totalCloseEndSec = foldStartSec + closeSec;

    // Smoothly pull camera out across the full close choreography
    tl.to(
      this.animProxy,
      {
        camX: targetCam.position.x,
        camY: targetCam.position.y,
        camZ: targetCam.position.z,
        targetX: targetCam.target.x,
        targetY: targetCam.target.y,
        targetZ: targetCam.target.z,
        fov: targetCam.fov,
        duration: totalCloseEndSec,
        ease: 'power3.inOut',
        onUpdate: () => {
          this.applyCameraFromProxy();
          this.requestRender();
        },
      },
      0,
    );

    // Fold the front cover smoothly onto the full right stack
    tl.to(
      this.animProxy,
      {
        openProgress: 0,
        duration: closeSec,
        ease: 'power3.inOut',
        onUpdate: () => {
          this.bookRig.setOpenProgress(this.animProxy.openProgress);
          this.bookRig.setStackHeights(0, PHYSICAL_SPREAD_COUNT, this.animProxy.openProgress);
          this.applyPhaseLighting(this.animProxy.openProgress);
          this.invalidateShadows();
          this.requestRender();
        },
      },
      foldStartSec,
    );

    this.activeTimeline = tl;
  }

  public step(direction: 'next' | 'prev') {
    const isMobile = this.getViewportTier() === 'mobile';
    const target = getStepTarget(this.state, direction, isMobile);
    if (!target) return;
    this.goToSpread(target.targetSpread, target.targetMobileSide);
  }

  public setMobileSide(side: PageSide) {
    if (this.state.phase !== 'open' || this.state.mobileSide === side) return;
    this.state = { ...this.state, mobileSide: side };
    this.callbacks.onStateChange({ ...this.state });
    this.reframeCamera();
  }

  private reframeCamera() {
    const targetCam = this.getTargetCameraPreset();
    const durationSec = this.reducedMotion ? 0.1 : 0.48;
    gsap.to(this.animProxy, {
      camX: targetCam.position.x,
      camY: targetCam.position.y,
      camZ: targetCam.position.z,
      targetX: targetCam.target.x,
      targetY: targetCam.target.y,
      targetZ: targetCam.target.z,
      fov: targetCam.fov,
      duration: durationSec,
      ease: 'power2.out',
      onUpdate: () => {
        this.applyCameraFromProxy();
        this.requestRender();
      },
    });
  }

  public goToSpread(targetSpread: number, targetMobileSide?: PageSide) {
    const prevSpread = this.state.currentSpread;
    const { nextState, started } = requestSpreadNavigation(
      this.state,
      targetSpread,
      targetMobileSide,
    );
    this.state = nextState;
    this.callbacks.onStateChange({ ...this.state });

    if (!started) {
      if (this.state.phase === 'open' && targetMobileSide) {
        this.reframeCamera();
      }
      return;
    }

    this.dragTween?.kill();
    this.clearHoverState();

    if (this.reducedMotion) {
      // Instantaneous spread swap for reduced motion
      const leftH = this.getOrCreatePageHandle(targetSpread, 'left');
      const rightH = this.getOrCreatePageHandle(targetSpread, 'right');
      this.bookRig.setSpreadTextures(leftH.texture, rightH.texture);
      this.bookRig.setStackHeights(targetSpread, PHYSICAL_SPREAD_COUNT, 1);
      const { nextState: settled } = finishTurn(this.state);
      this.state = settled;
      this.invalidateShadows();
      this.callbacks.onStateChange({ ...this.state });
      this.reframeCamera();
      this.scheduleIdlePreload(targetSpread);
      this.requestRender();
      return;
    }

    const plan = computeTurnPlan(
      prevSpread,
      targetSpread,
      BOOK_TIMING.maxBatchSheets,
      BOOK_TIMING.singleTurnDurationMs,
      BOOK_TIMING.batchTurnDurationMs,
      BOOK_TIMING.batchTurnStaggerMs,
    );

    const prevLeftH = this.getOrCreatePageHandle(prevSpread, 'left');
    const prevRightH = this.getOrCreatePageHandle(prevSpread, 'right');
    const nextLeftH = this.getOrCreatePageHandle(targetSpread, 'left');
    const nextRightH = this.getOrCreatePageHandle(targetSpread, 'right');

    // Underlying stacks show what is uncovered during the sweep!
    if (plan.direction === 'next') {
      this.bookRig.setSpreadTextures(prevLeftH.texture, nextRightH.texture);
    } else {
      this.bookRig.setSpreadTextures(nextLeftH.texture, prevRightH.texture);
    }

    const syncTurnStackHeights = () => {
      const curLeftTop = this.bookRig.leftPageSurface.position.y + 0.0028;
      const curRightTop = this.bookRig.rightPageSurface.position.y + 0.0028;
      for (let k = 0; k < plan.sheetCount; k++) {
        const s = this.bookRig.turningSheets[k];
        if (!s) continue;
        if (plan.direction === 'next') {
          s.rightStackY = curRightTop + (plan.sheetCount - 1 - k) * 0.0028;
          s.leftStackY = curLeftTop + k * 0.0028;
        } else {
          s.leftStackY = curLeftTop + (plan.sheetCount - 1 - k) * 0.0028;
          s.rightStackY = curRightTop + k * 0.0028;
        }
        if (s.mesh.visible) {
          this.bookRig.updateTurningSheetGeometry(k);
        }
      }
    };

    const stackTween = { spreadPos: prevSpread };

    this.activeTimeline?.kill();
    const tl = gsap.timeline({
      onComplete: () => {
        this.bookRig.turningSheets.forEach((slot) => {
          slot.mesh.visible = false;
        });
        this.bookRig.setSpreadTextures(nextLeftH.texture, nextRightH.texture);
        this.bookRig.setStackHeights(targetSpread, PHYSICAL_SPREAD_COUNT, 1);
        const { nextState: settled, queuedPlan } = finishTurn(this.state);
        this.state = settled;
        this.invalidateShadows();
        this.callbacks.onStateChange({ ...this.state });
        this.scheduleIdlePreload(targetSpread);
        this.requestRender();

        if (queuedPlan) {
          this.goToSpread(queuedPlan.targetSpread, queuedPlan.targetMobileSide);
        }
      },
    });

    for (let i = 0; i < plan.sheetCount; i++) {
      const slot = this.bookRig.turningSheets[i];
      if (!slot) continue;

      const isLeadingSheet = i === 0;
      const isTrailingSheet = i === plan.sheetCount - 1;

      if (plan.direction === 'next') {
        slot.frontMaterial.map = isLeadingSheet ? prevRightH.texture : nextRightH.texture;
        slot.backMaterial.map = isTrailingSheet ? nextLeftH.texture : prevLeftH.texture;
        slot.progress = 0;
      } else {
        slot.frontMaterial.map = isTrailingSheet ? nextRightH.texture : prevRightH.texture;
        slot.backMaterial.map = isLeadingSheet ? prevLeftH.texture : nextLeftH.texture;
        slot.progress = 1;
      }
      slot.frontMaterial.needsUpdate = true;
      slot.backMaterial.needsUpdate = true;
      slot.mesh.visible = true;
    }
    syncTurnStackHeights();

    tl.to(
      stackTween,
      {
        spreadPos: targetSpread,
        duration: (plan.durationMs + plan.staggerMs * (plan.sheetCount - 1)) / 1000,
        ease: 'power2.inOut',
        onUpdate: () => {
          this.bookRig.setStackHeights(stackTween.spreadPos, PHYSICAL_SPREAD_COUNT, 1);
          syncTurnStackHeights();
        },
      },
      0,
    );

    // Camera reframe for mobile single-page side switches during turn
    if (this.getViewportTier() === 'mobile') {
      const targetCam = this.getTargetCameraPreset();
      tl.to(
        this.animProxy,
        {
          camX: targetCam.position.x,
          targetX: targetCam.target.x,
          duration: (plan.durationMs + plan.staggerMs * (plan.sheetCount - 1)) / 1000,
          ease: 'power2.inOut',
          onUpdate: () => this.applyCameraFromProxy(),
        },
        0,
      );
    }

    for (let i = 0; i < plan.sheetCount; i++) {
      const slot = this.bookRig.turningSheets[i];
      if (!slot) continue;

      const offsetSec = (i * plan.staggerMs) / 1000;
      const durSec = plan.durationMs / 1000;

      tl.to(
        slot,
        {
          progress: plan.direction === 'next' ? 1 : 0,
          duration: durSec,
          ease: 'power2.inOut',
          onUpdate: () => {
            this.bookRig.updateTurningSheetGeometry(i);
            this.invalidateShadows();
            this.requestRender();
          },
        },
        offsetSec,
      );
    }

    this.activeTimeline = tl;
  }

  private afterDraw(cb: () => void) {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (typeof gl.fenceSync === 'function') {
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        this.afterDrawTimerId = 0;
        if (this.disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const status = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
        if (status === gl.UNSIGNALED) {
          this.afterDrawTimerId = window.setTimeout(poll, 4);
        } else {
          if (sync) gl.deleteSync(sync);
          this.afterDrawTimerId = window.setTimeout(cb, 20);
        }
      };
      this.afterDrawTimerId = window.setTimeout(poll, 4);
    } else {
      this.afterDrawTimerId = window.setTimeout(cb, 20);
    }
  }

  private requestRender() {
    if (this.disposed) return;
    if (this.renderBusy) {
      this.renderDirty = true;
      return;
    }
    this.renderBusy = true;
    this.frameId = requestAnimationFrame((nowMs) => {
      this.frameId = 0;
      if (this.disposed) return;
      this.renderDirty = false;
      if (this.dragState?.active && this.stepActiveDragSmoothing()) {
        this.renderDirty = true;
      }

      const activeEnv = this.getActiveEnvironment();
      if (activeEnv && this.initializedEnvs.has(this.activeEnvId)) {
        const dtSec = Math.min(0.16, Math.max(0.001, (nowMs - this.lastEnvUpdateMs) / 1000));
        this.lastEnvUpdateMs = nowMs;
        const elapsedSec = (nowMs - this.envStartMs) / 1000;
        activeEnv.update(dtSec, elapsedSec);
        if (this.activeEnvId === 'pond') {
          const bookAnimating = Boolean(
            this.activeTimeline?.isActive() ||
              this.hoverTween?.isActive() ||
              this.dragState?.active ||
              this.dragTween?.isActive(),
          );
          if (bookAnimating || nowMs - this.lastPondShadowMs >= 32) {
            this.lastPondShadowMs = nowMs;
            this.invalidateShadows();
          }
        }
        activeEnv.onBeforeMainRender?.(this.renderer, this.scene, this.camera);
      }

      this.updateBookShaderBounds();
      this.updateDepthOfFieldUniforms();
      if (this.composer) {
        this.composer.render();
      } else {
        this.renderer.render(this.scene, this.camera);
      }
      const done = () => {
        this.renderBusy = false;
        if (this.disposed) return;
        if (this.renderDirty) {
          this.requestRender();
        } else if (this.activeEnvId === 'pond' && !this.isDocumentHidden) {
          this.startPondLoop();
        }
      };
      if (this.isSoftwareGl) {
        this.afterDraw(done);
      } else {
        done();
      }
    });
  }

  public dispose() {
    this.disposed = true;
    this.hoverTween?.kill();
    this.dragTween?.kill();
    this.activeTimeline?.kill();
    this.stopPreviewLoop();
    this.stopPondLoop();
    cancelAnimationFrame(this.parallaxAnimId);
    clearTimeout(this.preloadQueueTimer);
    clearTimeout(this.dragTickId);
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.afterDrawTimerId);

    this.environments.forEach((env, envId) => {
      if (this.initializedEnvs.has(envId)) {
        env.dispose();
      }
    });
    this.environments.clear();
    this.initializedEnvs.clear();

    this.cleanupFns.forEach((fn) => fn());
    this.pageHandles.forEach((h) => h.dispose());
    this.pageHandles.clear();

    this.bookRig?.dispose();
    this.dofPass?.dispose();
    this.gradingPass?.dispose();
    this.composer?.dispose();
    this.renderer?.dispose();
    if (this.renderer?.domElement?.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}
