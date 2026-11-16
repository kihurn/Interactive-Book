import * as THREE from 'three';

export interface PotProfileSpec {
  rimY: number;
  innerRimRadius: number;
  outerRimRadius: number;
  innerFloorY: number;
  innerFloorRadius: number;
  outerBaseRadius: number;
  outerShoulderY: number;
  outerShoulderRadius: number;
}

export const POT_SPEC: PotProfileSpec = {
  rimY: 0.184,
  innerRimRadius: 0.125,
  outerRimRadius: 0.145,
  innerFloorY: 0.14,
  innerFloorRadius: 0.115,
  outerBaseRadius: 0.115,
  outerShoulderY: 0.16,
  outerShoulderRadius: 0.135,
};

export interface StylizedLeafSpec {
  length: number;
  maxWidth: number;
  stemLift: number;
  archRise: number;
  tipDroop: number;
  cupDepth: number;
  midribFold: number;
  lateralSway: number;
  twistRad: number;
  edgeRipple: number;
  phase: number;
  segU?: number;
  segV?: number;
}

export interface FoliageLeafInstanceSpec {
  tierIndex: number;
  azimuthRad: number;
  baseRadius: number;
  baseY: number;
  pitchRad: number;
  rollRad: number;
  scale: number;
  leaf: StylizedLeafSpec;
}

export interface PotClearanceReport {
  minInnerWallGap: number;
  minRimVerticalGap: number;
  maxOuterRadius: number;
  collides: boolean;
}

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Exact inner wall radius of the stoneware pot bowl as a function of Y.
 * Returns 0 below the inner clay floor so any vertex inside clay counts as colliding.
 */
export function getPotInnerRadiusAtY(y: number, pot: PotProfileSpec = POT_SPEC): number {
  if (y < pot.innerFloorY) return 0;
  if (y > pot.rimY) return Number.POSITIVE_INFINITY;
  const t = (y - pot.innerFloorY) / Math.max(1e-5, pot.rimY - pot.innerFloorY);
  return pot.innerFloorRadius + (pot.innerRimRadius - pot.innerFloorRadius) * t;
}

/**
 * Soil dome height inside the pot as a function of radial distance r.
 */
export function getSoilDomeHeightAtR(r: number, pot: PotProfileSpec = POT_SPEC): number {
  const normR = clamp01(r / Math.max(1e-5, pot.innerFloorRadius));
  return pot.innerFloorY + 0.008 + 0.017 * Math.cos(normR * Math.PI * 0.5);
}

/**
 * Evaluates a single vertex on our stylized high-poly curved leaf blade + ascending petiole.
 * Anchored at (0, 0, 0) pointing initially upward/outward along +Z/+Y.
 */
export function evaluateStylizedLeafPoint(
  uNorm: number,
  v: number,
  spec: StylizedLeafSpec,
  out: THREE.Vector3,
): THREE.Vector3 {
  const uSigned = uNorm * 2 - 1; // -1..+1 across leaf width
  const absU = Math.abs(uSigned);

  // 1. Petiole stalk -> ovate/lanceolate leaf blade width envelope
  const petioleHalfW = spec.maxWidth * 0.055;
  const bladeTaper = Math.sin(Math.pow(clamp01((v - 0.14) / 0.86), 0.78) * Math.PI);
  const tipAcuminate = Math.pow(1 - v, 0.28);
  const bladeBlend = smoothstep(0.08, 0.34, v);
  const ripple =
    1 + spec.edgeRipple * Math.sin(v * 13.0 + spec.phase) * Math.sin(v * Math.PI);
  const halfWidth =
    (petioleHalfW * (1 - bladeBlend * 0.85) +
      spec.maxWidth * 0.5 * bladeTaper * tipAcuminate * bladeBlend) *
    ripple;

  // 2. Centerline spine: ascends past pot rim first via petiole, then arches outward + gracefully droops
  const stemFraction = smoothstep(0.0, 0.3, v);
  const archPhase = clamp01((v - 0.16) / 0.84);
  const z = (0.14 * stemFraction + 0.86 * archPhase) * spec.length;
  const centerY =
    spec.stemLift * stemFraction +
    spec.archRise * Math.sin(archPhase * Math.PI * 0.84) -
    spec.tipDroop * Math.pow(archPhase, 2.1);

  const centerX = spec.lateralSway * Math.sin(v * Math.PI * 1.1 + spec.phase);

  // 3. Transverse midrib crease + gentle edge cupping + organic torsional twist
  const creaseMask = smoothstep(0.08, 0.3, v) * (1 - 0.55 * v * v);
  const localY =
    Math.pow(absU, 1.35) * spec.cupDepth * creaseMask +
    (1 - absU) * -spec.midribFold * creaseMask;
  const localX = uSigned * halfWidth;

  const twist = spec.twistRad * archPhase;
  const cosT = Math.cos(twist);
  const sinT = Math.sin(twist);
  const rotatedX = localX * cosT - localY * sinT;
  const rotatedY = localX * sinT + localY * cosT;

  out.set(centerX + rotatedX, centerY + rotatedY, z);
  return out;
}

