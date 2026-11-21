export type BookPhase = 'closed' | 'opening' | 'open' | 'turning' | 'closing';

export type PageSide = 'left' | 'right';

export interface QueuedNavigation {
  targetSpread: number;
  targetMobileSide?: PageSide;
}

export interface BookControllerState {
  phase: BookPhase;
  currentSpread: number;
  targetSpread: number;
  totalSpreads: number;
  physicalSpreads: number;
  mobileSide: PageSide;
  queuedNavigation: QueuedNavigation | null;
}

export interface TurnPlan {
  fromSpread: number;
  toSpread: number;
  direction: 'next' | 'prev';
  sheetCount: number;
  staggerMs: number;
  durationMs: number;
}

export function createInitialBookState(
  totalSpreads: number,
  autostart = false,
  physicalSpreads = 10,
): BookControllerState {
  const safeTotal = Math.max(1, totalSpreads);
  return {
    phase: autostart ? 'open' : 'closed',
    currentSpread: 0,
    targetSpread: 0,
    totalSpreads: safeTotal,
    physicalSpreads: Math.max(safeTotal, physicalSpreads),
    mobileSide: autostart ? 'right' : 'left',
    queuedNavigation: null,
  };
}

export function clampSpread(index: number, totalSpreads: number): number {
  return Math.max(0, Math.min(totalSpreads - 1, Math.floor(index)));
}

export function canStartOpen(state: BookControllerState): boolean {
  return state.phase === 'closed';
}

export function beginOpen(state: BookControllerState): BookControllerState {
  if (!canStartOpen(state)) return state;
  return {
    ...state,
    phase: 'opening',
    currentSpread: 0,
    targetSpread: 0,
    queuedNavigation: null,
  };
}

export function finishOpen(state: BookControllerState): BookControllerState {
  if (state.phase !== 'opening') return state;
  return {
    ...state,
    phase: 'open',
    currentSpread: 0,
    targetSpread: 0,
  };
}

export function canStartClose(state: BookControllerState): boolean {
  return state.phase === 'open';
}

export function beginClose(state: BookControllerState): BookControllerState {
  if (!canStartClose(state)) return state;
  return {
    ...state,
    phase: 'closing',
    queuedNavigation: null,
  };
}

export function finishClose(state: BookControllerState): BookControllerState {
  if (state.phase !== 'closing') return state;
  return {
    ...state,
    phase: 'closed',
    currentSpread: 0,
    targetSpread: 0,
    mobileSide: 'left',
    queuedNavigation: null,
  };
}

export function computeTurnPlan(
  fromSpread: number,
  toSpread: number,
  maxBatchSheets = 3,
  singleDurationMs = 1000,
  batchDurationMs = 740,
  staggerMs = 110,
): TurnPlan {
  const delta = toSpread - fromSpread;
  const direction: 'next' | 'prev' = delta >= 0 ? 'next' : 'prev';
  const distance = Math.abs(delta);
  const sheetCount = Math.max(1, Math.min(maxBatchSheets, distance));
  const isBatch = sheetCount > 1;
  return {
    fromSpread,
    toSpread,
    direction,
    sheetCount,
    staggerMs: isBatch ? staggerMs : 0,
    durationMs: isBatch ? batchDurationMs : singleDurationMs,
  };
}

/**
 * Initiates or queues (at most one) spread navigation.
 * Prevents overlapping transitions while keeping rapid button clicks predictable.
 */
