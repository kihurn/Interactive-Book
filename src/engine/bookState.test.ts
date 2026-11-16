import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BOOK_TIMING, LAMPLIT_DESK_THEME } from '../config/theme';
import { createBookRig } from './BookMesh';
import type { BookStaticTextureSet } from './textures';
import {
  beginClose,
  beginDragTurn,
  beginOpen,
  computeCursorCameraOffset,
  computeLampShadowOffset,
  computePageSupersampleScale,
  computePhaseLighting,
  computeTurnPlan,
  createInitialBookState,
  deformPageVertex,
  finishClose,
  finishDragTurn,
  finishOpen,
  finishTurn,
  getStepTarget,
  requestSpreadNavigation,
  resolveDragRelease,
  worldOffsetToLocal,
} from './bookState';

test('book open and close lifecycle transitions cleanly without overlapping', () => {
  let state = createInitialBookState(4, false, 10);
  assert.equal(state.phase, 'closed');
  assert.equal(state.physicalSpreads, 10);

  // Cannot navigate while closed
  const navClosed = requestSpreadNavigation(state, 1);
  assert.equal(navClosed.started, false);
  assert.equal(navClosed.nextState.phase, 'closed');

  // Open cycle
  state = beginOpen(state);
  assert.equal(state.phase, 'opening');
  // Repeated beginOpen ignored while opening
  assert.equal(beginOpen(state).phase, 'opening');

  state = finishOpen(state);
  assert.equal(state.phase, 'open');
  assert.equal(state.currentSpread, 0);

  // Close cycle
  state = beginClose(state);
  assert.equal(state.phase, 'closing');
  state = finishClose(state);
  assert.equal(state.phase, 'closed');
  assert.equal(state.currentSpread, 0);
});

test('autostart initializes directly in open state', () => {
  const state = createInitialBookState(4, true, 10);
  assert.equal(state.phase, 'open');
  assert.equal(state.currentSpread, 0);
  assert.equal(state.mobileSide, 'right');
});

test('rapid navigation queues at most one subsequent turn and respects boundaries', () => {
  let state = createInitialBookState(4, true, 10);

  // Boundary: cannot go previous from spread 0 on desktop
  assert.equal(getStepTarget(state, 'prev', false), null);

  // Boundary: cannot step past active coming-soon spread (spread 3) even though physicalSpreads=10
  const atLimit = { ...state, currentSpread: 3 };
  assert.equal(getStepTarget(atLimit, 'next', false), null);

  // Start turn 0 -> 1
  const t1 = requestSpreadNavigation(state, 1);
  assert.equal(t1.started, true);
  state = t1.nextState;
  assert.equal(state.phase, 'turning');
  assert.equal(state.targetSpread, 1);

  // Rapid second click -> queued (targetSpread 2)
  const t2 = requestSpreadNavigation(state, 2);
  assert.equal(t2.started, false);
  state = t2.nextState;
  assert.deepEqual(state.queuedNavigation, {
    targetSpread: 2,
    targetMobileSide: undefined,
  });

  // Rapid third click -> ignored because queue already holds 1 item
  const t3 = requestSpreadNavigation(state, 3);
  assert.equal(t3.started, false);
  state = t3.nextState;
  assert.deepEqual(state.queuedNavigation, {
    targetSpread: 2,
    targetMobileSide: undefined,
  });

  // Finishing turn 1 surfaces the single queued plan (2)
  const finished = finishTurn(state);
  assert.equal(finished.nextState.phase, 'open');
  assert.equal(finished.nextState.currentSpread, 1);
  assert.deepEqual(finished.queuedPlan, {
    targetSpread: 2,
    targetMobileSide: undefined,
  });
});

