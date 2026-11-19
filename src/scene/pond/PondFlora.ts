import * as THREE from 'three';
import { nearestObstacleSeparation, POND_LAYOUT } from './constants';
import {
  createCreepingMossMatGeometry,
  createMossClumpTextures,
  createVelvetyMossMaterial,
} from './FloatingPlank';
import type { WaterSimulation } from './WaterSimulation';

export interface LilyPadTextures {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  dispose: () => void;
}

export function createMeniscusShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 14, 64, 64, 62);
  g.addColorStop(0, 'rgba(4, 10, 9, 0.44)');
  g.addColorStop(0.58, 'rgba(4, 10, 9, 0.28)');
  g.addColorStop(0.84, 'rgba(4, 10, 9, 0.09)');
  g.addColorStop(1, 'rgba(4, 10, 9, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

export interface PondFloraRig {
  group: THREE.Group;
  aboveWaterGroup: THREE.Group;
  update: (
    dtSec: number,
    elapsedSec: number,
    waterSim: WaterSimulation,
    onDripImpact: (x: number, z: number) => void,
  ) => void;
  dispose: () => void;
}

interface FloatingLeafAgent {
  mesh: THREE.Mesh;
  baseX: number;
  baseZ: number;
  baseYaw: number;
  driftPhase: number;
  driftAmpX: number;
  driftAmpZ: number;
}

function hash3(x: number, y: number, z: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 19.3) * 43758.5453123;
  return n - Math.floor(n);
}

function valueNoise3D(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);

  const c000 = hash3(ix, iy, iz, seed);
  const c100 = hash3(ix + 1, iy, iz, seed);
  const c010 = hash3(ix, iy + 1, iz, seed);
  const c110 = hash3(ix + 1, iy + 1, iz, seed);
  const c001 = hash3(ix, iy, iz + 1, seed);
  const c101 = hash3(ix + 1, iy, iz + 1, seed);
  const c011 = hash3(ix, iy + 1, iz + 1, seed);
  const c111 = hash3(ix + 1, iy + 1, iz + 1, seed);

  const x00 = c000 + (c100 - c000) * ux;
  const x10 = c010 + (c110 - c010) * ux;
  const x01 = c001 + (c101 - c001) * ux;
  const x11 = c011 + (c111 - c011) * ux;

  const y0 = x00 + (x10 - x00) * uy;
  const y1 = x01 + (x11 - x01) * uy;
  return y0 + (y1 - y0) * uz;
}

function fbm3D(x: number, y: number, z: number, seed: number): number {
  return (
    valueNoise3D(x, y, z, seed) * 0.56 +
    valueNoise3D(x * 2.05 + 4.1, y * 2.05 + 1.3, z * 2.05 + 2.7, seed + 7) * 0.29 +
    valueNoise3D(x * 4.2 + 8.3, y * 4.2 + 5.1, z * 4.2 + 6.9, seed + 17) * 0.15
  );
}

export function createLilyPadTextures(maxAnisotropy: number): LilyPadTextures {
  const size = 1024;
  const cCanvas = document.createElement('canvas');
  cCanvas.width = size;
  cCanvas.height = size;
  const cCtx = cCanvas.getContext('2d')!;

  const bCanvas = document.createElement('canvas');
  bCanvas.width = size;
  bCanvas.height = size;
  const bCtx = bCanvas.getContext('2d')!;

  const rCanvas = document.createElement('canvas');
  rCanvas.width = size;
  rCanvas.height = size;
  const rCtx = rCanvas.getContext('2d')!;

  const cx = size * 0.5;
  const cy = size * 0.5;
  const maxR = size * 0.49;

  // Rich deep botanical jade-olive lamina with subtle warm bronze-crimson outer rim blush
  const radGrad = cCtx.createRadialGradient(cx, cy, 18, cx, cy, maxR);
  radGrad.addColorStop(0, '#3e5e2b');
  radGrad.addColorStop(0.28, '#324e23');
  radGrad.addColorStop(0.68, '#263e1b');
  radGrad.addColorStop(0.91, '#203517');
  radGrad.addColorStop(0.97, '#423620');
  radGrad.addColorStop(1, '#4c3221');
  cCtx.fillStyle = radGrad;
  cCtx.fillRect(0, 0, size, size);

  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, size, size);

  // Hydrophobic waxy lamina cuticle (~0.40 roughness), slightly higher along veins/rim
  const roughGrad = rCtx.createRadialGradient(cx, cy, 24, cx, cy, maxR);
  roughGrad.addColorStop(0, '#626262');
  roughGrad.addColorStop(0.75, '#6e6e6e');
  roughGrad.addColorStop(1, '#949494');
  rCtx.fillStyle = roughGrad;
  rCtx.fillRect(0, 0, size, size);

  const hash = (n: number) => {
    const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return v - Math.floor(v);
  };

  // Subtle low-contrast organic chlorophyll depth mottling (no harsh chalky speckles)
  for (let i = 0; i < 420; i++) {
    const a = (i * 2.39996) % (Math.PI * 2);
    const r = Math.sqrt((i + 1) / 420) * (size * 0.465);
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    const rad = 10 + hash(i * 3.1) * 22;
    const pick = i % 4;
    cCtx.fillStyle =
      pick === 0
        ? 'rgba(74, 108, 48, 0.065)'
        : pick === 1
          ? 'rgba(24, 42, 18, 0.07)'
          : pick === 2
            ? 'rgba(60, 90, 40, 0.055)'
            : 'rgba(84, 72, 42, 0.045)';
    cCtx.beginPath();
    cCtx.ellipse(px, py, rad * 1.25, rad * 0.88, a + 0.4, 0, Math.PI * 2);
    cCtx.fill();
  }

  // Delicate dichotomous branching veins (soft chartreuse-jade, subtle natural contrast)
  const drawBranchVein = (
    x0: number,
    y0: number,
    angle: number,
    len: number,
    width: number,
    depth: number,
    seed: number,
  ) => {
    if (depth > 2 || len < 14) return;
    const curveBend = (hash(seed * 3.7) - 0.5) * 0.18;
    const midAngle = angle + curveBend;
    const mx = x0 + Math.cos(midAngle) * (len * 0.52);
    const my = y0 + Math.sin(midAngle) * (len * 0.52);
    const ex = x0 + Math.cos(angle + curveBend * 0.6) * len;
    const ey = y0 + Math.sin(angle + curveBend * 0.6) * len;

    const alphaColor = depth === 0 ? 0.21 : depth === 1 ? 0.15 : 0.095;
    const alphaBump = depth === 0 ? 0.24 : depth === 1 ? 0.18 : 0.11;

    cCtx.strokeStyle = `rgba(116, 152, 74, ${alphaColor})`;
    cCtx.lineWidth = width;
    cCtx.lineCap = 'round';
    cCtx.beginPath();
    cCtx.moveTo(x0, y0);
    cCtx.quadraticCurveTo(mx, my, ex, ey);
    cCtx.stroke();

    bCtx.strokeStyle = `rgba(210, 210, 210, ${alphaBump})`;
    bCtx.lineWidth = width * 1.15;
    bCtx.lineCap = 'round';
    bCtx.beginPath();
    bCtx.moveTo(x0, y0);
    bCtx.quadraticCurveTo(mx, my, ex, ey);
    bCtx.stroke();

    rCtx.strokeStyle = `rgba(144, 144, 144, ${alphaBump * 0.85})`;
    rCtx.lineWidth = width * 1.1;
    rCtx.beginPath();
    rCtx.moveTo(x0, y0);
    rCtx.quadraticCurveTo(mx, my, ex, ey);
    rCtx.stroke();

    if (depth < 2) {
      const forkSpread = depth === 0 ? 0.24 : 0.32;
      drawBranchVein(
        mx,
        my,
        angle + forkSpread,
        len * 0.56,
        width * 0.62,
        depth + 1,
        seed * 2.1 + 1.1,
      );
      drawBranchVein(
        ex,
        ey,
        angle - forkSpread * 0.85,
        len * 0.50,
        width * 0.58,
        depth + 1,
        seed * 3.3 + 2.7,
      );
    }
  };

  const primaryVeins = 16;
  for (let i = 0; i < primaryVeins; i++) {
    const ang = (i / primaryVeins) * Math.PI * 2 + 0.12 + (hash(i + 5) - 0.5) * 0.08;
    drawBranchVein(cx, cy, ang, size * 0.28, 2.1, 0, i + 1);
  }

  // Faint bronze-crimson blush ring right along the wavy rim edge
  const rimGlow = cCtx.createRadialGradient(cx, cy, maxR * 0.86, cx, cy, maxR);
  rimGlow.addColorStop(0, 'rgba(98, 48, 32, 0)');
  rimGlow.addColorStop(0.75, 'rgba(98, 48, 32, 0.12)');
  rimGlow.addColorStop(1, 'rgba(104, 42, 30, 0.24)');
  cCtx.fillStyle = rimGlow;
  cCtx.fillRect(0, 0, size, size);

  const map = new THREE.CanvasTexture(cCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = maxAnisotropy;

  const bumpMap = new THREE.CanvasTexture(bCanvas);
  bumpMap.anisotropy = maxAnisotropy;

  const roughnessMap = new THREE.CanvasTexture(rCanvas);
  roughnessMap.anisotropy = maxAnisotropy;

  return {
    map,
    bumpMap,
    roughnessMap,
    dispose: () => {
      map.dispose();
      bumpMap.dispose();
      roughnessMap.dispose();
    },
  };
}

