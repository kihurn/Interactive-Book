import assert from 'node:assert/strict';
import test from 'node:test';
import type * as THREE from 'three';
import { LAMPLIT_DESK_THEME, SITE_CONFIG } from '../../config/theme';
import { DEFAULT_ENVIRONMENT, ENVIRONMENT_STORAGE_KEY } from '../environments/types';
import {
  nearestObstacleSeparation,
  POND_BOUNDS,
  POND_LAYOUT,
  POND_OBSTACLES,
  pondUvToWorld,
  signedDistanceToObstacle,
  worldToPondUv,
} from './constants';

test('worldToPondUv and pondUvToWorld round-trip accurately inside pond bounds', () => {
  const samples = [
    { x: 0, z: 0 },
    { x: -2.4, z: 1.2 },
    { x: 1.85, z: -0.95 },
    { x: POND_BOUNDS.minX + 0.5, z: POND_BOUNDS.maxZ - 0.5 },
  ];

  for (const pt of samples) {
    const uv = worldToPondUv(pt.x, pt.z);
    assert.ok(uv.u >= 0 && uv.u <= 1, 'u stays normalized');
    assert.ok(uv.v >= 0 && uv.v <= 1, 'v stays normalized');
    const back = pondUvToWorld(uv.u, uv.v);
    assert.ok(Math.abs(back.x - pt.x) < 1e-6, 'x round-trip');
    assert.ok(Math.abs(back.z - pt.z) < 1e-6, 'z round-trip');
  }
});

test('floating plank covers ~85-90% of open book footprint so book edges overhang water', () => {
  const openBookWidth =
    (LAMPLIT_DESK_THEME.bookDimensions.pageWidth +
      LAMPLIT_DESK_THEME.bookDimensions.coverOverhang) *
    2;
  const openBookDepth =
    LAMPLIT_DESK_THEME.bookDimensions.pageHeight +
    LAMPLIT_DESK_THEME.bookDimensions.coverOverhang * 2;

  const widthRatio = POND_LAYOUT.plankWidth / openBookWidth;
  const depthRatio = POND_LAYOUT.plankDepth / openBookDepth;

  assert.ok(
    widthRatio >= 0.85 && widthRatio <= 0.9,
    `expected overhang width ratio 0.85..0.90, got ${widthRatio}`,
  );
  assert.ok(
    depthRatio >= 0.85 && depthRatio <= 0.9,
    `expected overhang depth ratio 0.85..0.90, got ${depthRatio}`,
  );
});

test('pond obstacle SDF detects interior vs clear open water and separates koi cleanly', () => {
  const plank = POND_OBSTACLES.find((o) => o.id === 'floating-plank')!;
  assert.ok(signedDistanceToObstacle(0, 0, plank) < 0, 'origin is inside plank');
  assert.ok(signedDistanceToObstacle(0, 1.2, plank) > 0.5, 'south water is clear');

  const sep = nearestObstacleSeparation(0, 0.37, 0.1);
  assert.ok(sep.dist < 0, 'point right at plank edge triggers separation');
  const openOverhangSep = nearestObstacleSeparation(1.48, 0.44, 0.05, true);
  assert.ok(openOverhangSep.dist < 0, 'open book overhang keeps koi clear of corners');
  const northEdgeSep = nearestObstacleSeparation(0, -0.68, 0.05, true);
  assert.ok(northEdgeSep.dist < 0, 'open book upper edge keeps koi clear of top clipping');
  const clearSep = nearestObstacleSeparation(-0.9, 1.25, 0.1);
  assert.ok(clearSep.dist > 0.2, 'open swimming lane stays unobstructed');
});

