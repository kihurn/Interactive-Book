import * as THREE from 'three';
import { POND_LAYOUT } from './constants';
import type { WaterSimulation } from './WaterSimulation';

export interface FloatingPlankRig {
  group: THREE.Group;
  aboveWaterGroup: THREE.Group;
  update: (elapsedSec: number, waterSim: WaterSimulation, bookOpenProgress: number) => void;
  dispose: () => void;
}

function createWeatheredPlankTextures(maxAnisotropy: number): {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  dispose: () => void;
} {
  const w = 1024;
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

  // Rich weathered driftwood / aged cedar tone (clean wood, zero green paint blobs)
  const baseGrad = cCtx.createLinearGradient(0, 0, 0, h);
  baseGrad.addColorStop(0, '#3a2b1f');
  baseGrad.addColorStop(0.5, '#4b3728');
  baseGrad.addColorStop(1, '#34261b');
  cCtx.fillStyle = baseGrad;
  cCtx.fillRect(0, 0, w, h);

  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, w, h);

  rCtx.fillStyle = '#dcdcdc'; // ~0.86 matte weathered driftwood roughness
  rCtx.fillRect(0, 0, w, h);

  const hash = (n: number) => {
    const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return v - Math.floor(v);
  };

  // Longitudinal wood grain fibers & sun-bleached driftwood streaks
  for (let i = 0; i < 460; i++) {
    const yBase = hash(i * 3 + 1) * h;
    const thick = 0.8 + hash(i * 3 + 2) * 3.2;
    const isLight = i % 5 === 0;
    const isDark = i % 3 === 0;
    cCtx.strokeStyle = isLight
      ? 'rgba(136, 118, 98, 0.22)'
      : isDark
        ? 'rgba(18, 13, 9, 0.34)'
        : 'rgba(84, 62, 44, 0.28)';
    cCtx.lineWidth = thick;

    bCtx.strokeStyle = isDark ? 'rgba(62, 62, 62, 0.38)' : 'rgba(158, 158, 158, 0.24)';
    bCtx.lineWidth = thick;

    rCtx.strokeStyle = isLight ? 'rgba(235, 235, 235, 0.25)' : 'rgba(190, 190, 190, 0.2)';
    rCtx.lineWidth = thick;

    cCtx.beginPath();
    bCtx.beginPath();
    rCtx.beginPath();
    for (let sx = 0; sx <= 16; sx++) {
      const px = (sx / 16) * w;
      const wave =
        Math.sin(sx * 0.45 + i * 0.7) * (3 + hash(i) * 5) +
        Math.cos(sx * 0.9 - i * 0.3) * 2;
      const py = yBase + wave;
      if (sx === 0) {
        cCtx.moveTo(px, py);
        bCtx.moveTo(px, py);
        rCtx.moveTo(px, py);
      } else {
        cCtx.lineTo(px, py);
        bCtx.lineTo(px, py);
        rCtx.lineTo(px, py);
      }
    }
    cCtx.stroke();
    bCtx.stroke();
    rCtx.stroke();
  }

  // Weathered longitudinal split checks
  for (let i = 0; i < 24; i++) {
    const startX = hash(i * 11 + 5) * w * 0.72;
    const len = 90 + hash(i * 11 + 7) * 260;
    const yPos = 20 + hash(i * 11 + 9) * (h - 40);

    cCtx.strokeStyle = 'rgba(12, 9, 6, 0.84)';
    cCtx.lineWidth = 1.5 + hash(i * 5) * 1.8;
    bCtx.strokeStyle = 'rgba(16, 16, 16, 0.92)';
    bCtx.lineWidth = 2.4 + hash(i * 5) * 2.0;

    cCtx.beginPath();
    bCtx.beginPath();
    for (let s = 0; s <= 10; s++) {
      const px = startX + (s / 10) * len;
      const py = yPos + Math.sin(s * 1.2 + i) * 2.5;
      if (s === 0) {
        cCtx.moveTo(px, py);
        bCtx.moveTo(px, py);
      } else {
        cCtx.lineTo(px, py);
        bCtx.lineTo(px, py);
      }
    }
    cCtx.stroke();
    bCtx.stroke();
  }

  // Organic wood knots
  for (let k = 0; k < 5; k++) {
    const kx = 120 + hash(k * 17 + 3) * (w - 240);
    const ky = 60 + hash(k * 17 + 8) * (h - 120);
    const rx = 18 + hash(k * 13) * 14;
    const ry = 8 + hash(k * 13 + 2) * 6;
    const grad = cCtx.createRadialGradient(kx, ky, 2, kx, ky, rx);
    grad.addColorStop(0, '#18100a');
    grad.addColorStop(0.55, '#2b1e14');
    grad.addColorStop(1, 'rgba(58, 43, 31, 0)');
    cCtx.fillStyle = grad;
    cCtx.beginPath();
    cCtx.ellipse(kx, ky, rx, ry, (hash(k) - 0.5) * 0.18, 0, Math.PI * 2);
    cCtx.fill();

    bCtx.fillStyle = 'rgba(40, 40, 40, 0.65)';
    bCtx.beginPath();
    bCtx.ellipse(kx, ky, rx * 0.7, ry * 0.7, 0, 0, Math.PI * 2);
    bCtx.fill();
  }

  // Subtle dark damp wood staining near outer board edges
  for (let i = 0; i < 45; i++) {
    const mx = hash(i * 23 + 1) * w;
    const my = i % 2 === 0 ? hash(i * 23 + 2) * 26 : h - hash(i * 23 + 3) * 26;
    const mr = 8 + hash(i * 23 + 4) * 14;
    cCtx.fillStyle = 'rgba(20, 15, 11, 0.24)';
    cCtx.beginPath();
    cCtx.arc(mx, my, mr, 0, Math.PI * 2);
    cCtx.fill();
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

export function createMossClumpTextures(maxAnisotropy: number): {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
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

  cCtx.fillStyle = '#334820';
  cCtx.fillRect(0, 0, size, size);
  bCtx.fillStyle = '#565656';
  bCtx.fillRect(0, 0, size, size);

  const hash = (n: number) => {
    const v = Math.sin(n * 91.7 + 17.3) * 43758.5453;
    return v - Math.floor(v);
  };

  // Subtle organic base tone variation
  for (let i = 0; i < 160; i++) {
    const x = hash(i * 7 + 1) * size;
    const y = hash(i * 7 + 2) * size;
    const r = 10 + hash(i * 7 + 3) * 26;
    cCtx.fillStyle = i % 2 === 0 ? 'rgba(34, 51, 22, 0.30)' : 'rgba(98, 126, 48, 0.25)';
    cCtx.beginPath();
    cCtx.arc(x, y, r, 0, Math.PI * 2);
    cCtx.fill();
  }

  // Dense micro-tufted creeping gametophyte shoots & fibrous speckled tips
  const palette = ['#263918', '#415d26', '#5a7832', '#75933f'];
  for (let i = 0; i < 7200; i++) {
    const x = hash(i * 3 + 1) * size;
    const y = hash(i * 3 + 2) * size;
    const len = 2.2 + hash(i * 3 + 3) * 4.6;
    const ang = hash(i * 5 + 7) * Math.PI * 2;
    const col = palette[i % palette.length];

    cCtx.strokeStyle = col;
    cCtx.lineWidth = 1.1 + (i % 2) * 0.75;
    cCtx.beginPath();
    cCtx.moveTo(x, y);
    cCtx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    cCtx.stroke();

    const bv = i % 4 === 3 ? 236 : 124 + Math.round(hash(i * 5 + 2) * 95);
    bCtx.strokeStyle = `rgb(${bv},${bv},${bv})`;
    bCtx.lineWidth = 1.25;
    bCtx.beginPath();
    bCtx.moveTo(x, y);
    bCtx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    bCtx.stroke();
  }

  const map = new THREE.CanvasTexture(cCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(2.2, 2.2);
  map.anisotropy = maxAnisotropy;

  const bumpMap = new THREE.CanvasTexture(bCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(2.2, 2.2);
  bumpMap.anisotropy = maxAnisotropy;

  return {
    map,
    bumpMap,
    dispose: () => {
      map.dispose();
      bumpMap.dispose();
    },
  };
}

export function createVelvetyMossMaterial(
  textures: { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture },
  tintHex = 0xe8efda,
): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: tintHex,
    map: textures.map,
    bumpMap: textures.bumpMap,
    bumpScale: 0.022,
    roughness: 0.94,
    metalness: 0.0,
    sheen: 0.85,
    sheenRoughness: 0.88,
    sheenColor: new THREE.Color('#8ca84d'),
    envMapIntensity: 0.14,
  });
}

