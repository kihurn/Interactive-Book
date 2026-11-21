import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { nearestObstacleSeparation, POND_BOUNDS, POND_LAYOUT } from './constants';
import { POND_CAUSTICS_GLSL } from './causticsShader';
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
 * 4: Ki Utsuri (warm golden-amber body with bold velvety sumi ink-black patches)
 * 5: Yamabuki Hariwake (luminous pearl white with vivid saffron-gold patches)
 */
export type KoiVarietyId = 0 | 1 | 2 | 3 | 4 | 5;

export interface KoiWaypoint {
  x: number;
  z: number;
}

export interface KoiSpec {
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

export interface KoiMotionState {
  spec: KoiSpec;
  x: number;
  z: number;
  vx: number;
  vz: number;
  yaw: number;
  speed: number;
  burst: number;
  turnBend: number;
  swimPhase: number;
  wanderPhase: number;
  waypointIndex: number;
  anchorX: number;
  anchorZ: number;
  stuckTimer: number;
  evadeTimer: number;
  evadeYaw: number;
}

export const KOI_PATROL_SPECS: KoiSpec[] = [
  // North Lagoon (3 staggered shallow depth layers: 0.065, 0.125, 0.185)
  {
    variety: 3, // Showa
    scaleVar: 1.02,
    length: 0.44,
    depthOffset: 0.065,
    baseSpeed: 0.145,
    initX: -0.95,
    initZ: -1.14,
    initYaw: 1.35,
    phase: 0.4,
    waypoints: [
      { x: -0.25, z: -1.24 },
      { x: 0.72, z: -1.18 },
      { x: 0.88, z: -1.03 },
      { x: 0.15, z: -1.02 },
      { x: -0.78, z: -1.04 },
      { x: -1.12, z: -1.18 },
    ],
  },
  {
    variety: 2, // Shiro Utsuri
    scaleVar: 0.98,
    length: 0.46,
    depthOffset: 0.125,
    baseSpeed: 0.155,
    initX: 0.72,
    initZ: -1.12,
    initYaw: -1.65,
    phase: 2.1,
    waypoints: [
      { x: -0.1, z: -1.03 },
      { x: -0.98, z: -1.08 },
      { x: -1.24, z: -1.22 },
      { x: -0.52, z: -1.32 },
      { x: 0.45, z: -1.26 },
      { x: 0.88, z: -1.12 },
    ],
  },
  {
    variety: 5, // Yamabuki Hariwake (pearl white + vivid saffron-gold patches)
    scaleVar: 0.95,
    length: 0.42,
    depthOffset: 0.185,
    baseSpeed: 0.14,
    initX: -0.35,
    initZ: -1.28,
    initYaw: 0.95,
    phase: 4.3,
    waypoints: [
      { x: 0.35, z: -1.32 },
      { x: 0.84, z: -1.2 },
      { x: 0.46, z: -1.05 },
      { x: -0.45, z: -1.04 },
      { x: -1.08, z: -1.14 },
      { x: -0.88, z: -1.29 },
    ],
  },
  // South Lagoon (3 staggered shallow depth layers: 0.065, 0.125, 0.185)
  {
    variety: 0, // Kohaku
    scaleVar: 1.04,
    length: 0.48,
    depthOffset: 0.065,
    baseSpeed: 0.15,
    initX: -0.72,
    initZ: 0.94,
    initYaw: 1.48,
    phase: 1.15,
    waypoints: [
      { x: 0.05, z: 0.9 },
      { x: 0.84, z: 0.92 },
      { x: 0.98, z: 1.06 },
      { x: 0.32, z: 1.1 },
      { x: -0.58, z: 1.08 },
      { x: -0.98, z: 0.96 },
    ],
  },
  {
    variety: 1, // Deep Crimson Kohaku
    scaleVar: 0.96,
    length: 0.45,
    depthOffset: 0.125,
    baseSpeed: 0.16,
    initX: 0.68,
    initZ: 1.02,
    initYaw: -1.72,
    phase: 3.25,
    waypoints: [
      { x: -0.15, z: 1.09 },
      { x: -0.92, z: 1.04 },
      { x: -1.0, z: 0.89 },
      { x: -0.28, z: 0.87 },
      { x: 0.56, z: 0.88 },
      { x: 0.94, z: 0.98 },
    ],
  },
  {
    variety: 4, // Ki Utsuri (warm gold + bold sumi ink-black patches)
    scaleVar: 1.0,
    length: 0.43,
    depthOffset: 0.185,
    baseSpeed: 0.145,
    initX: -0.05,
    initZ: 1.06,
    initYaw: 1.22,
    phase: 5.1,
    waypoints: [
      { x: 0.64, z: 1.08 },
      { x: 0.96, z: 0.95 },
      { x: 0.42, z: 0.87 },
      { x: -0.45, z: 0.88 },
      { x: -0.96, z: 0.98 },
      { x: -0.62, z: 1.1 },
    ],
  },
];

interface KoiAgent extends KoiMotionState {
  root: THREE.Group;
  shadowDisc: THREE.Mesh;
  mixer: THREE.AnimationMixer | null;
  action: THREE.AnimationAction | null;
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

function wrapAngleRad(a: number): number {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r < -Math.PI) r += Math.PI * 2;
  return r;
}

/**
 * Fits a single smooth circular arc (x - cx)^2 + (z - cz)^2 = R^2 in the XZ plane via
 * Huber-reweighted IRLS over core body cross-section samples so lateral pectoral fins don't pull the spine.
 */
function fitCircleIRLS(
  samples: Array<{ x: number; z: number; w: number }>,
): { cx: number; cz: number; R: number } | null {
  if (samples.length < 6) return null;
  let weights = samples.map((s) => s.w);
  let cx = 0;
  let cz = 0;
  let R = 1;

  for (let iter = 0; iter < 8; iter++) {
    let sxx = 0;
    let sxz = 0;
    let sx1 = 0;
    let szz = 0;
    let sz1 = 0;
    let s11 = 0;
    let sxy = 0;
    let szy = 0;
    let s1y = 0;

    for (let i = 0; i < samples.length; i++) {
      const { x, z } = samples[i];
      const wi = weights[i];
      const y = x * x + z * z;
      sxx += wi * x * x;
      sxz += wi * x * z;
      sx1 += wi * x;
      szz += wi * z * z;
      sz1 += wi * z;
      s11 += wi;
      sxy += wi * x * y;
      szy += wi * z * y;
      s1y += wi * y;
    }

    const mat = [
      [sxx + 1e-6, sxz, sx1, sxy],
      [sxz, szz + 1e-6, sz1, szy],
      [sx1, sz1, s11 + 1e-6, s1y],
    ];

    for (let col = 0; col < 3; col++) {
      let pivotRow = col;
      for (let r = col + 1; r < 3; r++) {
        if (Math.abs(mat[r][col]) > Math.abs(mat[pivotRow][col])) pivotRow = r;
      }
      if (pivotRow !== col) {
        const tmp = mat[col];
        mat[col] = mat[pivotRow];
        mat[pivotRow] = tmp;
      }
      const diag = mat[col][col];
      if (Math.abs(diag) < 1e-10) return null;
      for (let c = col; c < 4; c++) mat[col][c] /= diag;
      for (let r = 0; r < 3; r++) {
        if (r === col) continue;
        const factor = mat[r][col];
        for (let c = col; c < 4; c++) {
          mat[r][c] -= factor * mat[col][c];
        }
      }
    }

    cx = mat[0][3] * 0.5;
    cz = mat[1][3] * 0.5;
    const rSq = mat[2][3] + cx * cx + cz * cz;
    if (rSq <= 1e-6) return null;
    R = Math.sqrt(rSq);

    const huberThresh = Math.max(0.02, R * 0.045);
    weights = samples.map((s) => {
      const err = Math.abs(Math.hypot(s.x - cx, s.z - cz) - R);
      const huber = err <= huberThresh ? 1 : huberThresh / err;
      return s.w * huber;
    });
  }

  return { cx, cz, R };
}

/**
 * Weighted IRLS fit of a quadratic polynomial y(u) = c0 + c1*u + c2*u^2.
 */
function fitQuadraticIRLS(
  samples: Array<{ u: number; r: number; w: number }>,
  fallbackR: number,
  huberScale?: number,
): { c0: number; c1: number; c2: number } {
  if (samples.length < 6) return { c0: fallbackR, c1: 0, c2: 0 };
  let weights = samples.map((s) => s.w);
  let c0 = fallbackR;
  let c1 = 0;
  let c2 = 0;

  for (let iter = 0; iter < 6; iter++) {
    const A = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    for (let i = 0; i < samples.length; i++) {
      const { u, r } = samples[i];
      const wi = weights[i];
      const basis = [1, u, u * u];
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          A[row][col] += wi * basis[row] * basis[col];
        }
        A[row][3] += wi * basis[row] * r;
      }
    }

