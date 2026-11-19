import * as THREE from 'three';
import type { SceneTheme } from '../../config/theme';
import type { BookStaticTextureSet } from '../../engine/textures';
import { createBusinessCardPad, type BusinessCardPadRig } from '../pond/BusinessCardPad';
import { POND_LAYOUT } from '../pond/constants';
import { createFloatingPlank, type FloatingPlankRig } from '../pond/FloatingPlank';
import { createKoiSchool, type KoiSchoolRig } from '../pond/KoiSchool';
import { createPondBed, type PondBedRig } from '../pond/PondBed';
import {
  createLilyPadTextures,
  createPondFlora,
  type LilyPadTextures,
  type PondFloraRig,
} from '../pond/PondFlora';
import { createPondLantern, type PondLanternRig } from '../pond/PondLantern';
import { WaterSimulation } from '../pond/WaterSimulation';
import { createWaterSurface, type WaterSurfaceRig } from '../pond/WaterSurface';
import type { EnvironmentInitContext, SceneEnvironment } from './types';

export class PondEnvironment implements SceneEnvironment {
  public readonly id = 'pond' as const;
  public readonly group = new THREE.Group();

  private theme: SceneTheme;
  private staticTextures: BookStaticTextureSet;
  private ctx: EnvironmentInitContext | null = null;
  private active = false;

  private waterSim: WaterSimulation | null = null;
  private pondBed: PondBedRig | null = null;
  private floatingPlank: FloatingPlankRig | null = null;
  private lantern: PondLanternRig | null = null;
  private flora: PondFloraRig | null = null;
  private cardPadTextures: LilyPadTextures | null = null;
  private cardPad: BusinessCardPadRig | null = null;
  private koiSchool: KoiSchoolRig | null = null;
  private waterSurface: WaterSurfaceRig | null = null;

  private aboveWaterObjects: THREE.Object3D[] = [];
  private rayObstacles: THREE.Object3D[] = [];
  private disposables: Array<{ dispose: () => void }> = [];

  private waterY = -POND_LAYOUT.waterDepthOffset;
  private currentCardPos = { x: 1.56, z: 0.6 };
  private cardHovered = false;
  private lastRippleTimeMs = 0;
  private lastRippleX = 999;
  private lastRippleZ = 999;
  private lastDownSplashMs = 0;
  private seededInitialRipple = false;
  private tmpCardWorld = new THREE.Vector3();

  constructor(theme: SceneTheme, staticTextures: BookStaticTextureSet) {
    this.theme = theme;
    this.staticTextures = staticTextures;
    this.group.name = 'pond-environment';
  }

  public init(ctx: EnvironmentInitContext): void {
    this.ctx = ctx;
    const { scene, renderer, surfaceY, isSoftwareGl, maxAnisotropy } = ctx;

    this.waterY = surfaceY - POND_LAYOUT.waterDepthOffset;
    const bedY = surfaceY - POND_LAYOUT.bedDepthOffset;

    this.waterSim = new WaterSimulation(isSoftwareGl);
    this.pondBed = createPondBed(this.waterY, bedY, maxAnisotropy, isSoftwareGl);
    this.floatingPlank = createFloatingPlank(surfaceY, this.waterY, maxAnisotropy);
    this.lantern = createPondLantern(this.waterY, bedY, maxAnisotropy);
    this.flora = createPondFlora(this.waterY, bedY, maxAnisotropy);
    this.cardPadTextures = createLilyPadTextures(maxAnisotropy);
    this.cardPad = createBusinessCardPad(
      this.staticTextures.businessCardMap,
      this.cardPadTextures,
      this.waterY,
    );
    this.koiSchool = createKoiSchool(this.waterY, bedY, maxAnisotropy);

    const w = Math.max(1, renderer.domElement.clientWidth || window.innerWidth);
    const h = Math.max(1, renderer.domElement.clientHeight || window.innerHeight);
    const dpr = renderer.getPixelRatio();
    this.waterSurface = createWaterSurface(
      this.waterSim,
      this.waterY,
      w,
      h,
      dpr,
      isSoftwareGl,
    );

    this.group.add(
      this.pondBed.group,
      this.floatingPlank.group,
      this.lantern.group,
      this.flora.group,
      this.cardPad.group,
      this.koiSchool.group,
      this.waterSurface.waterMesh,
    );

    this.aboveWaterObjects = [
      this.floatingPlank.aboveWaterGroup,
      this.lantern.aboveWaterGroup,
      this.flora.aboveWaterGroup,
      this.cardPad.group,
      ...(ctx.bookGroup ? [ctx.bookGroup] : []),
    ];

    this.rayObstacles = [
      this.waterSurface.waterMesh,
      this.floatingPlank.group,
      this.cardPad.group,
      this.lantern.group,
      this.flora.group,
    ];

    this.disposables.push(
      this.waterSim,
      this.pondBed,
      this.floatingPlank,
      this.lantern,
      this.flora,
      this.cardPadTextures,
      this.cardPad,
      this.koiSchool,
      this.waterSurface,
    );

    scene.add(this.group);
  }