test('mobile single-page mode steps left -> right -> next spread left', () => {
  let state = createInitialBookState(3, true);
  state = { ...state, mobileSide: 'left', currentSpread: 0 };

  const step1 = getStepTarget(state, 'next', true);
  assert.deepEqual(step1, { targetSpread: 0, targetMobileSide: 'right' });

  state = { ...state, mobileSide: 'right' };
  const step2 = getStepTarget(state, 'next', true);
  assert.deepEqual(step2, { targetSpread: 1, targetMobileSide: 'left' });

  // Boundary at last spread right page
  state = { ...state, currentSpread: 2, mobileSide: 'right' };
  assert.equal(getStepTarget(state, 'next', true), null);
});

test('computeTurnPlan caps batch sheets for distant contents jumps and matches BOOK_TIMING pacing', () => {
  const single = computeTurnPlan(0, 1);
  assert.equal(single.direction, 'next');
  assert.equal(single.sheetCount, 1);
  assert.equal(single.staggerMs, 0);
  assert.equal(single.durationMs, 1000);

  const jump = computeTurnPlan(0, 4, 3, 760, 560, 90);
  assert.equal(jump.direction, 'next');
  assert.equal(jump.sheetCount, 3);
  assert.equal(jump.staggerMs, 90);

  const backJump = computeTurnPlan(4, 0, 3);
  assert.equal(backJump.direction, 'prev');
  assert.equal(backJump.sheetCount, 3);

  assert.equal(BOOK_TIMING.openDurationMs, 1400);
  assert.equal(BOOK_TIMING.singleTurnDurationMs, 1000);
  assert.ok(BOOK_TIMING.closeDurationMs > BOOK_TIMING.openDurationMs);
  assert.ok(BOOK_TIMING.closeSweepDurationMs > 800);
});

test('deformPageVertex anchors spine at x=0, avoids NaN, and clears asymmetric stacks without clipping', () => {
  const pageWidth = 1.44;
  const pageHeight = 0.81;
  const leftY = 0.024;
  const rightY = 0.095;

  for (const progress of [0, 0.15, 0.25, 0.5, 0.75, 0.85, 1]) {
    const spine = deformPageVertex(0, 0.5, pageWidth, pageHeight, progress, leftY, rightY);
    assert.ok(Number.isFinite(spine.x) && Number.isFinite(spine.y) && Number.isFinite(spine.z));
    assert.ok(Math.abs(spine.x) < 1e-6, `spine x should stay anchored at 0, got ${spine.x}`);

    const outer = deformPageVertex(1, 0.5, pageWidth, pageHeight, progress, leftY, rightY);
    assert.ok(Number.isFinite(outer.x) && Number.isFinite(outer.y) && Number.isFinite(outer.z));

    if (progress === 0) {
      assert.ok(Math.abs(outer.x - pageWidth) < 1e-5);
      assert.ok(Math.abs(outer.y - rightY) < 1e-5);
    } else if (progress === 1) {
      assert.ok(Math.abs(outer.x + pageWidth) < 1e-5);
      assert.ok(Math.abs(outer.y - leftY) < 1e-5);
    } else {
      // Every non-spine sample mid-turn must stay above the higher of the two stacks
      for (const uSample of [0.2, 0.5, 0.8, 1.0]) {
        const lowerSheet = deformPageVertex(uSample, 0.5, pageWidth, pageHeight, progress, leftY, rightY, 0);
        const upperSheet = deformPageVertex(uSample, 0.5, pageWidth, pageHeight, progress, leftY, rightY, 0.65);
        assert.ok(
          lowerSheet.y >= Math.max(leftY, rightY),
          `u=${uSample} at p=${progress} dipped to ${lowerSheet.y} < ${Math.max(leftY, rightY)}`,
        );
        assert.ok(
          upperSheet.y > lowerSheet.y,
          `batch sheet with higher liftBias should stay cleanly above lower sheet`,
        );
      }
      if (progress === 0.5) {
        assert.ok(outer.y > Math.max(leftY, rightY) + 0.5, 'outer edge should arch well above stacks');
      }
    }
  }
});

