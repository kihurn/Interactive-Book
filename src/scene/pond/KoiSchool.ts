import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { nearestObstacleSeparation, POND_LAYOUT } from './constants';
import type { WaterSimulation } from './WaterSimulation';

export const MODEL_YAW_OFFSET = 0;

export interface KoiSchoolRig {
  group: THREE.Group;
  update: (
    dtSec: number,
    elapsedSec: number,
    waterSim: WaterSimulation,
    renderer: THREE.WebGLRenderer,
    bookOpenProgress?: number,
  ) => void;
  dispose: () => void;
}

/**
 * 0: Kohaku (pearl white + vermilion orange)
 * 1: Deep Crimson Kohaku (vivid scarlet spots on pearl white)
 * 2: Shiro Utsuri (deep velvety sumi ink-black on pearl white)
 * 3: Showa (3D object-space noise splitting spots between sumi ink-black & crimson-red on white)
 * 4: Yamabuki Ogon (warm metallic gold body wash with burnished amber-gold spot shading)
 * 5: Platinum Ogon (desaturated luminous silver-pearl white)
 */
export type KoiVarietyId = 0 | 1 | 2 | 3 | 4 | 5;

interface KoiWaypoint {
  x: number;
  z: number;
}

interface KoiSpec {
  variety: KoiVarietyId;
  scaleVar: number; // ~0.85x - 1.15x subtle size variation
  length: number;
  depthOffset: number; // depth below waterY
  baseSpeed: number;
  initX: number;
  initZ: number;
  initYaw: number;
  phase: number;
  waypoints: KoiWaypoint[];
}

interface KoiAgent {
  spec: KoiSpec;
  root: THREE.Group;
  shadowDisc: THREE.Mesh;
  mixer: THREE.AnimationMixer | null;
  action: THREE.AnimationAction | null;
  x: number;
  z: number;
  vx: number;
  vz: number;
  yaw: number;
  speed: number;
  burst: number;
  turnBend: number;
  wanderPhase: number;
  waypointIndex: number;
  timeUniform: { value: number };
  freqUniform: { value: number };
  bendUniform: { value: number };
}

function createSoftShadowDiscTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  g.addColorStop(0, 'rgba(4, 8, 9, 0.45)');
  g.addColorStop(0.55, 'rgba(4, 8, 9, 0.20)');
  g.addColorStop(1, 'rgba(4, 8, 9, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

/**
 * Fetches GLB binary from candidate local paths without triggering console errors on SPA HTML fallbacks.
 */
async function fetchKoiGlbBuffer(): Promise<ArrayBuffer> {
  const candidates = ['/model/koi.glb', '/models/koi.glb'];
  for (const url of candidates) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      if (buf.byteLength < 12) continue;
      const magic = new DataView(buf).getUint32(0, true);
      if (magic === 0x46546c67) {
        return buf;
      }
    } catch {
      // Try next candidate
    }
  }
  throw new Error('Unable to locate valid koi.glb asset');
}

/**
 * Fits a smooth 4-coefficient cubic polynomial x(zn) = a0 + a1*zn + a2*zn^2 + a3*zn^3 via IRLS
 * (Gaussian kernel-density / Huber reweighting) over normalized slice coordinates zn in [-1, 1].
 */
function fitCubicIRLS(samples: Array<{ zn: number; x: number; w: number }>): [number, number, number, number] | null {
  if (samples.length < 6) return null;
  let coef: [number, number, number, number] = [0, 0, 0, 0];
  const weights = samples.map((s) => s.w);

  for (let iter = 0; iter < 6; iter++) {
    // Build 4x4 normal equations A^T W A c = A^T W y
    const mat = [
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ];
    for (let i = 0; i < samples.length; i++) {
      const { zn, x } = samples[i];
      const w = weights[i];
      const basis = [1, zn, zn * zn, zn * zn * zn];
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          mat[r][c] += w * basis[r] * basis[c];
        }
        mat[r][4] += w * basis[r] * x;
      }
    }
    // Slight ridge regularization for conditioning
    for (let r = 0; r < 4; r++) mat[r][r] += 1e-6;

    // Gaussian elimination with partial pivoting
    for (let col = 0; col < 4; col++) {
      let pivotRow = col;
      for (let r = col + 1; r < 4; r++) {
        if (Math.abs(mat[r][col]) > Math.abs(mat[pivotRow][col])) pivotRow = r;
      }
      if (pivotRow !== col) {
        const tmp = mat[col];
        mat[col] = mat[pivotRow];
        mat[pivotRow] = tmp;
      }
      const diag = mat[col][col];
      if (Math.abs(diag) < 1e-10) return null;
      for (let c = col; c < 5; c++) mat[col][c] /= diag;
      for (let r = 0; r < 4; r++) {
        if (r === col) continue;
        const factor = mat[r][col];
        for (let c = col; c < 5; c++) {
          mat[r][c] -= factor * mat[col][c];
        }
      }
    }
    coef = [mat[0][4], mat[1][4], mat[2][4], mat[3][4]];

    // Reweight residuals robustly (Huber / Tukey-style falloff) so pectoral fin outliers don't pull the spine
    for (let i = 0; i < samples.length; i++) {
      const { zn, x, w } = samples[i];
      const pred = coef[0] + coef[1] * zn + coef[2] * zn * zn + coef[3] * zn * zn * zn;
      const err = Math.abs(x - pred);
      const huber = err <= 0.06 ? 1 : 0.06 / Math.max(0.06, err);
      weights[i] = w * huber;
    }
  }
  return coef;
}

/**
 * Un-bends a frozen C-curved koi BufferGeometry in the XZ plane onto a straight +Z spine
 * (snout +Z, tail -Z, dorsal +Y preserved), allocating fresh Float32BufferAttributes so
 * KHR_mesh_quantization Int16/Int8 buffers are never mutated in-place.
 */