  public applyViewportLayout(tier: 'desktop' | 'tablet' | 'mobile'): void {
    const layout = this.theme.props[tier].cards;
    this.currentCardPos = { x: layout.position.x, z: layout.position.z };
    this.cardPad?.applyPlacement(layout);
  }

  public setActive(active: boolean): void {
    this.active = active;
    this.group.visible = active;
    if (!active) {
      this.clearHover();
      return;
    }
    if (!this.seededInitialRipple && this.ctx && this.waterSim) {
      this.seededInitialRipple = true;
      this.waterSim.addDrop(this.ctx.renderer, 0.96, -0.78, 0.22, 0.22);
      this.waterSim.addDrop(this.ctx.renderer, -0.82, 0.78, 0.2, 0.18);
    }
  }

  public onResize(width: number, height: number, dpr: number): void {
    this.waterSurface?.resize(width, height, dpr);
  }

  public update(dt: number, elapsed: number): void {
    if (!this.active || !this.ctx || !this.waterSim) return;

    const bookOpen = this.ctx.getBookOpenProgress?.() ?? 0;

    this.waterSim.step(this.ctx.renderer, dt, elapsed);
    this.pondBed?.update(elapsed);
    this.floatingPlank?.update(elapsed, this.waterSim, bookOpen);
    this.lantern?.update(elapsed);

    this.flora?.update(dt, elapsed, this.waterSim, (dripX, dripZ) => {
      if (this.ctx && this.waterSim) {
        this.waterSim.addDrop(this.ctx.renderer, dripX, dripZ, 0.18, 0.22);
      }
    });

    this.cardPad?.update(dt, elapsed, this.waterSim, this.cardHovered);
    this.koiSchool?.update(dt, elapsed, this.waterSim, this.ctx.renderer, bookOpen);

    const flicker = this.lantern ? this.lantern.pointLight.intensity / 0.30 : 1.0;
    this.waterSurface?.update(
      elapsed,
      this.ctx.camera,
      flicker,
      bookOpen,
      this.currentCardPos,
    );
  }

  public onBeforeMainRender(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ): void {
    if (!this.active || !this.waterSurface) return;
    this.waterSurface.renderUnderwater(renderer, scene, camera, this.aboveWaterObjects);
  }

