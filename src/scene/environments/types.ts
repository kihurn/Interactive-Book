import type * as THREE from 'three';

export type EnvironmentId = 'desk' | 'pond';

export const DEFAULT_ENVIRONMENT: EnvironmentId = 'desk';
export const ENVIRONMENT_STORAGE_KEY = 'kihurn-environment';

export interface EnvironmentInitContext {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.Camera;
  surfaceY: number;
  isSoftwareGl: boolean;
  maxAnisotropy: number;
  lampPosition: { x: number; y: number; z: number };
  bookGroup?: THREE.Object3D;
  getBookOpenProgress?: () => number;
  onOpenContact?: () => void;
  onCardHoverChange?: (hovered: boolean, screenPos?: { x: number; y: number }) => void;
  onCursorInteractiveChange?: (interactive: boolean) => void;
  onRequestRender?: () => void;
}

export interface SceneEnvironment {
  readonly id: EnvironmentId;
  readonly group: THREE.Group;
  init(ctx: EnvironmentInitContext): void;
  setActive(active: boolean): void;
  applyViewportLayout?(tier: 'desktop' | 'tablet' | 'mobile'): void;
  onResize?(width: number, height: number, dpr: number): void;
  update(dt: number, elapsed: number): void;
  onBeforeMainRender?(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ): void;
  onPointerMove?(raycaster: THREE.Raycaster, ndc: THREE.Vector2): boolean;
  onPointerDown?(raycaster: THREE.Raycaster, ndc: THREE.Vector2): boolean;
  onPointerClick?(raycaster: THREE.Raycaster, ndc: THREE.Vector2): boolean;
  clearHover?(): void;
  dispose(): void;
}