/**
 * Builds an irregular low-profile creeping moss mat from 7 overlapping flattened
 * organic cushions/micro-lobes (hugged tightly to seams & rock ledges, never round balls).
 */
export function createCreepingMossMatGeometry(seed: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const hash = (n: number) => {
    const v = Math.sin(n * 73.13 + seed * 19.7) * 43758.5453;
    return v - Math.floor(v);
  };

  const lobeCount = 7;
  let vertOffset = 0;

  for (let l = 0; l < lobeCount; l++) {
    const lobeGeo = new THREE.IcosahedronGeometry(1, 2);
    const lPos = lobeGeo.attributes.position as THREE.BufferAttribute;
    const lUv = lobeGeo.attributes.uv as THREE.BufferAttribute;

    const ox = l === 0 ? 0 : (hash(l * 5 + 1) - 0.5) * 1.15;
    const oz = l === 0 ? 0 : (hash(l * 5 + 2) - 0.5) * 0.95;
    const sx = 0.42 + hash(l * 5 + 3) * 0.46;
    const sz = 0.36 + hash(l * 5 + 4) * 0.44;
    const sy = 0.24 + hash(l * 5 + 5) * 0.22;
    const yaw = hash(l * 5 + 6) * Math.PI * 2;
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);

    for (let i = 0; i < lPos.count; i++) {
      const vx = lPos.getX(i);
      const vy = lPos.getY(i);
      const vz = lPos.getZ(i);
      const n1 = Math.sin(vx * 6.5 + seed + l) * Math.cos(vz * 7.2 - l * 1.4) * 0.24;
      const n2 = Math.sin((vx + vz) * 14.0 + l * 3.1) * 0.12;
      const radial = 0.84 + n1 + n2;
      // Dead-flat underside + low velvety mound crown
      const yLocal = vy < 0 ? vy * 0.06 : Math.pow(vy, 0.72) * sy * (0.85 + n1 * 0.45);
      const lx = vx * radial * sx;
      const lz = vz * radial * sz;

      const rx = lx * cosY - lz * sinY + ox;
      const rz = lx * sinY + lz * cosY + oz;
      positions.push(rx, yLocal, rz);
      uvs.push(lUv.getX(i) + ox * 0.35, lUv.getY(i) + oz * 0.35);
    }

    const idx = lobeGeo.index;
    if (idx) {
      for (let i = 0; i < idx.count; i++) {
        indices.push(vertOffset + idx.getX(i));
      }
    }
    vertOffset += lPos.count;
    lobeGeo.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  merged.setIndex(indices);
  merged.computeVertexNormals();
  return merged;
}

