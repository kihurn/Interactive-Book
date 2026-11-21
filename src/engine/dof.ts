export type DofEnvironmentId = 'desk' | 'pond';

export interface DofFocusPointParams {
  openProgress: number;
  isMobile: boolean;
  mobileSide: 'left' | 'right';
  surfaceY: number;
  pageWidth: number;
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface DofProfile {
  nearDeadzone: number;
  farDeadzone: number;
  nearBlurRange: number;
  farBlurRange: number;
  maxBlurPx: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x >= edge1 ? 1 : 0;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Computes the 3D world-space focal anchor point on the book so the cover (closed)
 * or spread/active mobile page (open) sits squarely in the center of the focal plane.
 */
export function computeBookFocusPoint(
  params: DofFocusPointParams,
  out: Vec3Like = { x: 0, y: 0, z: 0 },
): Vec3Like {
  const p = clamp(Number.isFinite(params.openProgress) ? params.openProgress : 0, 0, 1);
  const smooth = p * p * (3 - 2 * p);

  let targetX = 0;
  if (params.isMobile) {
    const mobilePageOffset = params.mobileSide === 'left' ? -params.pageWidth * 0.5 : params.pageWidth * 0.5;
    targetX = mobilePageOffset * smooth;
  }

  // Closed cover stack sits slightly taller (~0.065m) than open pages (~0.055m)
  out.x = targetX;
  out.y = params.surfaceY + (0.065 * (1 - smooth) + 0.055 * smooth);
  out.z = 0;
  return out;
}

/**
 * Computes the camera's forward view-space Z depth to the book focal point, matching
 * the linearized perspective depth `-viewPos.z` sampled from the GPU depth buffer.
 */
export function computeLinearFocusDistance(params: {
  cameraPos: Vec3Like;
  cameraTarget: Vec3Like;
  focusPoint: Vec3Like;
}): number {
  const fx = params.cameraTarget.x - params.cameraPos.x;
  const fy = params.cameraTarget.y - params.cameraPos.y;
  const fz = params.cameraTarget.z - params.cameraPos.z;
  const fLen = Math.hypot(fx, fy, fz);
  if (!Number.isFinite(fLen) || fLen < 1e-5) {
    return 3.8;
  }

  const dx = params.focusPoint.x - params.cameraPos.x;
  const dy = params.focusPoint.y - params.cameraPos.y;
  const dz = params.focusPoint.z - params.cameraPos.z;

  const viewZ = (dx * fx + dy * fy + dz * fz) / fLen;
  if (!Number.isFinite(viewZ)) return 3.8;
  return clamp(viewZ, 0.5, 30);
}

/**
 * Computes optical Depth-of-Field aperture deadzone and soft blur ramp parameters
 * tuned so 100% of the book cover/spread remains razor sharp while outer props,
 * tabletop corners, and distant pond foliage/stones gently fall out of focus.
 */
export function computeDofProfile(params: {
  openProgress: number;
  isMobile: boolean;
  environmentId: DofEnvironmentId;
}): DofProfile {
  const p = clamp(Number.isFinite(params.openProgress) ? params.openProgress : 0, 0, 1);
  const smooth = p * p * (3 - 2 * p);

  const mobilePad = params.isMobile ? 0.08 : 0;
  const envBlurBoost = params.environmentId === 'pond' ? 0.22 : 0;

  return {
    nearDeadzone: 0.38 - 0.02 * smooth + mobilePad,
    farDeadzone: 0.36 - 0.02 * smooth + mobilePad,
    nearBlurRange: 1.0,
    farBlurRange: 1.05 + 0.05 * (1 - smooth),
    maxBlurPx: (2.6 + 0.32 * smooth + envBlurBoost) * (params.isMobile ? 0.9 : 1),
  };
}

/**
 * Evaluates normalized Circle of Confusion in [0, 1] and signed CoC in [-1, 1]
 * (negative = foreground closer than focus, positive = background farther than focus).
 */
export function computeCircleOfConfusion(
  linearDepth: number,
  focusDist: number,
  profile: DofProfile,
): { coc: number; signedCoc: number } {
  if (!Number.isFinite(linearDepth) || !Number.isFinite(focusDist)) {
    return { coc: 0, signedCoc: 0 };
  }
  const delta = linearDepth - focusDist;
  if (delta >= 0) {
    const coc = smoothstep(profile.farDeadzone, profile.farDeadzone + profile.farBlurRange, delta);
    return { coc, signedCoc: coc };
  }
  const coc = smoothstep(profile.nearDeadzone, profile.nearDeadzone + profile.nearBlurRange, -delta);
  return { coc, signedCoc: -coc };
}