    for (let col = 0; col < 3; col++) {
      let piv = col;
      for (let r = col + 1; r < 3; r++) {
        if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
      }
      if (piv !== col) {
        const tmp = A[col];
        A[col] = A[piv];
        A[piv] = tmp;
      }
      const diag = A[col][col];
      if (Math.abs(diag) < 1e-10) return { c0: fallbackR, c1: 0, c2: 0 };
      for (let k = col; k < 4; k++) A[col][k] /= diag;
      for (let r = 0; r < 3; r++) {
        if (r === col) continue;
        const f = A[r][col];
        for (let k = col; k < 4; k++) A[r][k] -= f * A[col][k];
      }
    }

    c0 = A[0][3];
    c1 = A[1][3];
    c2 = A[2][3];
    const huberThresh = Math.max(1e-4, huberScale ?? Math.abs(fallbackR) * 0.03);
    weights = samples.map((s) => {
      const err = Math.abs(s.r - (c0 + c1 * s.u + c2 * s.u * s.u));
      const h = err <= huberThresh ? 1 : huberThresh / err;
      return s.w * h;
    });
  }

  return { c0, c1, c2 };
}

/**
 * Recursively traverses the koi.glb hierarchy, computes each mesh's worldMatrix from parent
 * transforms down, bakes worldMatrix into cloned Float32-promoted BufferGeometries, resets all
 * parent/node transforms to identity, and ensures consistent +Y dorsal-up & +Z length orientation.
 */
