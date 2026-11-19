import * as THREE from 'three';
import { POND_LAYOUT } from './constants';
import {
  createCreepingMossMatGeometry,
  createMossClumpTextures,
  createVelvetyMossMaterial,
} from './FloatingPlank';

export interface PondLanternRig {
  group: THREE.Group;
  aboveWaterGroup: THREE.Group;
  pointLight: THREE.PointLight;
  update: (elapsedSec: number) => void;
  dispose: () => void;
}

function hash3Lantern(x: number, y: number, z: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 19.3) * 43758.5453123;
  return n - Math.floor(n);
}

function valueNoise3DLantern(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);

  const c000 = hash3Lantern(ix, iy, iz, seed);
  const c100 = hash3Lantern(ix + 1, iy, iz, seed);
  const c010 = hash3Lantern(ix, iy + 1, iz, seed);
  const c110 = hash3Lantern(ix + 1, iy + 1, iz, seed);
  const c001 = hash3Lantern(ix, iy, iz + 1, seed);
  const c101 = hash3Lantern(ix + 1, iy, iz + 1, seed);
  const c011 = hash3Lantern(ix, iy + 1, iz + 1, seed);
  const c111 = hash3Lantern(ix + 1, iy + 1, iz + 1, seed);

  const x00 = c000 + (c100 - c000) * ux;
  const x10 = c010 + (c110 - c010) * ux;
  const x01 = c001 + (c101 - c001) * ux;
  const x11 = c011 + (c111 - c011) * ux;

  const y0 = x00 + (x10 - x00) * uy;
  const y1 = x01 + (x11 - x01) * uy;
  return y0 + (y1 - y0) * uz;
}

function fbm3DLantern(x: number, y: number, z: number, seed: number): number {
  return (
    valueNoise3DLantern(x, y, z, seed) * 0.56 +
    valueNoise3DLantern(x * 2.05 + 4.1, y * 2.05 + 1.3, z * 2.05 + 2.7, seed + 7) * 0.29 +
    valueNoise3DLantern(x * 4.2 + 8.3, y * 4.2 + 5.1, z * 4.2 + 6.9, seed + 17) * 0.15
  );
}

