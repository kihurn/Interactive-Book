import * as THREE from 'three';
import type { PropLayout, SceneTheme } from '../config/theme';
import { computeLampShadowOffset, worldOffsetToLocal } from './bookState';
import {
  POT_SPEC,
  createStylizedLeafGeometry,
  generateValidatedPlantFoliage,
  getSoilDomeHeightAtR,
} from './foliage';
import type { BookStaticTextureSet } from './textures';

export interface BusinessCardStackHandle {
  group: THREE.Group;
  cardsMeshGroup: THREE.Group;
  hitTargets: THREE.Object3D[];
  dispose: () => void;
}

export interface DeskPropsRig {
  group: THREE.Group;
  succulent: THREE.Group;
  pencil: THREE.Group;
  coffee: THREE.Group;
  cards: THREE.Group;
  cardsMeshGroup: THREE.Group;
  cardHitTargets: THREE.Object3D[];
  applyLayout: (layout: SceneTheme['props']['desktop']) => void;
  dispose: () => void;
}

export function createBusinessCardStack(
  businessCardMap: THREE.CanvasTexture,
): BusinessCardStackHandle {
  const disposables: Array<{ dispose: () => void }> = [];
  const group = new THREE.Group();
  const cardsMeshGroup = new THREE.Group();
  cardsMeshGroup.position.y = 0.003;
  group.add(cardsMeshGroup);

  const cardGeo = new THREE.BoxGeometry(0.28, 0.004, 0.165);
  const cardTopMat = new THREE.MeshStandardMaterial({
    map: businessCardMap,
    roughness: 0.72,
    metalness: 0.03,
    envMapIntensity: 0.28,
  });
  const cardEdgeMat = new THREE.MeshStandardMaterial({
    color: 0x262529,
    roughness: 0.84,
    metalness: 0.02,
    envMapIntensity: 0.2,
  });
  const cardMaterials = [
    cardEdgeMat,
    cardEdgeMat,
    cardTopMat,
    cardEdgeMat,
    cardEdgeMat,
    cardEdgeMat,
  ];
  const cardLightMat = new THREE.MeshStandardMaterial({
    color: 0xe6e1d7,
    roughness: 0.84,
    metalness: 0.01,
    envMapIntensity: 0.18,
  });

  const cardBottom = new THREE.Mesh(cardGeo, cardLightMat);
  cardBottom.position.set(-0.028, 0.002, 0.02);
  cardBottom.rotation.y = -0.32;
  cardBottom.castShadow = true;
  cardBottom.receiveShadow = true;
  cardBottom.name = 'business-card-bottom';
  cardsMeshGroup.add(cardBottom);

  const cardTop = new THREE.Mesh(cardGeo, cardMaterials);
  cardTop.position.set(0.022, 0.007, -0.012);
  cardTop.rotation.y = 0.2;
  cardTop.castShadow = true;
  cardTop.receiveShadow = true;
  cardTop.name = 'business-card-top';
  cardsMeshGroup.add(cardTop);

  disposables.push(cardGeo, cardTopMat, cardEdgeMat, cardLightMat);

  return {
    group,
    cardsMeshGroup,
    hitTargets: [cardTop, cardBottom],
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}

function applyPropPlacement(obj: THREE.Object3D, placement: PropLayout) {
  obj.position.set(placement.position.x, placement.position.y, placement.position.z);
  obj.rotation.y = placement.rotationY;
  obj.scale.setScalar(placement.scale);
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 192;
  const ctx = canvas.getContext('2d')!;
  // Soft directional desk drop shadow + tight base contact core
  const grad = ctx.createRadialGradient(96, 96, 16, 96, 96, 90);
  grad.addColorStop(0, 'rgba(0,0,0,0.72)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0.42)');
  grad.addColorStop(0.78, 'rgba(0,0,0,0.14)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 192, 192);
  return new THREE.CanvasTexture(canvas);
}

function createPencilDropShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.save();
  ctx.filter = 'blur(6px)';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
  ctx.beginPath();
  ctx.roundRect(22, 33, 212, 28, 14);
  ctx.fill();
  ctx.restore();
  // Tight directional shadow core offset beside the hexagonal barrel
  const core = ctx.createLinearGradient(26, 0, 230, 0);
  core.addColorStop(0, 'rgba(0,0,0,0)');
  core.addColorStop(0.1, 'rgba(0,0,0,0.68)');
  core.addColorStop(0.9, 'rgba(0,0,0,0.68)');
  core.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = core;
  ctx.fillRect(26, 40, 204, 14);
  return new THREE.CanvasTexture(canvas);
}

function createPotSoftShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 192;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(96, 96, 24, 96, 96, 86);
  grad.addColorStop(0, 'rgba(0,0,0,0.72)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.36)');
  grad.addColorStop(0.84, 'rgba(0,0,0,0.12)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 192, 192);
  return new THREE.CanvasTexture(canvas);
}

function createSaucerDropShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(128, 128, 36, 128, 128, 118);
  grad.addColorStop(0, 'rgba(0,0,0,0.78)');
  grad.addColorStop(0.62, 'rgba(0,0,0,0.48)');
  grad.addColorStop(0.82, 'rgba(0,0,0,0.2)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(canvas);
}

function createSpoonShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.save();
  ctx.filter = 'blur(9px)';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.56)';
  // Spoon bowl soft shadow on the left + narrow neck + tapered flared handle on the right
  ctx.beginPath();
  ctx.ellipse(62, 64, 34, 21, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(88, 59);
  ctx.quadraticCurveTo(155, 57, 224, 52);
  ctx.quadraticCurveTo(234, 64, 224, 76);
  ctx.quadraticCurveTo(155, 71, 88, 69);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  return new THREE.CanvasTexture(canvas);
}