  public onPointerMove(raycaster: THREE.Raycaster, _ndc: THREE.Vector2): boolean {
    if (!this.active || !this.ctx || !this.cardPad || !this.waterSurface || !this.waterSim) {
      return false;
    }

    // 1. Check Business Card resting dry on top-center of its lily pad first
    const cardHits = raycaster.intersectObjects(this.cardPad.hitTargets, false);
    if (cardHits.length > 0) {
      if (!this.cardHovered) {
        this.cardHovered = true;
        this.ctx.onCursorInteractiveChange?.(true);
        this.cardPad.cardVisualGroup.getWorldPosition(this.tmpCardWorld);
        this.tmpCardWorld.y += 0.045;
        this.tmpCardWorld.project(this.ctx.camera);
        const w = this.ctx.renderer.domElement.clientWidth || window.innerWidth;
        const h = this.ctx.renderer.domElement.clientHeight || window.innerHeight;
        this.ctx.onCardHoverChange?.(true, {
          x: (this.tmpCardWorld.x * 0.5 + 0.5) * w,
          y: (-this.tmpCardWorld.y * 0.5 + 0.5) * h,
        });
      }
      return true;
    }

    if (this.cardHovered) {
      this.cardHovered = false;
      this.ctx.onCardHoverChange?.(false);
      this.ctx.onCursorInteractiveChange?.(false);
    }

    // 2. Raycast water vs solid visible pond islands; only ripple when closest hit is open water
    const hits = raycaster
      .intersectObjects(this.rayObstacles, true)
      .filter((h) => h.object.visible);
    if (hits.length > 0 && hits[0].object === this.waterSurface.waterMesh) {
      const pt = hits[0].point;
      const now = performance.now();
      const moved = Math.hypot(pt.x - this.lastRippleX, pt.z - this.lastRippleZ);
      if (now - this.lastRippleTimeMs > 24 && moved > 0.025) {
        this.lastRippleTimeMs = now;
        this.lastRippleX = pt.x;
        this.lastRippleZ = pt.z;
        this.waterSim.addDrop(this.ctx.renderer, pt.x, pt.z, 0.17, 0.19);
      }
      return false;
    }

    return false;
  }

  public onPointerDown(raycaster: THREE.Raycaster, _ndc: THREE.Vector2): boolean {
    if (!this.active || !this.ctx || !this.cardPad || !this.waterSurface || !this.waterSim) {
      return false;
    }

    const cardHits = raycaster.intersectObjects(this.cardPad.hitTargets, false);
    if (cardHits.length > 0) {
      return false;
    }

    const hits = raycaster
      .intersectObjects(this.rayObstacles, true)
      .filter((h) => h.object.visible);
    if (hits.length > 0 && hits[0].object === this.waterSurface.waterMesh) {
      const pt = hits[0].point;
      this.lastDownSplashMs = performance.now();
      this.waterSim.addDrop(this.ctx.renderer, pt.x, pt.z, 0.25, 0.46);
      return true;
    }

    return false;
  }

  public onPointerClick(raycaster: THREE.Raycaster, _ndc: THREE.Vector2): boolean {
    if (!this.active || !this.ctx || !this.cardPad || !this.waterSurface || !this.waterSim) {
      return false;
    }

    const cardHits = raycaster.intersectObjects(this.cardPad.hitTargets, false);
    if (cardHits.length > 0) {
      this.ctx.onOpenContact?.();
      return true;
    }

    const hits = raycaster
      .intersectObjects(this.rayObstacles, true)
      .filter((h) => h.object.visible);
    if (hits.length > 0 && hits[0].object === this.waterSurface.waterMesh) {
      if (performance.now() - this.lastDownSplashMs > 220) {
        const pt = hits[0].point;
        this.waterSim.addDrop(this.ctx.renderer, pt.x, pt.z, 0.25, 0.46);
      }
      return true;
    }

    return false;
  }

  public clearHover(): void {
    if (this.cardHovered) {
      this.cardHovered = false;
      this.ctx?.onCardHoverChange?.(false);
      this.ctx?.onCursorInteractiveChange?.(false);
    }
  }

  public dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    this.aboveWaterObjects = [];
    this.rayObstacles = [];
    if (this.group.parent) {
      this.group.parent.remove(this.group);
    }
  }
}
