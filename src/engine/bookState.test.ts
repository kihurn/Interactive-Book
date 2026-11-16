import test from 'node:test';
import assert from 'node:assert/strict';
import {
  beginClose,
  beginOpen,
  computeCursorCameraOffset,
  computeTurnPlan,
  createInitialBookState,
  deformPageVertex,
  finishClose,
  finishOpen,
  finishTurn,
  getStepTarget,
  requestSpreadNavigation,
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

test('computeTurnPlan caps batch sheets for distant contents jumps', () => {
  const single = computeTurnPlan(0, 1);
  assert.equal(single.direction, 'next');
  assert.equal(single.sheetCount, 1);
  assert.equal(single.staggerMs, 0);

  const jump = computeTurnPlan(0, 4, 3, 760, 560, 90);
  assert.equal(jump.direction, 'next');
  assert.equal(jump.sheetCount, 3);
  assert.equal(jump.staggerMs, 90);

  const backJump = computeTurnPlan(4, 0, 3);
  assert.equal(backJump.direction, 'prev');
  assert.equal(backJump.sheetCount, 3);
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