export function requestSpreadNavigation(
  state: BookControllerState,
  requestedSpread: number,
  requestedMobileSide?: PageSide,
): { nextState: BookControllerState; started: boolean } {
  const target = clampSpread(requestedSpread, state.totalSpreads);

  if (state.phase === 'closed' || state.phase === 'opening' || state.phase === 'closing') {
    return { nextState: state, started: false };
  }

  if (state.phase === 'turning') {
    // Queue at most ONE navigation step ahead; ignore further rapid inputs consistently
    if (state.queuedNavigation === null && target !== state.targetSpread) {
      return {
        nextState: {
          ...state,
          queuedNavigation: {
            targetSpread: target,
            targetMobileSide: requestedMobileSide,
          },
        },
        started: false,
      };
    }
    return { nextState: state, started: false };
  }

  if (target === state.currentSpread) {
    if (requestedMobileSide && requestedMobileSide !== state.mobileSide) {
      return {
        nextState: {
          ...state,
          mobileSide: requestedMobileSide,
        },
        started: false,
      };
    }
    return { nextState: state, started: false };
  }

  return {
    nextState: {
      ...state,
      phase: 'turning',
      targetSpread: target,
      mobileSide: requestedMobileSide ?? (target > state.currentSpread ? 'left' : 'right'),
      queuedNavigation: null,
    },
    started: true,
  };
}

export function finishTurn(state: BookControllerState): {
  nextState: BookControllerState;
  queuedPlan: QueuedNavigation | null;
} {
  if (state.phase !== 'turning') {
    return { nextState: state, queuedPlan: null };
  }

  const settled: BookControllerState = {
    ...state,
    phase: 'open',
    currentSpread: state.targetSpread,
  };

  if (state.queuedNavigation && state.queuedNavigation.targetSpread !== settled.currentSpread) {
    const queued = state.queuedNavigation;
    return {
      nextState: {
        ...settled,
        queuedNavigation: null,
      },
      queuedPlan: queued,
    };
  }

  return {
    nextState: {
      ...settled,
      queuedNavigation: null,
    },
    queuedPlan: null,
  };
}

/**
 * Step single page navigation for both desktop (spread-by-spread)
 * and narrow mobile (page-by-page: left -> right -> next spread left).
 */
export function getStepTarget(
  state: BookControllerState,
  direction: 'next' | 'prev',
  isSinglePageMode: boolean,
): { targetSpread: number; targetMobileSide: PageSide } | null {
  const baseSpread = state.phase === 'turning' ? state.targetSpread : state.currentSpread;
  const baseSide = state.mobileSide;

  if (!isSinglePageMode) {
    const nextSpread = direction === 'next' ? baseSpread + 1 : baseSpread - 1;
    if (nextSpread < 0 || nextSpread >= state.totalSpreads) return null;
    return { targetSpread: nextSpread, targetMobileSide: 'left' };
  }

  if (direction === 'next') {
    if (baseSide === 'left') {
      return { targetSpread: baseSpread, targetMobileSide: 'right' };
    }
    if (baseSpread + 1 < state.totalSpreads) {
      return { targetSpread: baseSpread + 1, targetMobileSide: 'left' };
    }
    return null;
  } else {
    if (baseSide === 'right') {
      return { targetSpread: baseSpread, targetMobileSide: 'left' };
    }
    if (baseSpread - 1 >= 0) {
      return { targetSpread: baseSpread - 1, targetMobileSide: 'right' };
    }
    return null;
  }
}

export interface DeformedVertex {
  x: number;
  y: number;
  z: number;
}

/**
 * Computes the 3D position of a sheet vertex anchored at the spine (x = 0).
 *
 * @param u Normalized distance from spine (0 at spine -> 1 at outer fore-edge)
 * @param v Normalized vertical position (0 at bottom -> 1 at top)
 * @param pageWidth Physical width of one page
 * @param pageHeight Physical height of one page
 * @param progress Normalized turn progress (0 = flat on right stack, 1 = flat on left stack)
 * @param leftStackY Resting Y height on left stack
 * @param rightStackY Resting Y height on right stack
 * @param liftBias Extra arc clearance for staggered multi-sheet turns (0..1)
 */