function createBrushedSteelMaps(): {
  roughnessMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
} {
  const size = 256;
  const rCanvas = document.createElement('canvas');
  rCanvas.width = size;
  rCanvas.height = size;
  const rCtx = rCanvas.getContext('2d')!;

  const bCanvas = document.createElement('canvas');
  bCanvas.width = size;
  bCanvas.height = size;
  const bCtx = bCanvas.getContext('2d')!;

  const rImg = rCtx.createImageData(size, size);
  const bImg = bCtx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    // Ultra-fine parallel hairline polish lines along spoon length without low-frequency ripple bands
    const rowHash = Math.sin(y * 12.9898) * 43758.5453;
    const rowGrain = rowHash - Math.floor(rowHash);
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const microSweep = Math.sin(x * 0.08 + y * 0.14) * 0.5 + 0.5;
      const polish = rowGrain * 0.7 + microSweep * 0.3;
      const rByte = Math.round((0.18 + polish * 0.065) * 255);
      rImg.data[idx] = rByte;
      rImg.data[idx + 1] = rByte;
      rImg.data[idx + 2] = rByte;
      rImg.data[idx + 3] = 255;

      const bByte = Math.round((0.48 + polish * 0.04) * 255);
      bImg.data[idx] = bByte;
      bImg.data[idx + 1] = bByte;
      bImg.data[idx + 2] = bByte;
      bImg.data[idx + 3] = 255;
    }
  }

  rCtx.putImageData(rImg, 0, 0);
  bCtx.putImageData(bImg, 0, 0);

  const roughnessMap = new THREE.CanvasTexture(rCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;

  const bumpMap = new THREE.CanvasTexture(bCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;

  return { roughnessMap, bumpMap };
}

function getSaucerSurfaceY(r: number): number {
  if (r <= 0.09) return 0.015;
  if (r <= 0.165) return 0.015 + ((r - 0.09) / 0.075) * (0.026 - 0.015);
  if (r <= 0.242) return 0.026 + ((r - 0.165) / 0.077) * (0.044 - 0.026);
  return 0.044;
}

function createPlantSoftShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  // Soft scalloped foliage rosette shadow penumbra (pot base shadow handled separately for subtle layered depth)
  ctx.save();
  ctx.filter = 'blur(12px)';
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.35;
    const dist = 48 + (i % 3) * 16;
    const cx = 128 + Math.cos(a) * dist;
    const cy = 128 + Math.sin(a) * dist;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.34)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, 30, 14, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  const castGrad = ctx.createRadialGradient(128, 128, 24, 128, 128, 114);
  castGrad.addColorStop(0, 'rgba(0,0,0,0.44)');
  castGrad.addColorStop(0.55, 'rgba(0,0,0,0.22)');
  castGrad.addColorStop(0.84, 'rgba(0,0,0,0.08)');
  castGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = castGrad;
  ctx.fillRect(0, 0, 256, 256);

  return new THREE.CanvasTexture(canvas);
}

function createPottingSoilTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#241a13';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2400; i++) {
    const x = ((Math.sin(i * 19.31 + 1.1) * 0.5 + 0.5) * 256) | 0;
    const y = ((Math.cos(i * 41.73 + 2.7) * 0.5 + 0.5) * 256) | 0;
    const r = 0.8 + (i % 3) * 0.65;
    ctx.fillStyle =
      i % 7 === 0
        ? 'rgba(130, 108, 86, 0.24)'
        : i % 2 === 0
          ? 'rgba(12, 8, 5, 0.42)'
          : 'rgba(54, 38, 28, 0.3)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function createLeafBladeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;

  const baseGrad = ctx.createLinearGradient(0, 1024, 0, 0);
  baseGrad.addColorStop(0, '#a8b8a2');
  baseGrad.addColorStop(0.2, '#c5d4bf');
  baseGrad.addColorStop(0.65, '#d6e3cf');
  baseGrad.addColorStop(0.92, '#e2edd9');
  baseGrad.addColorStop(1, '#eef5e4');
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, 512, 1024);

  // Subtle organic mottling for matte waxy cuticle realism
  for (let i = 0; i < 420; i++) {
    const x = ((Math.sin(i * 19.3) * 0.5 + 0.5) * 512) | 0;
    const y = ((Math.cos(i * 47.7) * 0.5 + 0.5) * 1024) | 0;
    const r = 6 + (i % 14);
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(25,45,28,0.04)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Tapered central midrib
  const rib = ctx.createLinearGradient(236, 0, 276, 0);
  rib.addColorStop(0, 'rgba(255,255,255,0)');
  rib.addColorStop(0.5, 'rgba(244,250,235,0.44)');
  rib.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = rib;
  ctx.fillRect(236, 36, 40, 960);

  // Arcing lateral botanical veins
  ctx.strokeStyle = 'rgba(236, 246, 228, 0.22)';
  ctx.lineWidth = 2.2;
  for (let i = 0; i < 16; i++) {
    const y0 = 910 - i * 48;
    const span = 185 * Math.sin(((i + 1) / 17) * Math.PI * 0.9 + 0.15);
    ctx.beginPath();
    ctx.moveTo(256, y0);
    ctx.quadraticCurveTo(256 - span * 0.45, y0 - 26, 256 - span, y0 - 74);
    ctx.moveTo(256, y0);
    ctx.quadraticCurveTo(256 + span * 0.45, y0 - 26, 256 + span, y0 - 74);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Builds composite 3–12 part procedural 3D desk props with bottom-center pivots,
 * tactile matte/stoneware/ceramic PBR finishes, contact shadows, and dynamic lighting response.
 */
export function createDeskProps(
  staticTextures: BookStaticTextureSet,
  lampPosition: { x: number; y: number; z: number } = { x: -0.42, y: 3.35, z: 0.52 },
): DeskPropsRig {
  const disposables: Array<{ dispose: () => void }> = [];
  const root = new THREE.Group();

  const propShadowTex = createContactShadowTexture();
  const propShadowMat = new THREE.MeshBasicMaterial({
    map: propShadowTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.62,
  });
  const propCastDropMat = new THREE.MeshBasicMaterial({
    map: propShadowTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.8,
  });
  const propShadowCatcherMat = new THREE.ShadowMaterial({
    color: 0x050302,
    opacity: 0.56,
    transparent: true,
    depthWrite: false,
  });
  disposables.push(propShadowTex, propShadowMat, propCastDropMat, propShadowCatcherMat);

  const addCircularShadowCatcher = (
    parent: THREE.Group,
    aoRadius: number,
    catcherRadius: number,
    offsetX = 0,
    offsetZ = 0,
    catcherY = 0.002,
  ): THREE.Mesh => {
    const aoGeo = new THREE.CircleGeometry(aoRadius, 48);
    aoGeo.rotateX(-Math.PI / 2);
    const aoMesh = new THREE.Mesh(aoGeo, propShadowMat);
    aoMesh.position.set(0, 0.0014, 0);
    aoMesh.renderOrder = 1;
    parent.add(aoMesh);

    const dropGeo = new THREE.CircleGeometry(aoRadius * 1.2, 48);
    dropGeo.rotateX(-Math.PI / 2);
    const dropMesh = new THREE.Mesh(dropGeo, propCastDropMat);
    dropMesh.position.set(offsetX, 0.0012, offsetZ);
    dropMesh.renderOrder = 1;
    parent.add(dropMesh);

    const catcherGeo = new THREE.CircleGeometry(catcherRadius, 64);
    catcherGeo.rotateX(-Math.PI / 2);
    const catcherMesh = new THREE.Mesh(catcherGeo, propShadowCatcherMat);
    catcherMesh.position.set(offsetX, catcherY, offsetZ);
    catcherMesh.receiveShadow = true;
    catcherMesh.renderOrder = 2;
    parent.add(catcherMesh);

    disposables.push(aoGeo, dropGeo, catcherGeo);
    return dropMesh;
  };

  const addRectShadowCatcher = (
    parent: THREE.Group,
    width: number,
    depth: number,
    offsetX = 0,
    offsetZ = 0,
  ) => {
    const aoGeo = new THREE.PlaneGeometry(width, depth);
    aoGeo.rotateX(-Math.PI / 2);
    const aoMesh = new THREE.Mesh(aoGeo, propShadowMat);
    aoMesh.position.set(offsetX, 0.0014, offsetZ);
    aoMesh.renderOrder = 1;
    parent.add(aoMesh);

    const catcherGeo = new THREE.PlaneGeometry(width, depth);
    catcherGeo.rotateX(-Math.PI / 2);
    const catcherMesh = new THREE.Mesh(catcherGeo, propShadowCatcherMat);
    catcherMesh.position.set(offsetX, 0.0026, offsetZ);
    catcherMesh.receiveShadow = true;
    catcherMesh.renderOrder = 2;
    parent.add(catcherMesh);

    disposables.push(aoGeo, catcherGeo);
  };

  // 1. PLANT & POT (left): Dedicated contact AO + separate subtle lamp-angle soft shadows for stoneware pot & foliage
  const succulent = new THREE.Group();
  const potSoftShadowTex = createPotSoftShadowTexture();
  const potSoftShadowMat = new THREE.MeshBasicMaterial({
    map: potSoftShadowTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.66,
  });
  const plantSoftShadowTex = createPlantSoftShadowTexture();
  const plantSoftShadowMat = new THREE.MeshBasicMaterial({
    map: plantSoftShadowTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.54,
  });
  const plantAoGeo = new THREE.CircleGeometry(0.225, 48);
  plantAoGeo.rotateX(-Math.PI / 2);
  const plantAoMesh = new THREE.Mesh(plantAoGeo, propShadowMat);
  plantAoMesh.position.set(0, 0.0015, 0);
  plantAoMesh.renderOrder = 1;
  succulent.add(plantAoMesh);

  const potDropGeo = new THREE.CircleGeometry(0.245, 48);
  potDropGeo.rotateX(-Math.PI / 2);
  const potDropMesh = new THREE.Mesh(potDropGeo, potSoftShadowMat);
  potDropMesh.position.set(-0.032, 0.0013, -0.014);
  potDropMesh.renderOrder = 1;
  succulent.add(potDropMesh);

  const plantDropGeo = new THREE.CircleGeometry(0.335, 48);
  plantDropGeo.rotateX(-Math.PI / 2);
  const plantDropMesh = new THREE.Mesh(plantDropGeo, plantSoftShadowMat);
  plantDropMesh.position.set(-0.048, 0.0011, -0.02);
  plantDropMesh.renderOrder = 1;
  succulent.add(plantDropMesh);

  const plantCatcherGeo = new THREE.CircleGeometry(0.325, 64);
  plantCatcherGeo.rotateX(-Math.PI / 2);
  const plantCatcherMesh = new THREE.Mesh(plantCatcherGeo, propShadowCatcherMat);
  plantCatcherMesh.position.set(0.012, 0.0026, -0.016);
  plantCatcherMesh.receiveShadow = true;
  plantCatcherMesh.renderOrder = 2;
  succulent.add(plantCatcherMesh);
  disposables.push(
    potSoftShadowTex,
    potSoftShadowMat,
    plantSoftShadowTex,
    plantSoftShadowMat,
    plantAoGeo,
    potDropGeo,
    plantDropGeo,
    plantCatcherGeo,
  );

  const plantMeshGroup = new THREE.Group();
  plantMeshGroup.position.y = 0.0075;
  succulent.add(plantMeshGroup);

  const potProfile = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(POT_SPEC.outerBaseRadius, 0.0),
    new THREE.Vector2(POT_SPEC.outerShoulderRadius, POT_SPEC.outerShoulderY),
    new THREE.Vector2(POT_SPEC.outerRimRadius, POT_SPEC.rimY - 0.004),
    new THREE.Vector2(POT_SPEC.outerRimRadius - 0.004, POT_SPEC.rimY),
    new THREE.Vector2(POT_SPEC.innerRimRadius + 0.004, POT_SPEC.rimY),
    new THREE.Vector2(POT_SPEC.innerRimRadius, POT_SPEC.rimY - 0.004),
    new THREE.Vector2(POT_SPEC.innerFloorRadius, POT_SPEC.innerFloorY),
    new THREE.Vector2(0.0, POT_SPEC.innerFloorY),
  ];
  const potGeo = new THREE.LatheGeometry(potProfile, 56);
  const potMat = new THREE.MeshStandardMaterial({
    color: 0xc8c0b4,
    map: staticTextures.stonewareMap,
    roughness: 0.9,
    metalness: 0.01,
    envMapIntensity: 0.16,
  });
  const potMesh = new THREE.Mesh(potGeo, potMat);
  potMesh.castShadow = true;
  potMesh.receiveShadow = true;
  plantMeshGroup.add(potMesh);

  // Sculpted soil dome ordered outer -> center so LatheGeometry normals point strictly +Y upward
  // with zero coplanar underside cap against POT_SPEC.innerFloorY (eliminates Z-fighting/flicker)
  const soilPoints: THREE.Vector2[] = [];
  for (let i = 10; i >= 0; i--) {
    const r = (i / 10) * POT_SPEC.innerFloorRadius;
    soilPoints.push(new THREE.Vector2(r, getSoilDomeHeightAtR(r, POT_SPEC)));
  }
  const soilGeo = new THREE.LatheGeometry(soilPoints, 48);
  const soilTex = createPottingSoilTexture();
  const soilMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: soilTex,
    roughness: 0.96,
    metalness: 0.0,
    envMapIntensity: 0.1,
  });
  const soilMesh = new THREE.Mesh(soilGeo, soilMat);
  soilMesh.receiveShadow = true;
  plantMeshGroup.add(soilMesh);

  const leafTex = createLeafBladeTexture();
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0xcfd6ca,
    map: leafTex,
    vertexColors: true,
    roughness: 0.64,
    metalness: 0.0,
    envMapIntensity: 0.16,
    side: THREE.DoubleSide,
    shadowSide: THREE.DoubleSide,
  });

  const foliageSpecs = generateValidatedPlantFoliage(POT_SPEC);
  foliageSpecs.forEach((spec, idx) => {
    const hueShift = (((idx * 37) % 11) - 5) * 0.0045;
    const leafGeo = createStylizedLeafGeometry(spec.leaf, hueShift);
    const leafMesh = new THREE.Mesh(leafGeo, leafMat);
    leafMesh.position.set(
      Math.cos(spec.azimuthRad) * spec.baseRadius,
      spec.baseY,
      Math.sin(spec.azimuthRad) * spec.baseRadius,
    );
    leafMesh.rotation.order = 'YXZ';
    leafMesh.rotation.y = -spec.azimuthRad + Math.PI / 2;
    leafMesh.rotation.x = spec.pitchRad;
    leafMesh.rotation.z = spec.rollRad;
    leafMesh.scale.setScalar(spec.scale);
    leafMesh.castShadow = true;
    leafMesh.receiveShadow = false;
    plantMeshGroup.add(leafMesh);
    disposables.push(leafGeo);
  });

  root.add(succulent);
  disposables.push(potGeo, potMat, soilGeo, soilTex, soilMat, leafTex, leafMat);

  // 2. DIAGONAL PENCIL (lower-left): Matte lacquer barrel + brushed brass ferrule + muted eraser + short offset lamp drop shadow
  const pencil = new THREE.Group();
  const pencilShadowTex = createPencilDropShadowTexture();
  const pencilShadowMat = new THREE.MeshBasicMaterial({
    map: pencilShadowTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.88,
  });
  const pencilDropGeo = new THREE.PlaneGeometry(0.86, 0.13);
  pencilDropGeo.rotateX(-Math.PI / 2);
  const pencilDropMesh = new THREE.Mesh(pencilDropGeo, pencilShadowMat);
  pencilDropMesh.position.set(-0.022, 0.0013, 0.012);
  pencilDropMesh.renderOrder = 1;
  pencil.add(pencilDropMesh);

  const pencilCatcherGeo = new THREE.PlaneGeometry(0.88, 0.16);
  pencilCatcherGeo.rotateX(-Math.PI / 2);
  const pencilCatcherMesh = new THREE.Mesh(pencilCatcherGeo, propShadowCatcherMat);
  pencilCatcherMesh.position.set(0, 0.0024, 0.004);
  pencilCatcherMesh.receiveShadow = true;
  pencilCatcherMesh.renderOrder = 2;
  pencil.add(pencilCatcherMesh);
  disposables.push(pencilShadowTex, pencilShadowMat, pencilDropGeo, pencilCatcherGeo);

  const pencilBodyGroup = new THREE.Group();
  pencilBodyGroup.position.y = 0.003;
  pencil.add(pencilBodyGroup);

  const pencilRadius = 0.016;
  const shaftLen = 0.62;
  const shaftGeo = new THREE.CylinderGeometry(pencilRadius, pencilRadius, shaftLen, 6);
  shaftGeo.rotateZ(Math.PI / 2);
  const shaftMat = new THREE.MeshStandardMaterial({
    color: 0x2b2c30,
    roughness: 0.52,
    metalness: 0.12,
    envMapIntensity: 0.22,
  });
  const shaftMesh = new THREE.Mesh(shaftGeo, shaftMat);
  shaftMesh.position.y = pencilRadius;
  shaftMesh.castShadow = true;
  shaftMesh.receiveShadow = true;
  pencilBodyGroup.add(shaftMesh);

  const ferruleGeo = new THREE.CylinderGeometry(
    pencilRadius * 1.04,
    pencilRadius * 1.04,
    0.055,
    24,
  );
  ferruleGeo.rotateZ(Math.PI / 2);
  const ferruleMat = new THREE.MeshStandardMaterial({
    color: 0xb89f6d,
    roughness: 0.34,
    metalness: 0.82,
    envMapIntensity: 0.42,
  });
  const ferruleMesh = new THREE.Mesh(ferruleGeo, ferruleMat);
  ferruleMesh.position.set(-shaftLen / 2 - 0.027, pencilRadius, 0);
  ferruleMesh.castShadow = true;
  pencilBodyGroup.add(ferruleMesh);

  const eraserGeo = new THREE.CylinderGeometry(
    pencilRadius * 0.96,
    pencilRadius * 0.96,
    0.036,
    24,
  );
  eraserGeo.rotateZ(Math.PI / 2);
  const eraserMat = new THREE.MeshStandardMaterial({
    color: 0x6b4544,
    roughness: 0.9,
    metalness: 0.0,
    envMapIntensity: 0.1,
  });
  const eraserMesh = new THREE.Mesh(eraserGeo, eraserMat);
  eraserMesh.position.set(-shaftLen / 2 - 0.072, pencilRadius, 0);
  eraserMesh.castShadow = true;
  pencilBodyGroup.add(eraserMesh);

  const woodConeGeo = new THREE.ConeGeometry(pencilRadius, 0.075, 24);
  woodConeGeo.rotateZ(-Math.PI / 2);
  const woodMat = new THREE.MeshStandardMaterial({
    color: 0xb89062,
    roughness: 0.84,
    metalness: 0.0,
    envMapIntensity: 0.12,
  });
  const woodConeMesh = new THREE.Mesh(woodConeGeo, woodMat);
  woodConeMesh.position.set(shaftLen / 2 + 0.037, pencilRadius, 0);
  woodConeMesh.castShadow = true;
  pencilBodyGroup.add(woodConeMesh);

  const leadGeo = new THREE.ConeGeometry(pencilRadius * 0.34, 0.028, 16);
  leadGeo.rotateZ(-Math.PI / 2);
  const leadMat = new THREE.MeshStandardMaterial({
    color: 0x1f2023,
    roughness: 0.42,
    metalness: 0.3,
    envMapIntensity: 0.25,
  });
  const leadMesh = new THREE.Mesh(leadGeo, leadMat);
  leadMesh.position.set(shaftLen / 2 + 0.068, pencilRadius, 0);
  pencilBodyGroup.add(leadMesh);

  root.add(pencil);
  disposables.push(
    shaftGeo,
    shaftMat,
    ferruleGeo,
    ferruleMat,
    eraserGeo,
    eraserMat,
    woodConeGeo,
    woodMat,
    leadGeo,
    leadMat,
  );

  // 3. COFFEE CUP, SAUCER PLATE & REALISTIC BRUSHED-STEEL SPOON (upper-right)
  const coffee = new THREE.Group();
  const saucerShadowTex = createSaucerDropShadowTexture();
  const saucerDropMat = new THREE.MeshBasicMaterial({
    map: saucerShadowTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.74,
  });
  const coffeeAoGeo = new THREE.CircleGeometry(0.25, 48);
  coffeeAoGeo.rotateX(-Math.PI / 2);
  const coffeeAoMesh = new THREE.Mesh(coffeeAoGeo, propShadowMat);
  coffeeAoMesh.position.set(0, 0.0014, 0);
  coffeeAoMesh.renderOrder = 1;
  coffee.add(coffeeAoMesh);

  const coffeeDropGeo = new THREE.CircleGeometry(0.295, 48);
  coffeeDropGeo.rotateX(-Math.PI / 2);
  const coffeeDropMesh = new THREE.Mesh(coffeeDropGeo, saucerDropMat);
  coffeeDropMesh.position.set(0.055, 0.0012, -0.022);
  coffeeDropMesh.renderOrder = 1;
  coffee.add(coffeeDropMesh);

  const coffeeCatcherGeo = new THREE.CircleGeometry(0.32, 64);
  coffeeCatcherGeo.rotateX(-Math.PI / 2);
  const coffeeCatcherMesh = new THREE.Mesh(coffeeCatcherGeo, propShadowCatcherMat);
  coffeeCatcherMesh.position.set(0.055, 0.002, -0.022);
  coffeeCatcherMesh.receiveShadow = true;
  coffeeCatcherMesh.renderOrder = 2;
  coffee.add(coffeeCatcherMesh);
  disposables.push(saucerShadowTex, saucerDropMat, coffeeAoGeo, coffeeDropGeo, coffeeCatcherGeo);

  const coffeeMeshGroup = new THREE.Group();
  coffeeMeshGroup.position.y = 0.0036;
  coffee.add(coffeeMeshGroup);

  const ceramicMat = new THREE.MeshPhysicalMaterial({
    color: 0xbab3a6,
    roughness: 0.36,
    metalness: 0.01,
    clearcoat: 0.14,
    clearcoatRoughness: 0.32,
    envMapIntensity: 0.12,
  });

  const saucerPoints = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.11, 0.0),
    new THREE.Vector2(0.19, 0.018),
    new THREE.Vector2(0.245, 0.038),
    new THREE.Vector2(0.242, 0.044),
    new THREE.Vector2(0.165, 0.026),
    new THREE.Vector2(0.09, 0.015),
    new THREE.Vector2(0.0, 0.015),
  ];
  const saucerGeo = new THREE.LatheGeometry(saucerPoints, 64);
  const saucerMesh = new THREE.Mesh(saucerGeo, ceramicMat);
  saucerMesh.castShadow = true;
  saucerMesh.receiveShadow = true;
  coffeeMeshGroup.add(saucerMesh);

  // Conformal soft directional drop shadow cast by the coffee cup onto the sloped porcelain saucer
  const cupOnSaucerShadowGeo = new THREE.PlaneGeometry(0.32, 0.32, 26, 26);
  cupOnSaucerShadowGeo.rotateX(-Math.PI / 2);
  const cupOnSaucerBasePos = Float32Array.from(
    (cupOnSaucerShadowGeo.attributes.position as THREE.BufferAttribute).array,
  );
  const cupOnSaucerShadowMat = new THREE.MeshBasicMaterial({
    map: propShadowTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.48,
  });
  const cupOnSaucerShadowMesh = new THREE.Mesh(cupOnSaucerShadowGeo, cupOnSaucerShadowMat);
  cupOnSaucerShadowMesh.renderOrder = 2;
  coffeeMeshGroup.add(cupOnSaucerShadowMesh);
  disposables.push(cupOnSaucerShadowGeo, cupOnSaucerShadowMat);

  // Conformal soft directional drop shadow cast by the metallic spoon onto the porcelain saucer rim
  const spoonShadowTex = createSpoonShadowTexture();
  const spoonOnSaucerShadowGeo = new THREE.PlaneGeometry(0.295, 0.115, 22, 10);
  spoonOnSaucerShadowGeo.rotateX(-Math.PI / 2);
  const spoonOnSaucerBasePos = Float32Array.from(
    (spoonOnSaucerShadowGeo.attributes.position as THREE.BufferAttribute).array,
  );
  const spoonOnSaucerShadowMat = new THREE.MeshBasicMaterial({
    map: spoonShadowTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.44,
  });
  const spoonOnSaucerShadowMesh = new THREE.Mesh(spoonOnSaucerShadowGeo, spoonOnSaucerShadowMat);
  spoonOnSaucerShadowMesh.renderOrder = 2;
  coffeeMeshGroup.add(spoonOnSaucerShadowMesh);
  disposables.push(spoonShadowTex, spoonOnSaucerShadowGeo, spoonOnSaucerShadowMat);

  const cupPoints = [
    new THREE.Vector2(0.0, 0.016),
    new THREE.Vector2(0.088, 0.016),
    new THREE.Vector2(0.128, 0.11),
    new THREE.Vector2(0.138, 0.165),
    new THREE.Vector2(0.128, 0.168),
    new THREE.Vector2(0.116, 0.11),
    new THREE.Vector2(0.08, 0.032),
    new THREE.Vector2(0.0, 0.032),
  ];
  const cupGeo = new THREE.LatheGeometry(cupPoints, 64);
  const cupMesh = new THREE.Mesh(cupGeo, ceramicMat);
  cupMesh.castShadow = true;
  cupMesh.receiveShadow = true;
  coffeeMeshGroup.add(cupMesh);

  // Cup handle
  const handleCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.13, 0.14, 0),
    new THREE.Vector3(0.185, 0.145, 0),
    new THREE.Vector3(0.18, 0.085, 0),
    new THREE.Vector3(0.11, 0.06, 0),
  ]);
  const handleGeo = new THREE.TubeGeometry(handleCurve, 28, 0.012, 14, false);
  const handleMesh = new THREE.Mesh(handleGeo, ceramicMat);
  handleMesh.castShadow = true;
  coffeeMeshGroup.add(handleMesh);

  // Organic matte latte crema disc
  const cremaGeo = new THREE.CircleGeometry(0.123, 48);
  cremaGeo.rotateX(-Math.PI / 2);
  const cremaMat = new THREE.MeshStandardMaterial({
    color: 0xe6dfd6,
    map: staticTextures.coffeeLatteMap,
    roughness: 0.44,
    metalness: 0.0,
    envMapIntensity: 0.1,
  });
  const cremaMesh = new THREE.Mesh(cremaGeo, cremaMat);
  cremaMesh.position.y = 0.145;
  cremaMesh.rotation.y = 0.4;
  cremaMesh.receiveShadow = true;
  coffeeMeshGroup.add(cremaMesh);

  // Sculpted 18/10 brushed stainless-steel teaspoon resting cleanly on the front-left saucer rim
  const spoonGroup = new THREE.Group();
  const steelMaps = createBrushedSteelMaps();
  const spoonMat = new THREE.MeshPhysicalMaterial({
    color: 0xd8dce2,
    roughness: 0.2,
    roughnessMap: steelMaps.roughnessMap,
    bumpMap: steelMaps.bumpMap,
    bumpScale: 0.00018,
    metalness: 0.92,
    anisotropy: 0.28,
    anisotropyRotation: 0.0,
    envMapIntensity: 0.96,
    side: THREE.DoubleSide,
  });

  // Double-sided concave spoon bowl with planar XZ UVs so brushed steel shading stays silky without polar ring artifacts
  const spoonBowlGeo = new THREE.SphereGeometry(0.036, 32, 22, 0, Math.PI * 2, 0, Math.PI * 0.44);
  spoonBowlGeo.scale(0.88, 0.42, 1.38);
  spoonBowlGeo.rotateX(Math.PI);
  const bowlPosAttr = spoonBowlGeo.attributes.position as THREE.BufferAttribute;
  const bowlUvAttr = spoonBowlGeo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < bowlPosAttr.count; i++) {
    const px = bowlPosAttr.getX(i);
    const pz = bowlPosAttr.getZ(i);
    bowlUvAttr.setXY(i, px * 11 + 0.5, pz * 9 + 0.5);
  }
  bowlUvAttr.needsUpdate = true;
  const spoonBowl = new THREE.Mesh(spoonBowlGeo, spoonMat);
  spoonBowl.position.set(-0.162, 0.051, 0.026);
  spoonBowl.rotation.order = 'YXZ';
  spoonBowl.rotation.y = -0.68;
  spoonBowl.rotation.x = 0.12;
  spoonBowl.rotation.z = -0.18;
  spoonBowl.castShadow = true;
  spoonBowl.receiveShadow = true;
  spoonGroup.add(spoonBowl);

  // Tapered flared brushed-steel spoon handle seamlessly joined from bowl neck to saucer rim
  const handleShape = new THREE.Shape();
  handleShape.moveTo(-0.0042, 0);
  handleShape.quadraticCurveTo(-0.0036, 0.085, -0.0095, 0.195);
  handleShape.quadraticCurveTo(0, 0.215, 0.0095, 0.195);
  handleShape.quadraticCurveTo(0.0036, 0.085, 0.0042, 0);
  handleShape.closePath();

  const spoonStemGeo = new THREE.ExtrudeGeometry(handleShape, {
    depth: 0.0032,
    bevelEnabled: true,
    bevelThickness: 0.0012,
    bevelSize: 0.0012,
    bevelSegments: 2,
    curveSegments: 16,
  });
  spoonStemGeo.rotateX(Math.PI / 2);
  const spoonStem = new THREE.Mesh(spoonStemGeo, spoonMat);
  spoonStem.position.set(-0.146, 0.044, 0.045);
  spoonStem.rotation.order = 'YXZ';
  spoonStem.rotation.y = 0.69;
  spoonStem.rotation.x = -0.095;
  spoonStem.castShadow = true;
  spoonStem.receiveShadow = true;
  spoonGroup.add(spoonStem);
  coffeeMeshGroup.add(spoonGroup);

  root.add(coffee);
  disposables.push(
    ceramicMat,
    saucerGeo,
    cupGeo,
    handleGeo,
    cremaGeo,
    cremaMat,
    steelMaps.roughnessMap,
    steelMaps.bumpMap,
    spoonMat,
    spoonBowlGeo,
    spoonStemGeo,
  );

  // 4. TWO OFFSET BUSINESS CARDS (lower-right)
  const cardStack = createBusinessCardStack(staticTextures.businessCardMap);
  const cards = cardStack.group;
  addRectShadowCatcher(cards, 0.4, 0.28, 0.01, 0.008);
  root.add(cards);
  disposables.push(cardStack);

  const updateDirectionalShadows = (layout: SceneTheme['props']['desktop']) => {
    const syncOffset = (
      placement: PropLayout,
      castHeight: number,
      maxOffset: number,
    ) => {
      const world = computeLampShadowOffset({
        propX: placement.position.x,
        propZ: placement.position.z,
        lampX: lampPosition.x,
        lampY: lampPosition.y,
        lampZ: lampPosition.z,
        castHeight,
        maxOffset,
      });
      return worldOffsetToLocal(world.worldDx, world.worldDz, placement.rotationY, placement.scale);
    };

    // Pot base + plant rosette layered soft shadows strictly projected from lamp angle
    const potLocal = syncOffset(layout.succulent, 0.12, 0.044);
    potDropMesh.position.set(potLocal.localDx, 0.0013, potLocal.localDz);

    const plantLocal = syncOffset(layout.succulent, 0.19, 0.068);
    plantDropMesh.position.set(plantLocal.localDx, 0.0011, plantLocal.localDz);

    // Short offset drop shadow strictly along lamp angle for the pencil resting on the desk
    const pencilLocal = syncOffset(layout.pencil, 0.12, 0.045);
    pencilDropMesh.position.set(pencilLocal.localDx, 0.0013, pencilLocal.localDz);

    // Saucer plate shadow on oak desk + conformal cup & spoon drop shadows draped onto sloped saucer surface
    const coffeeLocal = syncOffset(layout.coffee, 0.19, 0.082);
    coffeeDropMesh.position.set(coffeeLocal.localDx, 0.0012, coffeeLocal.localDz);
    coffeeCatcherMesh.position.set(coffeeLocal.localDx, 0.002, coffeeLocal.localDz);

    // Project cup shadow onto sloped saucer profile without ever sinking beneath the rim
    const cupCx = coffeeLocal.localDx * 0.72;
    const cupCz = coffeeLocal.localDz * 0.72;
    const cupPosAttr = cupOnSaucerShadowGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < cupPosAttr.count; i++) {
      const bx = cupOnSaucerBasePos[i * 3] + cupCx;
      const bz = cupOnSaucerBasePos[i * 3 + 2] + cupCz;
      const r = Math.hypot(bx, bz);
      const clampedScale = r > 0.236 ? 0.236 / r : 1;
      const sx = bx * clampedScale;
      const sz = bz * clampedScale;
      cupPosAttr.setXYZ(i, sx, getSaucerSurfaceY(Math.min(r, 0.236)) + 0.0012, sz);
    }
    cupPosAttr.needsUpdate = true;

    // Project spoon shadow beneath the spoon bowl & handle onto sloped porcelain saucer along lamp angle
    const spoonShiftX = coffeeLocal.localDx * 0.22;
    const spoonShiftZ = coffeeLocal.localDz * 0.22;
    const spoonCenterX = -0.096 + spoonShiftX;
    const spoonCenterZ = 0.114 + spoonShiftZ;
    const spoonRotY = -0.88; // aligns bowl (-X) to flared tip (+X) directly under spoonGroup
    const cosS = Math.cos(spoonRotY);
    const sinS = Math.sin(spoonRotY);
    const spoonPosAttr = spoonOnSaucerShadowGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < spoonPosAttr.count; i++) {
      const lx = spoonOnSaucerBasePos[i * 3];
      const lz = spoonOnSaucerBasePos[i * 3 + 2];
      const rx = spoonCenterX + lx * cosS + lz * sinS;
      const rz = spoonCenterZ - lx * sinS + lz * cosS;
      const r = Math.hypot(rx, rz);
      const clampedScale = r > 0.238 ? 0.238 / r : 1;
      const sx = rx * clampedScale;
      const sz = rz * clampedScale;
      spoonPosAttr.setXYZ(i, sx, getSaucerSurfaceY(Math.min(r, 0.238)) + 0.0016, sz);
    }
    spoonPosAttr.needsUpdate = true;
  };

  return {
    group: root,
    succulent,
    pencil,
    coffee,
    cards,
    cardsMeshGroup: cardStack.cardsMeshGroup,
    cardHitTargets: cardStack.hitTargets,
    applyLayout: (layout) => {
      applyPropPlacement(succulent, layout.succulent);
      applyPropPlacement(pencil, layout.pencil);
      applyPropPlacement(coffee, layout.coffee);
      applyPropPlacement(cards, layout.cards);
      updateDirectionalShadows(layout);
    },
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}