function straightenKoiGeometry(geometry: THREE.BufferGeometry): void {
  const posAttr = geometry.attributes.position as THREE.BufferAttribute | undefined;
  if (!posAttr || posAttr.count < 16) return;
  const normAttr = geometry.attributes.normal as THREE.BufferAttribute | undefined;

  const count = posAttr.count;
  const px = new Float32Array(count);
  const py = new Float32Array(count);
  const pz = new Float32Array(count);
  const nxArr = normAttr ? new Float32Array(count) : null;
  const nyArr = normAttr ? new Float32Array(count) : null;
  const nzArr = normAttr ? new Float32Array(count) : null;

  const tmp = new THREE.Vector3();
  const tmpN = new THREE.Vector3();
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;

  for (let i = 0; i < count; i++) {
    tmp.fromBufferAttribute(posAttr, i);
    px[i] = tmp.x;
    py[i] = tmp.y;
    pz[i] = tmp.z;
    if (tmp.z < minZ) minZ = tmp.z;
    if (tmp.z > maxZ) maxZ = tmp.z;
    if (tmp.x < minX) minX = tmp.x;
    if (tmp.x > maxX) maxX = tmp.x;
    if (normAttr && nxArr && nyArr && nzArr) {
      tmpN.fromBufferAttribute(normAttr, i);
      nxArr[i] = tmpN.x;
      nyArr[i] = tmpN.y;
      nzArr[i] = tmpN.z;
    }
  }

  const spanZ = maxZ - minZ;
  if (spanZ < 1e-4) return;
  const midZ = (minZ + maxZ) * 0.5;
  const halfSpanZ = spanZ * 0.5;

  // Verify which end of Z is thicker (head/shoulder ~25% from snout vs narrow caudal peduncle ~78%)
  const checkThickness = (fromPosZ: boolean): number => {
    let headSum = 0;
    let headN = 0;
    let tailSum = 0;
    let tailN = 0;
    for (let i = 0; i < count; i++) {
      const t = fromPosZ ? (maxZ - pz[i]) / spanZ : (pz[i] - minZ) / spanZ;
      const rSq = px[i] * px[i] + py[i] * py[i];
      if (t >= 0.18 && t <= 0.32) {
        headSum += rSq;
        headN++;
      } else if (t >= 0.72 && t <= 0.84) {
        tailSum += rSq;
        tailN++;
      }
    }
    return (headN > 0 ? headSum / headN : 0) / Math.max(1e-8, tailN > 0 ? tailSum / tailN : 1e-6);
  };
  const snoutAtPosZ = checkThickness(true) >= checkThickness(false);

  // Bin vertices into 18 cross-sections along Z and find core kernel-density X mode to ignore lateral pectoral fins
  const numBins = 18;
  const bw = spanZ * 0.0425;
  const bwSq2 = 2 * bw * bw;
  const sliceSamples: Array<{ zn: number; x: number; w: number }> = [];

  for (let b = 0; b < numBins; b++) {
    const zLo = minZ + (b / numBins) * spanZ;
    const zHi = minZ + ((b + 1) / numBins) * spanZ;
    const binIndices: number[] = [];
    for (let i = 0; i < count; i++) {
      if (pz[i] >= zLo && pz[i] <= zHi) binIndices.push(i);
    }
    if (binIndices.length < 12) continue;

    // Evaluate Gaussian kernel density along candidate X positions inside the slice
    let bestX = 0;
    let bestScore = -1;
    const step = Math.max(1, Math.floor(binIndices.length / 40));
    for (let ci = 0; ci < binIndices.length; ci += step) {
      const candX = px[binIndices[ci]];
      let score = 0;
      for (let si = 0; si < binIndices.length; si += step) {
        const dx = px[binIndices[si]] - candX;
        score += Math.exp(-(dx * dx) / bwSq2);
      }
      if (score > bestScore) {
        bestScore = score;
        bestX = candX;
      }
    }

    // Weighted core centroid within ~1.4*bw of the density peak
    let sumX = 0;
    let sumZ = 0;
    let sumW = 0;
    for (let k = 0; k < binIndices.length; k++) {
      const idx = binIndices[k];
      const dx = px[idx] - bestX;
      const w = Math.exp(-(dx * dx) / bwSq2);
      if (w > 0.15) {
        sumX += px[idx] * w;
        sumZ += pz[idx] * w;
        sumW += w;
      }
    }
    if (sumW > 1) {
      sliceSamples.push({
        zn: (sumZ / sumW - midZ) / halfSpanZ,
        x: sumX / sumW,
        w: Math.sqrt(sumW),
      });
    }
  }

  const coef = fitCubicIRLS(sliceSamples);
  if (!coef) return;

  // Verify the curve actually has curvature worth straightening (avoid distorting already-straight models)
  const curveSpanX = Math.abs(
    coef[0] + coef[2] - (coef[0] - coef[1] + coef[2] - coef[3]) * 0.5 - (coef[0] + coef[1] + coef[2] + coef[3]) * 0.5,
  );
  if (curveSpanX < spanZ * 0.03 && Math.abs(coef[2]) < spanZ * 0.03) return;

  // Sample 80 ordered centerline points C(u) from u=0 (snout) -> u=1 (tail)
  const N = 80;
  const cx = new Float64Array(N);
  const cz = new Float64Array(N);
  const arcS = new Float64Array(N);

  for (let k = 0; k < N; k++) {
    const u = k / (N - 1);
    const zVal = snoutAtPosZ ? maxZ - u * spanZ : minZ + u * spanZ;
    const zn = (zVal - midZ) / halfSpanZ;
    cx[k] = coef[0] + coef[1] * zn + coef[2] * zn * zn + coef[3] * zn * zn * zn;
    cz[k] = zVal;
    if (k > 0) {
      arcS[k] = arcS[k - 1] + Math.hypot(cx[k] - cx[k - 1], cz[k] - cz[k - 1]);
    }
  }

  const totalArc = arcS[N - 1];
  if (totalArc < 1e-4) return;
  const halfArc = totalArc * 0.5;

  // Precompute smooth unit tangents T pointing tail -> snout (+Z after straightening) at every sample
  const tx = new Float64Array(N);
  const tz = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    const kPrev = Math.max(0, k - 1);
    const kNext = Math.min(N - 1, k + 1);
    // C goes snout(0)->tail(N-1), so kPrev - kNext points tail->snout
    const dx = cx[kPrev] - cx[kNext];
    const dz = cz[kPrev] - cz[kNext];
    const len = Math.hypot(dx, dz) || 1;
    tx[k] = dx / len;
    tz[k] = dz / len;
  }

  const newPos = new Float32Array(count * 3);
  const newNorm = normAttr ? new Float32Array(count * 3) : null;

  for (let i = 0; i < count; i++) {
    const vx = px[i];
    const vy = py[i];
    const vz = pz[i];

    // Exact nearest point projection across all 79 centerline segments [k, k+1]
    let bestDistSq = Infinity;
    let bestK = 0;
    let bestSegT = 0;
    let bestNearX = cx[0];
    let bestNearZ = cz[0];

    for (let k = 0; k < N - 1; k++) {
      const ax = cx[k];
      const az = cz[k];
      const abx = cx[k + 1] - ax;
      const abz = cz[k + 1] - az;
      const abLenSq = abx * abx + abz * abz;
      const segT = abLenSq > 1e-12
        ? Math.max(0, Math.min(1, ((vx - ax) * abx + (vz - az) * abz) / abLenSq))
        : 0;
      const nearX = ax + abx * segT;
      const nearZ = az + abz * segT;
      const dx = vx - nearX;
      const dz = vz - nearZ;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestK = k;
        bestSegT = segT;
        bestNearX = nearX;
        bestNearZ = nearZ;
      }
    }

    const sStar = arcS[bestK] + (arcS[bestK + 1] - arcS[bestK]) * bestSegT;
    // Smoothly interpolated tangent T pointing tail -> snout (+Z)
    let tanX = tx[bestK] + (tx[bestK + 1] - tx[bestK]) * bestSegT;
    let tanZ = tz[bestK] + (tz[bestK + 1] - tz[bestK]) * bestSegT;
    const tanLen = Math.hypot(tanX, tanZ) || 1;
    tanX /= tanLen;
    tanZ /= tanLen;

    // Right-handed lateral normal N = (T.z, -T.x) so N x Y = T (det = +1, preserves winding)
    const latNormX = tanZ;
    const latNormZ = -tanX;

    const relX = vx - bestNearX;
    const relZ = vz - bestNearZ;
    const lat = relX * latNormX + relZ * latNormZ;
    // Preserve signed extension past snout (k=0, segT=0) or past tail (k=N-2, segT=1)
    const along =
      (bestK === 0 && bestSegT <= 1e-6) || (bestK === N - 2 && bestSegT >= 1 - 1e-6)
        ? relX * tanX + relZ * tanZ
        : 0;

    newPos[i * 3] = lat;
    newPos[i * 3 + 1] = vy;
    newPos[i * 3 + 2] = halfArc - sStar + along;

    if (newNorm && nxArr && nyArr && nzArr) {
      const nX = nxArr[i];
      const nY = nyArr[i];
      const nZ = nzArr[i];
      const rX = nX * latNormX + nZ * latNormZ;
      const rY = nY;
      const rZ = nX * tanX + nZ * tanZ;
      const rLen = Math.hypot(rX, rY, rZ) || 1;
      newNorm[i * 3] = rX / rLen;
      newNorm[i * 3 + 1] = rY / rLen;
      newNorm[i * 3 + 2] = rZ / rLen;
    }
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(newPos, 3));
  if (newNorm) {
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(newNorm, 3));
  } else {
    geometry.computeVertexNormals();
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

/**
 * Measures raw model bounding box, aligns spine along Z, inspects 25% vs 78% cross-section thickness
 * so snout strictly points +Z, preserves dorsal +Y, centers origin, and normalizes unit length = 1.0.
 */
function buildNormalizedKoiPrototype(rawScene: THREE.Object3D): THREE.Group {
  rawScene.updateMatrixWorld(true);
  const rawBox = new THREE.Box3().setFromObject(rawScene);
  const rawSize = new THREE.Vector3();
  rawBox.getSize(rawSize);

  const alignGroup = new THREE.Group();
  alignGroup.add(rawScene);

  // Align longest axis onto Z
  if (rawSize.x >= rawSize.y && rawSize.x >= rawSize.z) {
    rawScene.rotation.y += Math.PI / 2;
  } else if (rawSize.y >= rawSize.x && rawSize.y >= rawSize.z) {
    rawScene.rotation.x += Math.PI / 2;
  }
  alignGroup.updateMatrixWorld(true);

  const zBox = new THREE.Box3().setFromObject(alignGroup);
  const minZ = zBox.min.z;
  const maxZ = zBox.max.z;
  const spanZ = Math.max(0.0001, maxZ - minZ);
  const centerY = (zBox.min.y + zBox.max.y) * 0.5;
  const centerX = (zBox.min.x + zBox.max.x) * 0.5;

  // Compare cross-sectional thickness at 25% vs 78% from +Z end and from -Z end
  let posHeadAreaSum = 0;
  let posHeadCount = 0;
  let posTailAreaSum = 0;
  let posTailCount = 0;
  let negHeadAreaSum = 0;
  let negHeadCount = 0;
  let negTailAreaSum = 0;
  let negTailCount = 0;

  const v = new THREE.Vector3();
  alignGroup.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !obj.geometry) return;
    const pos = obj.geometry.attributes.position as THREE.BufferAttribute | undefined;
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld);
      const rSq = (v.x - centerX) * (v.x - centerX) + (v.y - centerY) * (v.y - centerY);

      const tFromPosZ = (maxZ - v.z) / spanZ;
      if (tFromPosZ >= 0.18 && tFromPosZ <= 0.32) {
        posHeadAreaSum += rSq;
        posHeadCount++;
      } else if (tFromPosZ >= 0.72 && tFromPosZ <= 0.84) {
        posTailAreaSum += rSq;
        posTailCount++;
      }

      const tFromNegZ = (v.z - minZ) / spanZ;
      if (tFromNegZ >= 0.18 && tFromNegZ <= 0.32) {
        negHeadAreaSum += rSq;
        negHeadCount++;
      } else if (tFromNegZ >= 0.72 && tFromNegZ <= 0.84) {
        negTailAreaSum += rSq;
        negTailCount++;
      }
    }
  });

  const posRatio =
    (posHeadCount > 0 ? posHeadAreaSum / posHeadCount : 0) /
    Math.max(1e-9, posTailCount > 0 ? posTailAreaSum / posTailCount : 1e-6);
  const negRatio =
    (negHeadCount > 0 ? negHeadAreaSum / negHeadCount : 0) /
    Math.max(1e-9, negTailCount > 0 ? negTailAreaSum / negTailCount : 1e-6);

  if (negRatio > posRatio * 1.05) {
    alignGroup.rotation.y += Math.PI;
  }

  if (MODEL_YAW_OFFSET !== 0) {
    alignGroup.rotation.y += MODEL_YAW_OFFSET;
  }

  alignGroup.updateMatrixWorld(true);
  const finalBox = new THREE.Box3().setFromObject(alignGroup);
  const finalCenter = new THREE.Vector3();
  const finalSize = new THREE.Vector3();
  finalBox.getCenter(finalCenter);
  finalBox.getSize(finalSize);

  const unitScale = 1 / Math.max(0.0001, finalSize.z);
  const proto = new THREE.Group();
  proto.name = 'koi-normalized-prototype';
  alignGroup.position.sub(finalCenter);
  proto.add(alignGroup);
  proto.scale.setScalar(unitScale);
  proto.updateMatrixWorld(true);

  return proto;
}

