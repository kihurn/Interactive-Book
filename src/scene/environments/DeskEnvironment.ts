import * as THREE from 'three';
import type { SceneTheme } from '../../config/theme';
import { createDeskProps, type DeskPropsRig } from '../../engine/props';
import { enhanceDeskShader } from '../../engine/shaders';
import { createDeskTextures, type BookStaticTextureSet } from '../../engine/textures';
import type { EnvironmentInitContext, SceneEnvironment } from './types';

export class DeskEnvironment implements SceneEnvironment {
  public readonly id = 'desk' as const;
  public readonly group = new THREE.Group();

  private theme: SceneTheme;
  private staticTextures: BookStaticTextureSet;
  private propsRig: DeskPropsRig | null = null;
  private ctx: EnvironmentInitContext | null = null;
  private disposables: Array<{ dispose: () => void }> = [];

  private active = false;
  private cardHovered = false;
  private cardLift = 0;
  private baseCardsY = 0.003;
  private tmpCardWorld = new THREE.Vector3();

  constructor(theme: SceneTheme, staticTextures: BookStaticTextureSet) {
    this.theme = theme;
    this.staticTextures = staticTextures;
    this.group.name = 'desk-environment';
  }

  public init(ctx: EnvironmentInitContext): void {
    this.ctx = ctx;
    const { surfaceY, maxAnisotropy, lampPosition } = ctx;

    const deskTextures = createDeskTextures(this.theme, maxAnisotropy);
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
    deskMesh.position.y = surfaceY;
    deskMesh.receiveShadow = false;
    this.group.add(deskMesh);

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
    contactShadow.position.y = surfaceY + 0.001;
    contactShadow.renderOrder = 1;
    this.group.add(contactShadow);

    const bookShadowCatcherGeo = new THREE.PlaneGeometry(2.82, 1.12);
    bookShadowCatcherGeo.rotateX(-Math.PI / 2);
    const bookShadowCatcherMat = new THREE.ShadowMaterial({
      color: 0x050302,
      opacity: 0.54,
      transparent: true,
      depthWrite: false,
    });
    const bookShadowCatcher = new THREE.Mesh(bookShadowCatcherGeo, bookShadowCatcherMat);
    bookShadowCatcher.position.y = surfaceY + 0.0016;
    bookShadowCatcher.receiveShadow = true;
    bookShadowCatcher.renderOrder = 2;
    this.group.add(bookShadowCatcher);

    this.propsRig = createDeskProps(this.staticTextures, lampPosition);
    this.propsRig.group.position.y = surfaceY;
    this.baseCardsY = this.propsRig.cardsMeshGroup.position.y;
    this.group.add(this.propsRig.group);

    this.disposables.push(
      deskTextures,
      deskGeo,
      deskMat,
      contactShadowTex,
      contactShadowGeo,
      contactShadowMat,
      bookShadowCatcherGeo,
      bookShadowCatcherMat,
      this.propsRig,
    );

    ctx.scene.add(this.group);
  }

  public applyViewportLayout(tier: 'desktop' | 'tablet' | 'mobile'): void {
    this.propsRig?.applyLayout(this.theme.props[tier]);
  }

  public setActive(active: boolean): void {
    this.active = active;
    this.group.visible = active;
    if (!active) {
      this.clearHover();
    }
  }

  public update(dt: number): void {
    if (!this.active || !this.propsRig) return;
    const targetLift = this.cardHovered ? 0.011 : 0;
    if (Math.abs(this.cardLift - targetLift) > 0.0002) {
      const alpha = 1 - Math.exp(-14 * Math.min(0.05, Math.max(0.001, dt)));
      this.cardLift += (targetLift - this.cardLift) * alpha;
      this.propsRig.cardsMeshGroup.position.y = this.baseCardsY + this.cardLift;
      this.ctx?.onRequestRender?.();
    }
  }

  public onPointerMove(raycaster: THREE.Raycaster, _ndc: THREE.Vector2): boolean {
    if (!this.active || !this.propsRig || !this.ctx) return false;
    const hits = raycaster.intersectObjects(this.propsRig.cardHitTargets, false);
    const hovered = hits.length > 0;
    if (hovered !== this.cardHovered) {
      this.cardHovered = hovered;
      this.ctx.onCursorInteractiveChange?.(hovered);
      if (hovered) {
        this.propsRig.cardsMeshGroup.getWorldPosition(this.tmpCardWorld);
        this.tmpCardWorld.y += 0.045;
        this.tmpCardWorld.project(this.ctx.camera);
        const w = this.ctx.renderer.domElement.clientWidth || window.innerWidth;
        const h = this.ctx.renderer.domElement.clientHeight || window.innerHeight;
        this.ctx.onCardHoverChange?.(true, {
          x: (this.tmpCardWorld.x * 0.5 + 0.5) * w,
          y: (-this.tmpCardWorld.y * 0.5 + 0.5) * h,
        });
      } else {
        this.ctx.onCardHoverChange?.(false);
      }
      this.ctx.onRequestRender?.();
    }
    return hovered;
  }

  public onPointerClick(raycaster: THREE.Raycaster, _ndc: THREE.Vector2): boolean {
    if (!this.active || !this.propsRig || !this.ctx) return false;
    const hits = raycaster.intersectObjects(this.propsRig.cardHitTargets, false);
    if (hits.length > 0) {
      this.ctx.onOpenContact?.();
      return true;
    }
    return false;
  }

  public clearHover(): void {
    if (this.cardHovered) {
      this.cardHovered = false;
      this.cardLift = 0;
      if (this.propsRig) {
        this.propsRig.cardsMeshGroup.position.y = this.baseCardsY;
      }
      this.ctx?.onCardHoverChange?.(false);
      this.ctx?.onCursorInteractiveChange?.(false);
    }
  }

  public dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    if (this.group.parent) {
      this.group.parent.remove(this.group);
    }
  }
}