function createWeatheredLanternGraniteMaps(maxAnisotropy: number): {
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

  // Natural weathered granite tone harmonized with the top-right sculpted boulders
  cCtx.fillStyle = '#585e5c';
  cCtx.fillRect(0, 0, size, size);

  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, size, size);

  rCtx.fillStyle = '#ebebeb';
  rCtx.fillRect(0, 0, size, size);

  const rand = (n: number) => {
    const v = Math.sin(n * 47.31 + 3.1) * 43758.5453;
    return v - Math.floor(v);
  };

  // Mineral weathering patches & subtle pale quartz mottling
  for (let i = 0; i < 220; i++) {
    const x = rand(i * 3 + 1) * size;
    const y = rand(i * 3 + 2) * size;
    const r = 10 + rand(i * 3 + 3) * 30;
    const pick = i % 4;
    cCtx.fillStyle =
      pick === 0
        ? 'rgba(176, 182, 176, 0.24)'
        : pick === 1
          ? 'rgba(72, 86, 64, 0.16)'
          : pick === 2
            ? 'rgba(54, 58, 60, 0.20)'
            : 'rgba(116, 114, 106, 0.18)';
    cCtx.beginPath();
    cCtx.arc(x, y, r, 0, Math.PI * 2);
    cCtx.fill();

    bCtx.fillStyle = pick % 2 === 0 ? 'rgba(200, 200, 200, 0.18)' : 'rgba(55, 55, 55, 0.2)';
    bCtx.beginPath();
    bCtx.arc(x, y, r * 0.72, 0, Math.PI * 2);
    bCtx.fill();
  }

  // Dense speckled granite feldspar/quartz/biotite mineral grit
  for (let i = 0; i < 6400; i++) {
    const x = rand(i * 5 + 7) * size;
    const y = rand(i * 5 + 11) * size;
    const s = 1 + (i % 3);
    cCtx.fillStyle =
      i % 5 === 0
        ? 'rgba(226, 230, 224, 0.34)'
        : i % 3 === 0
          ? 'rgba(34, 38, 40, 0.32)'
          : i % 7 === 0
            ? 'rgba(84, 98, 68, 0.20)'
            : 'rgba(154, 158, 152, 0.26)';
    cCtx.fillRect(x, y, s, s);
    bCtx.fillStyle = i % 2 === 0 ? 'rgba(225, 225, 225, 0.26)' : 'rgba(35, 35, 35, 0.26)';
    bCtx.fillRect(x, y, s, s);
  }

  // Subtle fractured stone micro-veins
  for (let i = 0; i < 12; i++) {
    let px = rand(i * 19 + 3) * size;
    let py = rand(i * 19 + 5) * size;
    cCtx.strokeStyle = 'rgba(42, 46, 46, 0.36)';
    cCtx.lineWidth = 1.3;
    bCtx.strokeStyle = 'rgba(26, 26, 26, 0.6)';
    bCtx.lineWidth = 1.9;
    cCtx.beginPath();
    bCtx.beginPath();
    cCtx.moveTo(px, py);
    bCtx.moveTo(px, py);
    for (let s = 0; s < 5; s++) {
      px += (rand(i * 29 + s * 3) - 0.5) * 60;
      py += (rand(i * 29 + s * 7) - 0.5) * 60;
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
 * Sculpts a wide, multi-faceted granite boulder platform with planar cleavage bevels,
 * a level upper shelf for the Yukimi-doro lantern legs, and broad sunlit front-right
 * granite shoulders extending past the lantern roof shadow.
 */
function createSculptedLanternBoulderGeometry(
  radius: number,
  aboveWater: number,
  belowWater: number,
): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, 4);
  const pos = geo.attributes.position as THREE.BufferAttribute;

  const planes = Array.from({ length: 5 }, (_, k) => {
    const a = k * 1.92 + 1.15;
    const elev = 0.24 + ((k * 0.34) % 0.62);
    return new THREE.Vector3(
      Math.cos(a) * Math.cos(elev),
      Math.sin(elev),
      Math.sin(a) * Math.cos(elev),
    ).normalize();
  });

  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();

    const n1 = fbm3DLantern(v.x * 1.85 + 2.0, v.y * 1.85 + 2.0, v.z * 1.85 + 2.0, 14.3);
    let rMod = 0.88 + n1 * 0.26;

    for (let p = 0; p < planes.length; p++) {
      const dot = v.dot(planes[p]);
      if (dot > 0.50) {
        rMod -= (dot - 0.50) * 0.21;
      }
    }

    // Flat horizontal shelf atop boulder for stable 3-leg seating + terraced front-right shoulder
    let py = v.y * rMod;
    if (py > 0.38) {
      py = 0.38 + (py - 0.38) * 0.22;
    }

    // Broad sunlit front-right shoulder extension (+X / +Z) protruding clearly beyond the 0.214m kasa roof shadow
    const shoulderBias =
      1.0 + Math.max(0, v.x * 0.62 + v.z * 0.42) * 0.18;

    const px = v.x * rMod * radius * 1.15 * shoulderBias;
    const pz = v.z * rMod * radius * 0.98 * shoulderBias;
    const scaledY = py >= 0 ? py * aboveWater * 1.38 : py * belowWater * 1.38;

    pos.setXYZ(i, px, scaledY, pz);
  }

  geo.computeVertexNormals();
  return geo;
}

function createShojiLatticeTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createRadialGradient(64, 72, 6, 64, 64, 68);
  grad.addColorStop(0, '#fff2c4');
  grad.addColorStop(0.5, '#f6b85c');
  grad.addColorStop(1, '#c7722a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(42, 28, 18, 0.78)';
  ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, size - 8, size - 8);
  ctx.lineWidth = 3;
  for (let i = 1; i <= 2; i++) {
    const p = (size / 3) * i;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Multi-part carved Japanese Yukimi-doro garden lantern resting on a wide, multi-faceted
 * sculpted light-grey granite boulder platform in the top-left pond quadrant.
 */
export function createPondLantern(
  waterY: number,
  bedY: number,
  maxAnisotropy: number,
): PondLanternRig {
  const disposables: Array<{ dispose: () => void }> = [];
  const group = new THREE.Group();
  group.name = 'pond-lantern-group';

  const { x, z } = POND_LAYOUT.lanternPos;
  group.position.set(x, 0, z);

  const aboveWaterGroup = new THREE.Group();
  group.add(aboveWaterGroup);

  const graniteMaps = createWeatheredLanternGraniteMaps(maxAnisotropy);
  const mossTex = createMossClumpTextures(maxAnisotropy);
  disposables.push(graniteMaps, mossTex);

  const causticTimeUniform = { value: 0 };
  const flickerUniform = { value: 1.0 };
  const pedestalTopY = waterY + 0.068;
  const fireboxCenterLocalY = pedestalTopY + 0.073 + 0.048;

  const attachStoneRimShader = (
    mat: THREE.MeshStandardMaterial,
    mossBias: number,
    isBaseRock: boolean,
    cacheKey: string,
  ) => {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWaterY = { value: waterY };
      shader.uniforms.uMossBias = { value: mossBias };
      shader.uniforms.uCausticTime = causticTimeUniform;
      shader.uniforms.uFlicker = flickerUniform;
      shader.uniforms.uBounceOrigin = {
        value: new THREE.Vector3(x, fireboxCenterLocalY, z),
      };

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vLanternWorld;
          varying vec3 vLanternWorldN;`,
        )
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          vLanternWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vLanternWorldN = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz);`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uWaterY;
          uniform float uMossBias;
          uniform float uCausticTime;
          uniform float uFlicker;
          uniform vec3 uBounceOrigin;
          varying vec3 vLanternWorld;
          varying vec3 vLanternWorldN;

          vec2 lanternHash2(vec2 p) {
            p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
            return fract(sin(p) * 43758.5453123);
          }

          float lanternVoronoiEdge(vec2 x, float t) {
            vec2 n = floor(x);
            vec2 f = fract(x);
            float d1 = 8.0;
            float d2 = 8.0;
            for (int j = -1; j <= 1; j++) {
              for (int i = -1; i <= 1; i++) {
                vec2 g = vec2(float(i), float(j));
                vec2 o = lanternHash2(n + g);
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

          float lanternCausticArcs(vec2 p, float t) {
            vec2 warp = vec2(
              sin(p.y * 1.6 + t * 0.42) + cos(p.x * 1.1 - t * 0.35) * 0.5,
              cos(p.x * 1.5 - t * 0.38) + sin(p.y * 1.2 + t * 0.31) * 0.5
            ) * 0.24;
            float f1 = lanternVoronoiEdge((p + warp) * 1.55, t * 0.72);
            float f2 = lanternVoronoiEdge((mat2(0.8, -0.6, 0.6, 0.8) * (p - warp * 0.8)) * 1.95 + vec2(3.7, -2.1), -t * 0.58 + 1.9);
            float break1 = smoothstep(0.08, 0.68, sin(p.x * 1.85 - p.y * 1.35 + t * 0.28 + sin(p.y * 2.1) * 0.7));
            float break2 = smoothstep(0.08, 0.68, cos(p.x * 1.55 + p.y * 1.75 - t * 0.24 + cos(p.x * 1.9) * 0.7));
            float sunPocket = smoothstep(-0.12, 0.52, sin(p.x * 0.85 + t * 0.14) * cos(p.y * 0.95 - t * 0.12));
            return clamp(f1 * break1 + f2 * break2 * 0.78, 0.0, 1.0) * (0.30 + 0.70 * sunPocket);
          }`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float lMoss = smoothstep(0.45, 0.92, vLanternWorldN.y) * uMossBias;
          float lPatch = 0.5 + 0.5 * sin(vLanternWorld.x * 26.0 + vLanternWorld.z * 21.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.11, 0.16, 0.08), lMoss * lPatch * 0.44);
          float lWet = 1.0 - smoothstep(uWaterY - 0.015, uWaterY + 0.036, vLanternWorld.y);
          float lDeepDark = smoothstep(uWaterY - 0.02, uWaterY - 0.24, vLanternWorld.y);
          diffuseColor.rgb *= mix(1.0, 0.34, lWet) * mix(1.0, 0.45, lDeepDark);`,
        )
        .replace(
          '#include <lights_fragment_begin>',
          `#include <lights_fragment_begin>
          vec3 lV = normalize(cameraPosition - vLanternWorld);
          float lRim = pow(1.0 - max(dot(normalize(vLanternWorldN), lV), 0.0), 2.8);
          float lUpTilt = smoothstep(-0.1, 0.8, vLanternWorldN.y);
          float lAboveWater = smoothstep(uWaterY - 0.01, uWaterY + 0.03, vLanternWorld.y);
          totalEmissiveRadiance += vec3(0.036, 0.046, 0.050) * (lRim * 0.36 + lUpTilt * 0.10) * lAboveWater;

          // Subtle warm amber lantern bounce light grazing stone shoulder rim directly beneath firebox
          vec3 toBounce = uBounceOrigin - vLanternWorld;
          float bDist = length(toBounce);
          float bNdotL = max(dot(normalize(vLanternWorldN), toBounce / max(0.001, bDist)), 0.0);
          float bAtten = exp(-bDist * 6.8) * smoothstep(uWaterY + 0.015, uWaterY + 0.075, vLanternWorld.y);
          totalEmissiveRadiance += vec3(0.92, 0.44, 0.14) * bNdotL * bAtten * ${isBaseRock ? '0.16' : '0.14'} * uFlicker;`,
        )
        .replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
          // Subtle sunlit underwater caustics across submerged granite boulder facets
          float lSubMask = 1.0 - smoothstep(uWaterY - 0.06, uWaterY + 0.01, vLanternWorld.y);
          if (lSubMask > 0.01) {
            float lCaustic = lanternCausticArcs(vLanternWorld.xz, uCausticTime * 0.82);
            float lEdgeFade = exp(-dot(vLanternWorld.xz, vLanternWorld.xz) * 0.10);
            reflectedLight.directDiffuse += vec3(0.88, 0.95, 0.89) * (lCaustic * 0.14) * lSubMask * lEdgeFade;
          }`,
        );
    };
    mat.customProgramCacheKey = () => `${cacheKey}-voronoi-v3`;
  };

  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0xc2c8c4,
    map: graniteMaps.map,
    bumpMap: graniteMaps.bumpMap,
    bumpScale: 0.014,
    roughnessMap: graniteMaps.roughnessMap,
    roughness: 0.9,
    metalness: 0.02,
    envMapIntensity: 0.18,
  });
  attachStoneRimShader(stoneMat, 0.24, false, 'lantern-granite-rim-v5');

  const boulderPlatformMat = new THREE.MeshStandardMaterial({
    color: 0xb4bab7,
    map: graniteMaps.map,
    bumpMap: graniteMaps.bumpMap,
    bumpScale: 0.016,
    roughnessMap: graniteMaps.roughnessMap,
    roughness: 0.92,
    metalness: 0.02,
    envMapIntensity: 0.14,
  });
  attachStoneRimShader(boulderPlatformMat, 0.22, true, 'lantern-boulder-platform-v5');

  const roofGraniteMat = new THREE.MeshStandardMaterial({
    color: 0xc8cec8,
    map: graniteMaps.map,
    bumpMap: graniteMaps.bumpMap,
    bumpScale: 0.015,
    roughnessMap: graniteMaps.roughnessMap,
    roughness: 0.9,
    metalness: 0.02,
    envMapIntensity: 0.2,
  });
  attachStoneRimShader(roofGraniteMat, 0.65, false, 'lantern-roof-granite-rim-v5');

  // 1. Wide sculpted granite boulder matching the exact underwater/above-water proportions of top-right boulders
  const boulderGeo = createSculptedLanternBoulderGeometry(0.365, 0.135, 0.175);
  const baseRock = new THREE.Mesh(boulderGeo, boulderPlatformMat);
  baseRock.position.set(0.03, waterY + 0.006, 0.02);
  baseRock.rotation.y = 0.35;
  baseRock.castShadow = true;
  baseRock.receiveShadow = true;
  group.add(baseRock);

  // Dark shadowy submerged reef shoal underneath boulder anchoring into pond floor
  const shoalH = Math.max(0.1, waterY - 0.12 - bedY + 0.06);
  const shoalGeo = new THREE.CylinderGeometry(0.28, 0.44, shoalH, 14);
  const shoalMat = new THREE.MeshStandardMaterial({
    color: 0x161d1e,
    roughness: 0.94,
    metalness: 0.02,
  });
  const shoalMesh = new THREE.Mesh(shoalGeo, shoalMat);
  shoalMesh.position.set(0.03, bedY + shoalH * 0.5 - 0.02, 0.02);
  shoalMesh.receiveShadow = true;
  group.add(shoalMesh);

  // Low-profile velvety creeping moss mats tucked along sculpted granite boulder ledges
  const lanternMossMat = createVelvetyMossMaterial(mossTex, 0xdce6cc);
  const mossGeos = [
    createCreepingMossMatGeometry(4.2),
    createCreepingMossMatGeometry(7.9),
  ];
  const lanternMossPlacements: Array<{ x: number; y: number; z: number; sx: number; sy: number; sz: number; yaw: number }> = [
    { x: -0.2, y: waterY + 0.044, z: 0.13, sx: 0.088, sy: 0.032, sz: 0.062, yaw: 0.8 },
    { x: 0.22, y: waterY + 0.048, z: -0.13, sx: 0.078, sy: 0.03, sz: 0.056, yaw: 2.4 },
    { x: 0.16, y: waterY + 0.028, z: 0.22, sx: 0.074, sy: 0.028, sz: 0.052, yaw: -0.5 },
  ];
  lanternMossPlacements.forEach((mp, idx) => {
    const mMesh = new THREE.Mesh(mossGeos[idx % mossGeos.length], lanternMossMat);
    mMesh.position.set(mp.x, mp.y, mp.z);
    mMesh.scale.set(mp.sx, mp.sy, mp.sz);
    mMesh.rotation.y = mp.yaw;
    mMesh.castShadow = true;
    mMesh.receiveShadow = true;
    aboveWaterGroup.add(mMesh);
  });

  // 2. Yukimi-doro 3 curved stone legs & carved chudai platform seated atop granite plateau
  const chudaiProfile = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.115, 0),
    new THREE.Vector2(0.148, 0.025),
    new THREE.Vector2(0.136, 0.048),
    new THREE.Vector2(0, 0.048),
  ];
  const chudaiGeo = new THREE.LatheGeometry(chudaiProfile, 6);
  const chudaiMesh = new THREE.Mesh(chudaiGeo, stoneMat);
  chudaiMesh.position.y = pedestalTopY + 0.025;
  chudaiMesh.castShadow = true;
  chudaiMesh.receiveShadow = true;
  aboveWaterGroup.add(chudaiMesh);

  const legGeo = new THREE.CylinderGeometry(0.02, 0.028, 0.048, 8);
  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * Math.PI * 2 + 0.4;
    const leg = new THREE.Mesh(legGeo, stoneMat);
    leg.position.set(Math.cos(ang) * 0.092, pedestalTopY + 0.012, Math.sin(ang) * 0.092);
    leg.rotation.z = Math.cos(ang) * 0.22;
    leg.rotation.x = -Math.sin(ang) * 0.22;
    leg.castShadow = true;
    leg.receiveShadow = true;
    aboveWaterGroup.add(leg);
  }

  // 3. Firebox (hibukuro) — warm shoji glowing core + carved granite corner pillars
  const fireboxY = pedestalTopY + 0.073;
  const fireboxHeight = 0.092;
  const shojiTex = createShojiLatticeTexture();
  const shojiMat = new THREE.MeshStandardMaterial({
    map: shojiTex,
    emissiveMap: shojiTex,
    emissive: new THREE.Color('#ff9d3b'),
    emissiveIntensity: 1.55,
    roughness: 0.7,
  });
  const coreGeo = new THREE.CylinderGeometry(0.068, 0.068, fireboxHeight, 6);
  const coreMesh = new THREE.Mesh(coreGeo, shojiMat);
  coreMesh.position.y = fireboxY + fireboxHeight * 0.5;
  coreMesh.castShadow = true;
  aboveWaterGroup.add(coreMesh);

  const pillarGeo = new THREE.BoxGeometry(0.018, fireboxHeight + 0.008, 0.018);
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    const pillar = new THREE.Mesh(pillarGeo, stoneMat);
    pillar.position.set(
      Math.cos(ang) * 0.072,
      fireboxY + fireboxHeight * 0.5,
      Math.sin(ang) * 0.072,
    );
    pillar.rotation.y = -ang;
    pillar.castShadow = true;
    pillar.receiveShadow = true;
    aboveWaterGroup.add(pillar);
  }

  // 4. Sculpted curved Yukimi-doro hexagonal umbrella roof (kasa) with carved corner ridges & upturned eave rim
  const roofY = fireboxY + fireboxHeight;
  const roofProfile = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.19, -0.02),
    new THREE.Vector2(0.214, -0.004),
    new THREE.Vector2(0.205, 0.012),
    new THREE.Vector2(0.162, 0.038),
    new THREE.Vector2(0.088, 0.075),
    new THREE.Vector2(0.036, 0.096),
    new THREE.Vector2(0, 0.096),
  ];
  const roofGeo = new THREE.LatheGeometry(roofProfile, 6);
  const roofMesh = new THREE.Mesh(roofGeo, roofGraniteMat);
  roofMesh.position.y = roofY + 0.008;
  roofMesh.castShadow = true;
  roofMesh.receiveShadow = true;
  aboveWaterGroup.add(roofMesh);

  // Carved radial stone ridge ribs along the 6 hexagonal roof hip seams
  const ribCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.035, 0.096, 0),
    new THREE.Vector3(0.115, 0.064, 0),
    new THREE.Vector3(0.185, 0.026, 0),
    new THREE.Vector3(0.213, 0.004, 0),
  ]);
  const ribGeo = new THREE.TubeGeometry(ribCurve, 8, 0.0075, 5, false);
  for (let i = 0; i < 6; i++) {
    const rib = new THREE.Mesh(ribGeo, roofGraniteMat);
    rib.position.y = roofY + 0.008;
    rib.rotation.y = (i / 6) * Math.PI * 2 + Math.PI / 2;
    rib.castShadow = true;
    rib.receiveShadow = true;
    aboveWaterGroup.add(rib);
  }

  // Finial lotus jewel (hoju)
  const hojuProfile = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.036, 0.008),
    new THREE.Vector2(0.022, 0.024),
    new THREE.Vector2(0.032, 0.042),
    new THREE.Vector2(0.012, 0.064),
    new THREE.Vector2(0, 0.074),
  ];
  const hojuGeo = new THREE.LatheGeometry(hojuProfile, 12);
  const hojuMesh = new THREE.Mesh(hojuGeo, stoneMat);
  hojuMesh.position.y = roofY + 0.102;
  hojuMesh.castShadow = true;
  hojuMesh.receiveShadow = true;
  aboveWaterGroup.add(hojuMesh);

  // 5. Tightly localized warm flickering candle-flame PointLight illuminating firebox & upper granite boulder rim
  const pointLight = new THREE.PointLight('#ff9a3e', 0.30, 0.55, 2.35);
  pointLight.position.set(0, fireboxY + fireboxHeight * 0.62, 0);
  pointLight.castShadow = false;
  group.add(pointLight);

  disposables.push(
    stoneMat,
    boulderPlatformMat,
    roofGraniteMat,
    shoalGeo,
    shoalMat,
    boulderGeo,
    lanternMossMat,
    ...mossGeos,
    chudaiGeo,
    legGeo,
    shojiTex,
    shojiMat,
    coreGeo,
    pillarGeo,
    roofGeo,
    ribGeo,
    hojuGeo,
  );

  return {
    group,
    aboveWaterGroup,
    pointLight,
    update: (elapsedSec: number) => {
      const f =
        Math.sin(elapsedSec * 5.2) * 0.07 +
        Math.sin(elapsedSec * 11.7 + 1.3) * 0.04 +
        Math.cos(elapsedSec * 18.4 + 0.7) * 0.025;
      const flicker = 1.0 + f;
      pointLight.intensity = 0.30 * flicker;
      shojiMat.emissiveIntensity = 1.48 * flicker;
      causticTimeUniform.value = elapsedSec;
      flickerUniform.value = flicker;
    },
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}
