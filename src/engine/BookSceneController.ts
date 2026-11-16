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
import { createDeskProps, type DeskPropsRig } from './props';
import { enhanceDeskShader, VignetteGradingShader } from './shaders';
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
  private keyLight!: THREE.DirectionalLight;
  private deskLamp!: THREE.SpotLight;
  private hemiLight!: THREE.HemisphereLight;
  private rimLight!: THREE.DirectionalLight;

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

  private getTargetSupersampleScale(): number {
    const width = Math.max(1, this.container.clientWidth || window.innerWidth);
    const dpr = window.devicePixelRatio || 1;
    const maxTextureSize = this.renderer?.capabilities.maxTextureSize ?? 4096;
    return computePageSupersampleScale({
      phase: this.state.phase,
      viewportWidth: width,
      dpr,
      isSoftwareGl: this.isSoftwareGl,
      maxTextureSize,
    });
  }

  private syncPageSupersampling() {
    const targetScale = this.getTargetSupersampleScale();
    let changed = false;
    this.pageHandles.forEach((handle) => {
      if (handle.setSupersampleScale(targetScale)) {
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
    const maxAniso = this.renderer ? Math.min(16, this.renderer.capabilities.getMaxAnisotropy()) : 4;
    const handle = createPageTextureHandle(
      slot,
      side,
      SITE_CONFIG.brandName,
      maxAniso,
      () => {
        if (!this.disposed) this.requestRender();
      },
      this.getTargetSupersampleScale(),
    );
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

    const corners = [
      new THREE.Vector3(minLocalX, 0, -halfH),
      new THREE.Vector3(maxLocalX, 0, -halfH),
      new THREE.Vector3(minLocalX, 0, halfH),
      new THREE.Vector3(maxLocalX, 0, halfH),
      new THREE.Vector3(minLocalX, maxY, -halfH),
      new THREE.Vector3(maxLocalX, maxY, -halfH),
      new THREE.Vector3(minLocalX, maxY, halfH),
      new THREE.Vector3(maxLocalX, maxY, halfH),
    ];

    let uMin = 1;
    let vMin = 1;
    let uMax = 0;
    let vMax = 0;

    for (const c of corners) {
      c.applyMatrix4(this.bookRig.group.matrixWorld);
      c.project(this.camera);
      const u = c.x * 0.5 + 0.5;
      const v = c.y * 0.5 + 0.5;
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

  private applyPhaseLighting(openProgress: number) {
    if (!this.deskLamp || !this.keyLight || !this.hemiLight || !this.rimLight) return;
    const vals = computePhaseLighting(openProgress, this.theme.lighting);
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
      this.renderer.shadowMap.enabled = !this.isSoftwareGl;
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
      this.keyLight.castShadow = !this.isSoftwareGl;
      const shadowMapRes = this.isSoftwareGl ? 1024 : 2048;
      this.keyLight.shadow.mapSize.set(shadowMapRes, shadowMapRes);
      this.keyLight.shadow.camera.left = -2.6;
      this.keyLight.shadow.camera.right = 2.6;
      this.keyLight.shadow.camera.top = 1.7;
      this.keyLight.shadow.camera.bottom = -1.7;
      this.keyLight.shadow.camera.near = 0.6;
      this.keyLight.shadow.camera.far = 8.5;
      this.keyLight.shadow.bias = -0.00025;
      this.keyLight.shadow.normalBias = 0.0028;
      this.keyLight.shadow.radius = 4.5;
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

      // Post-processing composer with 4x MSAA on GPU: RenderPass -> VignetteGradingShader -> OutputPass
      const composerDpr = this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);
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

      const maxAniso = Math.min(16, this.renderer.capabilities.getMaxAnisotropy());
      const deskTextures = createDeskTextures(this.theme, maxAniso);
      const staticTextures = createBookStaticTextures(this.theme, SITE_CONFIG.brandName, maxAniso);

      // Desk surface extending seamlessly without visible horizon
      const deskGeo = new THREE.PlaneGeometry(18, 14, 1, 1);
      deskGeo.rotateX(-Math.PI / 2);
      const deskMat = new THREE.MeshStandardMaterial({
        map: deskTextures.baseColor,
        normalMap: deskTextures.normalMap,
        normalScale: new THREE.Vector2(0.36, 0.36),
        roughnessMap: deskTextures.roughnessMap,
        roughness: this.theme.materials.deskRoughness,
        metalness: 0.0,
        envMapIntensity: 0.14,
      });
      enhanceDeskShader(deskMat);
      const deskMesh = new THREE.Mesh(deskGeo, deskMat);
      deskMesh.receiveShadow = false;
      this.scene.add(deskMesh);

      // Soft radial contact shadow directly beneath the 16:9 book + isolated shadow-catching plane
      const contactShadowCanvas = document.createElement('canvas');
      contactShadowCanvas.width = 256;
      contactShadowCanvas.height = 256;
      const csCtx = contactShadowCanvas.getContext('2d')!;
      const csGrad = csCtx.createRadialGradient(128, 128, 30, 128, 128, 124);
      csGrad.addColorStop(0, 'rgba(0,0,0,0.58)');
      csGrad.addColorStop(0.65, 'rgba(0,0,0,0.28)');
      csGrad.addColorStop(1, 'rgba(0,0,0,0)');
      csCtx.fillStyle = csGrad;
      csCtx.fillRect(0, 0, 256, 256);
      const contactShadowTex = new THREE.CanvasTexture(contactShadowCanvas);
      const contactShadowGeo = new THREE.PlaneGeometry(2.82, 1.04);
      contactShadowGeo.rotateX(-Math.PI / 2);
      const contactShadowMat = new THREE.MeshBasicMaterial({
        map: contactShadowTex,
        transparent: true,
        depthWrite: false,
        opacity: 0.48,
      });
      const contactShadow = new THREE.Mesh(contactShadowGeo, contactShadowMat);
      contactShadow.position.y = 0.001;
      contactShadow.renderOrder = 1;
      this.scene.add(contactShadow);

      const bookShadowCatcherGeo = new THREE.PlaneGeometry(2.82, 1.12);
      bookShadowCatcherGeo.rotateX(-Math.PI / 2);
      const bookShadowCatcherMat = new THREE.ShadowMaterial({
        color: 0x050302,
        opacity: 0.54,
        transparent: true,
        depthWrite: false,
      });
      const bookShadowCatcher = new THREE.Mesh(bookShadowCatcherGeo, bookShadowCatcherMat);
      bookShadowCatcher.position.y = 0.0016;
      bookShadowCatcher.receiveShadow = true;
      bookShadowCatcher.renderOrder = 2;
      this.scene.add(bookShadowCatcher);

      // Book rig & Props (book offset cleanly above its shadow-catching plane)
      this.bookRig = createBookRig(this.theme, staticTextures, BOOK_TIMING.maxBatchSheets);
      this.bookRig.group.position.y = 0.0036;
      this.scene.add(this.bookRig.group);

      this.propsRig = createDeskProps(staticTextures, this.theme.lighting.spotPosition);
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
        envRT.dispose();
        composerTarget.dispose();
        deskTextures.dispose();
        staticTextures.dispose();
        deskGeo.dispose();
        deskMat.dispose();
        contactShadowTex.dispose();
        contactShadowGeo.dispose();
        contactShadowMat.dispose();
        bookShadowCatcherGeo.dispose();
        bookShadowCatcherMat.dispose();
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
      if (e.button !== 0 || this.state.phase !== 'open' || this.disposed) return;
      this.updateNdcFromClient(e.clientX, e.clientY);
      this.raycaster.setFromCamera(this.pointerNdc, this.camera);
      const leftSurface =
        this.state.currentSpread === 0 ? this.bookRig.insideCoverSurface : this.bookRig.leftPageSurface;
      const hits = this.raycaster.intersectObjects(
        [leftSurface, this.bookRig.rightPageSurface],
        false,
      );
      if (hits.length === 0) return;

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
      if (e.pointerType === 'touch') return;
      const now = performance.now();
      if (now - this.lastRaycastMs < 35) return;
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
      } else if (this.activePreviewSide) {
        this.startPreviewLoop(this.activePreviewSide);
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
      const hits = this.raycaster.intersectObject(this.bookRig.group, true);
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
      this.preloadAdjacentSpreads(startRes.toSpread);

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
    const durationSec = this.reducedMotion ? 0.08 : Math.max(0.24, Math.min(0.56, remaining * 0.62));

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
        this.callbacks.onStateChange({ ...this.state });
        this.requestRender();
      },
    });
  }

  private handleCanvasClick(e: MouseEvent) {
    if (this.disposed || this.suppressNextClick) return;
    this.updateNdcFromClient(e.clientX, e.clientY);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);

    if (this.state.phase === 'closed') {
      const hits = this.raycaster.intersectObject(this.bookRig.group, true);
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

    this.syncPageSupersampling();
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
        this.applyPhaseLighting(this.animProxy.openProgress);
        this.applyCameraFromProxy();
        this.requestRender();
      },
      onComplete: () => {
        this.applyPhaseLighting(1);
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
        this.syncPageSupersampling();
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
          this.applyPhaseLighting(this.animProxy.openProgress);
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
      if (this.dragState?.active && this.stepActiveDragSmoothing()) {
        this.renderDirty = true;
      }
      this.updateBookShaderBounds();
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
    this.dragTween?.kill();
    this.activeTimeline?.kill();
    this.stopPreviewLoop();
    clearTimeout(this.parallaxAnimId);
    clearTimeout(this.dragTickId);
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
