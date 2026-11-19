import assert from 'node:assert/strict';
import test from 'node:test';
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
  const clearSep = nearestObstacleSeparation(-0.9, 1.25, 0.1);
  assert.ok(clearSep.dist > 0.2, 'open swimming lane stays unobstructed');
});

test('environment defaults, storage key, water depth ordering, and contact channels stay valid', () => {
  assert.equal(DEFAULT_ENVIRONMENT, 'desk');
  assert.equal(ENVIRONMENT_STORAGE_KEY, 'kihurn-environment');
  assert.ok(POND_LAYOUT.waterDepthOffset > 0.1);
  assert.ok(POND_LAYOUT.bedDepthOffset > POND_LAYOUT.waterDepthOffset + 0.4);
  assert.ok(SITE_CONFIG.contact.channels.some((c) => c.href?.includes('github.com/kihurn')));
  assert.ok(SITE_CONFIG.contact.channels.some((c) => c.href?.startsWith('mailto:')));
});
