import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
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
  beginOpen,
  computeCursorCameraOffset,
  computeTurnPlan,
  createInitialBookState,
  finishClose,
  finishOpen,
  finishTurn,
  getStepTarget,
  requestSpreadNavigation,
  type BookControllerState,
  type PageSide,
} from './bookState';
import { createDeskProps, type DeskPropsRig } from './props';
import { VignetteGradingShader } from './shaders';
import {
  createBookStaticTextures,
  createDeskTextures,
  createPageTextureHandle,
  type PageTextureHandle,
} from './textures';

export interface BookSceneCallbacks {
  onStateChange: (state: BookControllerState) => void;
  onHoverProject: (project: ProjectItem | null, side: PageSide | null) => void;
  onCursorInteractiveChange?: (interactive: boolean) => void;
  onSelectProject: (project: ProjectItem) => void;
  onWebGLFailed: (reason: string) => void;
  onReady: () => void;
}

export class BookSceneController {
  private container: HTMLElement;
  private theme: SceneTheme;
  private callbacks: BookSceneCallbacks;
  private reducedMotion: boolean;

  private renderer!: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private gradingPass: ShaderPass | null = null;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private bookRig!: BookRig;
  private propsRig!: DeskPropsRig;

  private isSoftwareGl = false;
  private renderBusy = false;
  private renderDirty = false;
  private frameId = 0;
  private previewAnimId = 0;
  private parallaxAnimId = 0;
  private disposed = false;
  private isDocumentHidden = false;

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
    options: { autostart?: boolean; reducedMotion?: boolean } = {},
  ) {
    this.container = container;
    this.theme = theme;
    this.callbacks = callbacks;
    this.reducedMotion = Boolean(options.reducedMotion);
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

  private getOrCreatePageHandle(spreadIdx: number, side: PageSide): PageTextureHandle {
    const key = this.getSlotKey(spreadIdx, side);
    const existing = this.pageHandles.get(key);
    if (existing) return existing;

    const slot = this.getPageSlot(spreadIdx, side);
    const maxAniso = this.renderer ? Math.min(8, this.renderer.capabilities.getMaxAnisotropy()) : 4;
    const handle = createPageTextureHandle(slot, side, SITE_CONFIG.brandName, maxAniso, () => {
      if (!this.disposed) this.requestRender();
    });
    this.pageHandles.set(key, handle);
    return handle;
  }

  private preloadAdjacentSpreads(centerSpread: number) {
    const indices = [centerSpread - 1, centerSpread, centerSpread + 1].filter(
      (i) => i >= 0 && i < BOOK_SPREADS.length,
    );
    for (const idx of indices) {
      this.getOrCreatePageHandle(idx, 'left');
      this.getOrCreatePageHandle(idx, 'right');
    }
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
    const basePos = new THREE.Vector3(this.animProxy.camX, this.animProxy.camY, this.animProxy.camZ);
    const target = new THREE.Vector3(
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
      const offset = basePos.clone().sub(target);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), yawRad);
      offset.applyAxisAngle(new THREE.Vector3(1, 0, 0), pitchRad);
      basePos.copy(target).add(offset);
    }

    this.camera.position.copy(basePos);
    this.camera.lookAt(target);
    if (Math.abs(this.camera.fov - this.animProxy.fov) > 0.05) {
      this.camera.fov = this.animProxy.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private syncPropsForViewport() {
    const tier = this.getViewportTier();
    this.propsRig.applyLayout(this.theme.props[tier]);
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
      // Cap DPR up to 2 on GPU for sharp 16:9 canvas typography, or 1 on software WebGL
      this.renderer.setPixelRatio(
        this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2),
      );
      this.renderer.setSize(width, height);
      this.renderer.shadowMap.enabled = !this.isSoftwareGl;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.domElement.style.display = 'block';
      this.renderer.domElement.style.width = '100%';
      this.renderer.domElement.style.height = '100%';
      this.renderer.domElement.setAttribute('aria-hidden', 'true');
      this.container.appendChild(this.renderer.domElement);

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(this.theme.palette.background);
      this.scene.fog = new THREE.FogExp2(this.theme.palette.background, 0.165);

      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environmentIntensity = 0.14;
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

      // Lighting rig: sharp warm overhead desk SpotLight + subtle directional fill + cool hemi + rim
      const keyLight = new THREE.DirectionalLight(
        this.theme.lighting.keyColor,
        this.theme.lighting.keyIntensity * 0.65,
      );
      keyLight.position.set(
        this.theme.lighting.keyPosition.x,
        this.theme.lighting.keyPosition.y,
        this.theme.lighting.keyPosition.z,
      );
      this.scene.add(keyLight);

      const deskLamp = new THREE.SpotLight(
        this.theme.lighting.spotColor,
        this.theme.lighting.spotIntensity,
        12.0,
        this.theme.lighting.spotAngle,
        this.theme.lighting.spotPenumbra,
        this.theme.lighting.spotDecay,
      );
      deskLamp.position.set(
        this.theme.lighting.spotPosition.x,
        this.theme.lighting.spotPosition.y,
        this.theme.lighting.spotPosition.z,
      );
      deskLamp.target.position.set(
        this.theme.lighting.spotTarget.x,
        this.theme.lighting.spotTarget.y,
        this.theme.lighting.spotTarget.z,
      );
      deskLamp.castShadow = !this.isSoftwareGl;
      const shadowMapRes = this.isSoftwareGl ? 1024 : 2048;
      deskLamp.shadow.mapSize.set(shadowMapRes, shadowMapRes);
      deskLamp.shadow.camera.near = 0.8;
      deskLamp.shadow.camera.far = 11;
      deskLamp.shadow.bias = -0.0003;
      deskLamp.shadow.normalBias = 0.014;
      deskLamp.shadow.radius = 2.6;
      this.scene.add(deskLamp.target);
      this.scene.add(deskLamp);

      const hemiLight = new THREE.HemisphereLight(
        this.theme.lighting.hemiSkyColor,
        this.theme.lighting.hemiGroundColor,
        this.theme.lighting.hemiIntensity,
      );
      this.scene.add(hemiLight);

      const rimLight = new THREE.DirectionalLight(
        this.theme.lighting.rimColor,
        this.theme.lighting.rimIntensity,
      );
      rimLight.position.set(
        this.theme.lighting.rimPosition.x,
        this.theme.lighting.rimPosition.y,
        this.theme.lighting.rimPosition.z,
      );
      this.scene.add(rimLight);

      // Post-processing composer with 4x MSAA on GPU: RenderPass -> VignetteGradingShader -> OutputPass
      const composerDpr = this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2);
      const composerTarget = new THREE.WebGLRenderTarget(
        Math.max(1, Math.round(width * composerDpr)),
        Math.max(1, Math.round(height * composerDpr)),
        {
          samples: this.isSoftwareGl ? 0 : 4,
          type: THREE.HalfFloatType,
        },
      );
      this.composer = new EffectComposer(this.renderer, composerTarget);
      this.composer.setPixelRatio(composerDpr);
      this.composer.setSize(width, height);
      this.composer.addPass(new RenderPass(this.scene, this.camera));

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
      const deskTextures = createDeskTextures(this.theme, maxAniso);
      const staticTextures = createBookStaticTextures(this.theme, SITE_CONFIG.brandName, maxAniso);

      // Desk surface extending seamlessly without visible horizon
      const deskGeo = new THREE.PlaneGeometry(18, 14, 1, 1);
      deskGeo.rotateX(-Math.PI / 2);
      const deskMat = new THREE.MeshStandardMaterial({
        map: deskTextures.baseColor,
        normalMap: deskTextures.normalMap,
        normalScale: new THREE.Vector2(0.18, 0.18),
        roughnessMap: deskTextures.roughnessMap,
        roughness: this.theme.materials.deskRoughness,
        metalness: 0.04,
        envMapIntensity: 0.16,
      });
      const deskMesh = new THREE.Mesh(deskGeo, deskMat);
      deskMesh.receiveShadow = true;
      this.scene.add(deskMesh);

      // Soft radial contact shadow directly beneath the 16:9 book
      const contactShadowCanvas = document.createElement('canvas');
      contactShadowCanvas.width = 256;
      contactShadowCanvas.height = 256;
      const csCtx = contactShadowCanvas.getContext('2d')!;
      const csGrad = csCtx.createRadialGradient(128, 128, 30, 128, 128, 124);
      csGrad.addColorStop(0, 'rgba(0,0,0,0.64)');
      csGrad.addColorStop(0.65, 'rgba(0,0,0,0.34)');
      csGrad.addColorStop(1, 'rgba(0,0,0,0)');
      csCtx.fillStyle = csGrad;
      csCtx.fillRect(0, 0, 256, 256);
      const contactShadowTex = new THREE.CanvasTexture(contactShadowCanvas);
      const contactShadowGeo = new THREE.PlaneGeometry(3.4, 1.85);
      contactShadowGeo.rotateX(-Math.PI / 2);
      const contactShadowMat = new THREE.MeshBasicMaterial({
        map: contactShadowTex,
        transparent: true,
        depthWrite: false,
        opacity: 0.72,
      });
      const contactShadow = new THREE.Mesh(contactShadowGeo, contactShadowMat);
      contactShadow.position.y = 0.002;
      this.scene.add(contactShadow);

      // Book rig & Props
      this.bookRig = createBookRig(this.theme, staticTextures, BOOK_TIMING.maxBatchSheets);
      this.scene.add(this.bookRig.group);

      this.propsRig = createDeskProps(staticTextures);
      this.syncPropsForViewport();
      this.scene.add(this.propsRig.group);

      // Preload initial spreads and apply textures
      this.preloadAdjacentSpreads(this.state.currentSpread);
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

      if (!this.isSoftwareGl) {
        this.renderer.compile(this.scene, this.camera);
      }

      this.bindEvents();
      this.requestRender();
      this.callbacks.onStateChange({ ...this.state });
      this.callbacks.onReady();

      this.cleanupFns.push(() => {
        composerTarget.dispose();
        deskTextures.dispose();
        staticTextures.dispose();
        deskGeo.dispose();
        deskMat.dispose();
        contactShadowTex.dispose();
        contactShadowGeo.dispose();
        contactShadowMat.dispose();
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
      this.gradingPass?.uniforms.uResolution.value.set(w, h);
      this.syncPropsForViewport();

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
      if (e.pointerType === 'touch' || this.reducedMotion) return;
      const w = Math.max(1, window.innerWidth);
      const h = Math.max(1, window.innerHeight);
      this.cursorTargetNdc.set((e.clientX / w) * 2 - 1, -((e.clientY / h) * 2 - 1));
      this.ensureParallaxLoop();
    };
    window.addEventListener('pointermove', onWindowPointerMove, { passive: true });

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const now = performance.now();
      if (now - this.lastRaycastMs < 35) return;
      this.lastRaycastMs = now;
      this.handleHoverRaycast(e);
    };
    canvas.addEventListener('pointermove', onPointerMove);

    const onPointerLeave = () => {
      this.clearHoverState();
    };
    canvas.addEventListener('pointerleave', onPointerLeave);

    const onClick = (e: MouseEvent) => {
      this.handleCanvasClick(e);
    };
    canvas.addEventListener('click', onClick);

    const onVisibility = () => {
      this.isDocumentHidden = document.hidden;
      if (this.isDocumentHidden) {
        this.stopPreviewLoop();
      } else if (this.activePreviewSide) {
        this.startPreviewLoop(this.activePreviewSide);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    this.cleanupFns.push(() => {
      canvas.removeEventListener('webglcontextlost', onContextLost);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onWindowPointerMove);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('click', onClick);
      document.removeEventListener('visibilitychange', onVisibility);
    });
  }

  private ensureParallaxLoop() {
    if (this.parallaxAnimId || this.disposed || this.reducedMotion) return;
    const tick = () => {
      if (this.disposed || this.reducedMotion) {
        this.parallaxAnimId = 0;
        return;
      }
      const dx = this.cursorTargetNdc.x - this.cursorCurrentNdc.x;
      const dy = this.cursorTargetNdc.y - this.cursorCurrentNdc.y;
      const factor = this.isSoftwareGl ? 0.35 : 0.14;
      this.cursorCurrentNdc.x += dx * factor;
      this.cursorCurrentNdc.y += dy * factor;

      this.applyCameraFromProxy();
      this.requestRender();

      if (Math.abs(dx) > 0.002 || Math.abs(dy) > 0.002) {
        this.parallaxAnimId = window.setTimeout(tick, this.isSoftwareGl ? 45 : 16);
      } else {
        this.cursorCurrentNdc.copy(this.cursorTargetNdc);
        this.applyCameraFromProxy();
        this.parallaxAnimId = 0;
      }
    };
    this.parallaxAnimId = window.setTimeout(tick, 16);
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
        this.requestRender();
      },
    });
  }

  private handleHoverRaycast(e: PointerEvent) {
    if (this.disposed) return;
    this.updateNdcFromClient(e.clientX, e.clientY);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);

    if (this.state.phase === 'closed') {
      const hits = this.raycaster.intersectObject(this.bookRig.frontCoverMesh, false);
      const isHover = hits.length > 0;
      this.setCursorInteractive(isHover);
      if (isHover !== this.hoveredCover) {
        this.hoveredCover = isHover;
        this.tweenCoverHoverLift(isHover);
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
      this.clearHoverState();
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

  private setActiveHoverProject(project: ProjectItem | null, side: PageSide | null) {
    if (this.hoveredSide === side && this.activePreviewSide === side) return;

    // Reset previous hovered page back to static poster
    if (this.hoveredSide && this.hoveredSide !== side) {
      const prevHandle = this.pageHandles.get(
        this.getSlotKey(this.state.currentSpread, this.hoveredSide),
      );
      prevHandle?.render(0, false);
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
      const prevHandle = this.pageHandles.get(
        this.getSlotKey(this.state.currentSpread, this.hoveredSide),
      );
      prevHandle?.render(0, false);
      this.hoveredSide = null;
      this.callbacks.onHoverProject(null, null);
    }
    this.stopPreviewLoop();
    this.requestRender();
  }

  private startPreviewLoop(side: PageSide) {
    this.stopPreviewLoop();
    if (this.reducedMotion || this.isDocumentHidden || this.state.phase !== 'open') return;

    this.activePreviewSide = side;
    this.previewStartMs = performance.now();

    const step = () => {
      if (this.disposed || this.isDocumentHidden || this.activePreviewSide !== side) return;
      const elapsedSec = (performance.now() - this.previewStartMs) / 1000;
      const handle = this.pageHandles.get(this.getSlotKey(this.state.currentSpread, side));
      if (handle) {
        handle.render(elapsedSec, true);
        this.requestRender();
      }
      const interval = this.isSoftwareGl ? 180 : 42;
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

  private handleCanvasClick(e: MouseEvent) {
    if (this.disposed) return;
    this.updateNdcFromClient(e.clientX, e.clientY);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);

    if (this.state.phase === 'closed') {
      const hits = this.raycaster.intersectObject(this.bookRig.frontCoverMesh, false);
      if (hits.length > 0) {
        this.openBook();
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
    if (hits.length === 0) return;

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

    this.state = beginOpen(this.state);
    this.callbacks.onStateChange({ ...this.state });

    this.preloadAdjacentSpreads(0);
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
        this.applyCameraFromProxy();
        this.requestRender();
      },
      onComplete: () => {
        this.state = finishOpen(this.state);
        this.callbacks.onStateChange({ ...this.state });
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
        this.state = finishClose(this.state);
        this.callbacks.onStateChange({ ...this.state });
        this.requestRender();
      },
    });

    let foldStartSec = 0;

    // Multi-stage physical close: if past Spread 0, sweep turned sheets back right first
    if (!this.reducedMotion && startingSpread > 0) {
      const sweepCount = Math.min(BOOK_TIMING.maxBatchSheets, startingSpread);
      const sweepDurSec = BOOK_TIMING.closeSweepDurationMs / 1000;
      const staggerSec = 0.08;

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

    this.clearHoverState();
    this.preloadAdjacentSpreads(targetSpread);

    if (this.reducedMotion) {
      // Instantaneous spread swap for reduced motion
      const leftH = this.getOrCreatePageHandle(targetSpread, 'left');
      const rightH = this.getOrCreatePageHandle(targetSpread, 'right');
      this.bookRig.setSpreadTextures(leftH.texture, rightH.texture);
      this.bookRig.setStackHeights(targetSpread, PHYSICAL_SPREAD_COUNT, 1);
      const { nextState: settled } = finishTurn(this.state);
      this.state = settled;
      this.callbacks.onStateChange({ ...this.state });
      this.reframeCamera();
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
        this.callbacks.onStateChange({ ...this.state });
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
        if (this.disposed) return;
        const status = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
        if (status === gl.UNSIGNALED) {
          this.frameId = window.setTimeout(poll, 4);
        } else {
          if (sync) gl.deleteSync(sync);
          this.frameId = window.setTimeout(cb, 20);
        }
      };
      this.frameId = window.setTimeout(poll, 4);
    } else {
      this.frameId = window.setTimeout(cb, 20);
    }
  }

  private requestRender() {
    if (this.disposed) return;
    if (this.renderBusy) {
      this.renderDirty = true;
      return;
    }
    this.renderBusy = true;
    this.frameId = requestAnimationFrame(() => {
      if (this.disposed) return;
      this.renderDirty = false;
      if (this.composer) {
        this.composer.render();
      } else {
        this.renderer.render(this.scene, this.camera);
      }
      const done = () => {
        this.renderBusy = false;
        if (this.renderDirty && !this.disposed) {
          this.requestRender();
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
    this.activeTimeline?.kill();
    this.stopPreviewLoop();
    clearTimeout(this.parallaxAnimId);
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);

    this.cleanupFns.forEach((fn) => fn());
    this.pageHandles.forEach((h) => h.dispose());
    this.pageHandles.clear();

    this.bookRig?.dispose();
    this.propsRig?.dispose();
    this.composer?.dispose();
    this.renderer?.dispose();
    if (this.renderer?.domElement?.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}