export interface LilyPadSculptOptions {
  radius: number;
  notchAngleRad?: number;
  cupHeight?: number;
  waveAmp?: number;
  flatCenterRatio?: number;
}

export function sampleLilyPadSurfaceY(
  rNorm: number,
  theta: number,
  opts: LilyPadSculptOptions,
): number {
  const {
    cupHeight = 0.02,
    waveAmp = 0.008,
    flatCenterRatio = 0.35,
  } = opts;
  const cupT = Math.max(0, (rNorm - flatCenterRatio) / (1 - flatCenterRatio));
  const cupY = cupHeight * Math.pow(cupT, 2.1);
  const rimWave =
    Math.sin(theta * 7 + 0.6) * waveAmp * Math.pow(cupT, 1.35) +
    Math.cos(theta * 11 - 0.3) * (waveAmp * 0.45) * Math.pow(cupT, 1.7);
  const lipCurl = rNorm > 0.88 ? ((rNorm - 0.88) / 0.12) * (cupHeight * 0.42) : 0;
  return cupY + rimWave + lipCurl;
}

export function createSculptedLilyPadGeometry(
  opts: LilyPadSculptOptions,
): THREE.BufferGeometry {
  const {
    radius,
    notchAngleRad = 0.42,
    flatCenterRatio = 0.35,
  } = opts;

  const radialSegs = 72;
  const ringSegs = 20;
  const thetaSpan = Math.PI * 2 - notchAngleRad;
  const thetaStart = notchAngleRad * 0.5;

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let ir = 0; ir <= ringSegs; ir++) {
    const rNorm = ir / ringSegs;
    const r = rNorm * radius;

    for (let it = 0; it <= radialSegs; it++) {
      const tNorm = it / radialSegs;
      const theta = thetaStart + tNorm * thetaSpan;
      // Smooth organically ruffled wavy outer rim & subtle cleft roundness
      const rimOrganic =
        1.0 +
        (Math.sin(theta * 6 + 0.4) * 0.024 +
          Math.cos(theta * 11 - 0.3) * 0.013 +
          Math.sin(theta * 17) * 0.005) *
          Math.pow(rNorm, 1.2);
      const px = Math.cos(theta) * r * rimOrganic;
      const pz = Math.sin(theta) * r * rimOrganic;
      const py = sampleLilyPadSurfaceY(rNorm, theta, { ...opts, flatCenterRatio });

      positions.push(px, py, pz);
      uvs.push(0.5 + px / (radius * 2.12), 0.5 + pz / (radius * 2.12));
    }
  }

  const cols = radialSegs + 1;
  for (let ir = 0; ir < ringSegs; ir++) {
    for (let it = 0; it < radialSegs; it++) {
      const a = ir * cols + it;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, c, d, a, d, b);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function createLilyPadDroplets(
  padOpts: LilyPadSculptOptions,
  placements: Array<{ rNorm: number; theta: number; scale: number }>,
): {
  group: THREE.Group;
  dispose: () => void;
} {
  const group = new THREE.Group();
  const geo = new THREE.SphereGeometry(0.0046, 12, 10);
  geo.scale(1.18, 0.56, 1.08);
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xd4efe2,
    roughness: 0.02,
    metalness: 0.08,
    clearcoat: 1.0,
    clearcoatRoughness: 0.015,
    ior: 1.333,
    reflectivity: 1.0,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    envMapIntensity: 1.35,
  });

  placements.forEach((p) => {
    const r = p.rNorm * padOpts.radius;
    const x = Math.cos(p.theta) * r;
    const z = Math.sin(p.theta) * r;
    const y = sampleLilyPadSurfaceY(p.rNorm, p.theta, padOpts) + 0.002 * p.scale;

    const bead = new THREE.Mesh(geo, mat);
    bead.position.set(x, y, z);
    bead.scale.setScalar(p.scale);
    bead.rotation.y = p.theta * 1.3;
    bead.castShadow = false;
    bead.receiveShadow = true;
    group.add(bead);
  });

  return {
    group,
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
}

function createLotusPetalTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const vGrad = ctx.createLinearGradient(0, size, 0, 0);
  vGrad.addColorStop(0, '#fff7dc'); // warm creamy nectar ivory base
  vGrad.addColorStop(0.32, '#fff5f0'); // luminous soft ivory-blush
  vGrad.addColorStop(0.68, '#f6bfd3'); // soft lotus-pink wash
  vGrad.addColorStop(1, '#dd6893'); // warm rose-blush upper apex
  ctx.fillStyle = vGrad;
  ctx.fillRect(0, 0, size, size);

  // Delicate longitudinal botanical petal veins fanning across the broad obovate belly
  const ribCount = 30;
  for (let i = 0; i < ribCount; i++) {
    const u = (i + 0.5) / ribCount;
    const s = u * 2 - 1;
    const xBase = size * (0.5 + s * 0.18);
    const xMid = size * (0.5 + s * 0.49);
    const xTip = size * (0.5 + s * 0.22);
    ctx.strokeStyle =
      i % 2 === 0 ? 'rgba(255, 250, 244, 0.34)' : 'rgba(214, 96, 138, 0.16)';
    ctx.lineWidth = i === ribCount / 2 ? 2.2 : 1.3;
    ctx.beginPath();
    ctx.moveTo(xBase, size);
    ctx.quadraticCurveTo(xMid, size * 0.42, xTip, 0);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

/**
 * Broad, plump, obovate spoon-cupped Sacred Lotus (Nelumbo) petal:
 * narrow claw base -> wide rounded spooned belly -> gentle soft tip,
 * with strong concave cupping along both width (s) and length (v).
 */
function createLotusPetalGeometry(
  length: number,
  maxWidth: number,
  bowlDepth: number,
): THREE.BufferGeometry {
  const segU = 18;
  const segV = 22;
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const baseColor = new THREE.Color('#fff9e2');
  const midColor = new THREE.Color('#fce6ef');
  const tipColor = new THREE.Color('#e37099');
  const tmpColor = new THREE.Color();

  for (let iv = 0; iv <= segV; iv++) {
    const v = iv / segV;
    // Obovate lotus petal profile: narrow base claw (0.18) swelling into wide plump rounded belly near v~0.58,
    // tapering softly to a gentle rounded tip (never needle-spiky)
    const belly = Math.pow(Math.sin(Math.pow(v, 0.64) * Math.PI), 0.68);
    const claw = 0.18 * (1 - v) * (1 - v);
    const wProfile = Math.min(1, belly + claw) * maxWidth;

    const zLen = v * length;
    // Longitudinal spoon bowl curve: belly swells subtly outward (-Y) then hooks gently inward (+Y) toward flower core
    const archY =
      -Math.sin(v * Math.PI) * (bowlDepth * 0.42) + Math.pow(v, 2.2) * (bowlDepth * 0.85);

    for (let iu = 0; iu <= segU; iu++) {
      const u = iu / segU;
      const s = u * 2 - 1;
      const x = s * wProfile * 0.5;
      // Pronounced concave lateral cupping (+Y lifts lateral margins around the flower interior)
      const lateralCup =
        Math.pow(Math.abs(s), 1.85) * bowlDepth * Math.sin(Math.pow(v, 0.75) * Math.PI * 0.96);
      const microPleat = Math.cos(s * Math.PI * 3.0) * 0.0005 * Math.sin(v * Math.PI);
      const y = archY + lateralCup + microPleat;

      positions.push(x, y, zLen);
      uvs.push(u, v);

      if (v < 0.44) {
        tmpColor.copy(baseColor).lerp(midColor, v / 0.44);
      } else {
        tmpColor.copy(midColor).lerp(tipColor, Math.pow((v - 0.44) / 0.56, 1.08));
      }
      colors.push(tmpColor.r, tmpColor.g, tmpColor.b);
    }
  }

  const cols = segU + 1;
  for (let iv = 0; iv < segV; iv++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = iv * cols + iu;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, c, d, a, d, b);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function createGraniteBoulderTextures(maxAnisotropy: number): {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  dispose: () => void;
} {
  const size = 512;
  const cCanvas = document.createElement('canvas');
  cCanvas.width = size;
  cCanvas.height = size;
  const cCtx = cCanvas.getContext('2d')!;

  const bCanvas = document.createElement('canvas');
  bCanvas.width = size;
  bCanvas.height = size;
  const bCtx = bCanvas.getContext('2d')!;

  const rCanvas = document.createElement('canvas');
  rCanvas.width = size;
  rCanvas.height = size;
  const rCtx = rCanvas.getContext('2d')!;

  // Matte weathered natural dark-grey granite base (#444a48)
  cCtx.fillStyle = '#444a48';
  cCtx.fillRect(0, 0, size, size);

  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, size, size);

  rCtx.fillStyle = '#ebebeb'; // ~0.92 matte stone roughness
  rCtx.fillRect(0, 0, size, size);

  const rand = (n: number) => {
    const v = Math.sin(n * 43.17 + 1.9) * 43758.5453;
    return v - Math.floor(v);
  };

  // Large mineral patches & warm lichen / moss weathering
  for (let i = 0; i < 240; i++) {
    const x = rand(i * 3 + 1) * size;
    const y = rand(i * 3 + 2) * size;
    const r = 10 + rand(i * 3 + 3) * 32;
    const tone = i % 5;
    cCtx.fillStyle =
      tone === 0
        ? 'rgba(130, 134, 128, 0.20)'
        : tone === 1
          ? 'rgba(54, 62, 58, 0.24)'
          : tone === 2
            ? 'rgba(78, 92, 62, 0.14)'
            : 'rgba(104, 102, 92, 0.16)';
    cCtx.beginPath();
    cCtx.arc(x, y, r, 0, Math.PI * 2);
    cCtx.fill();

    bCtx.fillStyle = tone % 2 === 0 ? 'rgba(195, 195, 195, 0.18)' : 'rgba(65, 65, 65, 0.2)';
    bCtx.beginPath();
    bCtx.arc(x, y, r * 0.7, 0, Math.PI * 2);
    bCtx.fill();
  }

  // Fine granite quartz/biotite/feldspar mineral speckles
  for (let i = 0; i < 5200; i++) {
    const x = rand(i * 5 + 7) * size;
    const y = rand(i * 5 + 11) * size;
    const s = 1 + (i % 3);
    cCtx.fillStyle =
      i % 4 === 0
        ? 'rgba(196, 200, 192, 0.30)'
        : i % 3 === 0
          ? 'rgba(26, 30, 32, 0.34)'
          : 'rgba(128, 132, 126, 0.24)';
    cCtx.fillRect(x, y, s, s);
    bCtx.fillStyle = i % 2 === 0 ? 'rgba(220, 220, 220, 0.22)' : 'rgba(42, 42, 42, 0.22)';
    bCtx.fillRect(x, y, s, s);
  }

  // Subtle fractured micro-veins
  for (let i = 0; i < 14; i++) {
    let px = rand(i * 19 + 3) * size;
    let py = rand(i * 19 + 5) * size;
    cCtx.strokeStyle = 'rgba(28, 32, 32, 0.42)';
    cCtx.lineWidth = 1.4;
    bCtx.strokeStyle = 'rgba(24, 24, 24, 0.65)';
    bCtx.lineWidth = 2.0;
    cCtx.beginPath();
    bCtx.beginPath();
    cCtx.moveTo(px, py);
    bCtx.moveTo(px, py);
    for (let s = 0; s < 5; s++) {
      px += (rand(i * 29 + s * 3) - 0.5) * 64;
      py += (rand(i * 29 + s * 7) - 0.5) * 64;
      cCtx.lineTo(px, py);
      bCtx.lineTo(px, py);
    }
    cCtx.stroke();
    bCtx.stroke();
  }

  const map = new THREE.CanvasTexture(cCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = maxAnisotropy;

  const bumpMap = new THREE.CanvasTexture(bCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.anisotropy = maxAnisotropy;

  const roughnessMap = new THREE.CanvasTexture(rCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = maxAnisotropy;

  return {
    map,
    bumpMap,
    roughnessMap,
    dispose: () => {
      map.dispose();
      bumpMap.dispose();
      roughnessMap.dispose();
    },
  };
}

/**
 * Sculpts a substantial angular & river-worn granite boulder with multi-octave FBM + planar
 * fracture bevels, protruding half above waterY and half submerged below waterY.
 */
function createGraniteBoulderGeometry(
  radius: number,
  aboveWater: number,
  belowWater: number,
  seed: number,
): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, 4);
  const pos = geo.attributes.position as THREE.BufferAttribute;

  // Define 5 pseudo-random cleavage planes for gentle river-worn rock facets
  const planes = Array.from({ length: 5 }, (_, k) => {
    const a = k * 2.1 + seed * 1.7;
    const elev = 0.25 + ((k * 0.37) % 0.65);
    return new THREE.Vector3(
      Math.cos(a) * Math.cos(elev),
      Math.sin(elev),
      Math.sin(a) * Math.cos(elev),
    ).normalize();
  });

  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();

    // Smooth FBM displacement + gentle river-worn rock facets
    const n1 = fbm3D(v.x * 1.85 + 2.0, v.y * 1.85 + 2.0, v.z * 1.85 + 2.0, seed);
    let rMod = 0.86 + n1 * 0.28;

    for (let p = 0; p < planes.length; p++) {
      const dot = v.dot(planes[p]);
      if (dot > 0.52) {
        rMod -= (dot - 0.52) * 0.19;
      }
    }

    // Subtle river-worn flat upper shelf so dappled bamboo shadows read clearly across the stone top
    let py = v.y * rMod;
    if (py > 0.46) {
      py = 0.46 + (py - 0.46) * 0.36;
    }

    const px = v.x * rMod * radius * 1.08;
    const pz = v.z * rMod * radius * 0.92;
    const scaledY = py >= 0 ? py * aboveWater * 1.38 : py * belowWater * 1.38;

    pos.setXYZ(i, px, scaledY, pz);
  }

  geo.computeVertexNormals();
  return geo;
}

function createBambooCulmTextures(maxAnisotropy: number): {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  dispose: () => void;
} {
  const w = 256;
  const h = 512;

  const cCanvas = document.createElement('canvas');
  cCanvas.width = w;
  cCanvas.height = h;
  const cCtx = cCanvas.getContext('2d')!;

  const bCanvas = document.createElement('canvas');
  bCanvas.width = w;
  bCanvas.height = h;
  const bCtx = bCanvas.getContext('2d')!;

  const rCanvas = document.createElement('canvas');
  rCanvas.width = w;
  rCanvas.height = h;
  const rCtx = rCanvas.getContext('2d')!;

  // Warm olive-jade bamboo culm gradient
  const grad = cCtx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, '#3a4e26');
  grad.addColorStop(0.5, '#597438');
  grad.addColorStop(1, '#3a4e26');
  cCtx.fillStyle = grad;
  cCtx.fillRect(0, 0, w, h);

  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, w, h);

  rCtx.fillStyle = '#909090'; // ~0.56 satin waxy bamboo epidermis
  rCtx.fillRect(0, 0, w, h);

  // Longitudinal vascular fiber striations along internode length
  for (let i = 0; i < 160; i++) {
    const x = (i / 160) * w;
    cCtx.strokeStyle =
      i % 4 === 0 ? 'rgba(136, 158, 86, 0.22)' : 'rgba(28, 40, 18, 0.18)';
    cCtx.lineWidth = 1.2;
    cCtx.beginPath();
    cCtx.moveTo(x, 0);
    cCtx.lineTo(x, h);
    cCtx.stroke();

    bCtx.strokeStyle = i % 2 === 0 ? 'rgba(165, 165, 165, 0.25)' : 'rgba(95, 95, 95, 0.25)';
    bCtx.lineWidth = 1;
    bCtx.beginPath();
    bCtx.moveTo(x, 0);
    bCtx.lineTo(x, h);
    bCtx.stroke();
  }

  // Subtle horizontal bamboo nodal patina bands
  for (let n = 1; n <= 3; n++) {
    const y = (h / 4) * n;
    cCtx.fillStyle = 'rgba(28, 34, 16, 0.36)';
    cCtx.fillRect(0, y - 5, w, 10);
    cCtx.fillStyle = 'rgba(182, 174, 122, 0.22)';
    cCtx.fillRect(0, y - 2, w, 3);
  }

  const map = new THREE.CanvasTexture(cCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = maxAnisotropy;

  const bumpMap = new THREE.CanvasTexture(bCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.anisotropy = maxAnisotropy;

  const roughnessMap = new THREE.CanvasTexture(rCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = maxAnisotropy;

  return {
    map,
    bumpMap,
    roughnessMap,
    dispose: () => {
      map.dispose();
      bumpMap.dispose();
      roughnessMap.dispose();
    },
  };
}

/**
 * Builds a tapered bamboo culm along a smooth 3D spline, plus returns nodal transforms
 * for raised nodal joint rings and twig forks.
 */
function createTaperedBambooCulmGeometry(
  curve: THREE.CatmullRomCurve3,
  radiusStart: number,
  radiusEnd: number,
  tubularSegs = 28,
  radialSegs = 10,
): THREE.BufferGeometry {
  const frames = curve.computeFrenetFrames(tubularSegs, false);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const vertex = new THREE.Vector3();

  for (let i = 0; i <= tubularSegs; i++) {
    const u = i / tubularSegs;
    const P = curve.getPointAt(u);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    const baseR = THREE.MathUtils.lerp(radiusStart, radiusEnd, u);
    // Subtle slight internode swelling near every bamboo joint (~4 nodes along culm)
    const nodePhase = (u * 4.0) % 1;
    const nodeFlare = Math.exp(-Math.pow((nodePhase - 0.0) / 0.08, 2)) * 0.14;
    const r = baseR * (1 + nodeFlare);

    for (let j = 0; j <= radialSegs; j++) {
      const v = j / radialSegs;
      const theta = v * Math.PI * 2;
      const sin = Math.sin(theta);
      const cos = Math.cos(theta);
      vertex
        .copy(P)
        .addScaledVector(N, cos * r)
        .addScaledVector(B, sin * r);
      positions.push(vertex.x, vertex.y, vertex.z);
      uvs.push(v, u * 4.0);
    }
  }

  const cols = radialSegs + 1;
  for (let i = 0; i < tubularSegs; i++) {
    for (let j = 0; j < radialSegs; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, c, d, a, d, b);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Multi-segment arched lance-shaped bamboo leaf blade with central V-fold midrib crease
 * and graceful natural droop toward the pointed needle tip.
 */
function createBambooLeafBladeGeometry(length = 0.22, maxWidth = 0.034): THREE.BufferGeometry {
  const segLen = 6;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segLen; i++) {
    const t = i / segLen; // 0 = petiole stem base, 1 = pointed tip
    // Lanceolate width profile: swells near t=0.32 then tapers smoothly to needle tip
    const wProfile = Math.sin(Math.pow(t, 0.65) * Math.PI) * maxWidth;
    const z = t * length;
    // Gentle arch upward near base, drooping smoothly toward tip
    const archY = Math.sin(t * Math.PI * 0.82) * (length * 0.08) - t * t * (length * 0.14);
    const midribV = Math.sin(t * Math.PI) * 0.0028;

    // 3 vertices across width: left edge, center midrib crease, right edge
    positions.push(-wProfile * 0.5, archY + midribV, z);
    positions.push(0, archY, z);
    positions.push(wProfile * 0.5, archY + midribV, z);

    uvs.push(0, t, 0.5, t, 1, t);
  }

  for (let i = 0; i < segLen; i++) {
    const row = i * 3;
    const next = (i + 1) * 3;
    indices.push(row, next, next + 1, row, next + 1, row + 1);
    indices.push(row + 1, next + 1, next + 2, row + 1, next + 2, row + 2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function createMomijiMapleTexture(
  baseHex: string,
  tipHex: string,
  veinRgba: string,
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createRadialGradient(size * 0.5, size * 0.58, 10, size * 0.5, size * 0.5, size * 0.52);
  grad.addColorStop(0, baseHex);
  grad.addColorStop(0.75, baseHex);
  grad.addColorStop(1, tipHex);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Delicate palmate leaf veins radiating from stem notch
  ctx.strokeStyle = veinRgba;
  ctx.lineWidth = 1.6;
  const originX = size * 0.5;
  const originY = size * 0.72;
  const lobeAngles = [-1.62, -1.06, -0.52, 0.0, 0.52, 1.06, 1.62];
  lobeAngles.forEach((a) => {
    const ex = originX + Math.sin(a) * size * 0.45;
    const ey = originY - Math.cos(a) * size * 0.45;
    ctx.beginPath();
    ctx.moveTo(originX, originY);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

/**
 * Recognizable ~2.5x larger 7-lobed Japanese Momiji maple leaf (~0.175m span) with sculpted stem & organic water-cupping camber.
 */
function createJapaneseMapleLeafGeometry(scaleSpan = 0.105): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  // Slender petiole stem at base
  shape.moveTo(-scaleSpan * 0.025, -scaleSpan * 0.34);
  shape.lineTo(scaleSpan * 0.025, -scaleSpan * 0.34);
  shape.lineTo(scaleSpan * 0.018, 0.0);

  // 7 serrated Momiji lobes radiating cleanly from -1.65 rad to +1.65 rad
  const lobes = [
    { angle: 1.68, len: scaleSpan * 0.48 },
    { angle: 1.06, len: scaleSpan * 0.78 },
    { angle: 0.52, len: scaleSpan * 0.94 },
    { angle: 0.0, len: scaleSpan * 1.06 },
    { angle: -0.52, len: scaleSpan * 0.94 },
    { angle: -1.06, len: scaleSpan * 0.78 },
    { angle: -1.68, len: scaleSpan * 0.48 },
  ];

  // Trace perimeter cleanly from right outer lobe around to left outer lobe
  shape.moveTo(0, 0);
  for (let i = 0; i < lobes.length; i++) {
    const l = lobes[i];
    const tipX = Math.sin(l.angle) * l.len;
    const tipY = Math.cos(l.angle) * l.len;
    const leadAng = l.angle + 0.19;
    const leadR = l.len * 0.56;
    shape.quadraticCurveTo(Math.sin(leadAng) * leadR, Math.cos(leadAng) * leadR, tipX, tipY);

    if (i < lobes.length - 1) {
      const next = lobes[i + 1];
      const valleyAng = (l.angle + next.angle) * 0.5;
      const valleyR = Math.min(l.len, next.len) * 0.28;
      const trailAng = l.angle - 0.16;
      shape.quadraticCurveTo(
        Math.sin(trailAng) * l.len * 0.5,
        Math.cos(trailAng) * l.len * 0.5,
        Math.sin(valleyAng) * valleyR,
        Math.cos(valleyAng) * valleyR,
      );
    }
  }
  shape.lineTo(-scaleSpan * 0.018, 0.0);
  shape.lineTo(-scaleSpan * 0.025, -scaleSpan * 0.34);
  shape.closePath();

  const geo = new THREE.ShapeGeometry(shape, 4);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const pz = pos.getZ(i);
    const r = Math.hypot(px, pz);
    // Gentle organic curl around lobe tips so leaves float naturally on the meniscus
    const curl = Math.pow(Math.min(1, r / scaleSpan), 1.6) * 0.009 + Math.sin(px * 22 + pz * 18) * 0.0022;
    pos.setY(i, curl);
    uv.setXY(i, 0.5 + px / (scaleSpan * 2.2), 0.72 + pz / (scaleSpan * 1.9));
  }
  geo.computeVertexNormals();
  return geo;
}

export function createPondFlora(
  waterY: number,
  bedY: number,
  maxAnisotropy: number,
): PondFloraRig {
  const disposables: Array<{ dispose: () => void }> = [];
  const group = new THREE.Group();
  group.name = 'pond-flora-group';

  const aboveWaterGroup = new THREE.Group();
  group.add(aboveWaterGroup);

  const padTextures = createLilyPadTextures(maxAnisotropy);
  const padMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: padTextures.map,
    bumpMap: padTextures.bumpMap,
    bumpScale: 0.0038,
    roughnessMap: padTextures.roughnessMap,
    roughness: 0.42,
    metalness: 0.0,
    clearcoat: 0.35,
    clearcoatRoughness: 0.32,
    envMapIntensity: 0.24,
    side: THREE.DoubleSide,
  });

  const meniscusTex = createMeniscusShadowTexture();
  const meniscusMat = new THREE.MeshBasicMaterial({
    map: meniscusTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.92,
  });
  const mainMeniscusGeo = new THREE.PlaneGeometry(0.62, 0.62);
  mainMeniscusGeo.rotateX(-Math.PI / 2);
  const compMeniscusGeo = new THREE.PlaneGeometry(0.35, 0.35);
  compMeniscusGeo.rotateX(-Math.PI / 2);

  // 1. BOTTOM-LEFT LILY PADS (with 3D glistening droplets) + 5-TIER TRANSLUCENT 3D LOTUS
  const lotusGroup = new THREE.Group();
  lotusGroup.position.set(POND_LAYOUT.lotusPadPos.x, waterY + 0.005, POND_LAYOUT.lotusPadPos.z);
  aboveWaterGroup.add(lotusGroup);

  const mainMeniscus = new THREE.Mesh(mainMeniscusGeo, meniscusMat);
  mainMeniscus.position.y = -0.0024;
  mainMeniscus.renderOrder = 2;
  lotusGroup.add(mainMeniscus);

  const mainPadOpts: LilyPadSculptOptions = {
    radius: 0.265,
    notchAngleRad: 0.46,
    cupHeight: 0.018,
    waveAmp: 0.0085,
    flatCenterRatio: 0.34,
  };
  const mainPadGeo = createSculptedLilyPadGeometry(mainPadOpts);
  const mainPadMesh = new THREE.Mesh(mainPadGeo, padMat);
  mainPadMesh.rotation.y = 0.85;
  mainPadMesh.castShadow = true;
  mainPadMesh.receiveShadow = true;
  lotusGroup.add(mainPadMesh);

  const mainPadDroplets = createLilyPadDroplets(mainPadOpts, [
    { rNorm: 0.56, theta: 2.05, scale: 1.1 },
    { rNorm: 0.68, theta: 2.32, scale: 0.78 },
    { rNorm: 0.52, theta: 3.72, scale: 1.25 },
    { rNorm: 0.74, theta: 4.55, scale: 0.85 },
    { rNorm: 0.60, theta: 5.45, scale: 0.95 },
  ]);
  mainPadMesh.add(mainPadDroplets.group);

  const compGroup = new THREE.Group();
  compGroup.position.set(
    POND_LAYOUT.companionPadPos.x,
    waterY + 0.004,
    POND_LAYOUT.companionPadPos.z,
  );
  aboveWaterGroup.add(compGroup);

  const compMeniscus = new THREE.Mesh(compMeniscusGeo, meniscusMat);
  compMeniscus.position.y = -0.002;
  compMeniscus.renderOrder = 2;
  compGroup.add(compMeniscus);

  const compPadOpts: LilyPadSculptOptions = {
    radius: 0.148,
    notchAngleRad: 0.48,
    cupHeight: 0.014,
    waveAmp: 0.0065,
    flatCenterRatio: 0.28,
  };
  const compPadGeo = createSculptedLilyPadGeometry(compPadOpts);
  const compPadMesh = new THREE.Mesh(compPadGeo, padMat);
  compPadMesh.rotation.y = -2.1;
  compPadMesh.castShadow = true;
  compPadMesh.receiveShadow = true;
  compGroup.add(compPadMesh);

  const compPadDroplets = createLilyPadDroplets(compPadOpts, [
    { rNorm: 0.48, theta: 1.45, scale: 0.9 },
    { rNorm: 0.64, theta: 2.85, scale: 0.72 },
    { rNorm: 0.55, theta: 4.65, scale: 0.84 },
    { rNorm: 0.72, theta: 5.15, scale: 0.65 },
  ]);
  compPadMesh.add(compPadDroplets.group);

  const flowerRoot = new THREE.Group();
  flowerRoot.position.set(0.035, 0.008, -0.025);
  lotusGroup.add(flowerRoot);

  // Classic flat-topped inverted-cone golden-yellow lotus seed pod receptacle + dimpled carpel sockets
  const podProfile = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.011, 0.003),
    new THREE.Vector2(0.021, 0.017),
    new THREE.Vector2(0.030, 0.033),
    new THREE.Vector2(0.0285, 0.0365),
    new THREE.Vector2(0, 0.0355),
  ];
  const podGeo = new THREE.LatheGeometry(podProfile, 28);
  const podMat = new THREE.MeshStandardMaterial({
    color: 0xebd04a,
    roughness: 0.54,
    metalness: 0.04,
    envMapIntensity: 0.26,
  });
  const podMesh = new THREE.Mesh(podGeo, podMat);
  podMesh.castShadow = true;
  podMesh.receiveShadow = true;
  flowerRoot.add(podMesh);

  const pitGeo = new THREE.CylinderGeometry(0.0031, 0.0022, 0.0036, 10);
  const pitMat = new THREE.MeshStandardMaterial({
    color: 0x6b4714,
    roughness: 0.82,
  });
  const pitPositions: Array<[number, number]> = [
    [0, 0],
    ...Array.from({ length: 5 }, (_, k): [number, number] => {
      const a = (k / 5) * Math.PI * 2 + 0.25;
      return [Math.cos(a) * 0.0105, Math.sin(a) * 0.0105];
    }),
    ...Array.from({ length: 7 }, (_, k): [number, number] => {
      const a = (k / 7) * Math.PI * 2 + 0.55;
      return [Math.cos(a) * 0.0205, Math.sin(a) * 0.0205];
    }),
  ];
  pitPositions.forEach(([px, pz]) => {
    const pitMesh = new THREE.Mesh(pitGeo, pitMat);
    pitMesh.position.set(px, 0.0348, pz);
    flowerRoot.add(pitMesh);
  });

  // Delicate crown of 36 slender golden stamens curving gently upward around the pod's base
  const filamentGeo = new THREE.CylinderGeometry(0.00085, 0.00115, 0.033, 5);
  filamentGeo.translate(0, 0.0165, 0);
  const antherGeo = new THREE.SphereGeometry(0.0023, 6, 5);
  antherGeo.scale(0.85, 1.45, 0.85);
  const stamenMat = new THREE.MeshStandardMaterial({
    color: 0xfde276,
    emissive: 0x4c3004,
    emissiveIntensity: 0.32,
    roughness: 0.38,
  });
  const antherMat = new THREE.MeshStandardMaterial({
    color: 0xf4b628,
    roughness: 0.42,
  });
  const stamenCount = 36;
  for (let i = 0; i < stamenCount; i++) {
    const ang = (i / stamenCount) * Math.PI * 2 + (i % 2) * 0.06;
    const ringR = i % 2 === 0 ? 0.025 : 0.030;
    const sHolder = new THREE.Group();
    sHolder.rotation.y = ang;
    const stem = new THREE.Mesh(filamentGeo, stamenMat);
    stem.position.set(0, 0.013, ringR);
    stem.rotation.x = i % 2 === 0 ? 0.18 : 0.31;
    stem.castShadow = true;
    const tip = new THREE.Mesh(antherGeo, antherMat);
    tip.position.set(0, 0.033, 0);
    stem.add(tip);
    sHolder.add(stem);
    flowerRoot.add(sHolder);
  }

  // Striated creamy-ivory-to-lotus-pink texture + backlit edge translucency glow
  const petalTexture = createLotusPetalTexture(maxAnisotropy);
  const petalMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: petalTexture,
    vertexColors: true,
    roughness: 0.40,
    metalness: 0.0,
    clearcoat: 0.10,
    clearcoatRoughness: 0.46,
    sheen: 0.55,
    sheenColor: new THREE.Color('#ffe4ef'),
    side: THREE.DoubleSide,
  });
  petalMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vLotusUv;
        varying vec3 vLotusWorld;`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vLotusUv = uv;
        vLotusWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vLotusUv;
        varying vec3 vLotusWorld;`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        vec3 lotusViewDir = normalize(cameraPosition - vLotusWorld);
        vec3 lotusLightDir = normalize(vec3(0.41, 0.88, -0.25));
        float backScatter = pow(clamp(dot(lotusViewDir, -lotusLightDir), 0.0, 1.0), 2.3);
        float wrapLight = clamp(dot(normal, lotusLightDir) * 0.5 + 0.5, 0.0, 1.0);
        float rimThinness = smoothstep(0.18, 0.94, vLotusUv.y) * (0.55 + 0.45 * abs(vLotusUv.x * 2.0 - 1.0));
        totalEmissiveRadiance += vec3(1.0, 0.74, 0.85) * (backScatter * 0.42 + wrapLight * 0.13) * rimThinness;`,
      );
  };
  petalMat.customProgramCacheKey = () => 'lotus-subsurface-petal-v2';

  const corePetalGeo = createLotusPetalGeometry(0.064, 0.044, 0.016);
  const innerPetalGeo = createLotusPetalGeometry(0.078, 0.054, 0.019);
  const midPetalGeo = createLotusPetalGeometry(0.092, 0.064, 0.021);
  const outerMidPetalGeo = createLotusPetalGeometry(0.102, 0.070, 0.019);
  const outerPetalGeo = createLotusPetalGeometry(0.110, 0.074, 0.016);

  // 5 staggered golden-angle phyllotaxis tiers forming a natural cupped Nelumbo chalice (36 petals)
  const goldenOffset = 2.39996;
  const tiers = [
    { geo: corePetalGeo, count: 5, pitch: -1.25, r: 0.023, y: 0.010, offset: 0.14 },
    { geo: innerPetalGeo, count: 7, pitch: -1.06, r: 0.027, y: 0.008, offset: goldenOffset },
    { geo: midPetalGeo, count: 8, pitch: -0.84, r: 0.030, y: 0.005, offset: goldenOffset * 2 },
    { geo: outerMidPetalGeo, count: 8, pitch: -0.60, r: 0.033, y: 0.002, offset: goldenOffset * 3 },
    { geo: outerPetalGeo, count: 8, pitch: -0.34, r: 0.034, y: 0.000, offset: goldenOffset * 4 },
  ];

  tiers.forEach((tier, tIdx) => {
    for (let i = 0; i < tier.count; i++) {
      const ang = (i / tier.count) * Math.PI * 2 + tier.offset;
      const pHolder = new THREE.Group();
      pHolder.rotation.y = ang;
      const pMesh = new THREE.Mesh(tier.geo, petalMat);
      pMesh.position.set(0, tier.y, tier.r);
      pMesh.rotation.x = tier.pitch + Math.sin(i * 2.1 + tIdx) * 0.038;
      pMesh.castShadow = true;
      pMesh.receiveShadow = true;
      pHolder.add(pMesh);
      flowerRoot.add(pHolder);
    }
  });

  // 2. LARGE HALF-EMERGED TOP-RIGHT GRANITE BOULDERS (50% above waterY, 50% submerged below)
  const graniteCausticTimeUniform = { value: 0 };
  const graniteTextures = createGraniteBoulderTextures(maxAnisotropy);
  const graniteMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: graniteTextures.map,
    bumpMap: graniteTextures.bumpMap,
    bumpScale: 0.012,
    roughnessMap: graniteTextures.roughnessMap,
    roughness: 0.92,
    metalness: 0.02,
    envMapIntensity: 0.14,
  });

  graniteMat.onBeforeCompile = (shader) => {
    shader.uniforms.uWaterY = { value: waterY };
    shader.uniforms.uCausticTime = graniteCausticTimeUniform;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vBoulderWorld;
        varying vec3 vBoulderNormalW;`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vBoulderWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vBoulderNormalW = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uWaterY;
        uniform float uCausticTime;
        varying vec3 vBoulderWorld;
        varying vec3 vBoulderNormalW;

        vec2 boulderCausticHash2(vec2 p) {
          p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
          return fract(sin(p) * 43758.5453123);
        }

        float boulderVoronoiEdge(vec2 x, float t) {
          vec2 n = floor(x);
          vec2 f = fract(x);
          float d1 = 8.0;
          float d2 = 8.0;
          for (int j = -1; j <= 1; j++) {
            for (int i = -1; i <= 1; i++) {
              vec2 g = vec2(float(i), float(j));
              vec2 o = boulderCausticHash2(n + g);
              o = 0.5 + 0.44 * sin(t + 6.2831 * o);
              vec2 r = g - f + o;
              float d = dot(r, r);
              if (d < d1) {
                d2 = d1;
                d1 = d;
              } else if (d < d2) {
                d2 = d;
              }
            }
          }
          return pow(clamp(1.0 - abs(sqrt(d2) - sqrt(d1)) * 4.4, 0.0, 1.0), 3.6);
        }

        float boulderCausticArcs(vec2 p, float t) {
          vec2 warp = vec2(
            sin(p.y * 1.6 + t * 0.42) + cos(p.x * 1.1 - t * 0.35) * 0.5,
            cos(p.x * 1.5 - t * 0.38) + sin(p.y * 1.2 + t * 0.31) * 0.5
          ) * 0.24;
          float f1 = boulderVoronoiEdge((p + warp) * 1.55, t * 0.72);
          float f2 = boulderVoronoiEdge((mat2(0.8, -0.6, 0.6, 0.8) * (p - warp * 0.8)) * 1.95 + vec2(3.7, -2.1), -t * 0.58 + 1.9);
          float break1 = smoothstep(0.08, 0.68, sin(p.x * 1.85 - p.y * 1.35 + t * 0.28 + sin(p.y * 2.1) * 0.7));
          float break2 = smoothstep(0.08, 0.68, cos(p.x * 1.55 + p.y * 1.75 - t * 0.24 + cos(p.x * 1.9) * 0.7));
          float sunPocket = smoothstep(-0.12, 0.52, sin(p.x * 0.85 + t * 0.14) * cos(p.y * 0.95 - t * 0.12));
          return clamp(f1 * break1 + f2 * break2 * 0.78, 0.0, 1.0) * (0.30 + 0.70 * sunPocket);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Wet waterline band darkening & sheen right at water level
        float bWet = 1.0 - smoothstep(uWaterY - 0.015, uWaterY + 0.038, vBoulderWorld.y);
        diffuseColor.rgb *= mix(1.0, 0.34, bWet);

        // Subtle dark damp algae mineral patina near waterline
        float bDryMask = smoothstep(uWaterY + 0.012, uWaterY + 0.060, vBoulderWorld.y);
        float mossSlope = smoothstep(0.32, 0.85, vBoulderNormalW.y);
        float mossN1 = sin(vBoulderWorld.x * 10.5 + sin(vBoulderWorld.z * 8.2)) * cos(vBoulderWorld.z * 9.8 - vBoulderWorld.x * 3.1);
        float mossN2 = sin(vBoulderWorld.x * 26.0 + vBoulderWorld.z * 21.0);
        float mossPatch = smoothstep(0.18, 0.65, mossN1 * 0.65 + mossN2 * 0.35);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.10, 0.13, 0.075), bDryMask * mossSlope * mossPatch * 0.38);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        float bWetRough = 1.0 - smoothstep(uWaterY - 0.015, uWaterY + 0.038, vBoulderWorld.y);
        roughnessFactor = mix(roughnessFactor, 0.24, bWetRough);`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        float bSubMask = 1.0 - smoothstep(uWaterY - 0.06, uWaterY + 0.01, vBoulderWorld.y);
        if (bSubMask > 0.01) {
          float bCaustic = boulderCausticArcs(vBoulderWorld.xz, uCausticTime * 0.82);
          float bEdgeFade = exp(-dot(vBoulderWorld.xz, vBoulderWorld.xz) * 0.10);
          reflectedLight.directDiffuse += vec3(0.88, 0.95, 0.89) * (bCaustic * 0.155) * bSubMask * bEdgeFade;
        }`,
      );
  };
  graniteMat.customProgramCacheKey = () => 'granite-boulder-wet-moss-voronoi-v6';

  const boulderMossTextures = createMossClumpTextures(maxAnisotropy);
  const boulderMossMats = [0xdde5ce, 0xcad6b8, 0xe4ead5].map((col) =>
    createVelvetyMossMaterial(boulderMossTextures, col),
  );
  const boulderTuftGeos = [
    createCreepingMossMatGeometry(2.3),
    createCreepingMossMatGeometry(4.9),
    createCreepingMossMatGeometry(7.6),
  ];

  const submergedReefMat = new THREE.MeshStandardMaterial({
    color: 0x1a2223,
    roughness: 0.9,
    metalness: 0.02,
  });

  POND_LAYOUT.emergentBoulders.forEach((b, idx) => {
    const bGeo = createGraniteBoulderGeometry(b.radius, b.aboveWater, b.belowWater, idx * 3.7 + 1.2);
    const bMesh = new THREE.Mesh(bGeo, graniteMat);
    // Centered right at waterY so ~50% protrudes above waterY and ~50% extends submerged below waterY
    bMesh.position.set(b.x, waterY + (b.aboveWater - b.belowWater) * 0.1, b.z);
    bMesh.rotation.y = b.yaw;
    bMesh.castShadow = true;
    bMesh.receiveShadow = true;
    group.add(bMesh);
    disposables.push(bGeo);

    // Low-profile velvety creeping moss mats hugging granite crevices & waterline ledges
    const tuftAngles = [b.yaw + 0.5, b.yaw + 2.35, b.yaw + 4.15];
    tuftAngles.forEach((ang, tIdx) => {
      const radialFrac = tIdx === 0 ? 0.52 : 0.68;
      const tx = b.x + Math.cos(ang) * b.radius * radialFrac;
      const tz = b.z + Math.sin(ang) * b.radius * radialFrac * 0.88;
      const ty = waterY + (tIdx === 0 ? b.aboveWater * 0.56 : b.aboveWater * 0.2);
      const tMesh = new THREE.Mesh(
        boulderTuftGeos[(idx + tIdx) % boulderTuftGeos.length],
        boulderMossMats[(idx + tIdx) % boulderMossMats.length],
      );
      tMesh.position.set(tx, ty, tz);
      const sBase = b.radius * (tIdx === 0 ? 0.25 : 0.21);
      tMesh.scale.set(sBase * 1.45, sBase * 0.48, sBase * 1.15);
      tMesh.rotation.set(0.06 * Math.sin(ang), ang, 0.06 * Math.cos(ang));
      tMesh.castShadow = true;
      tMesh.receiveShadow = true;
      aboveWaterGroup.add(tMesh);
    });

    // Broad dark submerged stone plinth connecting boulder base cleanly into pond bed (zero underwater gap)
    const plinthH = waterY - b.belowWater * 0.55 - bedY + 0.06;
    if (plinthH > 0.04) {
      const pGeo = new THREE.CylinderGeometry(b.radius * 0.85, b.radius * 1.18, plinthH, 14);
      const pMesh = new THREE.Mesh(pGeo, submergedReefMat);
      pMesh.position.set(b.x, bedY + plinthH * 0.5 - 0.02, b.z);
      pMesh.receiveShadow = true;
      group.add(pMesh);
      disposables.push(pGeo);
    }
  });

  // 3. TOP-RIGHT ARCHING MULTI-NODE BAMBOO GROVE (kept below top-right UI buttons)
  const bambooTextures = createBambooCulmTextures(maxAnisotropy);
  const culmMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: bambooTextures.map,
    bumpMap: bambooTextures.bumpMap,
    bumpScale: 0.0045,
    roughnessMap: bambooTextures.roughnessMap,
    roughness: 0.58,
    metalness: 0.02,
    envMapIntensity: 0.22,
  });

  const nodeRingMat = new THREE.MeshStandardMaterial({
    color: 0x3b4825,
    roughness: 0.68,
    metalness: 0.02,
  });

  const bambooColors = [0x345c27, 0x467032, 0x5d843c, 0x76823a];
  const bambooLeafMats = bambooColors.map(
    (col) =>
      new THREE.MeshStandardMaterial({
        color: col,
        roughness: 0.56,
        metalness: 0.0,
        side: THREE.DoubleSide,
      }),
  );

  const bambooRoot = new THREE.Group();
  bambooRoot.position.set(2.58, waterY + 0.78, -1.28);
  aboveWaterGroup.add(bambooRoot);

  const leafBladeGeo = createBambooLeafBladeGeometry(0.22, 0.034);
  const smallLeafBladeGeo = createBambooLeafBladeGeometry(0.165, 0.027);

  const culmSpecs = [
    {
      points: [
        new THREE.Vector3(0.42, 0.16, -0.32),
        new THREE.Vector3(-0.18, 0.12, 0.08),
        new THREE.Vector3(-0.72, 0.02, 0.48),
        new THREE.Vector3(-1.26, -0.09, 0.94), // leaf drip reaches POND_LAYOUT.dripWorldPos
      ],
      rStart: 0.024,
      rEnd: 0.009,
      nodes: [0.22, 0.46, 0.7, 0.9],
    },
    {
      points: [
        new THREE.Vector3(0.55, 0.28, -0.05),
        new THREE.Vector3(-0.08, 0.22, 0.18),
        new THREE.Vector3(-0.66, 0.12, 0.34),
        new THREE.Vector3(-1.12, 0.04, 0.52),
      ],
      rStart: 0.02,
      rEnd: 0.008,
      nodes: [0.25, 0.5, 0.75, 0.93],
    },
    {
      points: [
        new THREE.Vector3(0.25, 0.1, -0.45),
        new THREE.Vector3(-0.34, 0.06, -0.14),
        new THREE.Vector3(-0.84, -0.01, 0.1),
        new THREE.Vector3(-1.18, -0.07, 0.26),
      ],
      rStart: 0.017,
      rEnd: 0.007,
      nodes: [0.24, 0.52, 0.78],
    },
  ];

  const twigBranches: Array<{ group: THREE.Group; phase: number }> = [];

  culmSpecs.forEach((spec, cIdx) => {
    const curve = new THREE.CatmullRomCurve3(spec.points);
    const culmGeo = createTaperedBambooCulmGeometry(curve, spec.rStart, spec.rEnd);
    const culmMesh = new THREE.Mesh(culmGeo, culmMat);
    culmMesh.castShadow = true;
    culmMesh.receiveShadow = true;
    bambooRoot.add(culmMesh);
    disposables.push(culmGeo);

    // Raised circumferential nodal rings + secondary twigs with fan clusters of 4-6 bamboo leaves
    spec.nodes.forEach((u, nIdx) => {
      const nodePos = curve.getPointAt(u);
      const tangent = curve.getTangentAt(u).normalize();
      const localR = THREE.MathUtils.lerp(spec.rStart, spec.rEnd, u);

      const ringGeo = new THREE.TorusGeometry(localR * 1.16, localR * 0.26, 7, 16);
      const ringMesh = new THREE.Mesh(ringGeo, nodeRingMat);
      ringMesh.position.copy(nodePos);
      ringMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
      ringMesh.castShadow = true;
      ringMesh.receiveShadow = true;
      bambooRoot.add(ringMesh);
      disposables.push(ringGeo);

      // Fork 1-2 fine bamboo twigs from upper/middle nodes
      const twigCount = nIdx === 0 ? 1 : 2;
      for (let t = 0; t < twigCount; t++) {
        const twigGroup = new THREE.Group();
        twigGroup.position.copy(nodePos);
        bambooRoot.add(twigGroup);
        twigBranches.push({ group: twigGroup, phase: cIdx * 1.7 + nIdx * 0.9 + t });

        const sideSign = t % 2 === 0 ? 1 : -1;
        const twigEnd = new THREE.Vector3(
          -0.16 - nIdx * 0.025,
          0.03 + t * 0.025,
          sideSign * (0.14 + (cIdx % 2) * 0.04),
        );
        const twigMid = twigEnd.clone().multiplyScalar(0.5).add(new THREE.Vector3(0, 0.025, 0));
        const twigCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), twigMid, twigEnd]);
        const twigGeo = new THREE.TubeGeometry(twigCurve, 8, 0.0042, 6, false);
        const twigMesh = new THREE.Mesh(twigGeo, culmMat);
        twigMesh.castShadow = true;
        twigGroup.add(twigMesh);
        disposables.push(twigGeo);

        // Fan cluster of 4-5 arched lance-shaped bamboo leaves at twig tip + midpoint
        const leafCount = nIdx >= 2 ? 5 : 4;
        for (let k = 0; k < leafCount; k++) {
          const frac = k / (leafCount - 1) - 0.5;
          const anchorPt = k % 2 === 0 ? twigEnd : twigMid.clone().lerp(twigEnd, 0.65);
          const lGeo = k % 2 === 0 ? leafBladeGeo : smallLeafBladeGeo;
          const lMesh = new THREE.Mesh(
            lGeo,
            bambooLeafMats[(cIdx + nIdx + k) % bambooLeafMats.length],
          );
          lMesh.position.copy(anchorPt);
          lMesh.rotation.set(
            0.12 + Math.abs(frac) * 0.24,
            Math.atan2(twigEnd.x, twigEnd.z) + frac * 1.35 + (cIdx - 1) * 0.15,
            frac * 0.2,
          );
          lMesh.scale.setScalar(0.92 + ((k * 17 + nIdx) % 3) * 0.11);
          lMesh.castShadow = true;
          lMesh.receiveShadow = true;
          twigGroup.add(lMesh);
        }
      }
    });
  });

  // 4. LARGER FLOATING FALLEN LEAVES ON OPEN WATER (~2.5x scale Momiji maple & curved bamboo leaves)
  const mapleLeafGeo = createJapaneseMapleLeafGeometry(0.102);
  const floatingBambooGeo = createBambooLeafBladeGeometry(0.27, 0.048);

  const crimsonMapleTex = createMomijiMapleTexture('#6e2116', '#9a3220', 'rgba(42, 12, 8, 0.48)', maxAnisotropy);
  const amberMapleTex = createMomijiMapleTexture('#7b3818', '#ad5624', 'rgba(52, 22, 10, 0.48)', maxAnisotropy);
  const russetMapleTex = createMomijiMapleTexture('#572318', '#7e321e', 'rgba(34, 14, 10, 0.48)', maxAnisotropy);

  const fallenMapleMats = [
    new THREE.MeshStandardMaterial({ map: crimsonMapleTex, roughness: 0.62, metalness: 0.0, side: THREE.DoubleSide }),
    new THREE.MeshStandardMaterial({ map: amberMapleTex, roughness: 0.62, metalness: 0.0, side: THREE.DoubleSide }),
    new THREE.MeshStandardMaterial({ map: russetMapleTex, roughness: 0.65, metalness: 0.0, side: THREE.DoubleSide }),
  ];
  const fallenBambooMats = [
    new THREE.MeshStandardMaterial({ color: 0x4e5e2a, roughness: 0.62, metalness: 0.0, side: THREE.DoubleSide }),
    new THREE.MeshStandardMaterial({ color: 0x626b30, roughness: 0.64, metalness: 0.0, side: THREE.DoubleSide }),
  ];

  const candidateCoords: Array<{ x: number; z: number; yaw: number; maple: boolean; scale: number }> = [
    { x: 0.86, z: -0.94, yaw: 0.42, maple: true, scale: 1.08 },
    { x: 1.10, z: -0.54, yaw: 1.48, maple: false, scale: 1.02 },
    { x: 1.14, z: 0.14, yaw: 2.35, maple: true, scale: 0.96 },
    { x: 0.72, z: 0.96, yaw: 0.95, maple: false, scale: 1.06 },
    { x: -0.44, z: 0.92, yaw: -1.72, maple: true, scale: 1.04 },
    { x: -1.04, z: 0.82, yaw: 2.55, maple: false, scale: 0.98 },
    { x: -1.36, z: -0.86, yaw: 0.25, maple: true, scale: 1.12 },
    { x: -0.64, z: -0.98, yaw: -2.38, maple: false, scale: 1.04 },
    { x: 0.18, z: -0.88, yaw: 1.12, maple: true, scale: 0.94 },
    { x: 1.88, z: 0.16, yaw: -0.35, maple: false, scale: 1.02 },
    { x: -0.92, z: 1.18, yaw: 1.92, maple: true, scale: 1.0 },
    { x: 0.28, z: 1.16, yaw: -1.14, maple: false, scale: 0.96 },
    { x: -1.78, z: -0.02, yaw: 0.72, maple: true, scale: 0.92 },
  ];

  const floatingLeaves: FloatingLeafAgent[] = [];
  candidateCoords.forEach((cand, idx) => {
    // Verify clear of plank, open book overhang, lantern rock, emergent boulders, lotus & card pad
    const sep = nearestObstacleSeparation(cand.x, cand.z, 0.14, true);
    const dCard = Math.hypot(cand.x - 1.56, cand.z - 0.6);
    const dLotus = Math.hypot(cand.x - POND_LAYOUT.lotusPadPos.x, cand.z - POND_LAYOUT.lotusPadPos.z);
    if (sep.dist < 0 || dCard < 0.44 || dLotus < 0.40) return;

    const geo = cand.maple ? mapleLeafGeo : floatingBambooGeo;
    const mat = cand.maple
      ? fallenMapleMats[idx % fallenMapleMats.length]
      : fallenBambooMats[idx % fallenBambooMats.length];
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cand.x, waterY + 0.0032, cand.z);
    mesh.rotation.y = cand.yaw;
    mesh.scale.setScalar(cand.scale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    aboveWaterGroup.add(mesh);

    floatingLeaves.push({
      mesh,
      baseX: cand.x,
      baseZ: cand.z,
      baseYaw: cand.yaw,
      driftPhase: idx * 1.37,
      driftAmpX: 0.018 + (idx % 3) * 0.006,
      driftAmpZ: 0.014 + (idx % 2) * 0.006,
    });
  });

  // 5. GLISTENING AMBIENT BAMBOO-LEAF WATER DRIP EMITTER
  const dropGeo = new THREE.SphereGeometry(0.013, 10, 10);
  dropGeo.scale(0.85, 1.35, 0.85);
  const dropMat = new THREE.MeshPhysicalMaterial({
    color: 0xdff6ff,
    roughness: 0.05,
    metalness: 0.0,
    clearcoat: 1.0,
    transparent: true,
    opacity: 0.86,
  });
  const dripMesh = new THREE.Mesh(dropGeo, dropMat);
  dripMesh.visible = false;
  aboveWaterGroup.add(dripMesh);

  let nextDripAt = 1.4;
  let dripActive = false;
  let dripStartSec = 0;
  const dripTopY = waterY + 0.68;
  const dripDurationSec = 0.35;

  disposables.push(
    meniscusTex,
    meniscusMat,
    mainMeniscusGeo,
    compMeniscusGeo,
    padTextures,
    padMat,
    mainPadGeo,
    mainPadDroplets,
    compPadGeo,
    compPadDroplets,
    podGeo,
    podMat,
    pitGeo,
    pitMat,
    filamentGeo,
    antherGeo,
    stamenMat,
    antherMat,
    petalTexture,
    petalMat,
    corePetalGeo,
    innerPetalGeo,
    midPetalGeo,
    outerMidPetalGeo,
    outerPetalGeo,
    graniteTextures,
    graniteMat,
    boulderMossTextures,
    ...boulderMossMats,
    ...boulderTuftGeos,
    submergedReefMat,
    bambooTextures,
    culmMat,
    nodeRingMat,
    leafBladeGeo,
    smallLeafBladeGeo,
    mapleLeafGeo,
    floatingBambooGeo,
    crimsonMapleTex,
    amberMapleTex,
    russetMapleTex,
    ...bambooLeafMats,
    ...fallenMapleMats,
    ...fallenBambooMats,
    dropGeo,
    dropMat,
  );

  return {
    group,
    aboveWaterGroup,
    update: (_dtSec, elapsedSec, waterSim, onDripImpact) => {
      graniteCausticTimeUniform.value = elapsedSec;
      // 1. Wave-synced floating bob on lily pads & blooming lotus
      const wMain = waterSim.sampleCpuWaveAt(
        POND_LAYOUT.lotusPadPos.x,
        POND_LAYOUT.lotusPadPos.z,
      );
      lotusGroup.position.y =
        waterY + 0.005 + wMain.height * 0.08 + Math.sin(elapsedSec * 1.15) * 0.0025;
      lotusGroup.rotation.x = wMain.slopeZ * 0.25 + Math.sin(elapsedSec * 0.9) * 0.014;
      lotusGroup.rotation.z = -wMain.slopeX * 0.25 + Math.cos(elapsedSec * 0.8) * 0.014;

      const wComp = waterSim.sampleCpuWaveAt(
        POND_LAYOUT.companionPadPos.x,
        POND_LAYOUT.companionPadPos.z,
      );
      compGroup.position.y =
        waterY + 0.004 + wComp.height * 0.08 + Math.cos(elapsedSec * 1.3 + 0.8) * 0.002;
      compGroup.rotation.x = wComp.slopeZ * 0.28 + Math.cos(elapsedSec * 1.1) * 0.015;
      compGroup.rotation.z = -wComp.slopeX * 0.28;

      // 2. Gentle layered wind sway on overhanging bamboo culms & twig foliage
      bambooRoot.rotation.z = Math.sin(elapsedSec * 0.88) * 0.016;
      bambooRoot.rotation.y = Math.cos(elapsedSec * 0.65) * 0.02;
      for (let i = 0; i < twigBranches.length; i++) {
        const tb = twigBranches[i];
        tb.group.rotation.x = Math.sin(elapsedSec * 1.45 + tb.phase) * 0.032;
        tb.group.rotation.z = Math.cos(elapsedSec * 1.18 + tb.phase * 1.3) * 0.026;
      }

      // 3. Wave-driven floating fallen leaves with slow ambient surface drift
      for (let i = 0; i < floatingLeaves.length; i++) {
        const fl = floatingLeaves[i];
        const lx = fl.baseX + Math.sin(elapsedSec * 0.22 + fl.driftPhase) * fl.driftAmpX;
        const lz = fl.baseZ + Math.cos(elapsedSec * 0.19 + fl.driftPhase * 0.8) * fl.driftAmpZ;
        const w = waterSim.sampleCpuWaveAt(lx, lz);
        fl.mesh.position.set(
          lx,
          waterY + 0.0028 + w.height * 0.09 + Math.sin(elapsedSec * 1.4 + fl.driftPhase) * 0.0012,
          lz,
        );
        fl.mesh.rotation.set(
          w.slopeZ * 0.35 + Math.sin(elapsedSec * 1.1 + fl.driftPhase) * 0.02,
          fl.baseYaw + Math.sin(elapsedSec * 0.18 + fl.driftPhase) * 0.08,
          -w.slopeX * 0.35,
        );
      }

      // 4. Periodic ambient bamboo-leaf water droplet falling onto open water beside boulders
      if (!dripActive && elapsedSec >= nextDripAt) {
        dripActive = true;
        dripStartSec = elapsedSec;
        dripMesh.visible = true;
      }

      if (dripActive) {
        const u = Math.min(1, (elapsedSec - dripStartSec) / dripDurationSec);
        const y = dripTopY - (dripTopY - waterY) * (u * u);
        dripMesh.position.set(POND_LAYOUT.dripWorldPos.x, y, POND_LAYOUT.dripWorldPos.z);
        if (u >= 1) {
          dripActive = false;
          dripMesh.visible = false;
          onDripImpact(POND_LAYOUT.dripWorldPos.x, POND_LAYOUT.dripWorldPos.z);
          const jitter = Math.sin(elapsedSec * 7.3) * 0.45;
          nextDripAt = elapsedSec + 3.8 + jitter;
        }
      }
    },
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}