test('computeCursorCameraOffset clamps extreme NDC coordinates cleanly', () => {
  const center = computeCursorCameraOffset(0, 0, 0.05, 0.02);
  assert.equal(center.yawRad, 0);
  assert.equal(center.pitchRad, 0);

  const clamped = computeCursorCameraOffset(4, -3, 0.05, 0.02);
  assert.equal(clamped.yawRad, -0.05);
  assert.equal(clamped.pitchRad, -0.02);

  const nanSafe = computeCursorCameraOffset(Number.NaN, 0.5, 0.05, 0.02);
  assert.equal(nanSafe.yawRad, 0);
  assert.equal(nanSafe.pitchRad, 0.01);
});

test('drag-to-flip commits on threshold or flick velocity, springs back on shallow release, and respects bounds', () => {
  const openState = createInitialBookState(4, true, 10);

  // Cannot drag prev at spread 0 on desktop
  const blockedPrev = beginDragTurn(openState, 'prev', false);
  assert.equal(blockedPrev.startedSheetDrag, false);

  // Dragging next from spread 0 -> 1
  const started = beginDragTurn(openState, 'next', false);
  assert.equal(started.startedSheetDrag, true);
  assert.equal(started.fromSpread, 0);
  assert.equal(started.toSpread, 1);
  assert.equal(started.nextState.phase, 'turning');

  // Shallow or weak-flick drag springs back (requires holding and dragging farther)
  const cancelShallow = resolveDragRelease({ direction: 'next', progress: 0.38, velocityPxPerMs: -0.05 });
  assert.deepEqual(cancelShallow, { committed: false, endProgress: 0 });
  const cancelTooShortFlick = resolveDragRelease({ direction: 'next', progress: 0.14, velocityPxPerMs: -1.1 });
  assert.deepEqual(cancelTooShortFlick, { committed: false, endProgress: 0 });
  const reverted = finishDragTurn(started.nextState, false);
  assert.equal(reverted.phase, 'open');
  assert.equal(reverted.currentSpread, 0);

  // Deliberate drag past 0.52 or strong flick past minFlickProgress commits
  const commitDrag = resolveDragRelease({ direction: 'next', progress: 0.55, velocityPxPerMs: -0.04 });
  assert.deepEqual(commitDrag, { committed: true, endProgress: 1 });
  const flickNext = resolveDragRelease({ direction: 'next', progress: 0.28, velocityPxPerMs: -1.1 });
  assert.deepEqual(flickNext, { committed: true, endProgress: 1 });
  const committed = finishDragTurn(started.nextState, true);
  assert.equal(committed.phase, 'open');
  assert.equal(committed.currentSpread, 1);

  // Prev drag release checks
  const commitPrev = resolveDragRelease({ direction: 'prev', progress: 0.42, velocityPxPerMs: 0.05 });
  assert.deepEqual(commitPrev, { committed: true, endProgress: 0 });
  const cancelPrev = resolveDragRelease({ direction: 'prev', progress: 0.65, velocityPxPerMs: 0.15 });
  assert.deepEqual(cancelPrev, { committed: false, endProgress: 1 });
});

test('computePhaseLighting dynamically scales lamp and ambient lighting with openProgress', () => {
  const base = {
    spotIntensity: 38,
    spotAngle: Math.PI / 2.05,
    spotPenumbra: 0.92,
    keyIntensity: 0.94,
    keyPosition: { x: -0.85, y: 3.3, z: 0.85 },
    hemiIntensity: 0.16,
    rimIntensity: 0.5,
  };
  const closed = computePhaseLighting(0, base);
  const half = computePhaseLighting(0.5, base);
  const open = computePhaseLighting(1, base);

  assert.ok(open.spotIntensity > half.spotIntensity && half.spotIntensity > closed.spotIntensity);
  assert.ok(open.keyIntensity > closed.keyIntensity);
  assert.ok(open.spotAngle > closed.spotAngle);
  assert.ok(open.hemiIntensity < closed.hemiIntensity);
  assert.ok(open.environmentIntensity > closed.environmentIntensity);
});