export function deformPageVertex(
  u: number,
  v: number,
  pageWidth: number,
  pageHeight: number,
  progress: number,
  leftStackY: number,
  rightStackY: number,
  liftBias = 0,
  out?: DeformedVertex,
): DeformedVertex {
  const res = out ?? { x: 0, y: 0, z: 0 };
  const p = Math.max(0, Math.min(1, progress));
  const clampedU = Math.max(0, Math.min(1, u));
  const clampedV = Math.max(0, Math.min(1, v));

  // Spine stays anchored cleanly at x = 0, y interpolated gently between right and left stack heights
  const restingY = rightStackY * (1 - p) + leftStackY * p;

  if (p <= 0.0001) {
    res.x = clampedU * pageWidth;
    res.y = rightStackY;
    res.z = (0.5 - clampedV) * pageHeight;
    return res;
  }
  if (p >= 0.9999) {
    res.x = -clampedU * pageWidth;
    res.y = leftStackY;
    res.z = (0.5 - clampedV) * pageHeight;
    return res;
  }

  // Quintic S-curve for smooth acceleration and soft landing settle
  const smoothP = p * p * p * (p * (p * 6 - 15) + 10);
  const bell = Math.sin(Math.PI * p);

  // Diagonal corner lead so outer bottom corner peels smoothly before the top edge
  const cornerLead = 0.07 * bell * Math.pow(clampedU, 0.9) * (1 - clampedV);
  const localP = Math.max(0, Math.min(1, smoothP + cornerLead));

  // Progressive curl lag clamped strictly within [0.012*bell, PI - 0.012*bell] so arcY never goes negative
  const lagFactor = Math.sin(Math.PI * localP);
  const lagSign = Math.cos(Math.PI * p);
  const maxCurlAngle = 0.68;
  const bendAngle =
    localP * Math.PI -
    maxCurlAngle * lagFactor * (0.45 + 0.55 * lagSign) * Math.pow(clampedU, 1.15);

  const radialDistance = clampedU * pageWidth;
  const edgeGuard = 0.014 * bell;
  const effectiveAngle = Math.max(edgeGuard, Math.min(Math.PI - edgeGuard, bendAngle));

  const x = Math.cos(effectiveAngle) * radialDistance;
  const arcY = Math.sin(effectiveAngle) * radialDistance;

  // Lift smoothly above whichever stack is higher during mid-turn so sheets never intersect stacks or each other
  const peakStackY = Math.max(restingY, leftStackY, rightStackY);
  const clearanceEnvelope = Math.pow(bell, 0.55);
  const safeBaseY =
    restingY * (1 - clearanceEnvelope) +
    (peakStackY + 0.014 + liftBias * 0.022) * clearanceEnvelope;

  const uWave = Math.sin(Math.PI * Math.min(1, clampedU * 1.08));
  const spineArch = (0.048 + liftBias * 0.03) * bell * uWave;
  const subtleZFlutter = 0.008 * bell * Math.sin(Math.PI * clampedU) * (clampedV - 0.5);

  res.x = x;
  res.y = safeBaseY + arcY * 0.85 + spineArch;
  res.z = (0.5 - clampedV) * pageHeight + subtleZFlutter;

  return res;
}

export interface CursorCameraOffset {
  yawRad: number;
  pitchRad: number;
}

/**
 * Computes smoothly clamped yaw and pitch parallax offsets from normalized cursor coordinates (-1..1).
 */
export function computeCursorCameraOffset(
  ndcX: number,
  ndcY: number,
  maxYawRad: number,
  maxPitchRad: number,
): CursorCameraOffset {
  const cx = Math.max(-1, Math.min(1, Number.isFinite(ndcX) ? ndcX : 0));
  const cy = Math.max(-1, Math.min(1, Number.isFinite(ndcY) ? ndcY : 0));
  return {
    yawRad: -cx * maxYawRad || 0,
    pitchRad: cy * maxPitchRad || 0,
  };
}

export interface DragTurnStartResult {
  nextState: BookControllerState;
  startedSheetDrag: boolean;
  sameSpreadMobileSide: PageSide | null;
  fromSpread: number;
  toSpread: number;
}