export function bakeKoiSceneTransforms(rawScene: THREE.Object3D): THREE.Group {
  const bakedRoot = new THREE.Group();
  bakedRoot.name = 'koi-baked-upright-root';

  const promoteToFloat32 = (attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.Float32BufferAttribute => {
    const out = new Float32Array(attr.count * attr.itemSize);
    const tmpV = new THREE.Vector3();
    for (let i = 0; i < attr.count; i++) {
      if (attr.itemSize === 3) {
        tmpV.fromBufferAttribute(attr, i);
        out[i * 3] = tmpV.x;
        out[i * 3 + 1] = tmpV.y;
        out[i * 3 + 2] = tmpV.z;
      } else {
        for (let k = 0; k < attr.itemSize; k++) {
          out[i * attr.itemSize + k] = attr.getComponent(i, k);
        }
      }
    }
    return new THREE.Float32BufferAttribute(out, attr.itemSize);
  };

  const resetNodeToIdentity = (node: THREE.Object3D): void => {
    node.position.set(0, 0, 0);
    node.rotation.set(0, 0, 0);
    node.quaternion.identity();
    node.scale.set(1, 1, 1);
    node.matrix.identity();
    node.matrixWorld.identity();
  };

  const meshEntries: Array<{ mesh: THREE.Mesh; worldMatrix: THREE.Matrix4 }> = [];
  const traversedNodes: THREE.Object3D[] = [];

  const computeWorldMatricesRecursively = (
    node: THREE.Object3D,
    parentWorld: THREE.Matrix4 | null,
  ): void => {
    node.updateMatrix();
    if (parentWorld) {
      node.matrixWorld.multiplyMatrices(parentWorld, node.matrix);
    } else {
      node.matrixWorld.copy(node.matrix);
    }
    traversedNodes.push(node);

    if (node instanceof THREE.Mesh && node.geometry) {
      meshEntries.push({ mesh: node, worldMatrix: node.matrixWorld.clone() });
    }
    for (let i = 0; i < node.children.length; i++) {
      computeWorldMatricesRecursively(node.children[i], node.matrixWorld);
    }
  };

  computeWorldMatricesRecursively(rawScene, null);

  // Reset all source hierarchy parent/child node transforms to identity after capturing worldMatrices
  for (let i = 0; i < traversedNodes.length; i++) {
    resetNodeToIdentity(traversedNodes[i]);
  }

  const meshes: THREE.Mesh[] = [];
  for (let i = 0; i < meshEntries.length; i++) {
    const { mesh: obj, worldMatrix } = meshEntries[i];
    const bakedGeo = obj.geometry.clone();
    // Promote quantized Int16/Int8 normalized glTF attributes to Float32 BEFORE baking world matrix
    const rawPos = bakedGeo.attributes.position;
    if (rawPos && !(rawPos.array instanceof Float32Array)) {
      bakedGeo.setAttribute('position', promoteToFloat32(rawPos));
    }
    const rawNorm = bakedGeo.attributes.normal;
    if (rawNorm && !(rawNorm.array instanceof Float32Array)) {
      bakedGeo.setAttribute('normal', promoteToFloat32(rawNorm));
    }
    bakedGeo.applyMatrix4(worldMatrix);
    if (!bakedGeo.attributes.normal) {
      bakedGeo.computeVertexNormals();
    }
    bakedGeo.computeBoundingBox();

    const bakedMesh = new THREE.Mesh(bakedGeo, obj.material);
    bakedMesh.name = obj.name || 'koi-baked-mesh';
    resetNodeToIdentity(bakedMesh);
    meshes.push(bakedMesh);
    bakedRoot.add(bakedMesh);
  }

  resetNodeToIdentity(bakedRoot);
  if (meshes.length === 0) return bakedRoot;

  bakedRoot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(bakedRoot);
  const size = new THREE.Vector3();
  box.getSize(size);

  // Align to upright XZ swim plane (Y shortest dorsal height, X lateral width, Z longest length)
  const alreadyUprightXZ = size.z > size.x * 1.05 && size.y < size.x * 0.98 && size.y < size.z * 0.95;
  if (!alreadyUprightXZ) {
    // Compute 3x3 vertex covariance and align principal axes via Jacobi eigensolver
    let mx = 0;
    let my = 0;
    let mz = 0;
    let nPts = 0;
    const pTmp = new THREE.Vector3();
    for (const m of meshes) {
      const pos = m.geometry.attributes.position as THREE.BufferAttribute | undefined;
      if (!pos) continue;
      for (let i = 0; i < pos.count; i++) {
        pTmp.fromBufferAttribute(pos, i);
        mx += pTmp.x;
        my += pTmp.y;
        mz += pTmp.z;
        nPts++;
      }
    }
    if (nPts > 3) {
      mx /= nPts;
      my /= nPts;
      mz /= nPts;
      const C = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ];
      for (const m of meshes) {
        const pos = m.geometry.attributes.position as THREE.BufferAttribute | undefined;
        if (!pos) continue;
        for (let i = 0; i < pos.count; i++) {
          pTmp.fromBufferAttribute(pos, i);
          const dx = pTmp.x - mx;
          const dy = pTmp.y - my;
          const dz = pTmp.z - mz;
          C[0][0] += dx * dx;
          C[0][1] += dx * dy;
          C[0][2] += dx * dz;
          C[1][1] += dy * dy;
          C[1][2] += dy * dz;
          C[2][2] += dz * dz;
        }
      }
      C[1][0] = C[0][1];
      C[2][0] = C[0][2];
      C[2][1] = C[1][2];

      const V = [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ];
      for (let iter = 0; iter < 18; iter++) {
        let p = 0;
        let q = 1;
        let maxOff = Math.abs(C[0][1]);
        if (Math.abs(C[0][2]) > maxOff) {
          p = 0;
          q = 2;
          maxOff = Math.abs(C[0][2]);
        }
        if (Math.abs(C[1][2]) > maxOff) {
          p = 1;
          q = 2;
          maxOff = Math.abs(C[1][2]);
        }
        if (maxOff < 1e-12) break;

        const tau = (C[q][q] - C[p][p]) / (2 * C[p][q]);
        const t =
          tau >= 0
            ? 1 / (tau + Math.sqrt(1 + tau * tau))
            : -1 / (-tau + Math.sqrt(1 + tau * tau));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = t * c;

        const cpp = C[p][p];
        const cqq = C[q][q];
        const cpq = C[p][q];
        C[p][p] = c * c * cpp - 2 * s * c * cpq + s * s * cqq;
        C[q][q] = s * s * cpp + 2 * s * c * cpq + c * c * cqq;
        C[p][q] = 0;
        C[q][p] = 0;
        for (let r = 0; r < 3; r++) {
          if (r === p || r === q) continue;
          const crp = C[r][p];
          const crq = C[r][q];
          C[r][p] = c * crp - s * crq;
          C[p][r] = C[r][p];
          C[r][q] = s * crp + c * crq;
          C[q][r] = C[r][q];
        }
        for (let r = 0; r < 3; r++) {
          const vrp = V[r][p];
          const vrq = V[r][q];
          V[r][p] = c * vrp - s * vrq;
          V[r][q] = s * vrp + c * vrq;
        }
      }

      const eig = [0, 1, 2]
        .map((idx) => ({
          val: C[idx][idx],
          vec: new THREE.Vector3(V[0][idx], V[1][idx], V[2][idx]).normalize(),
        }))
        .sort((a, b) => b.val - a.val);

      const vMax = eig[0].vec; // -> +Z (snout-to-tail length)
      const vMid = eig[1].vec; // -> +X (lateral width / C-curve plane)
      const vMin = eig[2].vec; // -> +Y (dorsal-ventral height)
      // Keep right-handed rotation (det = +1)
      if (new THREE.Vector3().crossVectors(vMid, vMin).dot(vMax) < 0) {
        vMid.negate();
      }
      const rotMat = new THREE.Matrix4().makeBasis(vMid, vMin, vMax).transpose();
      for (const m of meshes) m.geometry.applyMatrix4(rotMat);
    }
  }

  // Verify dorsal ridge protrudes toward +Y rather than being flipped upside-down (-Y)
  bakedRoot.updateMatrixWorld(true);
  box.setFromObject(bakedRoot);
  box.getSize(size);
  const midY = (box.min.y + box.max.y) * 0.5;
  let sumY = 0;
  let vCount = 0;
  const vTmp = new THREE.Vector3();
  for (const m of meshes) {
    const pos = m.geometry.attributes.position as THREE.BufferAttribute | undefined;
    if (!pos) continue;
    for (let i = 0; i < pos.count; i++) {
      vTmp.fromBufferAttribute(pos, i);
      sumY += vTmp.y;
      vCount++;
    }
  }
  if (vCount > 0 && size.y > 1e-6) {
    const meanY = sumY / vCount;
    if (meanY - midY > size.y * 0.05) {
      for (const m of meshes) m.geometry.rotateZ(Math.PI);
    }
  }

  for (const m of meshes) {
    m.geometry.computeBoundingBox();
    m.geometry.computeBoundingSphere();
  }
  return bakedRoot;
}

