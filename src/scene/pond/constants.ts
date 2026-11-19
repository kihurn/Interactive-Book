export interface PondObstacleCircle {
  kind: 'circle';
  id: string;
  x: number;
  z: number;
  radius: number;
}

export interface PondObstacleRoundedRect {
  kind: 'roundedRect';
  id: string;
  x: number;
  z: number;
  halfW: number;
  halfD: number;
  cornerRadius: number;
}

export type PondObstacle = PondObstacleCircle | PondObstacleRoundedRect;

export const POND_BOUNDS = {
  minX: -6.5,
  maxX: 6.5,
  minZ: -5.0,
  maxZ: 5.0,
  width: 13.0,
  depth: 10.0,
} as const;

export const POND_LAYOUT = {
  waterDepthOffset: 0.108, // slimmer ~32% lower plank profile: waterY = surfaceY - 0.108
  bedDepthOffset: 0.81,    // pondBedY = surfaceY - 0.81 (= waterY - 0.702)
  plankWidth: 2.51,        // ~85.3% of open book width (2.944) — sleek profile while supporting open book with overhanging corners
  plankDepth: 0.745,       // ~85.2% of open book depth (0.874)
  lanternPos: { x: -1.86, z: -0.34 },
  lotusPadPos: { x: -1.72, z: 0.56 },
  companionPadPos: { x: -2.06, z: 0.24 },
  emergentBoulders: [
    { id: 'boulder-a', x: 1.66, z: -0.5, radius: 0.29, aboveWater: 0.145, belowWater: 0.165, yaw: 0.45 },
    { id: 'boulder-b', x: 2.04, z: -0.24, radius: 0.23, aboveWater: 0.115, belowWater: 0.135, yaw: -1.1 },
    { id: 'boulder-c', x: 1.46, z: -0.84, radius: 0.21, aboveWater: 0.105, belowWater: 0.125, yaw: 1.85 },
  ],
  dripWorldPos: { x: 1.24, z: -0.18 },
} as const;

export const POND_OBSTACLES: PondObstacle[] = [
  {
    kind: 'roundedRect',
    id: 'floating-plank',
    x: 0,
    z: 0,
    halfW: POND_LAYOUT.plankWidth * 0.5,
    halfD: POND_LAYOUT.plankDepth * 0.5,
    cornerRadius: 0.08,
  },
  {
    kind: 'circle',
    id: 'lantern-rock',
    x: POND_LAYOUT.lanternPos.x,
    z: POND_LAYOUT.lanternPos.z,
    radius: 0.43,
  },
  ...POND_LAYOUT.emergentBoulders.map((b) => ({
    kind: 'circle' as const,
    id: b.id,
    x: b.x,
    z: b.z,
    radius: b.radius * 1.04,
  })),
];

export const OPEN_BOOK_OVERHANG_OBSTACLE: PondObstacleRoundedRect = {
  kind: 'roundedRect',
  id: 'open-book-overhang',
  x: 0,
  z: 0,
  halfW: 1.54,
  halfD: 0.50,
  cornerRadius: 0.08,
};

export const KOI_PAD_OBSTACLES: PondObstacleCircle[] = [
  {
    kind: 'circle',
    id: 'lotus-lily-pad',
    x: POND_LAYOUT.lotusPadPos.x,
    z: POND_LAYOUT.lotusPadPos.z,
    radius: 0.34,
  },
  {
    kind: 'circle',
    id: 'companion-lily-pad',
    x: POND_LAYOUT.companionPadPos.x,
    z: POND_LAYOUT.companionPadPos.z,
    radius: 0.22,
  },
  {
    kind: 'circle',
    id: 'card-lily-pad',
    x: 1.56,
    z: 0.60,
    radius: 0.27,
  },
];

export function worldToPondUv(worldX: number, worldZ: number): { u: number; v: number } {
  const u = (worldX - POND_BOUNDS.minX) / POND_BOUNDS.width;
  // Flip Z so +v corresponds smoothly with Three.js PlaneGeometry rotated -PI/2 around X
  const v = 1 - (worldZ - POND_BOUNDS.minZ) / POND_BOUNDS.depth;
  return {
    u: Math.max(0, Math.min(1, u)),
    v: Math.max(0, Math.min(1, v)),
  };
}

export function pondUvToWorld(u: number, v: number): { x: number; z: number } {
  return {
    x: POND_BOUNDS.minX + u * POND_BOUNDS.width,
    z: POND_BOUNDS.minZ + (1 - v) * POND_BOUNDS.depth,
  };
}

export function signedDistanceToObstacle(
  worldX: number,
  worldZ: number,
  obs: PondObstacle,
): number {
  const dx = worldX - obs.x;
  const dz = worldZ - obs.z;
  if (obs.kind === 'circle') {
    return Math.hypot(dx, dz) - obs.radius;
  }
  const qx = Math.abs(dx) - Math.max(0, obs.halfW - obs.cornerRadius);
  const qz = Math.abs(dz) - Math.max(0, obs.halfD - obs.cornerRadius);
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - obs.cornerRadius;
}

export function nearestObstacleSeparation(
  worldX: number,
  worldZ: number,
  extraMargin = 0,
  includeOpenBookOverhang = false,
  includeLilyPads = false,
): { dist: number; nx: number; nz: number } {
  let bestDist = Infinity;
  let bestNx = 0;
  let bestNz = 1;

  const list: PondObstacle[] = [...POND_OBSTACLES];
  if (includeOpenBookOverhang) {
    list.push(OPEN_BOOK_OVERHANG_OBSTACLE);
  }
  if (includeLilyPads) {
    list.push(...KOI_PAD_OBSTACLES);
  }

  for (const obs of list) {
    const d = signedDistanceToObstacle(worldX, worldZ, obs) - extraMargin;
    if (d < bestDist) {
      bestDist = d;
      const vx = worldX - obs.x;
      const vz = worldZ - obs.z;
      const mag = Math.hypot(vx, vz) || 1;
      bestNx = vx / mag;
      bestNz = vz / mag;
    }
  }

  return { dist: bestDist, nx: bestNx, nz: bestNz };
}