/**
 * Begins an interactive drag-to-flip gesture from the resting open state.
 */
export function beginDragTurn(
  state: BookControllerState,
  direction: 'next' | 'prev',
  isSinglePageMode: boolean,
): DragTurnStartResult {
  if (state.phase !== 'open') {
    return {
      nextState: state,
      startedSheetDrag: false,
      sameSpreadMobileSide: null,
      fromSpread: state.currentSpread,
      toSpread: state.currentSpread,
    };
  }

  const target = getStepTarget(state, direction, isSinglePageMode);
  if (!target) {
    return {
      nextState: state,
      startedSheetDrag: false,
      sameSpreadMobileSide: null,
      fromSpread: state.currentSpread,
      toSpread: state.currentSpread,
    };
  }

  if (target.targetSpread === state.currentSpread) {
    return {
      nextState: state,
      startedSheetDrag: false,
      sameSpreadMobileSide: target.targetMobileSide,
      fromSpread: state.currentSpread,
      toSpread: state.currentSpread,
    };
  }

  return {
    nextState: {
      ...state,
      phase: 'turning',
      targetSpread: target.targetSpread,
      mobileSide: target.targetMobileSide,
      queuedNavigation: null,
    },
    startedSheetDrag: true,
    sameSpreadMobileSide: null,
    fromSpread: state.currentSpread,
    toSpread: target.targetSpread,
  };
}

/**
 * Decides whether a released drag gesture commits to the next/previous spread or springs back.
 * Requires a deliberate hold-and-drag across at least half the turn span (or a strong committed flick).
 */
export function resolveDragRelease(params: {
  direction: 'next' | 'prev';
  progress: number;
  velocityPxPerMs: number;
  commitThreshold?: number;
  velocityThreshold?: number;
  minFlickProgress?: number;
}): { committed: boolean; endProgress: number } {
  const threshold = params.commitThreshold ?? 0.52;
  const vThreshold = params.velocityThreshold ?? 0.95;
  const minFlick = params.minFlickProgress ?? 0.22;
  const p = Math.max(0, Math.min(1, params.progress));

  if (params.direction === 'next') {
    const committed =
      p >= threshold || (p >= minFlick && params.velocityPxPerMs <= -vThreshold);
    return { committed, endProgress: committed ? 1 : 0 };
  }

  const committed =
    p <= 1 - threshold || (p <= 1 - minFlick && params.velocityPxPerMs >= vThreshold);
  return { committed, endProgress: committed ? 0 : 1 };
}

/**
 * Settles state after a drag turn completes or springs back to its origin spread.
 */
export function finishDragTurn(
  state: BookControllerState,
  committed: boolean,
): BookControllerState {
  if (state.phase !== 'turning') return state;
  const settledSpread = committed ? state.targetSpread : state.currentSpread;
  return {
    ...state,
    phase: 'open',
    currentSpread: settledSpread,
    targetSpread: settledSpread,
    queuedNavigation: null,
  };
}

export interface PhaseLightingValues {
  spotIntensity: number;
  spotAngle: number;
  spotPenumbra: number;
  keyIntensity: number;
  keyPosX: number;
  keyPosY: number;
  keyPosZ: number;
  hemiIntensity: number;
  rimIntensity: number;
  environmentIntensity: number;
}

/**
 * Maps the book's continuous opening progress (0 = closed, 1 = open) to dynamic
 * overhead lamp intensity, cone spread, shadow-casting key direction, and restrained
 * ambient fill so desk surface & prop lighting responds dynamically to the book phase.
 */