/**
 * Un-bends a baked C-curved koi BufferGeometry onto a straight +Z spine using dorsal-filtered
 * circular-arc polar coordinates refined by one continuous quadratic centerline r(u) in XZ
 * (zero piecewise seams, pectoral fin outliers excluded, exact C∞ normal transform).
 */
export function straightenKoiGeometry(geometry: THREE.BufferGeometry): void {
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
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < count; i++) {
    tmp.fromBufferAttribute(posAttr, i);
    px[i] = tmp.x;
    py[i] = tmp.y;
    pz[i] = tmp.z;
    if (tmp.y < minY) minY = tmp.y;
    if (tmp.y > maxY) maxY = tmp.y;
    if (tmp.z < minZ) minZ = tmp.z;
    if (tmp.z > maxZ) maxZ = tmp.z;
    if (normAttr && nxArr && nyArr && nzArr) {
      tmpN.fromBufferAttribute(normAttr, i);
      nxArr[i] = tmpN.x;
      nyArr[i] = tmpN.y;
      nzArr[i] = tmpN.z;
    }
  }

  const spanZ = maxZ - minZ;
  const spanY = maxY - minY;
  if (spanZ < 1e-6) return;

  // Filter out low ventral pectoral fins (lower 42% of height) so spine fit tracks dorsal torso cleanly
  const yCut = minY + spanY * 0.42;
  const torsoIndices: number[] = [];
  for (let i = 0; i < count; i++) {
    if (py[i] >= yCut) torsoIndices.push(i);
  }
  const activeIndices = torsoIndices.length >= 48 ? torsoIndices : Array.from({ length: count }, (_, i) => i);

  const numBins = 26;
  const sliceSamples: Array<{ x: number; z: number; w: number }> = [];
  for (let b = 0; b < numBins; b++) {
    const zLo = minZ + (b / numBins) * spanZ;
    const zHi = minZ + ((b + 1) / numBins) * spanZ;
    const binX: number[] = [];
    const binZ: number[] = [];
    for (let k = 0; k < activeIndices.length; k++) {
      const idx = activeIndices[k];
      if (pz[idx] >= zLo && pz[idx] <= zHi) {
        binX.push(px[idx]);
        binZ.push(pz[idx]);
      }
    }
    if (binX.length < 6) continue;
    binX.sort((a, b) => a - b);
    binZ.sort((a, b) => a - b);
    sliceSamples.push({
      x: binX[binX.length >> 1],
      z: binZ[binZ.length >> 1],
      w: Math.sqrt(binX.length),
    });
  }

  const circle = fitCircleIRLS(sliceSamples);
  const circleValid =
    circle !== null &&
    circle.R <= spanZ * 4.5 &&
    !px.some((xVal, i) => Math.hypot(xVal - circle.cx, pz[i] - circle.cz) < circle.R * 0.15);

  if (!circleValid) {
    // Low-curvature fallback: singular quadratic centerline xCenter(u) in XZ space
    const zMid = (minZ + maxZ) * 0.5;
    const invHalfZ = 2 / spanZ;
    const zSamples = sliceSamples.map((s) => ({
      u: (s.z - zMid) * invHalfZ,
      r: s.x,
      w: s.w,
    }));
    const qx = fitQuadraticIRLS(zSamples, 0, spanZ * 0.025);
    const newPos = new Float32Array(count * 3);
    const newNorm = normAttr ? new Float32Array(count * 3) : null;

    for (let i = 0; i < count; i++) {
      const u = (pz[i] - zMid) * invHalfZ;
      const xSpine = qx.c0 + qx.c1 * u + qx.c2 * u * u;
      const dxDu = (qx.c1 + 2 * qx.c2 * u) * invHalfZ;
      const tangentLen = Math.hypot(dxDu, 1);

      newPos[i * 3] = (px[i] - xSpine) / tangentLen;
      newPos[i * 3 + 1] = py[i];
      newPos[i * 3 + 2] = pz[i] - zMid;

      if (newNorm && nxArr && nyArr && nzArr) {
        const rx = nxArr[i] - dxDu * nzArr[i];
        const ry = nyArr[i];
        const rz = dxDu * nxArr[i] + nzArr[i];
        const rLen = Math.hypot(rx, ry, rz) || 1;
        newNorm[i * 3] = rx / rLen;
        newNorm[i * 3 + 1] = ry / rLen;
        newNorm[i * 3 + 2] = rz / rLen;
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
    return;
  }

  const { cx, cz, R } = circle!;

  let sinSum = 0;
  let cosSum = 0;
  for (let i = 0; i < sliceSamples.length; i++) {
    const th = Math.atan2(sliceSamples[i].z - cz, sliceSamples[i].x - cx);
    sinSum += Math.sin(th) * sliceSamples[i].w;
    cosSum += Math.cos(th) * sliceSamples[i].w;
  }
  const thetaMid = Math.atan2(sinSum, cosSum);
  const thFirst = Math.atan2(sliceSamples[0].z - cz, sliceSamples[0].x - cx);
  const thLast = Math.atan2(
    sliceSamples[sliceSamples.length - 1].z - cz,
    sliceSamples[sliceSamples.length - 1].x - cx,
  );
  // Preserves orientation + right-handed triangle winding
  const sign = wrapAngleRad(thLast - thFirst) >= 0 ? 1 : -1;

  // Polar-bin dorsal torso by angle u = wrapAngleRad(theta - thetaMid) and fit smooth single quadratic rSpine(u)
  const uList: Array<{ u: number; r: number }> = [];
  let minU = Infinity;
  let maxU = -Infinity;
  for (let k = 0; k < activeIndices.length; k++) {
    const idx = activeIndices[k];
    const dx = px[idx] - cx;
    const dz = pz[idx] - cz;
    const r = Math.hypot(dx, dz);
    const u = wrapAngleRad(Math.atan2(dz, dx) - thetaMid);
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    uList.push({ u, r });
  }

  const uSamples: Array<{ u: number; r: number; w: number }> = [];
  const uBins = 22;
  const uSpan = Math.max(1e-4, maxU - minU);
  for (let b = 0; b < uBins; b++) {
    const uLo = minU + (b / uBins) * uSpan;
    const uHi = minU + ((b + 1) / uBins) * uSpan;
    const rs: number[] = [];
    for (let k = 0; k < uList.length; k++) {
      if (uList[k].u >= uLo && uList[k].u <= uHi) rs.push(uList[k].r);
    }
    if (rs.length < 8) continue;
    rs.sort((a, b) => a - b);
    uSamples.push({ u: (uLo + uHi) * 0.5, r: rs[rs.length >> 1], w: Math.sqrt(rs.length) });
  }

  const quad = fitQuadraticIRLS(uSamples, R);
  const newPos = new Float32Array(count * 3);
  const newNorm = normAttr ? new Float32Array(count * 3) : null;

  for (let i = 0; i < count; i++) {
    const dx = px[i] - cx;
    const dz = pz[i] - cz;
    const r = Math.hypot(dx, dz) || 1e-6;
    const theta = Math.atan2(dz, dx);
    const dTh = wrapAngleRad(theta - thetaMid);
    const rSpine = quad.c0 + quad.c1 * dTh + quad.c2 * dTh * dTh;

    newPos[i * 3] = sign * (r - rSpine);
    newPos[i * 3 + 1] = py[i];
    newPos[i * 3 + 2] = sign * R * dTh;

    if (newNorm && nxArr && nyArr && nzArr) {
      const cosT = dx / r;
      const sinT = dz / r;
      const nX = nxArr[i];
      const nY = nyArr[i];
      const nZ = nzArr[i];

      const nRadial = nX * cosT + nZ * sinT;
      const nTheta = -nX * sinT + nZ * cosT;
      const drDu = quad.c1 + 2 * quad.c2 * dTh;

      // Exact C-infinity inverse-transpose normal mapping under polar-quadratic unwrap
      const rX = sign * nRadial;
      const rY = nY;
      const rZ = sign * ((drDu / R) * nRadial + (r / R) * nTheta);
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
 * Measures baked model bounding box, verifies dorsal-up +Z orientation (snout +Z, tail -Z),
 * centers origin, and normalizes unit length = 1.0.
 */
export function buildNormalizedKoiPrototype(rawScene: THREE.Object3D): THREE.Group {
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
  causticTimeUniform: { value: number },
  waveTexUniform: { value: THREE.Texture | null },
  waveTexelUniform: { value: THREE.Vector2 },
  pondBoundsUniform: { value: THREE.Vector4 },
  phase: number,
  useVertexSwim: boolean,
) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uMeshToProto = { value: meshToProto };
    shader.uniforms.uProtoToMesh = { value: protoToMesh };
    shader.uniforms.uSwimTime = timeUniform;
    shader.uniforms.uSwimFreq = freqUniform;
    shader.uniforms.uTurnBend = bendUniform;
    shader.uniforms.uCausticTime = causticTimeUniform;
    shader.uniforms.tWave = waveTexUniform;
    shader.uniforms.uWaveTexel = waveTexelUniform;
    shader.uniforms.uPondBounds = pondBoundsUniform;
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
          float phaseArg = uSwimTime * uSwimFreq + uPhase - spineS * 4.4;
          // Calm ~0.04 body-length tail undulation + smooth yaw-driven turn arc
          float lateralWave = sin(phaseArg) * (0.004 + 0.036 * sCurve);
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
        uniform float uCausticTime;
        uniform sampler2D tWave;
        uniform vec2 uWaveTexel;
        uniform vec4 uPondBounds;
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

        ${POND_CAUSTICS_GLSL}`,
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
          // 4: Ki Utsuri (warm golden-amber body with bold velvety sumi ink-black patches)
          float extraSumi = smoothstep(0.54, 0.65, koiFbm(vKoiLocalPos * vec3(3.8, 3.4, 3.2) + vec3(3.1, 0.8, 1.9)))
                          * smoothstep(-0.38, 0.38, vKoiLocalPos.z);
          float kiSumiMask = max(spotMask, extraSumi * 0.94);
          vec3 kiGold = vec3(0.95, 0.70, 0.14) * (0.68 + 0.40 * scaleTone);
          vec3 kiSumi = vec3(0.055, 0.060, 0.070) * (0.65 + 0.35 * scaleTone);
          recolored = mix(kiGold, kiSumi, kiSumiMask);
        } else {
          // 5: Yamabuki Hariwake (luminous pearl white with vivid saffron-gold patches)
          float extraGold = smoothstep(0.55, 0.66, koiFbm(vKoiLocalPos * vec3(3.6, 3.4, 3.2) + vec3(1.4, 2.3, 4.1)))
                          * smoothstep(-0.38, 0.38, vKoiLocalPos.z);
          float goldPatchMask = max(spotMask, extraGold * 0.92);
          vec3 hariwakeGold = vec3(0.98, 0.68, 0.07) * (0.70 + 0.38 * scaleTone);
          recolored = mix(pearlWhite, hariwakeGold, goldPatchMask);
        }

        diffuseColor.rgb = mix(diffuseColor.rgb, recolored, protectDark);`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        float koiDepth = max(0.0, uWaterY - vKoiWorldPos.y);
        // Gentle aquatic color absorption + clean exposure lift so submerged koi stay vivid beneath water refraction
        vec3 koiBeer = exp(-koiDepth * vec3(0.32, 0.17, 0.15));
        reflectedLight.directDiffuse *= koiBeer * 1.42;
        reflectedLight.indirectDiffuse *= mix(vec3(1.0), koiBeer, 0.72) * 1.28;

        // Wet aquatic Fresnel sheen & subtle sunlit subsurface scatter along flanks and fin edges
        vec3 koiN = normalize(vKoiWorldNormal);
        vec3 koiV = normalize(cameraPosition - vKoiWorldPos);
        float koiFresnel = pow(1.0 - max(dot(koiN, koiV), 0.0), 2.5);
        float koiDorsal = smoothstep(-0.08, 0.65, koiN.y);
        float koiFlankMask = smoothstep(-0.25, 0.35, koiN.y);
        reflectedLight.indirectSpecular += vec3(0.24, 0.31, 0.30) * koiFresnel * (0.45 + 0.55 * koiDorsal);
        reflectedLight.directDiffuse += diffuseColor.rgb * vec3(0.36, 0.28, 0.20) * koiFresnel * koiFlankMask * 0.42;

        float koiWaveCaustic = pondWaveLaplacianCaustic(
          tWave,
          uWaveTexel,
          uPondBounds,
          vKoiWorldPos,
          uWaterY
        );
        float koiThreads = pondAmbientSunThreads(vKoiWorldPos.xz, uCausticTime);
        float koiCover = pondCausticCoverMask(vKoiWorldPos.xz, 1.0);
        reflectedLight.directDiffuse += vec3(1.0, 0.95, 0.80) * (koiWaveCaustic * 0.44 + koiThreads * 0.20) * koiCover * koiDorsal;`,
      );
  };
  mat.customProgramCacheKey = () =>
    `koi-glb-swim-${useVertexSwim ? '1' : '0'}-laplacian-v7`;
}

export function stepKoiSchoolMotion(
  agents: KoiMotionState[],
  dt: number,
  elapsedSec: number,
  impulses: ReadonlyArray<{ x: number; z: number; startTime: number }>,
  checkBookOverhang: boolean,
): void {
  const marginX = 2.05;
  const marginZ = 1.48;

  for (let i = 0; i < agents.length; i++) {
    const koi = agents[i];

    // 1. Track displacement progress to detect stalling / getting pinned in one spot
    if (Math.hypot(koi.x - koi.anchorX, koi.z - koi.anchorZ) >= 0.10) {
      koi.anchorX = koi.x;
      koi.anchorZ = koi.z;
      koi.stuckTimer = 0;
    } else {
      koi.stuckTimer += dt;
    }

    koi.wanderPhase += dt * (0.45 + koi.spec.variety * 0.06);
    koi.burst = Math.max(0, koi.burst - dt * 0.65);

    const headX = Math.sin(koi.yaw);
    const headZ = Math.cos(koi.yaw);
    const probeX = koi.x + headX * 0.28;
    const probeZ = koi.z + headZ * 0.28;

    const sepBody = nearestObstacleSeparation(koi.x, koi.z, 0.26, checkBookOverhang, true);
    const sepProbe = nearestObstacleSeparation(probeX, probeZ, 0.24, checkBookOverhang, true);
    const headDotObs = headX * sepBody.nx + headZ * sepBody.nz;

    const hitWall =
      (koi.x > marginX + 0.08 && headX > 0.1) ||
      (koi.x < -(marginX + 0.08) && headX < -0.1) ||
      (koi.z > marginZ + 0.08 && headZ > 0.1) ||
      (koi.z < -(marginZ + 0.08) && headZ < -0.1);

    const hittingObstacle =
      sepBody.dist < -0.005 ||
      (sepBody.dist < 0.08 && headDotObs < 0.22) ||
      sepProbe.dist < -0.04;

    const isStuck = koi.stuckTimer >= 1.35;

    if (hittingObstacle || hitWall || isStuck) {
      const shouldRefreshEvade =
        koi.evadeTimer <= 0.05 || sepBody.dist < -0.015 || isStuck;

      if (shouldRefreshEvade) {
        let awayX = 0;
        let awayZ = 0;

        if (hitWall) {
          if (Math.abs(koi.x) > marginX) awayX += -Math.sign(koi.x);
          if (Math.abs(koi.z) > marginZ) awayZ += -Math.sign(koi.z);
        } else {
          const refSep = sepBody.dist <= sepProbe.dist ? sepBody : sepProbe;
          awayX += refSep.nx;
          awayZ += refSep.nz;
        }

        // Tangential arc bias so head-on hits always pick a decisive smooth turn side
        const turnSign = koi.spec.variety % 2 === 0 ? 1 : -1;
        const tanX = -awayZ * turnSign;
        const tanZ = awayX * turnSign;
        awayX += tanX * 0.35;
        awayZ += tanZ * 0.35;

        // Bias gently back toward open North or South lagoon center
        const lagoonTargetZ = koi.z >= 0 ? 0.98 : -1.14;
        const toLagoonX = 0 - koi.x;
        const toLagoonZ = lagoonTargetZ - koi.z;
        const toLagoonLen = Math.hypot(toLagoonX, toLagoonZ) || 1;
        awayX += (toLagoonX / toLagoonLen) * 0.45;
        awayZ += (toLagoonZ / toLagoonLen) * 0.45;

        const awayLen = Math.hypot(awayX, awayZ) || 1;
        awayX /= awayLen;
        awayZ /= awayLen;

        koi.evadeYaw = Math.atan2(awayX, awayZ);
        koi.evadeTimer = isStuck ? 2.0 : 1.45;
        koi.burst = Math.max(koi.burst, 0.32);

        // Skip any waypoint that points back into the blocked region
        let bestWpIdx = (koi.waypointIndex + 1) % koi.spec.waypoints.length;
        let bestScore = -Infinity;
        for (let wIdx = 0; wIdx < koi.spec.waypoints.length; wIdx++) {
          const candidate = koi.spec.waypoints[wIdx];
          const midX = (koi.x + candidate.x) * 0.5;
          const midZ = (koi.z + candidate.z) * 0.5;
          const midClear = nearestObstacleSeparation(
            midX,
            midZ,
            0.22,
            checkBookOverhang,
            true,
          ).dist;
          const dx = candidate.x - koi.x;
          const dz = candidate.z - koi.z;
          const dLen = Math.hypot(dx, dz) || 1;
          const align = (dx / dLen) * awayX + (dz / dLen) * awayZ;
          const score = align + (midClear > 0 ? 0.6 : -1.5);
          if (score > bestScore) {
            bestScore = score;
            bestWpIdx = wIdx;
          }
        }
        koi.waypointIndex = bestWpIdx;
        koi.stuckTimer = 0;
        koi.anchorX = koi.x;
        koi.anchorZ = koi.z;
      }
    }

    let desiredYaw: number;
    let maxTurnRate: number;

    if (koi.evadeTimer > 0) {
      koi.evadeTimer = Math.max(0, koi.evadeTimer - dt);
      desiredYaw = koi.evadeYaw;
      maxTurnRate = 1.85;
    } else {
      const wp = koi.spec.waypoints[koi.waypointIndex];
      const toWpX = wp.x - koi.x;
      const toWpZ = wp.z - koi.z;
      if (Math.hypot(toWpX, toWpZ) < 0.24) {
        koi.waypointIndex = (koi.waypointIndex + 1) % koi.spec.waypoints.length;
      }

      const wpLen = Math.hypot(toWpX, toWpZ) || 1;
      let steerX = toWpX / wpLen;
      let steerZ = toWpZ / wpLen;

      // Gentle natural wander
      const perpX = -steerZ;
      const perpZ = steerX;
      const wanderAmt = Math.sin(koi.wanderPhase) * 0.14;
      steerX += perpX * wanderAmt;
      steerZ += perpZ * wanderAmt;

      // Soft pond border repulsion
      if (Math.abs(koi.x) > marginX - 0.15) {
        steerX += -Math.sign(koi.x) * ((Math.abs(koi.x) - (marginX - 0.15)) * 1.6);
      }
      if (Math.abs(koi.z) > marginZ - 0.12) {
        steerZ += -Math.sign(koi.z) * ((Math.abs(koi.z) - (marginZ - 0.12)) * 1.6);
      }

      // Smooth predictive obstacle avoidance
      if (sepBody.dist < 0.24) {
        const push = (0.24 - sepBody.dist) * 3.2;
        steerX += sepBody.nx * push;
        steerZ += sepBody.nz * push;
      }
      if (sepProbe.dist < 0.22) {
        const push = (0.22 - sepProbe.dist) * 2.4;
        steerX += sepProbe.nx * push;
        steerZ += sepProbe.nz * push;
      }

      // Same-depth-layer fish separation
      for (let j = 0; j < agents.length; j++) {
        if (i === j) continue;
        const other = agents[j];
        if (Math.abs(other.spec.depthOffset - koi.spec.depthOffset) > 0.045) continue;
        const dx = koi.x - other.x;
        const dz = koi.z - other.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 0.001 && dist < 0.44) {
          const push = ((0.44 - dist) / 0.44) * 1.85;
          steerX += (dx / dist) * push;
          steerZ += (dz / dist) * push;
        }
      }

      // Subtle ripple startle response
      for (let r = 0; r < impulses.length; r++) {
        const imp = impulses[r];
        const age = elapsedSec - imp.startTime;
        if (age < 0 || age > 1.2) continue;
        const dx = koi.x - imp.x;
        const dz = koi.z - imp.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 0.01 && dist < 0.95) {
          const strength = (1 - dist / 0.95) * (1 - age / 1.2);
          steerX += (dx / dist) * strength * 1.5;
          steerZ += (dz / dist) * strength * 1.5;
          koi.burst = Math.max(koi.burst, strength * 0.45);
        }
      }

      desiredYaw = Math.atan2(steerX, steerZ);
      maxTurnRate = 1.2;
    }

    const yawDiff = wrapAngleRad(desiredYaw - koi.yaw);
    const maxDelta = maxTurnRate * dt;
    const appliedDelta = Math.max(-maxDelta, Math.min(maxDelta, yawDiff));
    koi.yaw = wrapAngleRad(koi.yaw + appliedDelta);

    const turnRate = appliedDelta / dt;
    const targetBend = Math.max(-0.25, Math.min(0.25, -turnRate * 0.16));
    const bendAlpha = 1 - Math.exp(-5.5 * dt);
    koi.turnBend += (targetBend - koi.turnBend) * bendAlpha;

    const targetSpeed = koi.spec.baseSpeed * (1 + koi.burst * 0.72);
    const speedAlpha = 1 - Math.exp(-3.2 * dt);
    koi.speed += (targetSpeed - koi.speed) * speedAlpha;

    koi.vx = Math.sin(koi.yaw) * koi.speed;
    koi.vz = Math.cos(koi.yaw) * koi.speed;
    koi.x += koi.vx * dt;
    koi.z += koi.vz * dt;
    koi.swimPhase += dt * (4.2 + koi.speed * 6.8);
  }

  // Post-step hard separation for same-depth-layer overlaps and obstacle interiors
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    for (let j = i + 1; j < agents.length; j++) {
      const b = agents[j];
      if (Math.abs(a.spec.depthOffset - b.spec.depthOffset) > 0.045) continue;
      const dx = a.x - b.x;
      const dz = a.z - b.z;
      const dist = Math.hypot(dx, dz);
      const minDist = 0.34;
      if (dist > 0.0001 && dist < minDist) {
        const push = (minDist - dist) * 0.5;
        const nx = dx / dist;
        const nz = dz / dist;
        a.x += nx * push;
        a.z += nz * push;
        b.x -= nx * push;
        b.z -= nz * push;
      }
    }

    const postObs = nearestObstacleSeparation(a.x, a.z, 0.25, checkBookOverhang, true);
    if (postObs.dist < 0) {
      a.x += postObs.nx * (-postObs.dist + 0.004);
      a.z += postObs.nz * (-postObs.dist + 0.004);
      if (a.evadeTimer <= 0.1) {
        const lagoonTargetZ = a.z >= 0 ? 0.98 : -1.14;
        const toLagoonX = 0 - a.x;
        const toLagoonZ = lagoonTargetZ - a.z;
        const toLagoonLen = Math.hypot(toLagoonX, toLagoonZ) || 1;
        const ex = postObs.nx + (toLagoonX / toLagoonLen) * 0.4;
        const ez = postObs.nz + (toLagoonZ / toLagoonLen) * 0.4;
        a.evadeYaw = Math.atan2(ex, ez);
        a.evadeTimer = 1.35;
        a.burst = Math.max(a.burst, 0.28);
      }
    }

    a.x = Math.max(-(marginX + 0.25), Math.min(marginX + 0.25, a.x));
    a.z = Math.max(-(marginZ + 0.22), Math.min(marginZ + 0.22, a.z));
  }
}

export function createKoiSchool(
  waterY: number,
  bedY: number,
  maxAnisotropy: number,
): KoiSchoolRig {
  const shadowDiscY = Math.min(waterY - 0.24, bedY + 0.015);
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

  const sharedCausticTime = { value: 0 };
  const sharedWaveTex: { value: THREE.Texture | null } = { value: null };
  const sharedWaveTexel = { value: new THREE.Vector2(1 / 384, 1 / 384) };
  const sharedPondBounds = {
    value: new THREE.Vector4(
      POND_BOUNDS.minX,
      POND_BOUNDS.maxX,
      POND_BOUNDS.minZ,
      POND_BOUNDS.maxZ,
    ),
  };

  // 6 authentic koi varieties across 3 staggered depth layers (0.085, 0.175, 0.265)
  // patrolling clear North & South open-water lagoons without crossing blocked book/rock barriers
  const koiSpecs: KoiSpec[] = KOI_PATROL_SPECS;

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

      // 1. Bake all parent/node transforms into cloned geometries so +Y is dorsal-up & (X,Z) horizontal swim plane
      const bakedScene = bakeKoiSceneTransforms(gltf.scene);

      // 2. Un-bend frozen C-curve koi geometry cleanly onto straight +Z
      bakedScene.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.geometry) {
          straightenKoiGeometry(obj.geometry);
        }
      });

      const prototype = buildNormalizedKoiPrototype(bakedScene);
      const hasAnimations = gltf.animations && gltf.animations.length > 0;

      // Capture prototype mesh -> outer normalized prototype transforms cleanly & configure shared texture once
      const protoMeshMatrices = new Map<string, THREE.Matrix4>();
      prototype.updateMatrixWorld(true);
      let meshIdx = 0;
      prototype.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.userData.__koiMeshIdx = meshIdx;
          protoMeshMatrices.set(String(meshIdx), obj.matrixWorld.clone());
          const origMats = Array.isArray(obj.material) ? obj.material : [obj.material];
          origMats.forEach((origMat) => {
            if (origMat instanceof THREE.MeshStandardMaterial && origMat.map) {
              origMat.map.colorSpace = THREE.SRGBColorSpace;
              origMat.map.anisotropy = maxAnisotropy;
              origMat.map.needsUpdate = true;
            }
          });
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
        const freqUniform = { value: 1.0 };
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

          mat.roughness = 0.19;
          mat.metalness = spec.variety === 4 ? 0.18 : spec.variety === 5 ? 0.14 : 0.06;
          mat.envMapIntensity = 0.66;

          attachKoiVarietyAndSwimShader(
            mat,
            spec.variety,
            waterY,
            meshToProto,
            protoToMesh,
            timeUniform,
            freqUniform,
            bendUniform,
            sharedCausticTime,
            sharedWaveTex,
            sharedWaveTexel,
            sharedPondBounds,
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
        shadowDisc.position.set(spec.initX, shadowDiscY, spec.initZ);
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
          swimPhase: 0,
          wanderPhase: idx * 1.4,
          waypointIndex: 0,
          anchorX: spec.initX,
          anchorZ: spec.initZ,
          stuckTimer: 0,
          evadeTimer: 0,
          evadeYaw: spec.initYaw,
          timeUniform,
          freqUniform,
          bendUniform,
        });
      });

      if (typeof document !== 'undefined') {
        document.body.dataset.koiCount = String(agents.length);
      }

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
    } catch (err) {
      if (typeof document !== 'undefined') {
        document.body.dataset.koiCount = 'error';
      }
      console.error('[KoiSchool] Failed to initialize koi.glb:', err);
    }
  })();

  return {
    group,
    update: (dtSec, elapsedSec, waterSim, _renderer, bookOpenProgress = 0) => {
      sharedCausticTime.value = elapsedSec;
      sharedWaveTex.value = waterSim.texture;
      sharedWaveTexel.value.copy(waterSim.texelSize);

      if (agents.length === 0) return;
      const dt = Math.min(0.045, Math.max(0.001, dtSec));
      const impulses = waterSim.getRecentImpulses();
      const checkBookOverhang = bookOpenProgress > 0.08;

      stepKoiSchoolMotion(agents, dt, elapsedSec, impulses, checkBookOverhang);

      // Sync final world transforms, smoothly accumulated swimPhase (zero phase-jump!), and bed shadows
      for (let i = 0; i < agents.length; i++) {
        const koi = agents[i];
        const depthY =
          waterY - koi.spec.depthOffset + Math.sin(elapsedSec * 0.72 + koi.spec.phase) * 0.005;

        koi.root.position.set(koi.x, depthY, koi.z);
        koi.root.rotation.y = koi.yaw;
        koi.root.rotation.z = THREE.MathUtils.clamp(-koi.turnBend * 0.32, -0.075, 0.075);

        koi.timeUniform.value = koi.swimPhase;
        koi.freqUniform.value = 1.0;
        koi.bendUniform.value = koi.turnBend;

        if (koi.mixer && koi.action) {
          koi.action.timeScale = 0.7 + (koi.speed / 0.24) * 0.55;
          koi.mixer.update(dt);
        }

        koi.shadowDisc.position.set(koi.x + 0.035, shadowDiscY, koi.z + 0.035);
        koi.shadowDisc.rotation.y = koi.yaw;
      }
    },
    dispose: () => {
      disposed = true;
      for (const a of agents) {
        if (a.mixer) a.mixer.stopAllAction();
      }
      new Set(disposables).forEach((d) => d.dispose());
    },
  };
}
