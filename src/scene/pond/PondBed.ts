import * as THREE from 'three';
import { POND_BOUNDS, POND_LAYOUT, POND_OBSTACLES, signedDistanceToObstacle } from './constants';

export interface PondBedRig {
  group: THREE.Group;
  bedMesh: THREE.Mesh;
  pebblesMesh: THREE.InstancedMesh;
  update: (elapsedSec: number) => void;
  dispose: () => void;
}

function createPondGravelTextures(maxAnisotropy: number): {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  dispose: () => void;
} {
  const size = 1024;

  const cCanvas = document.createElement('canvas');
  cCanvas.width = size;
  cCanvas.height = size;
  const cCtx = cCanvas.getContext('2d')!;

  const bCanvas = document.createElement('canvas');
  bCanvas.width = size;
  bCanvas.height = size;
  const bCtx = bCanvas.getContext('2d')!;

  const rCanvas = document.createElement('canvas');
  rCanvas.width = size;
  rCanvas.height = size;
  const rCtx = rCanvas.getContext('2d')!;

  // Muted dark basalt & river mineral silt base (no flat bright green wash)
  cCtx.fillStyle = '#1b2021';
  cCtx.fillRect(0, 0, size, size);

  bCtx.fillStyle = '#6c6c6c';
  bCtx.fillRect(0, 0, size, size);

  rCtx.fillStyle = '#e0e0e0'; // ~0.88 coarse silt roughness
  rCtx.fillRect(0, 0, size, size);

  const hash = (n: number) => {
    const v = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
    return v - Math.floor(v);
  };

  // Seamless wrapping helper for 3x3 periodic edge repetition
  const drawWrapped = (
    drawFn: (ox: number, oy: number) => void,
    x: number,
    y: number,
    margin: number,
  ) => {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const nx = x + dx * size;
        const ny = y + dy * size;
        if (
          nx >= -margin &&
          nx <= size + margin &&
          ny >= -margin &&
          ny <= size + margin
        ) {
          drawFn(nx, ny);
        }
      }
    }
  };

  // 1. Organic mineral sand & dark algae sediment patches
  for (let i = 0; i < 320; i++) {
    const x = hash(i * 3 + 1) * size;
    const y = hash(i * 3 + 2) * size;
    const r = 24 + hash(i * 3 + 3) * 58;
    const tone = i % 5;
    const col =
      tone === 0
        ? 'rgba(42, 46, 44, 0.28)'
        : tone === 1
          ? 'rgba(14, 18, 20, 0.34)'
          : tone === 2
            ? 'rgba(54, 50, 42, 0.22)'
            : tone === 3
              ? 'rgba(28, 36, 30, 0.22)'
              : 'rgba(66, 68, 65, 0.16)';

    drawWrapped(
      (ox, oy) => {
        cCtx.fillStyle = col;
        cCtx.beginPath();
        cCtx.arc(ox, oy, r, 0, Math.PI * 2);
        cCtx.fill();
      },
      x,
      y,
      r + 2,
    );
  }

  // 2. Packed sub-centimeter shingle stones baked into streambed texture
  const shinglePalette = [
    '#2a2f32',
    '#3d4448',
    '#4f493f',
    '#323934',
    '#5c5e5b',
    '#23282a',
    '#484c47',
  ];
  for (let i = 0; i < 2400; i++) {
    const x = hash(i * 7 + 11) * size;
    const y = hash(i * 7 + 13) * size;
    const rx = 3.2 + hash(i * 7 + 17) * 9.5;
    const ry = rx * (0.58 + hash(i * 7 + 19) * 0.34);
    const ang = hash(i * 7 + 23) * Math.PI * 2;
    const baseCol = shinglePalette[i % shinglePalette.length];
    const bumpVal = Math.round(135 + hash(i * 5 + 3) * 95);
    const roughVal = Math.round(165 + hash(i * 5 + 9) * 55);

    drawWrapped(
      (ox, oy) => {
        // Dark crevice shadow halo around each packed pebble
        cCtx.fillStyle = 'rgba(8, 10, 11, 0.42)';
        cCtx.beginPath();
        cCtx.ellipse(ox + 1.1, oy + 1.3, rx * 1.12, ry * 1.12, ang, 0, Math.PI * 2);
        cCtx.fill();

        cCtx.fillStyle = baseCol;
        cCtx.beginPath();
        cCtx.ellipse(ox, oy, rx, ry, ang, 0, Math.PI * 2);
        cCtx.fill();

        // Mineral highlight fleck on upper pebble crown
        cCtx.fillStyle = 'rgba(180, 185, 178, 0.18)';
        cCtx.beginPath();
        cCtx.ellipse(ox - rx * 0.2, oy - ry * 0.2, rx * 0.45, ry * 0.42, ang, 0, Math.PI * 2);
        cCtx.fill();

        bCtx.fillStyle = `rgb(${bumpVal}, ${bumpVal}, ${bumpVal})`;
        bCtx.beginPath();
        bCtx.ellipse(ox, oy, rx, ry, ang, 0, Math.PI * 2);
        bCtx.fill();

        rCtx.fillStyle = `rgb(${roughVal}, ${roughVal}, ${roughVal})`;
        rCtx.beginPath();
        rCtx.ellipse(ox, oy, rx, ry, ang, 0, Math.PI * 2);
        rCtx.fill();
      },
      x,
      y,
      rx * 1.3,
    );
  }

  // 3. Fine basalt grit & mineral sand grains across interstices
  for (let i = 0; i < 9500; i++) {
    const x = (hash(i * 11 + 3) * size) | 0;
    const y = (hash(i * 11 + 7) * size) | 0;
    const s = i % 4 === 0 ? 2 : 1;
    cCtx.fillStyle =
      i % 3 === 0
        ? 'rgba(130, 134, 126, 0.20)'
        : i % 2 === 0
          ? 'rgba(72, 68, 58, 0.24)'
          : 'rgba(8, 11, 13, 0.34)';
    cCtx.fillRect(x, y, s, s);
    bCtx.fillStyle = i % 2 === 0 ? 'rgba(220, 220, 220, 0.20)' : 'rgba(30, 30, 30, 0.24)';
    bCtx.fillRect(x, y, s, s);
  }

  const map = new THREE.CanvasTexture(cCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(3.4, 2.6);
  map.anisotropy = maxAnisotropy;

  const bumpMap = new THREE.CanvasTexture(bCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(3.4, 2.6);
  bumpMap.anisotropy = maxAnisotropy;

  const roughnessMap = new THREE.CanvasTexture(rCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(3.4, 2.6);
  roughnessMap.anisotropy = maxAnisotropy;

  return {
    map,
    bumpMap,
    roughnessMap,
    dispose: () => {
      map.dispose();
      bumpMap.dispose();
      roughnessMap.dispose();
    },
  };
}

function createRoundedPebbleGeometry(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(0.052, 1);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = Math.sin(x * 38.0 + z * 27.0) * 0.08 + Math.cos(y * 31.0) * 0.05;
    pos.setXYZ(i, x * (1.18 + n), y * (0.44 + n * 0.35), z * (0.92 - n * 0.55));
  }
  geo.computeVertexNormals();
  return geo;
}

function sampleBedHeight(wx: number, wz: number, bedY: number): number {
  const dCenter = Math.hypot(wx * 0.72, wz);
  const depthBowl = -0.06 * Math.exp(-dCenter * dCenter * 0.14);
  const rippleRelief = Math.sin(wx * 1.4) * Math.cos(wz * 1.8) * 0.025;
  // Gentle raised gravel shoal mound anchoring the top-right emergent granite boulders
  const dShoal = Math.hypot(wx - 1.72, wz + 0.52);
  const shoalMound = 0.065 * Math.exp(-dShoal * dShoal * 1.65);
  return bedY + depthBowl + rippleRelief + shoalMound;
}

export function createPondBed(
  waterY: number,
  bedY: number,
  maxAnisotropy: number,
  _isSoftwareGl = false,
): PondBedRig {
  const disposables: Array<{ dispose: () => void }> = [];
  const group = new THREE.Group();
  group.name = 'pond-bed-group';

  const bedTex = createPondGravelTextures(maxAnisotropy);

  const bedGeo = new THREE.PlaneGeometry(POND_BOUNDS.width, POND_BOUNDS.depth, 48, 36);
  bedGeo.rotateX(-Math.PI / 2);
  const bPos = bedGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < bPos.count; i++) {
    const wx = bPos.getX(i);
    const wz = bPos.getZ(i);
    bPos.setY(i, sampleBedHeight(wx, wz, 0));
  }
  bedGeo.computeVertexNormals();

  const timeUniform = { value: 0 };

  const attachBedCausticsShader = (
    mat: THREE.MeshStandardMaterial,
    isBedPlane: boolean,
    cacheKey: string,
  ) => {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uCausticTime = timeUniform;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vBedWorld;`,
        )
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          vec4 bedWp = vec4( transformed, 1.0 );
          #ifdef USE_INSTANCING
            bedWp = instanceMatrix * bedWp;
          #endif
          vBedWorld = (modelMatrix * bedWp).xyz;`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uCausticTime;
          varying vec3 vBedWorld;

          vec2 bedCausticHash2(vec2 p) {
            p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
            return fract(sin(p) * 43758.5453123);
          }

          float bedVoronoiEdge(vec2 x, float t) {
            vec2 n = floor(x);
            vec2 f = fract(x);
            float d1 = 8.0;
            float d2 = 8.0;
            for (int j = -1; j <= 1; j++) {
              for (int i = -1; i <= 1; i++) {
                vec2 g = vec2(float(i), float(j));
                vec2 o = bedCausticHash2(n + g);
                o = 0.5 + 0.44 * sin(t + 6.2831 * o);
                vec2 r = g - f + o;
                float d = dot(r, r);
                if (d < d1) {
                  d2 = d1;
                  d1 = d;
                } else if (d < d2) {
                  d2 = d;
                }
              }
            }
            return pow(clamp(1.0 - abs(sqrt(d2) - sqrt(d1)) * 4.4, 0.0, 1.0), 3.6);
          }

          float bedCausticArcs(vec2 p, float t) {
            vec2 warp = vec2(
              sin(p.y * 1.6 + t * 0.42) + cos(p.x * 1.1 - t * 0.35) * 0.5,
              cos(p.x * 1.5 - t * 0.38) + sin(p.y * 1.2 + t * 0.31) * 0.5
            ) * 0.24;
            float f1 = bedVoronoiEdge((p + warp) * 1.55, t * 0.72);
            float f2 = bedVoronoiEdge((mat2(0.8, -0.6, 0.6, 0.8) * (p - warp * 0.8)) * 1.95 + vec2(3.7, -2.1), -t * 0.58 + 1.9);
            float break1 = smoothstep(0.08, 0.68, sin(p.x * 1.85 - p.y * 1.35 + t * 0.28 + sin(p.y * 2.1) * 0.7));
            float break2 = smoothstep(0.08, 0.68, cos(p.x * 1.55 + p.y * 1.75 - t * 0.24 + cos(p.x * 1.9) * 0.7));
            float sunPocket = smoothstep(-0.12, 0.52, sin(p.x * 0.85 + t * 0.14) * cos(p.y * 0.95 - t * 0.12));
            return clamp(f1 * break1 + f2 * break2 * 0.78, 0.0, 1.0) * (0.30 + 0.70 * sunPocket);
          }`,
        );

      if (isBedPlane) {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float bedCenterGlow = exp(-dot(vBedWorld.xz, vBedWorld.xz) * 0.075);
          diffuseColor.rgb *= mix(0.38, 1.0, bedCenterGlow);`,
        );
      }

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        float cShadow = 1.0;
        #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
          DirectionalLightShadow cDirShadow = directionalLightShadows[ 0 ];
          cShadow = receiveShadow ? getShadow( directionalShadowMap[ 0 ], cDirShadow.shadowMapSize, cDirShadow.shadowIntensity, cDirShadow.shadowBias, cDirShadow.shadowRadius, vDirectionalShadowCoord[ 0 ] ) : 1.0;
        #endif
        float causticRibbons = bedCausticArcs(vBedWorld.xz, uCausticTime * 0.82);
        float cCenterGlow = exp(-dot(vBedWorld.xz, vBedWorld.xz) * 0.105);
        // Fine shimmering pale ivory-aqua Voronoi filament ribbons fading cleanly to 0 in corners & shadows
        reflectedLight.directDiffuse += vec3(0.88, 0.95, 0.89) * (causticRibbons * ${isBedPlane ? '0.205' : '0.155'}) * cCenterGlow * smoothstep(0.08, 0.92, cShadow);`,
      );
    };
    mat.customProgramCacheKey = () => `${cacheKey}-voronoi-v4`;
  };

  const bedMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: bedTex.map,
    bumpMap: bedTex.bumpMap,
    bumpScale: 0.018,
    roughnessMap: bedTex.roughnessMap,
    roughness: 0.9,
    metalness: 0.02,
    envMapIntensity: 0.12,
  });
  attachBedCausticsShader(bedMat, true, 'pond-bed-gravel-caustics-v4');

  const bedMesh = new THREE.Mesh(bedGeo, bedMat);
  bedMesh.position.y = bedY;
  bedMesh.receiveShadow = true;
  group.add(bedMesh);

  // 1,000 Instanced 3D River Pebbles in 1 draw call across 3 varied scale tiers
  const pebbleCount = 1000;
  const pebbleGeo = createRoundedPebbleGeometry();
  const pebbleMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.72,
    metalness: 0.03,
    envMapIntensity: 0.18,
  });
  attachBedCausticsShader(pebbleMat, false, 'pond-pebbles-caustics-v1');

  const pebblesMesh = new THREE.InstancedMesh(pebbleGeo, pebbleMat, pebbleCount);
  pebblesMesh.receiveShadow = true;
  pebblesMesh.castShadow = false;

  const mineralPalette = [
    new THREE.Color('#2a2f32'), // charcoal basalt
    new THREE.Color('#475156'), // river slate
    new THREE.Color('#5d5345'), // warm ochre-grey
    new THREE.Color('#3b4637'), // dark moss stone
    new THREE.Color('#303b39'), // slate jade
    new THREE.Color('#666763'), // weathered granite
  ];

  const hashAt = (n: number, salt: number) => {
    const v = Math.sin(n * 12.9898 + salt * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };

  const dummy = new THREE.Object3D();
  let placed = 0;

  const tryPlacePebble = (
    wx: number,
    wz: number,
    tierScale: number,
    seed: number,
    allowUnderPlank = false,
  ) => {
    if (placed >= pebbleCount) return;

    // Avoid deep rock cores while allowing natural clusters tight against boulder rims & underneath plank
    for (const obs of POND_OBSTACLES) {
      const margin = allowUnderPlank && obs.id === 'floating-plank' ? -0.38 : -0.06;
      if (signedDistanceToObstacle(wx, wz, obs) < margin) return;
    }

    const r1 = hashAt(seed, 1.3);
    const r2 = hashAt(seed, 2.7);
    const r3 = hashAt(seed, 4.1);
    const bedLocalY = sampleBedHeight(wx, wz, bedY);

    const sx = tierScale * (0.72 + r1 * 0.56);
    const sy = tierScale * (0.58 + r2 * 0.48);
    const sz = tierScale * (0.70 + r3 * 0.54);

    dummy.position.set(wx, Math.min(waterY - 0.08, bedLocalY + 0.011 * sy), wz);
    dummy.rotation.set((r1 - 0.5) * 0.28, r2 * Math.PI * 2, (r3 - 0.5) * 0.28);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    pebblesMesh.setMatrixAt(placed, dummy.matrix);

    const tint = mineralPalette[placed % mineralPalette.length].clone();
    tint.offsetHSL((r1 - 0.5) * 0.03, 0, (r3 - 0.5) * 0.07);
    pebblesMesh.setColorAt(placed, tint);
    placed++;
  };

  // Pass A (~260 stones): Dense gravel & cobble clusters anchoring the 3 top-right emergent boulders
  const boulders = POND_LAYOUT.emergentBoulders;
  for (let i = 0; i < 420 && placed < 260; i++) {
    const b = boulders[i % boulders.length];
    const ang = hashAt(i + 10, 5.1) * Math.PI * 2;
    const ringDist = b.radius * (0.88 + Math.pow(hashAt(i + 10, 7.3), 1.4) * 1.45);
    const wx = b.x + Math.cos(ang) * ringDist;
    const wz = b.z + Math.sin(ang) * ringDist;
    const tier = i % 5 === 0 ? 1.55 : i % 2 === 0 ? 0.92 : 0.52;
    tryPlacePebble(wx, wz, tier, i + 100, false);
  }

  // Pass B (~120 stones): Natural gravel collar around the top-left lantern rock & beneath the plank shadow
  for (let i = 0; i < 240 && placed < 380; i++) {
    const isLantern = i % 2 === 0;
    let wx: number;
    let wz: number;
    if (isLantern) {
      const ang = hashAt(i + 500, 3.3) * Math.PI * 2;
      const dist = 0.28 + Math.pow(hashAt(i + 500, 6.7), 1.3) * 0.42;
      wx = POND_LAYOUT.lanternPos.x + Math.cos(ang) * dist;
      wz = POND_LAYOUT.lanternPos.z + Math.sin(ang) * dist;
    } else {
      wx = (hashAt(i + 500, 8.1) * 2 - 1) * 1.32;
      wz = (hashAt(i + 500, 9.5) * 2 - 1) * 0.46;
    }
    const tier = i % 4 === 0 ? 1.4 : i % 2 === 0 ? 0.85 : 0.48;
    tryPlacePebble(wx, wz, tier, i + 700, true);
  }

  // Pass C (~620 stones): Multi-tier shingle, medium pebbles, and accent stones across the visible pond basin
  let attempt = 0;
  while (placed < pebbleCount && attempt < 4500) {
    attempt++;
    const rx = hashAt(attempt + 2000, 1.9);
    const rz = hashAt(attempt + 2000, 4.7);
    const wx = (rx * 2 - 1) * 3.45;
    const wz = (rz * 2 - 1) * 2.25;

    const tierPick = hashAt(attempt + 2000, 9.1);
    const tierScale =
      tierPick < 0.55
        ? 0.44 + tierPick * 0.35 // Tier 1: fine shingle gravel
        : tierPick < 0.88
          ? 0.82 + (tierPick - 0.55) * 1.35 // Tier 2: medium river pebbles
          : 1.42 + (tierPick - 0.88) * 5.2; // Tier 3: larger accent river stones
    tryPlacePebble(wx, wz, tierScale, attempt + 3000, true);
  }

  pebblesMesh.count = placed;
  pebblesMesh.instanceMatrix.needsUpdate = true;
  if (pebblesMesh.instanceColor) pebblesMesh.instanceColor.needsUpdate = true;
  pebblesMesh.computeBoundingSphere();
  group.add(pebblesMesh);

  // Sculptural submerged cobbles grounding boulder shoals and pond floor contours
  const submergedMat = new THREE.MeshStandardMaterial({
    color: 0x3b4344,
    roughness: 0.8,
    metalness: 0.03,
    envMapIntensity: 0.16,
  });
  attachBedCausticsShader(submergedMat, false, 'pond-submerged-rocks-caustics-v1');
  const submergedRocks: Array<{ x: number; z: number; rx: number; ry: number; rz: number; yaw: number }> = [
    { x: -1.18, z: -0.92, rx: 0.2, ry: 0.09, rz: 0.15, yaw: 0.5 },
    { x: 0.88, z: -1.04, rx: 0.17, ry: 0.08, rz: 0.14, yaw: 1.9 },
    { x: -0.96, z: 0.96, rx: 0.18, ry: 0.075, rz: 0.13, yaw: -0.7 },
    { x: 0.94, z: 0.98, rx: 0.21, ry: 0.085, rz: 0.16, yaw: 2.3 },
    { x: 1.88, z: 0.12, rx: 0.19, ry: 0.095, rz: 0.15, yaw: 1.1 },
    { x: 1.32, z: -0.58, rx: 0.18, ry: 0.09, rz: 0.14, yaw: -0.4 },
    { x: 1.78, z: -0.88, rx: 0.17, ry: 0.085, rz: 0.14, yaw: 2.1 },
    { x: -1.62, z: 0.02, rx: 0.15, ry: 0.07, rz: 0.12, yaw: -1.4 },
  ];
  submergedRocks.forEach((sr, idx) => {
    const rGeo = new THREE.IcosahedronGeometry(1, 2);
    const rPos = rGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < rPos.count; i++) {
      const vx = rPos.getX(i);
      const vy = rPos.getY(i);
      const vz = rPos.getZ(i);
      const n = 1 + Math.sin(vx * 5.1 + idx) * 0.12 + Math.cos(vz * 4.7 - idx) * 0.1;
      const flatY = vy > 0.28 ? 0.28 + (vy - 0.28) * 0.45 : vy;
      rPos.setXYZ(i, vx * sr.rx * n, flatY * sr.ry * n, vz * sr.rz * n);
    }
    rGeo.computeVertexNormals();
    const bedLocalY = sampleBedHeight(sr.x, sr.z, bedY);
    const rMesh = new THREE.Mesh(rGeo, submergedMat);
    rMesh.position.set(sr.x, Math.min(waterY - 0.15, bedLocalY + sr.ry * 0.36), sr.z);
    rMesh.rotation.y = sr.yaw;
    rMesh.receiveShadow = true;
    rMesh.castShadow = false;
    group.add(rMesh);
    disposables.push(rGeo);
  });

  disposables.push(bedTex, bedGeo, bedMat, pebbleGeo, pebbleMat, submergedMat);

  return {
    group,
    bedMesh,
    pebblesMesh,
    update: (elapsedSec: number) => {
      timeUniform.value = elapsedSec;
    },
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}