function attachKoiVarietyAndSwimShader(
  mat: THREE.MeshStandardMaterial,
  variety: KoiVarietyId,
  waterY: number,
  meshToProto: THREE.Matrix4,
  protoToMesh: THREE.Matrix4,
  timeUniform: { value: number },
  freqUniform: { value: number },
  bendUniform: { value: number },
  phase: number,
  useVertexSwim: boolean,
) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uMeshToProto = { value: meshToProto };
    shader.uniforms.uProtoToMesh = { value: protoToMesh };
    shader.uniforms.uSwimTime = timeUniform;
    shader.uniforms.uSwimFreq = freqUniform;
    shader.uniforms.uTurnBend = bendUniform;
    shader.uniforms.uPhase = { value: phase };
    shader.uniforms.uWaterY = { value: waterY };
    shader.uniforms.uVariety = { value: variety };
    shader.uniforms.uUseVertexSwim = { value: useVertexSwim ? 1.0 : 0.0 };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform mat4 uMeshToProto;
        uniform mat4 uProtoToMesh;
        uniform float uSwimTime;
        uniform float uSwimFreq;
        uniform float uTurnBend;
        uniform float uPhase;
        uniform float uUseVertexSwim;
        varying vec3 vKoiWorldPos;
        varying vec3 vKoiWorldNormal;
        varying vec3 vKoiLocalPos;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec3 kProtoPos = (uMeshToProto * vec4(transformed, 1.0)).xyz;
        vKoiLocalPos = kProtoPos;
        if (uUseVertexSwim > 0.5) {
          // Normalized spine coordinate s: snout (+0.5 Z) -> 0.0, caudal tail (-0.5 Z) -> 1.0
          float spineS = clamp(0.5 - kProtoPos.z, 0.0, 1.0);
          float sCurve = pow(spineS, 1.65);
          float phaseArg = uSwimTime * uSwimFreq + uPhase - spineS * 4.85;
          float lateralWave = sin(phaseArg) * (0.01 + 0.095 * sCurve);
          float turnArc = uTurnBend * pow(spineS, 1.5);
          kProtoPos.x += lateralWave + turnArc;
          transformed = (uProtoToMesh * vec4(kProtoPos, 1.0)).xyz;
        }`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vKoiWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vKoiWorldNormal = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uWaterY;
        uniform float uVariety;
        uniform float uSwimTime;
        varying vec3 vKoiWorldPos;
        varying vec3 vKoiWorldNormal;
        varying vec3 vKoiLocalPos;

        float koiHash3(vec3 p) {
          return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
        }

        float koiNoise3(vec3 p) {
          vec3 i = floor(p);
          vec3 f = fract(p);
          vec3 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(
              mix(koiHash3(i + vec3(0,0,0)), koiHash3(i + vec3(1,0,0)), u.x),
              mix(koiHash3(i + vec3(0,1,0)), koiHash3(i + vec3(1,1,0)), u.x),
              u.y
            ),
            mix(
              mix(koiHash3(i + vec3(0,0,1)), koiHash3(i + vec3(1,0,1)), u.x),
              mix(koiHash3(i + vec3(0,1,1)), koiHash3(i + vec3(1,1,1)), u.x),
              u.y
            ),
            u.z
          );
        }

        float koiFbm(vec3 p) {
          return koiNoise3(p) * 0.62 + koiNoise3(p * 2.1 + 3.7) * 0.38;
        }

        vec2 koiCausticHash2(vec2 p) {
          p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
          return fract(sin(p) * 43758.5453123);
        }

        float koiVoronoiEdge(vec2 x, float t) {
          vec2 n = floor(x);
          vec2 f = fract(x);
          float d1 = 8.0;
          float d2 = 8.0;
          for (int j = -1; j <= 1; j++) {
            for (int i = -1; i <= 1; i++) {
              vec2 g = vec2(float(i), float(j));
              vec2 o = koiCausticHash2(n + g);
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

        float koiCausticArcs(vec2 p, float t) {
          vec2 warp = vec2(
            sin(p.y * 1.6 + t * 0.42) + cos(p.x * 1.1 - t * 0.35) * 0.5,
            cos(p.x * 1.5 - t * 0.38) + sin(p.y * 1.2 + t * 0.31) * 0.5
          ) * 0.24;
          float f1 = koiVoronoiEdge((p + warp) * 1.55, t * 0.72);
          float f2 = koiVoronoiEdge((mat2(0.8, -0.6, 0.6, 0.8) * (p - warp * 0.8)) * 1.95 + vec2(3.7, -2.1), -t * 0.58 + 1.9);
          float break1 = smoothstep(0.08, 0.68, sin(p.x * 1.85 - p.y * 1.35 + t * 0.28 + sin(p.y * 2.1) * 0.7));
          float break2 = smoothstep(0.08, 0.68, cos(p.x * 1.55 + p.y * 1.75 - t * 0.24 + cos(p.x * 1.9) * 0.7));
          float sunPocket = smoothstep(-0.12, 0.52, sin(p.x * 0.85 + t * 0.14) * cos(p.y * 0.95 - t * 0.12));
          return clamp(f1 * break1 + f2 * break2 * 0.78, 0.0, 1.0) * (0.30 + 0.70 * sunPocket);
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float kLuma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        // Protect dark eye pupils (luma < 0.16), deep gill slits, and fin-ray crevices
        float protectDark = smoothstep(0.11, 0.21, kLuma);
        float spotMask = smoothstep(0.12, 0.32, diffuseColor.r - diffuseColor.b)
                       * smoothstep(0.05, 0.22, diffuseColor.r - diffuseColor.g);
        float scaleTone = clamp(kLuma / 0.76, 0.28, 1.12);
        vec3 pearlWhite = mix(vec3(0.95, 0.94, 0.91) * scaleTone, diffuseColor.rgb, 0.24);
        vec3 recolored = diffuseColor.rgb;

        if (uVariety < 0.5) {
          // 0: Kohaku (pearl white + vivid vermilion orange)
          vec3 kohakuHi = vec3(0.94, 0.22, 0.05) * (0.68 + 0.40 * scaleTone);
          recolored = mix(pearlWhite, kohakuHi, spotMask);
        } else if (uVariety < 1.5) {
          // 1: Deep Crimson Kohaku (scarlet beni spots on pearl white)
          vec3 crimsonHi = vec3(0.76, 0.075, 0.05) * (0.72 + 0.38 * scaleTone);
          recolored = mix(pearlWhite, crimsonHi, spotMask);
        } else if (uVariety < 2.5) {
          // 2: Shiro Utsuri (deep velvety sumi ink-black on pearl white)
          float extraSumi = smoothstep(0.58, 0.68, koiFbm(vKoiLocalPos * vec3(4.0, 3.6, 3.4) + vec3(2.3, 1.1, 4.7)))
                          * smoothstep(-0.36, 0.38, vKoiLocalPos.z);
          float sumiMask = max(spotMask, extraSumi * 0.92);
          vec3 sumiInk = vec3(0.065, 0.068, 0.075) * (0.65 + 0.35 * scaleTone);
          recolored = mix(pearlWhite, sumiInk, sumiMask);
        } else if (uVariety < 3.5) {
          // 3: Showa (3D object-space noise splitting spots between sumi ink & crimson-red on white)
          float splitNoise = koiFbm(vKoiLocalPos * vec3(4.2, 3.8, 3.6) + vec3(1.7, 0.4, 2.9));
          float showaFlip = smoothstep(0.42, 0.56, splitNoise);
          float flankSumi = smoothstep(0.61, 0.71, koiFbm(vKoiLocalPos * vec3(3.6, 3.4, 3.1) + vec3(5.8, 2.1, 0.9)))
                          * smoothstep(-0.32, 0.34, vKoiLocalPos.z);
          vec3 showaCrimson = vec3(0.84, 0.13, 0.06) * (0.72 + 0.36 * scaleTone);
          vec3 showaSumi = vec3(0.06, 0.064, 0.072) * (0.65 + 0.35 * scaleTone);
          vec3 spotCol = mix(showaCrimson, showaSumi, showaFlip);
          recolored = mix(pearlWhite, spotCol, spotMask);
          recolored = mix(recolored, showaSumi, flankSumi * (1.0 - spotMask * 0.65));
        } else if (uVariety < 4.5) {
          // 4: Yamabuki Ogon (warm metallic gold body wash with burnished amber-gold spot shading)
          vec3 goldWash = vec3(0.98, 0.76, 0.18) * (0.68 + 0.42 * scaleTone);
          vec3 amberShade = vec3(0.86, 0.50, 0.09) * (0.68 + 0.40 * scaleTone);
          recolored = mix(goldWash, amberShade, spotMask * 0.46);
        } else {
          // 5: Platinum Ogon (desaturated luminous silver-pearl white)
          recolored = vec3(0.95, 0.96, 0.98) * (0.76 + 0.28 * scaleTone);
        }

        diffuseColor.rgb = mix(diffuseColor.rgb, recolored, protectDark);`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        float koiDepth = max(0.0, uWaterY - vKoiWorldPos.y);
        vec3 koiBeer = exp(-koiDepth * vec3(0.88, 0.48, 0.42));
        reflectedLight.directDiffuse *= koiBeer;
        reflectedLight.indirectDiffuse *= mix(vec3(1.0), koiBeer, 0.82);

        float koiArcs = koiCausticArcs(vKoiWorldPos.xz, uSwimTime * 0.82);
        float koiDorsal = smoothstep(0.0, 0.65, vKoiWorldNormal.y);
        reflectedLight.directDiffuse += vec3(0.88, 0.95, 0.89) * (koiArcs * 0.145 * koiDorsal);`,
      );
  };
  mat.customProgramCacheKey = () =>
    `koi-glb-variety-${variety}-swim-${useVertexSwim ? '1' : '0'}-voronoi-v2`;
}

export function createKoiSchool(
  waterY: number,
  _bedY: number,
  maxAnisotropy: number,
): KoiSchoolRig {
  const disposables: Array<{ dispose: () => void }> = [];
  const group = new THREE.Group();
  group.name = 'pond-koi-school-group';

  const shadowDiscTex = createSoftShadowDiscTexture();
  const shadowDiscGeo = new THREE.PlaneGeometry(1, 1);
  shadowDiscGeo.rotateX(-Math.PI / 2);
  const shadowDiscMat = new THREE.MeshBasicMaterial({
    map: shadowDiscTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.65,
  });
  disposables.push(shadowDiscTex, shadowDiscGeo, shadowDiscMat);

  // 6 authentic koi varieties patrolling strictly inside visible open-water corridors with staggered non-crowding loops
  const koiSpecs: KoiSpec[] = [
    {
      variety: 0, // Kohaku (lower-center right loop)
      scaleVar: 1.0,
      length: 0.56,
      depthOffset: 0.105,
      baseSpeed: 0.22,
      initX: -0.32,
      initZ: 0.96,
      initYaw: 1.48,
      phase: 0.0,
      waypoints: [
        { x: -0.45, z: 0.92 },
        { x: 0.55, z: 0.98 },
        { x: 1.02, z: 1.12 },
        { x: 0.25, z: 1.28 },
        { x: -0.78, z: 1.16 },
      ],
    },
    {
      variety: 4, // Yamabuki Ogon (spacious lower-left & bottom-center open channel clear of lotus pads)
      scaleVar: 0.93,
      length: 0.52,
      depthOffset: 0.135,
      baseSpeed: 0.20,
      initX: -0.96,
      initZ: 1.06,
      initYaw: 1.95,
      phase: 1.35,
      waypoints: [
        { x: -1.24, z: 1.18 },
        { x: -1.86, z: 1.24 },
        { x: -0.68, z: 1.28 },
        { x: 0.18, z: 1.12 },
        { x: -0.58, z: 0.96 },
      ],
    },
    {
      variety: 3, // Showa (upper-right & center-top lane)
      scaleVar: 1.08,
      length: 0.59,
      depthOffset: 0.095,
      baseSpeed: 0.23,
      initX: 0.42,
      initZ: -0.95,
      initYaw: -1.58,
      phase: 2.6,
      waypoints: [
        { x: 0.86, z: -0.92 },
        { x: 0.05, z: -1.04 },
        { x: -0.88, z: -0.94 },
        { x: -0.35, z: -1.26 },
        { x: 0.72, z: -1.20 },
      ],
    },
    {
      variety: 1, // Deep Crimson Kohaku (lower-right open water & upper-right channel clear of card lily pad & boulders)
      scaleVar: 0.96,
      length: 0.54,
      depthOffset: 0.125,
      baseSpeed: 0.21,
      initX: 0.96,
      initZ: 1.04,
      initYaw: 1.35,
      phase: 3.9,
      waypoints: [
        { x: 1.48, z: 1.22 },
        { x: 0.45, z: 1.26 },
        { x: 0.14, z: 0.96 },
        { x: 0.96, z: 0.98 },
        { x: 1.16, z: 1.18 },
      ],
    },
    {
      variety: 2, // Shiro Utsuri (lower-left & wide clockwise sweep)
      scaleVar: 1.04,
      length: 0.57,
      depthOffset: 0.115,
      baseSpeed: 0.20,
      initX: 0.86,
      initZ: 1.02,
      initYaw: -1.78,
      phase: 5.05,
      waypoints: [
        { x: -0.12, z: 0.94 },
        { x: -1.16, z: 0.88 },
        { x: -1.24, z: -0.78 },
        { x: 0.15, z: -0.90 },
        { x: 1.02, z: 0.16 },
      ],
    },
    {
      variety: 5, // Platinum Ogon (upper-left & north bank patrol)
      scaleVar: 0.88,
      length: 0.50,
      depthOffset: 0.145,
      baseSpeed: 0.21,
      initX: -1.08,
      initZ: -0.90,
      initYaw: 1.38,
      phase: 4.35,
      waypoints: [
        { x: -0.45, z: -0.88 },
        { x: 0.52, z: -0.96 },
        { x: 0.98, z: -0.14 },
        { x: 0.58, z: 0.94 },
        { x: -0.82, z: 0.96 },
      ],
    },
  ];

  const agents: KoiAgent[] = [];
  let disposed = false;

  // Load real Meshopt-compressed GLB model asynchronously
  (async () => {
    try {
      await MeshoptDecoder.ready;
      if (disposed) return;

      const buffer = await fetchKoiGlbBuffer();
      if (disposed) return;

      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.parseAsync(buffer, '/model/');
      if (disposed) return;

      // Option 3: Un-bend frozen C-curve koi geometry once at load time before cloning & normalizing
      gltf.scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.geometry) {
          straightenKoiGeometry(obj.geometry);
        }
      });

      const prototype = buildNormalizedKoiPrototype(gltf.scene);
      const hasAnimations = gltf.animations && gltf.animations.length > 0;

      // Capture prototype mesh -> outer normalized prototype transforms cleanly
      const protoMeshMatrices = new Map<string, THREE.Matrix4>();
      prototype.updateMatrixWorld(true);
      let meshIdx = 0;
      prototype.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.userData.__koiMeshIdx = meshIdx;
          protoMeshMatrices.set(String(meshIdx), obj.matrixWorld.clone());
          meshIdx++;
        }
      });

      koiSpecs.forEach((spec, idx) => {
        const cloned = SkeletonUtils.clone(prototype);
        const root = new THREE.Group();
        root.name = `koi-glb-${idx}`;
        const actualLen = spec.length * spec.scaleVar;
        cloned.scale.multiplyScalar(actualLen);
        root.add(cloned);

        const timeUniform = { value: 0 };
        const freqUniform = { value: 6.4 };
        const bendUniform = { value: 0 };

        let mIdx = 0;
        cloned.traverse((obj) => {
          if (!(obj instanceof THREE.Mesh)) return;
          obj.castShadow = true;
          obj.receiveShadow = true;

          const lookupKey = String(
            typeof obj.userData.__koiMeshIdx === 'number' ? obj.userData.__koiMeshIdx : mIdx,
          );
          mIdx++;
          const meshToProto = protoMeshMatrices.get(lookupKey) ?? new THREE.Matrix4();
          const protoToMesh = meshToProto.clone().invert();

          const origMat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
          let mat: THREE.MeshStandardMaterial;

          if (origMat instanceof THREE.MeshStandardMaterial) {
            mat = origMat.clone();
          } else {
            mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
          }

          if (mat.map) {
            mat.map.colorSpace = THREE.SRGBColorSpace;
            mat.map.anisotropy = maxAnisotropy;
            mat.map.needsUpdate = true;
          }

          mat.roughness = spec.variety === 4 ? 0.22 : spec.variety === 5 ? 0.20 : 0.25;
          mat.metalness = spec.variety === 4 ? 0.34 : spec.variety === 5 ? 0.22 : 0.06;
          mat.envMapIntensity = 0.42;

          attachKoiVarietyAndSwimShader(
            mat,
            spec.variety,
            waterY,
            meshToProto,
            protoToMesh,
            timeUniform,
            freqUniform,
            bendUniform,
            spec.phase,
            !hasAnimations,
          );

          obj.material = mat;
          disposables.push(mat);
          if (obj.geometry) {
            disposables.push(obj.geometry);
          }
        });

        let mixer: THREE.AnimationMixer | null = null;
        let action: THREE.AnimationAction | null = null;
        if (hasAnimations) {
          mixer = new THREE.AnimationMixer(cloned);
          action = mixer.clipAction(gltf.animations[0]);
          action.time = (spec.phase / (Math.PI * 2)) * gltf.animations[0].duration;
          action.play();
        }

        root.position.set(spec.initX, waterY - spec.depthOffset, spec.initZ);
        root.rotation.y = spec.initYaw;
        group.add(root);

        const shadowDisc = new THREE.Mesh(shadowDiscGeo, shadowDiscMat);
        shadowDisc.scale.set(actualLen * 0.46, 1, actualLen * 1.15);
        shadowDisc.position.set(spec.initX, waterY - 0.56, spec.initZ);
        shadowDisc.rotation.y = spec.initYaw;
        group.add(shadowDisc);

        agents.push({
          spec,
          root,
          shadowDisc,
          mixer,
          action,
          x: spec.initX,
          z: spec.initZ,
          vx: Math.sin(spec.initYaw) * spec.baseSpeed,
          vz: Math.cos(spec.initYaw) * spec.baseSpeed,
          yaw: spec.initYaw,
          speed: spec.baseSpeed,
          burst: 0,
          turnBend: 0,
          wanderPhase: idx * 1.4,
          waypointIndex: 0,
          timeUniform,
          freqUniform,
          bendUniform,
        });
      });

      // Dispose uncloned original textures/geometries when cleanup runs
      prototype.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          if (obj.geometry) disposables.push(obj.geometry);
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => {
            if (m) {
              if (m instanceof THREE.MeshStandardMaterial && m.map) {
                disposables.push(m.map);
              }
              disposables.push(m);
            }
          });
        }
      });
    } catch {
      // Fail gracefully without crashing scene if GLB is temporarily unavailable
    }
  })();

  const wrapAngle = (a: number) => {
    let r = a;
    while (r > Math.PI) r -= Math.PI * 2;
    while (r < -Math.PI) r += Math.PI * 2;
    return r;
  };

  const marginX = 2.34;
  const marginZ = 1.50;

  return {
    group,
    update: (dtSec, elapsedSec, waterSim, _renderer, bookOpenProgress = 0) => {
      if (agents.length === 0) return;
      const dt = Math.min(0.045, Math.max(0.001, dtSec));
      const impulses = waterSim.getRecentImpulses();
      const checkBookOverhang = bookOpenProgress > 0.08;

      for (let i = 0; i < agents.length; i++) {
        const koi = agents[i];
        const wp = koi.spec.waypoints[koi.waypointIndex];

        const toWpX = wp.x - koi.x;
        const toWpZ = wp.z - koi.z;
        const wpDist = Math.hypot(toWpX, toWpZ);
        if (wpDist < 0.42) {
          koi.waypointIndex = (koi.waypointIndex + 1) % koi.spec.waypoints.length;
        }

        const dirX = wpDist > 0.001 ? toWpX / wpDist : Math.sin(koi.yaw);
        const dirZ = wpDist > 0.001 ? toWpZ / wpDist : Math.cos(koi.yaw);

        const swayAngle = Math.sin(elapsedSec * 0.44 + koi.wanderPhase) * 0.2;
        const cosS = Math.cos(swayAngle);
        const sinS = Math.sin(swayAngle);
        let steerX = dirX * cosS - dirZ * sinS;
        let steerZ = dirX * sinS + dirZ * cosS;

        // Smooth obstacle avoidance (plank + open book overhang + boulders + lantern rock + lily pads)
        const sep = nearestObstacleSeparation(koi.x, koi.z, 0.24, checkBookOverhang, true);
        if (sep.dist < 0.42) {
          const push = (0.42 - sep.dist) / 0.42;
          const strength = sep.dist < 0 ? 5.6 + push * 4.5 : push * 3.1;
          steerX += sep.nx * strength;
          steerZ += sep.nz * strength;
        }

        // Keep koi strictly inside visible pond water corridors
        if (Math.abs(koi.x) > marginX) {
          steerX -= Math.sign(koi.x) * (Math.abs(koi.x) - marginX) * 4.8;
        }
        if (Math.abs(koi.z) > marginZ) {
          steerZ -= Math.sign(koi.z) * (Math.abs(koi.z) - marginZ) * 4.8;
        }

        // Gentle curiosity/startle reaction to recent water ripples
        let rippleTargetSpeed = koi.spec.baseSpeed;
        for (let r = 0; r < impulses.length; r++) {
          const imp = impulses[r];
          const age = elapsedSec - imp.startTime;
          if (age < 0 || age > 1.8) continue;
          const dx = koi.x - imp.x;
          const dz = koi.z - imp.z;
          const d = Math.hypot(dx, dz);
          if (d < 0.75 && d > 0.01) {
            const awayWeight = (1 - d / 0.75) * Math.exp(-age * 1.8);
            steerX += (dx / d) * awayWeight * 1.4;
            steerZ += (dz / d) * awayWeight * 1.4;
            koi.burst = Math.max(koi.burst, awayWeight * 0.45);
          }
        }

        // Strong pairwise koi separation + tangential swirl deflection so koi glide cleanly past each other
        for (let j = 0; j < agents.length; j++) {
          if (i === j) continue;
          const other = agents[j];
          const dx = koi.x - other.x;
          const dz = koi.z - other.z;
          const d = Math.hypot(dx, dz);
          const safeDist = (koi.spec.length + other.spec.length) * 0.74 + 0.26;
          if (d < safeDist && d > 0.001) {
            const nx = dx / d;
            const nz = dz / d;
            const rep = Math.pow((safeDist - d) / safeDist, 1.25) * 6.2;
            const sideSign = i < j ? 1 : -1;
            steerX += nx * rep - nz * rep * 0.45 * sideSign;
            steerZ += nz * rep + nx * rep * 0.45 * sideSign;
          }
        }

        const desiredYaw = Math.atan2(steerX, steerZ);
        const yawDiff = wrapAngle(desiredYaw - koi.yaw);
        const maxTurnRate = 2.15 * dt;
        const dYaw = THREE.MathUtils.clamp(yawDiff, -maxTurnRate, maxTurnRate);
        koi.yaw = wrapAngle(koi.yaw + dYaw);

        const targetBend = THREE.MathUtils.clamp(-yawDiff * 0.24, -0.14, 0.14);
        koi.turnBend += (targetBend - koi.turnBend) * Math.min(1, dt * 6.5);

        koi.burst = Math.max(0, koi.burst - dt * 0.65);
        rippleTargetSpeed += koi.burst * 0.16;
        koi.speed += (rippleTargetSpeed - koi.speed) * Math.min(1, dt * 3.2);

        koi.vx = Math.sin(koi.yaw) * koi.speed;
        koi.vz = Math.cos(koi.yaw) * koi.speed;
        koi.x += koi.vx * dt;
        koi.z += koi.vz * dt;
      }

      // Alternating pairwise + obstacle collision resolution (3 iterations) so koi NEVER overlap each other or clip obstacles
      for (let iter = 0; iter < 3; iter++) {
        for (let i = 0; i < agents.length; i++) {
          for (let j = i + 1; j < agents.length; j++) {
            const a = agents[i];
            const b = agents[j];
            const dx = b.x - a.x;
            const dz = b.z - a.z;
            const dist = Math.hypot(dx, dz);
            const minCenterDist = (a.spec.length + b.spec.length) * 0.62 + 0.24;
            if (dist < minCenterDist) {
              const nx = dist > 0.0005 ? dx / dist : Math.cos(i * 1.3);
              const nz = dist > 0.0005 ? dz / dist : Math.sin(i * 1.3);
              const overlap = (minCenterDist - dist) * 0.52;
              a.x -= nx * overlap;
              a.z -= nz * overlap;
              b.x += nx * overlap;
              b.z += nz * overlap;
              if (iter === 0) {
                const yawA = Math.atan2(-nx, -nz);
                const yawB = Math.atan2(nx, nz);
                a.yaw = wrapAngle(a.yaw + wrapAngle(yawA - a.yaw) * 0.16);
                b.yaw = wrapAngle(b.yaw + wrapAngle(yawB - b.yaw) * 0.16);
              }
            }
          }
        }

        for (let i = 0; i < agents.length; i++) {
          const koi = agents[i];
          const postObs = nearestObstacleSeparation(koi.x, koi.z, 0.21, checkBookOverhang, true);
          if (postObs.dist < 0) {
            koi.x += postObs.nx * (-postObs.dist + 0.015);
            koi.z += postObs.nz * (-postObs.dist + 0.015);
            if (iter === 0) {
              const pushYaw = Math.atan2(postObs.nx, postObs.nz);
              koi.yaw = wrapAngle(koi.yaw + wrapAngle(pushYaw - koi.yaw) * 0.28);
            }
          }
        }
      }

      // Sync final world transforms, vertex swim uniforms / animation mixers, and bed shadows
      for (let i = 0; i < agents.length; i++) {
        const koi = agents[i];
        const depthY =
          waterY - koi.spec.depthOffset + Math.sin(elapsedSec * 0.72 + koi.spec.phase) * 0.007;

        koi.root.position.set(koi.x, depthY, koi.z);
        koi.root.rotation.y = koi.yaw;
        koi.root.rotation.z = THREE.MathUtils.clamp(-koi.turnBend * 0.7, -0.1, 0.1);

        koi.timeUniform.value = elapsedSec;
        koi.freqUniform.value = 5.4 + koi.speed * 10.0;
        koi.bendUniform.value = koi.turnBend;

        if (koi.mixer && koi.action) {
          koi.action.timeScale = 0.7 + (koi.speed / 0.24) * 0.55;
          koi.mixer.update(dt);
        }

        koi.shadowDisc.position.set(koi.x + 0.035, waterY - 0.54, koi.z + 0.035);
        koi.shadowDisc.rotation.y = koi.yaw;
      }
    },
    dispose: () => {
      disposed = true;
      for (const a of agents) {
        if (a.mixer) a.mixer.stopAllAction();
      }
      disposables.forEach((d) => d.dispose());
    },
  };
}