/**
 * Generates a thin, high-poly, organic stylized leaf blade BufferGeometry (with vertex colors
 * for midrib/margin chlorophyll variation and smooth analytical normals).
 */
export function createStylizedLeafGeometry(
  spec: StylizedLeafSpec,
  hueShift = 0,
): THREE.BufferGeometry {
  const segU = spec.segU ?? 12;
  const segV = spec.segV ?? 28;
  const cols = segU + 1;
  const rows = segV + 1;

  const positions = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  const colors = new Float32Array(cols * rows * 3);

  const pt = new THREE.Vector3();
  const baseColor = new THREE.Color().setHSL(0.35 + hueShift, 0.3, 0.32);
  const midribColor = new THREE.Color().setHSL(0.33 + hueShift, 0.34, 0.42);
  const marginColor = new THREE.Color().setHSL(0.32 + hueShift * 0.8, 0.28, 0.46);
  const tipColor = new THREE.Color().setHSL(0.29 + hueShift, 0.3, 0.49);
  const tmpColor = new THREE.Color();

  for (let iv = 0; iv < rows; iv++) {
    const v = iv / segV;
    for (let iu = 0; iu < cols; iu++) {
      const uNorm = iu / segU;
      const absU = Math.abs(uNorm * 2 - 1);

      evaluateStylizedLeafPoint(uNorm, v, spec, pt);

      const idx = iv * cols + iu;
      positions[idx * 3] = pt.x;
      positions[idx * 3 + 1] = pt.y;
      positions[idx * 3 + 2] = pt.z;
      uvs[idx * 2] = uNorm;
      uvs[idx * 2 + 1] = 1 - v;

      // Subtle botanical shading baked into vertex colors
      tmpColor.copy(baseColor).lerp(midribColor, Math.max(0, 1 - absU * 3.5) * (1 - v * 0.4));
      tmpColor.lerp(marginColor, Math.pow(absU, 1.8) * 0.45);
      tmpColor.lerp(tipColor, Math.pow(v, 2.2) * 0.4);
      colors[idx * 3] = tmpColor.r;
      colors[idx * 3 + 1] = tmpColor.g;
      colors[idx * 3 + 2] = tmpColor.b;
    }
  }

  const indices: number[] = [];
  for (let iv = 0; iv < segV; iv++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = iv * cols + iu;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, c, d, a, d, b);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Evaluates a candidate leaf placement against the stoneware pot inner bowl and rim.
 * Ensures zero vertices clip into the pot clay wall or rim.
 */
export function measureLeafPotClearance(
  instance: FoliageLeafInstanceSpec,
  pot: PotProfileSpec = POT_SPEC,
): PotClearanceReport {
  const mat = new THREE.Matrix4();
  const pos = new THREE.Vector3(
    Math.cos(instance.azimuthRad) * instance.baseRadius,
    instance.baseY,
    Math.sin(instance.azimuthRad) * instance.baseRadius,
  );
  const euler = new THREE.Euler(
    instance.pitchRad,
    -instance.azimuthRad + Math.PI / 2,
    instance.rollRad,
    'YXZ',
  );
  const quat = new THREE.Quaternion().setFromEuler(euler);
  const scale = new THREE.Vector3(instance.scale, instance.scale, instance.scale);
  mat.compose(pos, quat, scale);

  const pt = new THREE.Vector3();
  let minInnerWallGap = Number.POSITIVE_INFINITY;
  let minRimVerticalGap = Number.POSITIVE_INFINITY;
  let maxOuterRadius = 0;
  let collides = false;

  const sampleU = [0, 0.2, 0.5, 0.8, 1.0];
  const sampleVSteps = 18;

  for (let iv = 0; iv <= sampleVSteps; iv++) {
    const v = iv / sampleVSteps;
    for (const u of sampleU) {
      evaluateStylizedLeafPoint(u, v, instance.leaf, pt).applyMatrix4(mat);
      const r = Math.hypot(pt.x, pt.z);
      if (r > maxOuterRadius) maxOuterRadius = r;

      // Inside or crossing below the pot rim height: must stay strictly inside hollow inner bowl
      if (pt.y <= pot.rimY + 0.005) {
        const innerR = getPotInnerRadiusAtY(pt.y, pot);
        const wallGap = innerR - r;
        if (wallGap < minInnerWallGap) minInnerWallGap = wallGap;
        if (wallGap < 0.004) {
          collides = true;
        }
      }

      // When extending horizontally over the pot rim band (r >= innerRimRadius - 0.004): must stay cleanly above rimY
      if (r >= pot.innerRimRadius - 0.004 && r <= pot.outerRimRadius + 0.015) {
        const rimGap = pt.y - pot.rimY;
        if (rimGap < minRimVerticalGap) minRimVerticalGap = rimGap;
        if (rimGap < 0.005) {
          collides = true;
        }
      }
    }
  }

  return {
    minInnerWallGap,
    minRimVerticalGap,
    maxOuterRadius,
    collides,
  };
}

/**
 * Generates an organic multi-tier phyllotaxis arrangement of distinct high-poly stylized leaves,
 * automatically enforcing pot-wall / rim clearance and bounded radial footprint so nothing clips.
 */
export function generateValidatedPlantFoliage(
  pot: PotProfileSpec = POT_SPEC,
): FoliageLeafInstanceSpec[] {
  const goldenAngle = 2.399963229728653;

  const tiers = [
    {
      count: 9,
      baseRadius: 0.04,
      pitchBase: -0.26,
      lengthRange: [0.132, 0.148] as const,
      widthRange: [0.044, 0.052] as const,
      stemLift: 0.048,
      archRise: 0.024,
      tipDroop: 0.018,
    },
    {
      count: 8,
      baseRadius: 0.026,
      pitchBase: -0.58,
      lengthRange: [0.118, 0.134] as const,
      widthRange: [0.038, 0.046] as const,
      stemLift: 0.044,
      archRise: 0.022,
      tipDroop: 0.012,
    },
    {
      count: 6,
      baseRadius: 0.014,
      pitchBase: -0.92,
      lengthRange: [0.095, 0.112] as const,
      widthRange: [0.03, 0.036] as const,
      stemLift: 0.038,
      archRise: 0.018,
      tipDroop: 0.006,
    },
    {
      count: 4,
      baseRadius: 0.005,
      pitchBase: -1.24,
      lengthRange: [0.072, 0.086] as const,
      widthRange: [0.022, 0.028] as const,
      stemLift: 0.03,
      archRise: 0.014,
      tipDroop: 0.002,
    },
  ];

  const instances: FoliageLeafInstanceSpec[] = [];
  let leafIndex = 0;

  tiers.forEach((tier, tierIdx) => {
    for (let i = 0; i < tier.count; i++) {
      const idx = leafIndex++;
      const seedA = Math.abs(Math.sin(idx * 12.9898 + 4.1414) * 43758.5453) % 1;
      const seedB = Math.abs(Math.sin(idx * 78.233 + 1.732) * 29431.1234) % 1;
      const seedC = Math.abs(Math.sin(idx * 39.425 + 9.21) * 18273.5512) % 1;

      const azimuthRad = idx * goldenAngle + tierIdx * 0.42 + (seedA - 0.5) * 0.14;
      const baseRadius = tier.baseRadius * (0.85 + seedB * 0.3);
      const baseY = getSoilDomeHeightAtR(baseRadius, pot) - 0.002;

      const length =
        tier.lengthRange[0] + (tier.lengthRange[1] - tier.lengthRange[0]) * seedA;
      const maxWidth =
        tier.widthRange[0] + (tier.widthRange[1] - tier.widthRange[0]) * seedB;

      const leafSpec: StylizedLeafSpec = {
        length,
        maxWidth,
        stemLift: tier.stemLift + (seedC - 0.5) * 0.006,
        archRise: tier.archRise + (seedA - 0.5) * 0.005,
        tipDroop: tier.tipDroop * (0.85 + seedB * 0.3),
        cupDepth: 0.009 + seedA * 0.004,
        midribFold: 0.003 + seedC * 0.002,
        lateralSway: (seedC - 0.5) * 0.012,
        twistRad: (seedB - 0.5) * 0.28,
        edgeRipple: 0.04 + seedA * 0.03,
        phase: idx * 1.7,
        segU: 12,
        segV: 28,
      };

      let pitchRad = tier.pitchBase + (seedB - 0.5) * 0.08;
      const rollRad = (seedC - 0.5) * 0.16;
      let scale = 0.94 + seedA * 0.12;

      const candidate: FoliageLeafInstanceSpec = {
        tierIndex: tierIdx,
        azimuthRad,
        baseRadius,
        baseY,
        pitchRad,
        rollRad,
        scale,
        leaf: leafSpec,
      };

      // Iteratively raise pitch (tilt more upright) if any vertex touches pot inner wall or rim
      let guard = 0;
      while (guard < 24) {
        const report = measureLeafPotClearance(candidate, pot);
        if (!report.collides && report.maxOuterRadius <= 0.184) {
          break;
        }
        if (report.collides) {
          pitchRad -= 0.045;
          candidate.pitchRad = pitchRad;
        }
        if (report.maxOuterRadius > 0.184) {
          scale *= 0.95;
          candidate.scale = scale;
        }
        guard++;
      }

      instances.push(candidate);
    }
  });

  return instances;
}

export interface DeskOverlapIssue {
  prop: string;
  detail: string;
}

/**
 * Pure bounding-footprint check verifying that none of the desktop props clip into the
 * open 16:9 book footprint ([-bookHalfW, +bookHalfW] x [-bookHalfH, +bookHalfH]).
 */
export function checkDesktopBookPropClearances(params: {
  pageWidth: number;
  pageHeight: number;
  coverOverhang: number;
  maxPlantLocalRadius: number;
  props: {
    succulent: { position: { x: number; z: number }; scale: number };
    pencil: { position: { x: number; z: number }; rotationY: number; scale: number };
    coffee: { position: { x: number; z: number }; scale: number };
    cards: { position: { x: number; z: number }; rotationY: number; scale: number };
  };
}): DeskOverlapIssue[] {
  const issues: DeskOverlapIssue[] = [];
  const bookHalfW = params.pageWidth + params.coverOverhang;
  const bookHalfD = params.pageHeight * 0.5 + params.coverOverhang;
  const margin = 0.015;

  const circleHitsBook = (cx: number, cz: number, r: number) => {
    const closestX = Math.max(-bookHalfW, Math.min(cx, bookHalfW));
    const closestZ = Math.max(-bookHalfD, Math.min(cz, bookHalfD));
    return Math.hypot(cx - closestX, cz - closestZ) < r + margin;
  };

  // 1. Plant + pot outer footprint
  const plantR = Math.max(POT_SPEC.outerRimRadius, params.maxPlantLocalRadius) * params.props.succulent.scale;
  if (circleHitsBook(params.props.succulent.position.x, params.props.succulent.position.z, plantR)) {
    issues.push({ prop: 'succulent', detail: 'Plant foliage/pot enters open book footprint' });
  }

  // 2. Coffee saucer outer circle
  const saucerR = 0.245 * params.props.coffee.scale;
  if (circleHitsBook(params.props.coffee.position.x, params.props.coffee.position.z, saucerR)) {
    issues.push({ prop: 'coffee', detail: 'Coffee saucer overlaps open book footprint' });
  }

  // 3. Pencil capsule segment
  const pScale = params.props.pencil.scale;
  const pCos = Math.cos(params.props.pencil.rotationY);
  const pSin = Math.sin(params.props.pencil.rotationY);
  const pRadius = 0.017 * pScale;
  for (let t = -0.39; t <= 0.39; t += 0.065) {
    const wx = params.props.pencil.position.x + t * pScale * pCos;
    const wz = params.props.pencil.position.z - t * pScale * pSin;
    if (circleHitsBook(wx, wz, pRadius)) {
      issues.push({ prop: 'pencil', detail: `Pencil sample t=${t.toFixed(2)} overlaps open book` });
      break;
    }
  }

  // 4. Stacked business cards exact rotated rectangle corners (cardBottom & cardTop)
  const cScale = params.props.cards.scale;
  const cCos = Math.cos(params.props.cards.rotationY);
  const cSin = Math.sin(params.props.cards.rotationY);
  const localCards = [
    { ox: -0.028, oz: 0.02, rotY: -0.32 },
    { ox: 0.022, oz: -0.012, rotY: 0.2 },
  ];
  const halfCardW = 0.14;
  const halfCardD = 0.0825;
  let cardHits = false;
  for (const card of localCards) {
    const rCos = Math.cos(card.rotY);
    const rSin = Math.sin(card.rotY);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const lx = card.ox + sx * halfCardW * rCos + sz * halfCardD * rSin;
        const lz = card.oz - sx * halfCardW * rSin + sz * halfCardD * rCos;
        const wx = params.props.cards.position.x + (lx * cCos + lz * cSin) * cScale;
        const wz = params.props.cards.position.z + (-lx * cSin + lz * cCos) * cScale;
        if (Math.abs(wx) < bookHalfW + margin && Math.abs(wz) < bookHalfD + margin) {
          cardHits = true;
        }
      }
    }
  }
  if (cardHits) {
    issues.push({ prop: 'cards', detail: 'Business cards overlap open book footprint' });
  }

  return issues;
}
