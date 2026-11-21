/**
 * Shared GLSL helpers for physically motivated underwater & surface pond caustics:
 * 1. Live WaterSimulation Laplacian curvature focusing (soft warm pale-gold sunlight rings
 *    shimmering directly beneath real moving ripples).
 * 2. Gentle, thin, broken warm pale-gold sunlight caustic filaments (~0.08–0.13)
 *    generated from non-orthogonal warped wave-interference ribbons (zero circular dots/blobs,
 *    zero connected square grids), fading cleanly to 0.0 under plank/book/bamboo shadows.
 */
export const POND_CAUSTICS_GLSL = /* glsl */ `
float pondSdRoundedBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + vec2(r);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float pondCausticCoverMask(vec2 xz, float shadowVal) {
  float shadowVis = smoothstep(0.16, 0.92, shadowVal);
  // Under floating plank & open book overhang -> fade to 0.0
  float dPlank = pondSdRoundedBox(xz - vec2(0.0, -0.04), vec2(1.54, 0.52), 0.08);
  float plankClear = smoothstep(-0.04, 0.28, dPlank);
  // Under top-right bamboo grove & boulder shade -> fade to 0.0
  vec2 bDelta = (xz - vec2(1.92, -0.84)) / vec2(1.08, 0.80);
  float bambooShade = 1.0 - 0.94 * exp(-dot(bDelta, bDelta));
  return shadowVis * plankClear * bambooShade;
}

float pondSunPocketMask(vec2 xz) {
  vec2 d1 = (xz - vec2(-0.68, 1.12)) / vec2(1.02, 0.68);
  vec2 d2 = (xz - vec2(0.74, 1.16)) / vec2(0.96, 0.64);
  vec2 d3 = (xz - vec2(-0.24, -1.08)) / vec2(1.10, 0.66);
  vec2 d4 = (xz - vec2(0.88, -0.96)) / vec2(0.76, 0.52);
  float p1 = exp(-dot(d1, d1));
  float p2 = exp(-dot(d2, d2));
  float p3 = exp(-dot(d3, d3));
  float p4 = exp(-dot(d4, d4));
  return clamp(p1 + p2 + p3 + p4 * 0.72, 0.0, 1.0);
}

float pondAmbientSunThreads(vec2 xz, float t) {
  vec2 q = xz * 2.65;
  // Two-octave organic domain warp so interference ribbons bend naturally without forming a grid
  vec2 warp1 = vec2(
    sin(q.y * 0.95 + t * 0.26) * 0.52 + cos(q.x * 0.78 - t * 0.21) * 0.30,
    cos(q.x * 0.92 - t * 0.24) * 0.52 + sin(q.y * 0.84 + t * 0.19) * 0.30
  );
  vec2 q2 = q + warp1;
  vec2 warp2 = vec2(
    sin(q2.x * 1.45 - q2.y * 1.15 + t * 0.34),
    cos(q2.y * 1.38 + q2.x * 1.10 - t * 0.31)
  ) * 0.22;
  vec2 w = q2 + warp2;

  // Three non-orthogonal wave-interference angles (~0 deg, 58 deg, 114 deg) -> broken organic filaments
  float p1 = w.x * 1.52 + w.y * 0.28 + t * 0.22;
  float p2 = w.x * 0.81 + w.y * 1.29 - t * 0.18 + 1.37;
  float p3 = -w.x * 0.64 + w.y * 1.43 + t * 0.15 + 2.61;

  float f1 = pow(max(0.0, 1.0 - abs(sin(p1)) * 3.8), 3.2);
  float f2 = pow(max(0.0, 1.0 - abs(sin(p2)) * 3.8), 3.2);
  float f3 = pow(max(0.0, 1.0 - abs(sin(p3)) * 4.1), 3.4);

  // Organic breakup masks so ribbons break into delicate shimmering wisps instead of closed cells
  float brk1 = smoothstep(0.14, 0.88, 0.5 + 0.5 * sin(xz.x * 2.15 - xz.y * 1.65 + t * 0.24 + sin(xz.y * 2.4) * 0.7));
  float brk2 = smoothstep(0.18, 0.90, 0.5 + 0.5 * cos(xz.x * 1.85 + xz.y * 2.05 - t * 0.20 + cos(xz.x * 2.1) * 0.6));
  float brk3 = smoothstep(0.22, 0.92, 0.5 + 0.5 * sin(xz.x * 2.55 + xz.y * 1.25 + t * 0.17));

  float raw = clamp(f1 * brk1 * 0.76 + f2 * brk2 * 0.68 + f3 * brk3 * 0.58, 0.0, 1.0);
  return raw * (0.28 + 0.72 * pondSunPocketMask(xz));
}

float pondWaveLaplacianCaustic(
  sampler2D waveTex,
  vec2 waveTexel,
  vec4 pondBounds,
  vec3 worldPos,
  float waterY
) {
  float depth = max(0.0, waterY - worldPos.y);
  // Refract upward toward water entry along sun direction (1.92, 4.15, -1.18) with Snell index 0.75
  vec2 entryXZ = worldPos.xz + depth * vec2(0.415, -0.255) * 0.75;
  vec2 uv = vec2(
    (entryXZ.x - pondBounds.x) / (pondBounds.y - pondBounds.x),
    1.0 - (entryXZ.y - pondBounds.z) / (pondBounds.w - pondBounds.z)
  );
  if (uv.x < 0.01 || uv.x > 0.99 || uv.y < 0.01 || uv.y > 0.99) {
    return 0.0;
  }
  vec2 stepUv = waveTexel * 1.5;
  vec4 cInfo = texture2D(waveTex, uv);
  float hC = cInfo.r;
  float hL = texture2D(waveTex, clamp(uv - vec2(stepUv.x, 0.0), 0.0, 1.0)).r;
  float hR = texture2D(waveTex, clamp(uv + vec2(stepUv.x, 0.0), 0.0, 1.0)).r;
  float hU = texture2D(waveTex, clamp(uv + vec2(0.0, stepUv.y), 0.0, 1.0)).r;
  float hD = texture2D(waveTex, clamp(uv - vec2(0.0, stepUv.y), 0.0, 1.0)).r;

  float avg = (hL + hR + hU + hD) * 0.25;
  // Convex crest curvature focuses light into soft concentric sunlight rings beneath moving ripples
  float focus = max(0.0, hC - avg);
  float slopeMag = length(vec2(hL - hR, hD - hU));
  float ring = pow(clamp(focus * 46.0 + slopeMag * 3.8, 0.0, 1.0), 1.45);
  return ring * cInfo.b;
}
`;