export const createMossTuftGeometry = createCreepingMossMatGeometry;

/**
 * Builds a single sleek weathered timber board geometry with irregular splintered ends,
 * worn bevel edges, and a dead-flat resting plane under the book at topY = 0.
 */
function createSplinteredBoardGeometry(opts: {
  baseLength: number;
  widthZ: number;
  thickness: number;
  leftOffset: number;
  rightOffset: number;
  seed: number;
}): THREE.BufferGeometry {
  const { baseLength, widthZ, thickness, leftOffset, rightOffset, seed } = opts;
  const segX = 48;
  const segZ = 14;
  const segY = 4;

  const geo = new THREE.BoxGeometry(1, thickness, widthZ, segX, segY, segZ);
  geo.translate(0, -thickness * 0.5, 0);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;

  const leftBase = -baseLength * 0.5 + leftOffset;
  const rightBase = baseLength * 0.5 + rightOffset;

  const splinterProfile = (zNorm: number, isLeft: boolean) => {
    const s = seed * 5.3 + (isLeft ? 1.7 : 8.9);
    const band = Math.floor((zNorm + 1) * 4.5);
    const stepHash = Math.sin(band * 19.7 + s * 3.1) * 43758.5453;
    const stepRand = (stepHash - Math.floor(stepHash)) - 0.5;
    const grainSplit =
      Math.sin(zNorm * 6.2 + s) * 0.036 +
      Math.cos(zNorm * 13.5 - s * 1.3) * 0.018 +
      stepRand * 0.056;
    const taper = -Math.abs(zNorm) * 0.018 + zNorm * (isLeft ? 0.03 : -0.026);
    return grainSplit + taper;
  };

  for (let i = 0; i < pos.count; i++) {
    const ux = pos.getX(i) + 0.5;
    let y = pos.getY(i);
    let z = pos.getZ(i);

    const zNorm = z / Math.max(0.01, widthZ * 0.5);
    const yNorm = (y + thickness) / thickness;

    const leftX = leftBase + splinterProfile(zNorm, true);
    const rightX = rightBase + splinterProfile(zNorm, false);
    let x = THREE.MathUtils.lerp(leftX, rightX, ux);

    // Subtle lower-hull taper so sleek driftwood feels lighter and settles organically into water
    if (yNorm < 0.42) {
      const hullT = (0.42 - yNorm) / 0.42;
      z *= 1 - hullT * 0.06;
    }

    const edgeProx = Math.max(0, 1 - Math.min(ux, 1 - ux) * 6.5);
    if (edgeProx > 0) {
      const fractureStep = Math.sin(zNorm * 16 + seed * 5.1) * (1 - yNorm) * 0.042 * edgeProx;
      x += (ux < 0.5 ? -1 : 1) * fractureStep;
      if (yNorm > 0.72) {
        y -= edgeProx * (yNorm - 0.72) * 0.042;
      }
    }

    const absZNorm = Math.abs(zNorm);
    if (absZNorm > 0.86) {
      const edgeT = (absZNorm - 0.86) / 0.14;
      const wear = Math.sin(x * 7.5 + seed * 2.3) * 0.004;
      if (yNorm > 0.82) {
        y -= edgeT * 0.009 + Math.max(0, wear) * edgeT;
      }
      z -= Math.sign(z) * edgeT * 0.004;
    }

    // Subtle organic outer-edge undulation outside central book zone
    if (Math.abs(x) > 1.05 && absZNorm > 0.75) {
      z += Math.sin(x * 6.4 + seed * 3.1) * 0.004;
    }

    if (Math.abs(x) < 1.04 && y > -0.002) {
      y = 0;
    }

    pos.setXYZ(i, x, y, z);
    uv.setXY(i, x * 0.45 + 0.5 + seed * 0.13, z * 1.45 + 0.5 + y * 0.8);
  }

  geo.computeVertexNormals();
  return geo;
}