test('bakeKoiSceneTransforms + straightenKoiGeometry + buildNormalizedKoiPrototype produce upright straight +Z fish', async () => {
  const THREE = await import('three');
  const { bakeKoiSceneTransforms, straightenKoiGeometry, buildNormalizedKoiPrototype } = await import(
    './KoiSchool'
  );

  // Build a synthetic C-curved fish inside a Sketchfab-style -90deg X parent hierarchy
  const segs = 36;
  const rings = 12;
  const R = 1.6;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs; // 0 = tail, 1 = snout
    const ang = (t - 0.5) * 1.1;
    const cx = Math.cos(ang) * R;
    const cz = Math.sin(ang) * R;
    // Thicker head at t ~ 0.78, slender peduncle near tail t ~ 0.1
    const radX = 0.05 + Math.sin(t * Math.PI) * 0.12 + (t > 0.65 ? 0.04 : 0);
    const radY = 0.03 + Math.sin(t * Math.PI) * 0.07;
    for (let j = 0; j <= rings; j++) {
      const a = (j / rings) * Math.PI * 2;
      const radialOffset = Math.cos(a) * radX;
      const y = Math.sin(a) * radY;
      positions.push(cx + Math.cos(ang) * radialOffset, y, cz + Math.sin(ang) * radialOffset);
    }
  }
  const cols = rings + 1;
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < rings; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, c, d, a, d, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const root = new THREE.Group();
  root.position.set(1.2, -0.4, 0.8);
  root.rotation.y = Math.PI / 4;
  const parent = new THREE.Group();
  parent.rotation.x = -Math.PI / 2;
  parent.scale.setScalar(0.5);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial());
  mesh.position.set(0.3, 0.1, -0.2);
  parent.add(mesh);
  root.add(parent);

  const baked = bakeKoiSceneTransforms(root);
  // All source hierarchy parent/child nodes reset to identity
  for (const node of [root, parent, mesh]) {
    assert.equal(node.position.lengthSq(), 0, 'source node position reset to identity');
    assert.equal(node.scale.x, 1, 'source node scale reset to identity');
    assert.ok(node.quaternion.equals(new THREE.Quaternion()), 'source node quaternion reset to identity');
  }
  baked.traverse((obj) => {
    assert.equal(obj.position.lengthSq(), 0, 'baked node position reset to identity');
    assert.equal(obj.scale.x, 1, 'baked node scale reset to identity');
    if (obj instanceof THREE.Mesh) {
      straightenKoiGeometry(obj.geometry);
    }
  });

  const proto = buildNormalizedKoiPrototype(baked);
  const box = new THREE.Box3().setFromObject(proto);
  const size = new THREE.Vector3();
  box.getSize(size);

  assert.ok(Math.abs(size.z - 1.0) < 1e-4, `normalized length Z should be 1.0, got ${size.z}`);
  assert.ok(size.y < size.z && size.y < size.x * 1.1, 'dorsal Y stays compact after unbending');
  assert.ok(size.x < 0.35, `straightened width X should be narrow (~torso), got ${size.x}`);
});

test('environment defaults, storage key, water depth ordering, and contact channels stay valid', () => {
  assert.equal(DEFAULT_ENVIRONMENT, 'desk');
  assert.equal(ENVIRONMENT_STORAGE_KEY, 'kihurn-environment');
  assert.ok(POND_LAYOUT.waterDepthOffset > 0.1);
  assert.ok(POND_LAYOUT.bedDepthOffset > POND_LAYOUT.waterDepthOffset + 0.4);
  assert.ok(SITE_CONFIG.contact.channels.some((c) => c.href?.includes('github.com/kihurn')));
  assert.ok(SITE_CONFIG.contact.channels.some((c) => c.href?.startsWith('mailto:')));
});

test('KOI_PATROL_SPECS spawns, waypoints, and segment midpoints stay completely clear of book overhang and obstacles', async () => {
  const { KOI_PATROL_SPECS } = await import('./KoiSchool');
  assert.equal(KOI_PATROL_SPECS.length, 6, 'all 6 koi varieties have patrol specs');

  for (let i = 0; i < KOI_PATROL_SPECS.length; i++) {
    const spec = KOI_PATROL_SPECS[i];
    const initSep = nearestObstacleSeparation(spec.initX, spec.initZ, 0.24, true, true);
    assert.ok(
      initSep.dist > 0,
      `koi ${i} init (${spec.initX}, ${spec.initZ}) should clear obstacles/book, got dist=${initSep.dist}`,
    );

    for (let w = 0; w < spec.waypoints.length; w++) {
      const wp = spec.waypoints[w];
      const next = spec.waypoints[(w + 1) % spec.waypoints.length];
      const wpSep = nearestObstacleSeparation(wp.x, wp.z, 0.24, true, true);
      assert.ok(
        wpSep.dist > 0,
        `koi ${i} waypoint ${w} (${wp.x}, ${wp.z}) should clear obstacles/book, got dist=${wpSep.dist}`,
      );

      const midX = (wp.x + next.x) * 0.5;
      const midZ = (wp.z + next.z) * 0.5;
      const midSep = nearestObstacleSeparation(midX, midZ, 0.24, true, true);
      assert.ok(
        midSep.dist > 0,
        `koi ${i} segment ${w}->${(w + 1) % spec.waypoints.length} midpoint (${midX}, ${midZ}) should clear obstacles/book, got dist=${midSep.dist}`,
      );
    }
  }
});