test('computePageSupersampleScale scales dynamically between closed and open reading views', () => {
  const closedGpu = computePageSupersampleScale({
    phase: 'closed',
    viewportWidth: 1440,
    dpr: 2,
    isSoftwareGl: false,
    maxTextureSize: 8192,
  });
  const openGpu = computePageSupersampleScale({
    phase: 'open',
    viewportWidth: 1440,
    dpr: 2,
    isSoftwareGl: false,
    maxTextureSize: 8192,
  });
  const openLowTex = computePageSupersampleScale({
    phase: 'open',
    viewportWidth: 1440,
    dpr: 2,
    isSoftwareGl: false,
    maxTextureSize: 2048,
  });
  const openSoftware = computePageSupersampleScale({
    phase: 'open',
    viewportWidth: 1440,
    dpr: 1,
    isSoftwareGl: true,
    maxTextureSize: 4096,
  });

  assert.equal(closedGpu, 1.25);
  assert.equal(openGpu, 2.0);
  assert.ok(openLowTex <= 2048 / 1920 + 1e-5);
  assert.equal(openSoftware, 1.5);
});

test('computeLampShadowOffset projects prop drop shadows away from lamp angle cleanly', () => {
  // Plant at (-1.72, -0.08) illuminated by lamp at (-0.42, 3.35, 0.52) casts toward -X, -Z
  const plantOff = computeLampShadowOffset({
    propX: -1.72,
    propZ: -0.08,
    lampX: -0.42,
    lampY: 3.35,
    lampZ: 0.52,
    castHeight: 0.2,
  });
  assert.ok(plantOff.worldDx < 0 && plantOff.worldDz < 0);

  // Coffee at (+1.72, -0.06) casts toward +X, -Z
  const coffeeOff = computeLampShadowOffset({
    propX: 1.72,
    propZ: -0.06,
    lampX: -0.42,
    lampY: 3.35,
    lampZ: 0.52,
    castHeight: 0.14,
  });
  assert.ok(coffeeOff.worldDx > 0 && coffeeOff.worldDz < 0);

  // World-to-local rotation reverses when rotated back by +rotationY
  const local = worldOffsetToLocal(0.06, -0.02, 0.42, 0.9);
  assert.ok(Number.isFinite(local.localDx) && Number.isFinite(local.localDz));
});

test('closedHitTargets only matches visible closed cover and ignores hidden left-side meshes', () => {
  const stubTex = new THREE.Texture() as unknown as THREE.CanvasTexture;
  const staticStub: BookStaticTextureSet = {
    frontCoverMap: stubTex,
    backCoverMap: stubTex,
    coverRoughnessMap: stubTex,
    coverBumpMap: stubTex,
    stonewareMap: stubTex,
    pageEdgeMap: stubTex,
    coffeeLatteMap: stubTex,
    businessCardMap: stubTex,
    dispose: () => {},
  };

  const rig = createBookRig(LAMPLIT_DESK_THEME, staticStub, 2);
  rig.group.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);

  // Directly to the left of the closed book (-1.2, 0): must NOT hit closedHitTargets
  raycaster.set(new THREE.Vector3(-1.2, 3, 0), down);
  assert.equal(raycaster.intersectObjects(rig.closedHitTargets, false).length, 0);
  // Confirm why group recursion failed before: group contains invisible left-side meshes there
  assert.ok(raycaster.intersectObject(rig.group, true).length > 0);

  // Center of the closed cover (0.0, 0): must hit frontCoverMesh cleanly
  raycaster.set(new THREE.Vector3(0, 3, 0), down);
  const coverHits = raycaster.intersectObjects(rig.closedHitTargets, false);
  assert.ok(coverHits.length > 0);
  assert.equal(coverHits[0].object, rig.frontCoverMesh);

  // Outside right edge (+1.2, 0): must NOT hit closedHitTargets
  raycaster.set(new THREE.Vector3(1.2, 3, 0), down);
  assert.equal(raycaster.intersectObjects(rig.closedHitTargets, false).length, 0);

  rig.dispose();
});