export function createFloatingPlank(
  surfaceY: number,
  waterY: number,
  maxAnisotropy: number,
): FloatingPlankRig {
  const disposables: Array<{ dispose: () => void }> = [];
  const group = new THREE.Group();
  group.name = 'pond-floating-plank';

  const aboveWaterGroup = new THREE.Group();
  group.add(aboveWaterGroup);

  const textures = createWeatheredPlankTextures(maxAnisotropy);
  const mossTex = createMossClumpTextures(maxAnisotropy);
  disposables.push(textures, mossTex);

  const plankMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: textures.map,
    bumpMap: textures.bumpMap,
    bumpScale: 0.0085,
    roughnessMap: textures.roughnessMap,
    roughness: 0.86,
    metalness: 0.02,
    envMapIntensity: 0.16,
  });

  plankMat.onBeforeCompile = (shader) => {
    shader.uniforms.uWaterY = { value: waterY };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vPlankWorld;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vPlankWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uWaterY;
        varying vec3 vPlankWorld;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Rich damp darkened waterline right where weathered wood meets pond surface (zero green paint smears)
        float waterBand = 1.0 - smoothstep(uWaterY - 0.012, uWaterY + 0.032, vPlankWorld.y);
        diffuseColor.rgb *= mix(1.0, 0.34, waterBand);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        float wetRough = 1.0 - smoothstep(uWaterY - 0.012, uWaterY + 0.032, vPlankWorld.y);
        roughnessFactor = mix(roughnessFactor, 0.24, wetRough);`,
      );
  };
  plankMat.customProgramCacheKey = () => 'floating-plank-damp-driftwood-v2';

  const battenMat = new THREE.MeshStandardMaterial({
    color: 0x1a130d,
    roughness: 0.9,
    metalness: 0.04,
  });

  // Low-profile matte velvety garden moss mats (MeshPhysicalMaterial with soft moss sheen)
  const mossMats = [
    createVelvetyMossMaterial(mossTex, 0xe8f0d8),
    createVelvetyMossMaterial(mossTex, 0xd4e0be),
  ];

  // Sleek ~32% slimmer driftwood plank slats with subtle weathered organic asymmetry
  const plankThickness = surfaceY - waterY + 0.026;
  const boardSpecs = [
    { z: -0.249, widthZ: 0.23, leftOff: 0.075, rightOff: -0.035, seed: 1.1 },
    { z: 0.002, widthZ: 0.252, leftOff: -0.04, rightOff: 0.055, seed: 2.4 },
    { z: 0.249, widthZ: 0.238, leftOff: 0.025, rightOff: -0.065, seed: 3.7 },
  ];

  boardSpecs.forEach((b) => {
    const geo = createSplinteredBoardGeometry({
      baseLength: POND_LAYOUT.plankWidth,
      widthZ: b.widthZ,
      thickness: plankThickness,
      leftOffset: b.leftOff,
      rightOffset: b.rightOff,
      seed: b.seed,
    });
    const mesh = new THREE.Mesh(geo, plankMat);
    mesh.position.set(0, surfaceY, b.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    aboveWaterGroup.add(mesh);
    disposables.push(geo);
  });

  // Submerged cross-battens tucked beneath waterline
  const battenGeo = new THREE.BoxGeometry(0.1, 0.04, POND_LAYOUT.plankDepth * 0.9);
  for (const bx of [-0.72, 0.72]) {
    const batten = new THREE.Mesh(battenGeo, battenMat);
    batten.position.set(bx, waterY - 0.01, 0);
    batten.castShadow = true;
    batten.receiveShadow = true;
    group.add(batten);
  }

  // 3 tiny recessed oxidized dark iron pegs/nails with weathered wood sockets
  const socketGeo = new THREE.CylinderGeometry(0.0125, 0.0125, 0.0016, 12);
  const socketMat = new THREE.MeshStandardMaterial({
    color: 0x1b130d,
    roughness: 0.95,
    metalness: 0.02,
  });
  const pegGeo = new THREE.CylinderGeometry(0.0082, 0.0074, 0.0032, 10);
  const ironPegMat = new THREE.MeshStandardMaterial({
    color: 0x26211e,
    roughness: 0.72,
    metalness: 0.55,
  });
  const pegPositions: Array<[number, number]> = [
    [-1.07, -0.24],
    [-1.08, 0.24],
    [1.05, -0.23],
  ];
  pegPositions.forEach(([px, pz]) => {
    const socket = new THREE.Mesh(socketGeo, socketMat);
    socket.position.set(px, surfaceY - 0.0005, pz);
    socket.receiveShadow = true;
    aboveWaterGroup.add(socket);

    const peg = new THREE.Mesh(pegGeo, ironPegMat);
    peg.position.set(px, surfaceY - 0.001, pz);
    peg.receiveShadow = true;
    peg.castShadow = true;
    aboveWaterGroup.add(peg);
  });

  // Low-profile creeping velvety moss mats hugging outer plank seams & splintered wet ends (outside book footprint)
  const tuftGeos = [
    createCreepingMossMatGeometry(1.1),
    createCreepingMossMatGeometry(3.4),
    createCreepingMossMatGeometry(6.2),
  ];
  const tuftClusters: Array<{ x: number; y: number; z: number; sx: number; sy: number; sz: number; yaw: number }> = [
    // Left splintered damp tips & inter-board seam grooves (flush <= surfaceY + 0.003 so zero clip with open book)
    { x: -1.00, y: surfaceY - 0.003, z: -0.129, sx: 0.135, sy: 0.022, sz: 0.054, yaw: 0.06 },
    { x: -1.08, y: surfaceY - 0.003, z: 0.129, sx: 0.128, sy: 0.022, sz: 0.052, yaw: -0.14 },
    { x: -1.24, y: surfaceY - 0.010, z: 0.015, sx: 0.105, sy: 0.042, sz: 0.072, yaw: 0.28 },
    { x: -1.16, y: surfaceY - 0.008, z: 0.235, sx: 0.098, sy: 0.036, sz: 0.064, yaw: 0.42 },
    { x: -0.92, y: surfaceY - 0.006, z: -0.352, sx: 0.118, sy: 0.028, sz: 0.052, yaw: 0.08 },
    // Right splintered edge crevices & inter-board seam grooves
    { x: 1.00, y: surfaceY - 0.003, z: -0.129, sx: 0.132, sy: 0.022, sz: 0.054, yaw: -0.12 },
    { x: 1.08, y: surfaceY - 0.003, z: 0.129, sx: 0.124, sy: 0.022, sz: 0.052, yaw: 0.16 },
    { x: 1.24, y: surfaceY - 0.010, z: -0.012, sx: 0.102, sy: 0.042, sz: 0.070, yaw: -0.30 },
    { x: 1.15, y: surfaceY - 0.008, z: -0.228, sx: 0.096, sy: 0.036, sz: 0.062, yaw: -0.38 },
    { x: 0.92, y: surfaceY - 0.006, z: 0.352, sx: 0.116, sy: 0.028, sz: 0.052, yaw: 0.12 },
  ];

  tuftClusters.forEach((tc, idx) => {
    const tMesh = new THREE.Mesh(
      tuftGeos[idx % tuftGeos.length],
      mossMats[idx % mossMats.length],
    );
    tMesh.position.set(tc.x, tc.y, tc.z);
    tMesh.scale.set(tc.sx, tc.sy, tc.sz);
    tMesh.rotation.y = tc.yaw;
    tMesh.castShadow = true;
    tMesh.receiveShadow = true;
    aboveWaterGroup.add(tMesh);
  });

  // Subtle isolated contact shadow catcher strictly beneath book footprint
  const bookShadowGeo = new THREE.PlaneGeometry(POND_LAYOUT.plankWidth * 0.94, POND_LAYOUT.plankDepth * 0.94);
  bookShadowGeo.rotateX(-Math.PI / 2);
  const bookShadowMat = new THREE.ShadowMaterial({
    color: 0x050402,
    opacity: 0.44,
    transparent: true,
    depthWrite: false,
  });
  const bookShadow = new THREE.Mesh(bookShadowGeo, bookShadowMat);
  bookShadow.position.y = surfaceY + 0.0014;
  bookShadow.receiveShadow = true;
  bookShadow.renderOrder = 2;
  aboveWaterGroup.add(bookShadow);

  disposables.push(
    plankMat,
    battenMat,
    socketGeo,
    socketMat,
    ironPegMat,
    ...mossMats,
    ...tuftGeos,
    battenGeo,
    pegGeo,
    bookShadowGeo,
    bookShadowMat,
  );

  return {
    group,
    aboveWaterGroup,
    update: (elapsedSec, waterSim, bookOpenProgress) => {
      const idleWeight = 1 - THREE.MathUtils.smoothstep(bookOpenProgress, 0.0, 0.15);
      if (idleWeight <= 0.001) {
        group.position.y = 0;
        group.rotation.x = 0;
        group.rotation.z = 0;
        return;
      }
      const w = waterSim.sampleCpuWaveAt(0, 0);
      const bob = (w.height * 0.005 + Math.sin(elapsedSec * 0.85) * 0.00035) * idleWeight;
      group.position.y = THREE.MathUtils.clamp(bob, -0.00048, 0.00048);
      group.rotation.x = (w.slopeZ * 0.004 + Math.sin(elapsedSec * 0.72) * 0.0007) * idleWeight;
      group.rotation.z = (-w.slopeX * 0.004 + Math.cos(elapsedSec * 0.68) * 0.0006) * idleWeight;
    },
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}