test('KOI_PATROL_SPECS distributes 6 koi evenly across North & South lagoons with 3 distinct depth layers each', async () => {
  const { KOI_PATROL_SPECS } = await import('./KoiSchool');
  const northLagoon = KOI_PATROL_SPECS.filter((s) => s.initZ < -0.9);
  const southLagoon = KOI_PATROL_SPECS.filter((s) => s.initZ > 0.8);

  assert.equal(northLagoon.length, 3, '3 koi spawn in North open-water lagoon');
  assert.equal(southLagoon.length, 3, '3 koi spawn in South open-water lagoon');

  for (const [label, lagoon] of [
    ['north', northLagoon],
    ['south', southLagoon],
  ] as const) {
    const depths = new Set(lagoon.map((k) => k.depthOffset));
    assert.equal(
      depths.size,
      3,
      `${label} lagoon koi should occupy 3 distinct depth layers`,
    );
  }
});

test('bakeKoiSceneTransforms promotes normalized Int16 attributes to Float32 before scaling', async () => {
  const THREE = await import('three');
  const { bakeKoiSceneTransforms } = await import('./KoiSchool');

  const count = 1200;
  const rawPos = new Int16Array(count * 3);
  const rawNorm = new Int8Array(count * 3);
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    rawPos[i * 3] = Math.round((Math.sin(t * Math.PI * 4) * 0.2) * 32767);
    rawPos[i * 3 + 1] = Math.round((Math.cos(t * Math.PI * 2) * 0.15) * 32767);
    rawPos[i * 3 + 2] = Math.round((-0.9 + t * 1.8) * 16000);
    rawNorm[i * 3] = 0;
    rawNorm[i * 3 + 1] = 127;
    rawNorm[i * 3 + 2] = 0;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Int16BufferAttribute(rawPos, 3, true));
  geo.setAttribute('normal', new THREE.Int8BufferAttribute(rawNorm, 3, true));

  const parent = new THREE.Group();
  parent.scale.setScalar(0.0041);
  parent.rotation.x = -Math.PI / 2;
  parent.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial()));

  const baked = bakeKoiSceneTransforms(parent);
  let bakedMesh: THREE.Mesh | null = null;
  baked.traverse((o) => {
    if (o instanceof THREE.Mesh) bakedMesh = o;
  });
  assert.ok(bakedMesh, 'baked mesh exists');
  const posAttr = (bakedMesh as THREE.Mesh).geometry.attributes.position as THREE.BufferAttribute;
  assert.ok(posAttr.array instanceof Float32Array, 'position promoted to Float32Array');
  assert.equal(posAttr.normalized, false, 'normalized flag cleared after promotion');

  const distinctZ = new Set<string>();
  for (let i = 0; i < posAttr.count; i++) {
    distinctZ.add(posAttr.getZ(i).toFixed(7));
  }
  assert.ok(
    distinctZ.size > 1000,
    `expected >1000 distinct float coordinates without Int16 truncation, got ${distinctZ.size}`,
  );
});

test('stepKoiSchoolMotion escapes obstacle hits and recovers from stalled states cleanly', async () => {
  const { KOI_PATROL_SPECS, stepKoiSchoolMotion } = await import('./KoiSchool');
  type KoiMotionState = import('./KoiSchool').KoiMotionState;

  // 1. Hit-obstacle escape: koi facing straight into open book south overhang edge
  const hitAgent: KoiMotionState = {
    spec: KOI_PATROL_SPECS[3],
    x: 0,
    z: 0.78,
    vx: 0,
    vz: -0.15,
    yaw: Math.PI, // facing -Z toward open book
    speed: 0.15,
    burst: 0,
    turnBend: 0,
    swimPhase: 0,
    wanderPhase: 0,
    waypointIndex: 0,
    anchorX: 0,
    anchorZ: 0.78,
    stuckTimer: 0,
    evadeTimer: 0,
    evadeYaw: Math.PI,
  };

  for (let step = 0; step < 75; step++) {
    stepKoiSchoolMotion([hitAgent], 0.03, step * 0.03, [], true);
  }

  assert.ok(hitAgent.evadeTimer > 0 || Math.cos(hitAgent.yaw) > 0.3, 'koi turns away from open book edge');
  assert.ok(Math.cos(hitAgent.yaw) > 0.3, `expected south-facing escape yaw, cos(yaw)=${Math.cos(hitAgent.yaw)}`);
  assert.ok(hitAgent.z > 0.85, `expected koi to move south into clear water, got z=${hitAgent.z}`);

  // 2. Stuck recovery: pinned koi triggers evade and moves cleanly away into open water
  const stuckAgent: KoiMotionState = {
    spec: KOI_PATROL_SPECS[4],
    x: 0.92,
    z: 0.84,
    vx: 0,
    vz: 0,
    yaw: -Math.PI * 0.75,
    speed: 0.15,
    burst: 0,
    turnBend: 0,
    swimPhase: 0,
    wanderPhase: 0,
    waypointIndex: 2,
    anchorX: 0.92,
    anchorZ: 0.84,
    stuckTimer: 1.4,
    evadeTimer: 0,
    evadeYaw: 0,
  };

  stepKoiSchoolMotion([stuckAgent], 0.03, 0.03, [], true);
  assert.ok(stuckAgent.evadeTimer > 0, 'stuck condition activates evadeTimer');
  assert.equal(stuckAgent.stuckTimer, 0, 'stuckTimer resets once escape vector is engaged');

  for (let step = 1; step < 80; step++) {
    stepKoiSchoolMotion([stuckAgent], 0.03, step * 0.03, [], true);
  }

  const movedDist = Math.hypot(stuckAgent.x - 0.92, stuckAgent.z - 0.84);
  assert.ok(movedDist >= 0.25, `expected stuck koi to swim clear (>=0.25m), moved ${movedDist}m`);
  const endSep = nearestObstacleSeparation(stuckAgent.x, stuckAgent.z, 0.24, true, true);
  assert.ok(endSep.dist > 0, `expected escaped koi in clear water, got dist=${endSep.dist}`);
});

