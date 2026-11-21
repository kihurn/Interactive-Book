import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { POND_CAUSTICS_GLSL } from './causticsShader';
import { POND_BOUNDS, POND_LAYOUT } from './constants';
import {
  createCreepingMossMatGeometry,
  createMossClumpTextures,
  createVelvetyMossMaterial,
} from './FloatingPlank';
import type { WaterSimulation } from './WaterSimulation';

export interface PondLanternRig {
  group: THREE.Group;
  aboveWaterGroup: THREE.Group;
  pointLight: THREE.PointLight;
  update: (elapsedSec: number, waterSim?: WaterSimulation) => void;
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

function evaluateLanternBoulderVertex(
  dir: THREE.Vector3,
  radius: number,
  aboveWater: number,
  seed: number,
  out: THREE.Vector3,
  withLanternPocket = true,
): THREE.Vector3 {
  const n1 = fbm3DLantern(dir.x * 1.25 + 1.8, dir.y * 1.25 + 1.8, dir.z * 1.25 + 1.8, seed);
  const n2 = fbm3DLantern(dir.x * 2.3 + 4.1, dir.y * 2.3 + 2.6, dir.z * 2.3 + 3.4, seed + 15.4);

  // Smooth rounded river-cobble silhouette matching the pond's emergent stones
  const rMod = 0.90 + (n1 - 0.5) * 0.19 + (n2 - 0.5) * 0.07;

  // Gentle asymmetric river-boulder proportions curving naturally inward underwater
  const shoulderBias =
    1.0 +
    Math.max(0, dir.x * 0.65 + dir.z * 0.45) * 0.14 +
    Math.max(0, -dir.x * 0.4 + dir.z * 0.3) * 0.08;

  const px = dir.x * rMod * radius * 1.14 * shoulderBias;
  const pz = dir.z * rMod * radius * 0.96 * shoulderBias;

  const asymSlope = 1.0 + (-dir.x * 0.09 - dir.z * 0.07);
  const baseHalfH = Math.max(aboveWater * 1.08, radius * 0.48);
  const underFlatten = dir.y < 0 ? 0.90 : 1.0;
  let scaledY = dir.y * rMod * asymSlope * baseHalfH * underFlatten;

  // Subtle small natural cradle pocket tucked directly beneath the 3 lantern legs
  if (withLanternPocket && dir.y > 0.18) {
    const rXZ = Math.hypot(px, pz);
    const pocketWeight = 1.0 - Math.min(1, Math.max(0, (rXZ - 0.095) / (0.148 - 0.095)));
    const smoothPocket = pocketWeight * pocketWeight * (3 - 2 * pocketWeight);
    const pocketY = 0.057 + (n1 - 0.5) * 0.004;
    scaledY = THREE.MathUtils.lerp(scaledY, pocketY, smoothPocket);
  }

  return out.set(px, scaledY, pz);
}

/**
 * Sculpts a smooth, rounded river-granite cobble boulder matching the right-side stones,
 * curving naturally inward beneath the waterline rather than stretching into a vertical cylinder.
 */
function createSculptedLanternBoulderGeometry(
  radius: number,
  aboveWater: number,
  seed = 14.3,
  withLanternPocket = true,
): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, 3);
  const pos = geo.attributes.position as THREE.BufferAttribute;

  const v = new THREE.Vector3();
  const out = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    evaluateLanternBoulderVertex(v, radius, aboveWater, seed, out, withLanternPocket);
    pos.setXYZ(i, out.x, out.y, out.z);
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
  const waveTexUniform: { value: THREE.Texture | null } = { value: null };
  const waveTexelUniform = { value: new THREE.Vector2(1 / 128, 1 / 128) };
  const pondBoundsUniform = {
    value: new THREE.Vector4(
      POND_BOUNDS.minX,
      POND_BOUNDS.maxX,
      POND_BOUNDS.minZ,
      POND_BOUNDS.maxZ,
    ),
  };
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
      shader.uniforms.tWave = waveTexUniform;
      shader.uniforms.uWaveTexel = waveTexelUniform;
      shader.uniforms.uPondBounds = pondBoundsUniform;
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
          uniform sampler2D tWave;
          uniform vec2 uWaveTexel;
          uniform vec4 uPondBounds;
          uniform vec3 uBounceOrigin;
          varying vec3 vLanternWorld;
          varying vec3 vLanternWorldN;
          ${POND_CAUSTICS_GLSL}`,
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
          // Eliminate specular & environment reflections on submerged rock surfaces underwater
          float lSubmerged = 1.0 - smoothstep(uWaterY - 0.018, uWaterY + 0.006, vLanternWorld.y);
          reflectedLight.directSpecular *= (1.0 - lSubmerged);
          reflectedLight.indirectSpecular *= (1.0 - lSubmerged);

          // Subtle wave-driven underwater caustics across submerged granite boulder facets
          float lSubMask = 1.0 - smoothstep(uWaterY - 0.06, uWaterY + 0.01, vLanternWorld.y);
          if (lSubMask > 0.01) {
            float lShadow = 1.0;
            #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
              DirectionalLightShadow lDirShadow = directionalLightShadows[ 0 ];
              lShadow = receiveShadow ? getShadow( directionalShadowMap[ 0 ], lDirShadow.shadowMapSize, lDirShadow.shadowIntensity, lDirShadow.shadowBias, lDirShadow.shadowRadius, vDirectionalShadowCoord[ 0 ] ) : 1.0;
            #endif
            float lWaveCaustic = pondWaveLaplacianCaustic(tWave, uWaveTexel, uPondBounds, vLanternWorld, uWaterY);
            float lThreads = pondAmbientSunThreads(vLanternWorld.xz, uCausticTime);
            float lCover = pondCausticCoverMask(vLanternWorld.xz, lShadow);
            float lEdgeFade = exp(-dot(vLanternWorld.xz, vLanternWorld.xz) * 0.09);
            reflectedLight.directDiffuse += vec3(1.0, 0.94, 0.76) * (lWaveCaustic * 0.18 + lThreads * 0.09) * lSubMask * lCover * lEdgeFade;
          }`,
        );
    };
    mat.customProgramCacheKey = () => `${cacheKey}-laplacian-v7`;
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

  // 1. Roundish river-granite boulder supported underneath by nestled submerged river stones on the shallow bed
  const lanternBoulderRadius = 0.355;
  const lanternAboveWater = 0.12;
  const boulderGeo = createSculptedLanternBoulderGeometry(
    lanternBoulderRadius,
    lanternAboveWater,
  );
  const baseRock = new THREE.Mesh(boulderGeo, boulderPlatformMat);
  baseRock.position.set(0, waterY, 0);
  baseRock.rotation.y = 0.18;
  baseRock.castShadow = true;
  baseRock.receiveShadow = true;
  group.add(baseRock);

  const lanternBaseStones: Array<{
    ox: number;
    oz: number;
    yOffset: number;
    radius: number;
    height: number;
    yaw: number;
    seed: number;
  }> = [
    { ox: -0.14, oz: 0.10, yOffset: -0.24, radius: 0.25, height: 0.125, yaw: 0.65, seed: 31.2 },
    { ox: 0.17, oz: -0.06, yOffset: -0.25, radius: 0.24, height: 0.12, yaw: -1.1, seed: 44.8 },
    { ox: -0.02, oz: -0.16, yOffset: -0.26, radius: 0.23, height: 0.115, yaw: 2.15, seed: 58.3 },
  ];
  lanternBaseStones.forEach((ls) => {
    const sGeo = createSculptedLanternBoulderGeometry(ls.radius, ls.height, ls.seed, false);
    const sMesh = new THREE.Mesh(sGeo, boulderPlatformMat);
    sMesh.position.set(ls.ox, Math.max(bedY + ls.height * 0.42, waterY + ls.yOffset), ls.oz);
    sMesh.rotation.y = ls.yaw;
    sMesh.castShadow = false;
    sMesh.receiveShadow = true;
    group.add(sMesh);
    disposables.push(sGeo);
  });

  // Low-profile velvety creeping moss mats anchored onto outer granite boulder shoulders
  const lanternMossMat = createVelvetyMossMaterial(mossTex, 0xdce6cc);
  const mossGeos = [
    createCreepingMossMatGeometry(4.2),
    createCreepingMossMatGeometry(7.9),
  ];
  const mossShoulderDirs: Array<{ ang: number; elev: number; scale: number; yaw: number }> = [
    { ang: 2.55, elev: 0.38, scale: 0.08, yaw: 0.8 },
    { ang: -0.58, elev: 0.36, scale: 0.072, yaw: 2.4 },
    { ang: 0.92, elev: 0.34, scale: 0.068, yaw: -0.5 },
  ];
  const mDir = new THREE.Vector3();
  const mSurf = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const lanternScratch = new THREE.Object3D();
  const lanternMossParts: THREE.BufferGeometry[] = [];
  mossShoulderDirs.forEach((mp, idx) => {
    mDir
      .set(
        Math.cos(mp.ang) * Math.cos(mp.elev),
        Math.sin(mp.elev),
        Math.sin(mp.ang) * Math.cos(mp.elev),
      )
      .normalize();
    evaluateLanternBoulderVertex(
      mDir,
      lanternBoulderRadius,
      lanternAboveWater,
      14.3,
      mSurf,
    );
    mSurf.applyAxisAngle(yAxis, 0.18);
    lanternScratch.position.set(mSurf.x, waterY + mSurf.y - 0.004, mSurf.z);
    lanternScratch.rotation.set(0, mp.yaw, 0);
    lanternScratch.scale.set(mp.scale, mp.scale * 0.34, mp.scale * 0.7);
    lanternScratch.updateMatrix();
    const part = mossGeos[idx % mossGeos.length].clone();
    part.applyMatrix4(lanternScratch.matrix);
    lanternMossParts.push(part);
  });
  const mergedLanternMossGeo = mergeGeometries(lanternMossParts, false);
  lanternMossParts.forEach((g) => g.dispose());
  if (mergedLanternMossGeo) {
    const lanternMossMesh = new THREE.Mesh(mergedLanternMossGeo, lanternMossMat);
    lanternMossMesh.castShadow = true;
    lanternMossMesh.receiveShadow = true;
    aboveWaterGroup.add(lanternMossMesh);
    disposables.push(mergedLanternMossGeo);
  }

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

  const legProfile = [
    new THREE.Vector2(0, -0.024),
    new THREE.Vector2(0.029, -0.024),
    new THREE.Vector2(0.024, 0.0),
    new THREE.Vector2(0.020, 0.024),
    new THREE.Vector2(0, 0.024),
  ];
  const legGeo = new THREE.LatheGeometry(legProfile, 8);
  const legParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * Math.PI * 2 + 0.4;
    lanternScratch.position.set(Math.cos(ang) * 0.092, pedestalTopY + 0.012, Math.sin(ang) * 0.092);
    lanternScratch.rotation.set(-Math.sin(ang) * 0.22, 0, Math.cos(ang) * 0.22);
    lanternScratch.scale.set(1, 1, 1);
    lanternScratch.updateMatrix();
    const part = legGeo.clone();
    part.applyMatrix4(lanternScratch.matrix);
    legParts.push(part);
  }
  const mergedLegsGeo = mergeGeometries(legParts, false);
  legParts.forEach((g) => g.dispose());
  if (mergedLegsGeo) {
    const legsMesh = new THREE.Mesh(mergedLegsGeo, stoneMat);
    legsMesh.castShadow = true;
    legsMesh.receiveShadow = true;
    aboveWaterGroup.add(legsMesh);
    disposables.push(mergedLegsGeo);
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
  const coreProfile = [
    new THREE.Vector2(0, -fireboxHeight * 0.5),
    new THREE.Vector2(0.068, -fireboxHeight * 0.5),
    new THREE.Vector2(0.068, fireboxHeight * 0.5),
    new THREE.Vector2(0, fireboxHeight * 0.5),
  ];
  const coreGeo = new THREE.LatheGeometry(coreProfile, 6);
  const coreMesh = new THREE.Mesh(coreGeo, shojiMat);
  coreMesh.position.y = fireboxY + fireboxHeight * 0.5;
  coreMesh.castShadow = true;
  aboveWaterGroup.add(coreMesh);

  const pillarGeo = new THREE.BoxGeometry(0.018, fireboxHeight + 0.008, 0.018);
  const pillarParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    lanternScratch.position.set(
      Math.cos(ang) * 0.072,
      fireboxY + fireboxHeight * 0.5,
      Math.sin(ang) * 0.072,
    );
    lanternScratch.rotation.set(0, -ang, 0);
    lanternScratch.scale.set(1, 1, 1);
    lanternScratch.updateMatrix();
    const part = pillarGeo.clone();
    part.applyMatrix4(lanternScratch.matrix);
    pillarParts.push(part);
  }
  const mergedPillarsGeo = mergeGeometries(pillarParts, false);
  pillarParts.forEach((g) => g.dispose());
  if (mergedPillarsGeo) {
    const pillarsMesh = new THREE.Mesh(mergedPillarsGeo, stoneMat);
    pillarsMesh.castShadow = true;
    pillarsMesh.receiveShadow = true;
    aboveWaterGroup.add(pillarsMesh);
    disposables.push(mergedPillarsGeo);
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
  const ribParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    lanternScratch.position.set(0, roofY + 0.008, 0);
    lanternScratch.rotation.set(0, (i / 6) * Math.PI * 2 + Math.PI / 2, 0);
    lanternScratch.scale.set(1, 1, 1);
    lanternScratch.updateMatrix();
    const part = ribGeo.clone();
    part.applyMatrix4(lanternScratch.matrix);
    ribParts.push(part);
  }
  const mergedRibsGeo = mergeGeometries(ribParts, false);
  ribParts.forEach((g) => g.dispose());
  if (mergedRibsGeo) {
    const ribsMesh = new THREE.Mesh(mergedRibsGeo, roofGraniteMat);
    ribsMesh.castShadow = true;
    ribsMesh.receiveShadow = true;
    aboveWaterGroup.add(ribsMesh);
    disposables.push(mergedRibsGeo);
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
    update: (elapsedSec: number, waterSim?: WaterSimulation) => {
      const f =
        Math.sin(elapsedSec * 5.2) * 0.07 +
        Math.sin(elapsedSec * 11.7 + 1.3) * 0.04 +
        Math.cos(elapsedSec * 18.4 + 0.7) * 0.025;
      const flicker = 1.0 + f;
      pointLight.intensity = 0.30 * flicker;
      shojiMat.emissiveIntensity = 1.48 * flicker;
      causticTimeUniform.value = elapsedSec;
      flickerUniform.value = flicker;
      if (waterSim) {
        waveTexUniform.value = waterSim.texture;
        waveTexelUniform.value.copy(waterSim.texelSize);
      }
    },
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}
