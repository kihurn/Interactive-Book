import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBookFocusPoint,
  computeCircleOfConfusion,
  computeDofProfile,
  computeLinearFocusDistance,
} from './dof';

test('computeBookFocusPoint tracks centered book on desktop and active page on mobile', () => {
  const desktopClosed = computeBookFocusPoint({
    openProgress: 0,
    isMobile: false,
    mobileSide: 'left',
    surfaceY: 0,
    pageWidth: 1.44,
  });
  assert.equal(desktopClosed.x, 0);
  assert.equal(desktopClosed.z, 0);
  assert.ok(Math.abs(desktopClosed.y - 0.065) < 1e-6);

  const mobileOpenRight = computeBookFocusPoint({
    openProgress: 1,
    isMobile: true,
    mobileSide: 'right',
    surfaceY: 0,
    pageWidth: 1.44,
  });
  assert.ok(Math.abs(mobileOpenRight.x - 0.72) < 1e-6);
  assert.ok(Math.abs(mobileOpenRight.y - 0.055) < 1e-6);

  const mobileOpenLeft = computeBookFocusPoint({
    openProgress: 1,
    isMobile: true,
    mobileSide: 'left',
    surfaceY: 0,
    pageWidth: 1.44,
  });
  assert.ok(Math.abs(mobileOpenLeft.x + 0.72) < 1e-6);
});

test('computeLinearFocusDistance projects focus point along camera forward vector accurately', () => {
  // Matches LAMPLIT_DESK_THEME.camera.desktopOpen
  const camPos = { x: 0, y: 3.36, z: 1.88 };
  const camTarget = { x: 0, y: 0.02, z: -0.15 };
  const bookCenter = computeBookFocusPoint({
    openProgress: 1,
    isMobile: false,
    mobileSide: 'right',
    surfaceY: 0,
    pageWidth: 1.44,
  });

  const focusDist = computeLinearFocusDistance({
    cameraPos: camPos,
    cameraTarget: camTarget,
    focusPoint: bookCenter,
  });
  assert.ok(focusDist > 3.7 && focusDist < 3.9, `expected ~3.80m, got ${focusDist}`);

  // Degenerate camera == target falls back safely without NaN
  const fallback = computeLinearFocusDistance({
    cameraPos: { x: 0, y: 1, z: 0 },
    cameraTarget: { x: 0, y: 1, z: 0 },
    focusPoint: bookCenter,
  });
  assert.ok(Number.isFinite(fallback) && fallback > 0);
});

test('DOF deadzone keeps entire closed and open book at zero Circle of Confusion', () => {
  const closedProfile = computeDofProfile({
    openProgress: 0,
    isMobile: false,
    environmentId: 'desk',
  });
  const openProfile = computeDofProfile({
    openProgress: 1,
    isMobile: false,
    environmentId: 'pond',
  });

  // Closed book depth span relative to focus center is ~[-0.29m, +0.29m]
  for (const offset of [-0.29, -0.15, 0, 0.15, 0.29]) {
    const res = computeCircleOfConfusion(4.0 + offset, 4.0, closedProfile);
    assert.equal(res.coc, 0, `closed book offset ${offset} should have zero blur`);
  }

  // Open book depth span relative to focus center (including max cursor parallax) is ~[-0.27m, +0.27m]
  for (const offset of [-0.27, -0.15, 0, 0.15, 0.27]) {
    const res = computeCircleOfConfusion(3.8 + offset, 3.8, openProfile);
    assert.equal(res.coc, 0, `open book offset ${offset} should have zero blur`);
  }
});

test('Circle of Confusion increases monotonically beyond focal deadzone and clamps cleanly', () => {
  const profile = computeDofProfile({
    openProgress: 1,
    isMobile: false,
    environmentId: 'pond',
  });
  const focus = 3.8;

  const midFar = computeCircleOfConfusion(focus + 0.85, focus, profile);
  const distantFar = computeCircleOfConfusion(focus + 1.5, focus, profile);
  const extremeFar = computeCircleOfConfusion(focus + 20, focus, profile);

  assert.ok(midFar.coc > 0 && midFar.coc < distantFar.coc);
  assert.ok(distantFar.coc > midFar.coc && distantFar.coc <= 1);
  assert.equal(extremeFar.coc, 1);
  assert.equal(extremeFar.signedCoc, 1);

  const nearEdge = computeCircleOfConfusion(focus - 0.9, focus, profile);
  assert.ok(nearEdge.coc > 0 && nearEdge.signedCoc < 0);

  const nanSafe = computeCircleOfConfusion(Number.NaN, focus, profile);
  assert.deepEqual(nanSafe, { coc: 0, signedCoc: 0 });
});