test('straightenKoiGeometry un-bends low-curvature quadratic C-curve without pinching', async () => {
  const THREE = await import('three');
  const { straightenKoiGeometry } = await import('./KoiSchool');

  const segs = 48;
  const rings = 24;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const z = -1.0 + t * 2.0; // spanZ = 2.0
    const u = z; // u in [-1, 1]
    const cx = 0.03 * u * u - 0.015; // R ~ 16.7 >> spanZ * 4.5 (triggers quadratic fallback)
    const dxdz = 0.06 * u;
    const invLen = 1 / Math.hypot(dxdz, 1);
    const nx = invLen;
    const nz = -dxdz * invLen;
    const radX = 0.04 + Math.sin(t * Math.PI) * 0.14;
    const radY = 0.03 + Math.sin(t * Math.PI) * 0.07;
    for (let j = 0; j < rings; j++) {
      const a = (j / rings) * Math.PI * 2;
      const off = Math.cos(a) * radX;
      positions.push(cx + nx * off, Math.sin(a) * radY, z + nz * off);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < rings; j++) {
      const jNext = (j + 1) % rings;
      const a = i * rings + j;
      const b = i * rings + jNext;
      const c = (i + 1) * rings + j;
      const d = (i + 1) * rings + jNext;
      indices.push(a, c, d, a, d, b);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  straightenKoiGeometry(geo);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const norm = geo.attributes.normal as THREE.BufferAttribute;
  let maxAbsCenterX = 0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z), 'finite position');
    const nLen = Math.hypot(norm.getX(i), norm.getY(i), norm.getZ(i));
    assert.ok(Math.abs(nLen - 1) < 1e-3, `unit normal preserved, got ${nLen}`);
    if (Math.abs(x) > maxAbsCenterX) maxAbsCenterX = Math.abs(x);
  }
  assert.ok(maxAbsCenterX < 0.22, `straightened lateral half-width stays compact, got ${maxAbsCenterX}`);
});

test('RIGHT_UNDERWATER_SHOAL_STONES stay submerged below waterY, bed-anchored, and clear of book/card', async () => {
  const { RIGHT_UNDERWATER_SHOAL_STONES, computeSubmergedStoneCenterY } = await import('./PondFlora');
  const waterY = -POND_LAYOUT.waterDepthOffset;
  const bedY = -POND_LAYOUT.bedDepthOffset;

  assert.ok(RIGHT_UNDERWATER_SHOAL_STONES.length >= 12, 'expanded natural right-side underwater shoal');
  for (const s of RIGHT_UNDERWATER_SHOAL_STONES) {
    const cy = computeSubmergedStoneCenterY(waterY, bedY, s);
    const halfH = Math.max(s.height * 1.06, s.radius * 0.64);
    const topY = cy + halfH * 1.08;
    const botY = cy - halfH * 0.92;

    assert.ok(topY <= waterY - 0.05, `stone (${s.x}, ${s.z}) topY=${topY} stays >=5cm submerged`);
    assert.ok(botY <= bedY + 0.08, `stone (${s.x}, ${s.z}) botY=${botY} anchors near bedY=${bedY}`);
    const inBookFootprint = Math.abs(s.x) < 1.48 && Math.abs(s.z) < 0.44;
    assert.equal(inBookFootprint, false, `stone (${s.x}, ${s.z}) does not intersect open book`);
    const distToCardPad = Math.hypot(s.x - 1.56, s.z - 0.6);
    assert.ok(distToCardPad > s.radius + 0.2, `stone (${s.x}, ${s.z}) clears card pad`);
  }
});