export function computePhaseLighting(
  openProgress: number,
  base: {
    spotIntensity: number;
    spotAngle: number;
    spotPenumbra: number;
    keyIntensity: number;
    keyPosition: { x: number; y: number; z: number };
    hemiIntensity: number;
    rimIntensity: number;
  },
): PhaseLightingValues {
  const p = Math.max(0, Math.min(1, openProgress));
  const smooth = p * p * (3 - 2 * p);

  return {
    spotIntensity: base.spotIntensity * (0.9 + 0.16 * smooth),
    spotAngle: Math.min(Math.PI * 0.49, base.spotAngle * (0.96 + 0.08 * smooth)),
    spotPenumbra: Math.min(1, base.spotPenumbra * (0.97 + 0.03 * smooth)),
    keyIntensity: base.keyIntensity * (0.92 + 0.14 * smooth),
    keyPosX: base.keyPosition.x + 0.12 * smooth,
    keyPosY: base.keyPosition.y + 0.14 * smooth,
    keyPosZ: base.keyPosition.z - 0.08 * smooth,
    hemiIntensity: base.hemiIntensity * (1.04 - 0.14 * smooth),
    rimIntensity: base.rimIntensity * (0.92 + 0.14 * smooth),
    environmentIntensity: 0.22 + 0.08 * smooth,
  };
}

/**
 * Computes the dynamic supersampling multiplier for static book page CanvasTextures.
 * Scales smoothly between closed overview (1.25x) and open reading close-up (up to 2.0x = 3840x2160)
 * while respecting GPU maxTextureSize and software WebGL headroom.
 */
export function computePageSupersampleScale(params: {
  phase: BookPhase;
  viewportWidth: number;
  dpr: number;
  isSoftwareGl: boolean;
  maxTextureSize?: number;
}): number {
  const maxTex = Math.max(2048, params.maxTextureSize ?? 4096);
  const maxAllowed = Math.min(2.0, maxTex / 1920);
  const isReadingView =
    params.phase === 'open' || params.phase === 'opening' || params.phase === 'turning';

  if (params.isSoftwareGl) {
    return Math.min(maxAllowed, isReadingView ? 1.5 : 1.0);
  }

  const effectiveDpr = Math.max(1, Math.min(2, params.dpr || 1));
  const widthBoost = params.viewportWidth >= 1024 ? 1.0 : 0.88;
  const target = isReadingView ? Math.max(1.5, Math.min(2.0, effectiveDpr * 1.35 * widthBoost)) : 1.25;
  return Math.max(1.0, Math.min(maxAllowed, Math.round(target * 4) / 4));
}

/**
 * Projects a prop's world XZ coordinates away from the overhead desk lamp onto the tabletop plane,
 * returning clamped world-space drop-shadow offsets matching the lamp's physical angle.
 */
export function computeLampShadowOffset(params: {
  propX: number;
  propZ: number;
  lampX: number;
  lampY: number;
  lampZ: number;
  castHeight: number;
  maxOffset?: number;
}): { worldDx: number; worldDz: number } {
  const safeY = Math.max(0.5, params.lampY);
  const scale = params.castHeight / safeY;
  const rawDx = (params.propX - params.lampX) * scale;
  const rawDz = (params.propZ - params.lampZ) * scale;
  const maxOff = params.maxOffset ?? 0.12;
  const mag = Math.hypot(rawDx, rawDz);
  if (mag <= 1e-6 || mag <= maxOff) {
    return { worldDx: rawDx, worldDz: rawDz };
  }
  const k = maxOff / mag;
  return { worldDx: rawDx * k, worldDz: rawDz * k };
}

/**
 * Rotates a world-space XZ shadow offset into a prop's local coordinate frame (compensating for Y rotation and scale).
 */
export function worldOffsetToLocal(
  worldDx: number,
  worldDz: number,
  rotationY: number,
  scale = 1,
): { localDx: number; localDz: number } {
  const c = Math.cos(rotationY);
  const s = Math.sin(rotationY);
  const invScale = scale > 1e-4 ? 1 / scale : 1;
  return {
    localDx: (worldDx * c - worldDz * s) * invScale,
    localDz: (worldDx * s + worldDz * c) * invScale,
  };
}
