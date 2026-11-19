import * as THREE from 'three';
import { POND_BOUNDS, POND_LAYOUT } from './constants';
import type { WaterSimulation } from './WaterSimulation';

export interface WaterSurfaceRig {
  waterMesh: THREE.Mesh;
  resize: (width: number, height: number, dpr: number) => void;
  update: (
    elapsedSec: number,
    camera: THREE.Camera,
    lanternFlicker: number,
    bookOpenFactor: number,
    cardPos: { x: number; z: number },
  ) => void;
  renderUnderwater: (
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    aboveWaterObjects: THREE.Object3D[],
  ) => void;
  dispose: () => void;
}

export function createWaterSurface(
  waterSim: WaterSimulation,
  waterY: number,
  width: number,
  height: number,
  dpr: number,
  isSoftwareGl: boolean,
): WaterSurfaceRig {
  const rtScale = isSoftwareGl ? 0.55 : 0.85;
  const rtW = Math.max(64, Math.round(width * dpr * rtScale));
  const rtH = Math.max(64, Math.round(height * dpr * rtScale));

  const underwaterRT = new THREE.WebGLRenderTarget(rtW, rtH, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    stencilBuffer: false,
  });

  const waterGeo = new THREE.PlaneGeometry(POND_BOUNDS.width, POND_BOUNDS.depth, 48, 36);
  waterGeo.rotateX(-Math.PI / 2);

  const uniforms = {
    tWave: { value: waterSim.texture },
    tUnderwater: { value: underwaterRT.texture },
    uWaveTexel: { value: waterSim.texelSize.clone() },
    uPondBounds: {
      value: new THREE.Vector4(
        POND_BOUNDS.minX,
        POND_BOUNDS.maxX,
        POND_BOUNDS.minZ,
        POND_BOUNDS.maxZ,
      ),
    },
    uResolution: {
      value: new THREE.Vector2(Math.max(1, width * dpr), Math.max(1, height * dpr)),
    },
    uTime: { value: 0 },
    uCameraPos: { value: new THREE.Vector3(0, 3.26, 2.42) },
    uSunDir: { value: new THREE.Vector3(1.92, 4.15, -1.18).normalize() },
    uLanternPos: {
      value: new THREE.Vector3(
        POND_LAYOUT.lanternPos.x,
        waterY + 0.18,
        POND_LAYOUT.lanternPos.z,
      ),
    },
    uLanternFlicker: { value: 1.0 },
    uBookShadowHalfSize: { value: new THREE.Vector2(0.76, 0.44) },
    uCardPos: { value: new THREE.Vector2(1.56, 0.6) },
    uLotusPos: {
      value: new THREE.Vector2(POND_LAYOUT.lotusPadPos.x, POND_LAYOUT.lotusPadPos.z),
    },
  };

  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x040d0d,
    roughness: 0.56,
    metalness: 0.0,
    envMapIntensity: 0.0,
    transparent: false,
    depthWrite: true,
  });

  waterMat.onBeforeCompile = (shader) => {
    waterMat.userData.shader = shader;
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D tWave;
        uniform vec4 uPondBounds;
        varying vec2 vWaterUv;
        varying vec3 vWaterWorld;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec2 initWaterUv = vec2(
          (transformed.x - uPondBounds.x) / (uPondBounds.y - uPondBounds.x),
          1.0 - (transformed.z - uPondBounds.z) / (uPondBounds.w - uPondBounds.z)
        );
        float waveDisp = texture2D(tWave, clamp(initWaterUv, 0.0, 1.0)).r;
        transformed.y += waveDisp * 0.015;`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 waterWp = modelMatrix * vec4(transformed, 1.0);
        vWaterWorld = waterWp.xyz;
        vWaterUv = vec2(
          (waterWp.x - uPondBounds.x) / (uPondBounds.y - uPondBounds.x),
          1.0 - (waterWp.z - uPondBounds.z) / (uPondBounds.w - uPondBounds.z)
        );`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D tWave;
        uniform sampler2D tUnderwater;
        uniform vec2 uWaveTexel;
        uniform vec2 uResolution;
        uniform float uTime;
        uniform vec3 uCameraPos;
        uniform vec3 uSunDir;
        uniform vec3 uLanternPos;
        uniform float uLanternFlicker;
        uniform vec2 uBookShadowHalfSize;
        uniform vec2 uCardPos;
        uniform vec2 uLotusPos;

        varying vec2 vWaterUv;
        varying vec3 vWaterWorld;

        float waterSdRoundedBox(vec2 p, vec2 b, float r) {
          vec2 q = abs(p) - b + vec2(r);
          return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
        }

        vec2 waterCausticHash2(vec2 p) {
          p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
          return fract(sin(p) * 43758.5453123);
        }

        float waterVoronoiEdge(vec2 x, float t) {
          vec2 n = floor(x);
          vec2 f = fract(x);
          float d1 = 8.0;
          float d2 = 8.0;
          for (int j = -1; j <= 1; j++) {
            for (int i = -1; i <= 1; i++) {
              vec2 g = vec2(float(i), float(j));
              vec2 o = waterCausticHash2(n + g);
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

        float waterCausticShimmer(vec2 p, float t) {
          vec2 warp = vec2(
            sin(p.y * 1.6 + t * 0.42) + cos(p.x * 1.1 - t * 0.35) * 0.5,
            cos(p.x * 1.5 - t * 0.38) + sin(p.y * 1.2 + t * 0.31) * 0.5
          ) * 0.24;
          float f1 = waterVoronoiEdge((p + warp) * 1.55, t * 0.72);
          float f2 = waterVoronoiEdge((mat2(0.8, -0.6, 0.6, 0.8) * (p - warp * 0.8)) * 1.95 + vec2(3.7, -2.1), -t * 0.58 + 1.9);
          float break1 = smoothstep(0.08, 0.68, sin(p.x * 1.85 - p.y * 1.35 + t * 0.28 + sin(p.y * 2.1) * 0.7));
          float break2 = smoothstep(0.08, 0.68, cos(p.x * 1.55 + p.y * 1.75 - t * 0.24 + cos(p.x * 1.9) * 0.7));
          float sunPocket = smoothstep(-0.12, 0.52, sin(p.x * 0.85 + t * 0.14) * cos(p.y * 0.95 - t * 0.12));
          return clamp(f1 * break1 + f2 * break2 * 0.78, 0.0, 1.0) * (0.30 + 0.70 * sunPocket);
        }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        vec4 wCenterInfo = texture2D(tWave, clamp(vWaterUv, 0.0, 1.0));
        float wHC = wCenterInfo.r;
        float wOpenMask = wCenterInfo.b;

        float wHL = texture2D(tWave, clamp(vWaterUv - vec2(uWaveTexel.x, 0.0), 0.0, 1.0)).r;
        float wHR = texture2D(tWave, clamp(vWaterUv + vec2(uWaveTexel.x, 0.0), 0.0, 1.0)).r;
        float wHU = texture2D(tWave, clamp(vWaterUv + vec2(0.0, uWaveTexel.y), 0.0, 1.0)).r;
        float wHD = texture2D(tWave, clamp(vWaterUv - vec2(0.0, uWaveTexel.y), 0.0, 1.0)).r;

        float wBreeze1 = sin(vWaterWorld.x * 3.9 + vWaterWorld.z * 2.5 + uTime * 1.15) * 0.0022;
        float wBreeze2 = cos(vWaterWorld.x * 2.8 - vWaterWorld.z * 4.2 - uTime * 0.92) * 0.0018;

        float wDx = (wHL - wHR) * 5.8 + (wBreeze1 - wBreeze2) * 0.45;
        float wDz = (wHD - wHU) * 5.8 + (wBreeze1 + wBreeze2) * 0.45;
        vec3 wWorldN = normalize(vec3(wDx, 1.0, wDz));
        normal = normalize((viewMatrix * vec4(wWorldN, 0.0)).xyz);`,
      )
      .replace(
        '#include <lights_fragment_begin>',
        `#include <lights_fragment_begin>
        float waterShadow = 1.0;
        #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
          DirectionalLightShadow wDirShadow = directionalLightShadows[ 0 ];
          waterShadow = receiveShadow ? getShadow( directionalShadowMap[ 0 ], wDirShadow.shadowMapSize, wDirShadow.shadowIntensity, wDirShadow.shadowBias, wDirShadow.shadowRadius, vDirectionalShadowCoord[ 0 ] ) : 1.0;
        #endif

        // 1. Refracted underwater scene (pebbles, submerged boulders, 3D koi) with smooth slope saturation
        vec2 wScreenUv = gl_FragCoord.xy / max(uResolution, vec2(1.0));
        vec2 wSafeSlope = wWorldN.xz / (1.0 + length(wWorldN.xz) * 1.45);
        float wRefractStrength = 0.088 * wOpenMask;
        vec2 wUvR = clamp(wScreenUv + wSafeSlope * (wRefractStrength * 1.018), vec2(0.002), vec2(0.998));
        vec2 wUvG = clamp(wScreenUv + wSafeSlope * wRefractStrength, vec2(0.002), vec2(0.998));
        vec2 wUvB = clamp(wScreenUv + wSafeSlope * (wRefractStrength * 0.982), vec2(0.002), vec2(0.998));

        vec3 wUnderwater = vec3(
          texture2D(tUnderwater, wUvR).r,
          texture2D(tUnderwater, wUvG).g,
          texture2D(tUnderwater, wUvB).b
        );

        // 2. Clearer deep jade-slate water absorption gradient so submerged koi and gravel stay luminous
        float wRadialFade = exp(-dot(vWaterWorld.xz, vWaterWorld.xz) * 0.055);
        vec3 wDeepTint = mix(vec3(0.008, 0.022, 0.024), vec3(0.018, 0.056, 0.054), wRadialFade);
        vec3 wTransmitted = mix(wUnderwater, wDeepTint, mix(0.36, 0.11, wRadialFade));

        // 3. Real directional soft shadow cast onto water surface + meniscus contact occlusion
        wTransmitted *= mix(0.48, 1.0, waterShadow);

        float wDBook = waterSdRoundedBox(vWaterWorld.xz, uBookShadowHalfSize, 0.04);
        float wBookOcc = smoothstep(-0.08, 0.22, wDBook);
        wTransmitted *= mix(0.64, 1.0, wBookOcc);

        float wDCardPad = length(vWaterWorld.xz - uCardPos) - 0.30;
        float wCardOcc = smoothstep(-0.04, 0.10, wDCardPad);
        wTransmitted *= mix(0.58, 1.0, wCardOcc);

        float wDLotusPad = length(vWaterWorld.xz - uLotusPos) - 0.26;
        float wLotusOcc = smoothstep(-0.04, 0.10, wDLotusPad);
        wTransmitted *= mix(0.58, 1.0, wLotusOcc);

        // 4. Crisp dynamic Laplacian wave-crest caustics + trough darkening (pale ivory-aqua shimmer, never milky)
        float wLaplacian = clamp(((wHL + wHR + wHU + wHD) * 0.25 - wHC) * 32.0, -0.65, 1.25);
        float wCrestLight = pow(max(0.0, wLaplacian), 2.1);
        float wTroughDark = max(0.0, -wLaplacian);
        float wSlopeMag = length(wWorldN.xz);
        float wShimmer = waterCausticShimmer(vWaterWorld.xz + wSafeSlope * 0.42, uTime * 0.82);
        wTransmitted *= (1.0 - min(0.62, wTroughDark * 0.58));
        wTransmitted += vec3(0.048, 0.068, 0.062) * (wCrestLight * 0.72 + wShimmer * 0.065 * wRadialFade) * smoothstep(0.08, 0.92, waterShadow);

        // 5. Subtle directional Fresnel sheen + narrow optical ripple-crest highlights (preserves water transparency)
        vec3 wV = normalize(uCameraPos - vWaterWorld);
        float wFresnel = 0.015 + 0.985 * pow(1.0 - max(dot(wWorldN, wV), 0.0), 5.2);
        float wSunFacing = clamp(dot(wWorldN.xz, normalize(uSunDir.xz)) * 2.4 + 0.35, 0.0, 1.0);
        vec3 wSkyReflect = mix(vec3(0.005, 0.014, 0.017), vec3(0.024, 0.048, 0.052), wSunFacing);
        wTransmitted = mix(wTransmitted, wSkyReflect, wFresnel * (0.20 + 0.34 * clamp(wSlopeMag * 2.4, 0.0, 1.0)));

        // Narrow optical rim along crisp wave slopes facing key light
        float wSlopeRim = smoothstep(0.028, 0.15, wSlopeMag) * (0.30 + 0.70 * wSunFacing);
        wTransmitted += vec3(0.018, 0.036, 0.034) * wSlopeRim * mix(0.35, 1.0, waterShadow);

        // Sharp high-exponent sunlight glints riding narrow ripple crests (masked by real bamboo/book shadows)
        vec3 wLsun = normalize(uSunDir);
        vec3 wHsun = normalize(wLsun + wV);
        float wSunBroad = pow(max(dot(wWorldN, wHsun), 0.0), 92.0);
        float wSunCrisp = pow(max(dot(wWorldN, wHsun), 0.0), 260.0);
        wTransmitted += vec3(0.84, 0.93, 0.89) * (wSunBroad * 0.14 + wSunCrisp * 0.72) * waterShadow * wBookOcc * smoothstep(0.008, 0.045, wSlopeMag);

        // 6. Warm amber Yukimi-doro lantern rim reflections along open-water ripple crests
        vec3 wToLantern = normalize(uLanternPos - vWaterWorld);
        vec3 wHlantern = normalize(wToLantern + wV);
        float wLanternSpec = pow(max(dot(wWorldN, wHlantern), 0.0), 72.0);
        vec2 wReflDelta = (vWaterWorld.xz - uLanternPos.xz) + wWorldN.xz * 0.45;
        float wStreakMask = exp(-dot(wReflDelta * vec2(1.8, 1.0), wReflDelta * vec2(1.8, 1.0)) * 2.4);
        float wRippleBreak = 0.45 + 0.55 * sin(wReflDelta.x * 16.0 + wWorldN.x * 20.0 + uTime * 2.2);
        vec3 wAmber = vec3(0.95, 0.48, 0.16);
        wTransmitted += wAmber * (wStreakMask * wRippleBreak * 0.10 + wLanternSpec * 0.72) * smoothstep(0.08, 0.55, wOpenMask) * uLanternFlicker;

        // Wet shoreline contact darkening around plank, boulders, and lantern rock
        float wWetEdge = smoothstep(0.0, 0.34, wOpenMask);
        wTransmitted *= mix(0.68, 1.0, wWetEdge);

        totalEmissiveRadiance += wTransmitted;`,
      );
  };
  waterMat.customProgramCacheKey = () => 'pond-water-standard-shadow-v8';

  const waterMesh = new THREE.Mesh(waterGeo, waterMat);
  waterMesh.name = 'pond-water-surface';
  waterMesh.position.y = waterY;
  waterMesh.receiveShadow = true;
  waterMesh.castShadow = false;
  waterMesh.renderOrder = 1;

  const tmpSize = new THREE.Vector2();

  return {
    waterMesh,
    resize: (nextW: number, nextH: number, nextDpr: number) => {
      const scaledW = Math.max(64, Math.round(nextW * nextDpr * rtScale));
      const scaledH = Math.max(64, Math.round(nextH * nextDpr * rtScale));
      underwaterRT.setSize(scaledW, scaledH);
      uniforms.uResolution.value.set(
        Math.max(1, nextW * nextDpr),
        Math.max(1, nextH * nextDpr),
      );
    },
    update: (elapsedSec, camera, lanternFlicker, bookOpenFactor, cardPos) => {
      const waveTex = waterSim.texture;
      uniforms.tWave.value = waveTex;
      uniforms.uTime.value = elapsedSec;
      uniforms.uCameraPos.value.copy(camera.position);
      uniforms.uLanternFlicker.value = lanternFlicker;
      uniforms.uBookShadowHalfSize.value.set(
        THREE.MathUtils.lerp(0.76, 1.49, bookOpenFactor),
        0.44,
      );
      uniforms.uCardPos.value.set(cardPos.x, cardPos.z);

      const compiledShader = waterMat.userData.shader as
        | { uniforms?: Record<string, THREE.IUniform> }
        | undefined;
      if (compiledShader?.uniforms?.tWave) {
        compiledShader.uniforms.tWave.value = waveTex;
      }
    },
    renderUnderwater: (renderer, scene, camera, aboveWaterObjects) => {
      renderer.getDrawingBufferSize(tmpSize);
      if (tmpSize.x > 0 && tmpSize.y > 0) {
        uniforms.uResolution.value.copy(tmpSize);
      }

      const prevTarget = renderer.getRenderTarget();
      const prevShadowAuto = renderer.shadowMap.autoUpdate;
      const prevShadowNeeds = renderer.shadowMap.needsUpdate;
      const prevVis = aboveWaterObjects.map((obj) => obj.visible);
      const prevWaterVis = waterMesh.visible;

      waterMesh.visible = false;
      for (let i = 0; i < aboveWaterObjects.length; i++) {
        aboveWaterObjects[i].visible = false;
      }

      // Preserve main-pass shadow update while rendering clean underwater refraction buffer
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = false;
      renderer.setRenderTarget(underwaterRT);
      renderer.clear();
      renderer.render(scene, camera);

      renderer.setRenderTarget(prevTarget);
      renderer.shadowMap.autoUpdate = prevShadowAuto;
      renderer.shadowMap.needsUpdate = prevShadowNeeds;
      waterMesh.visible = prevWaterVis;
      for (let i = 0; i < aboveWaterObjects.length; i++) {
        aboveWaterObjects[i].visible = prevVis[i];
      }
    },
    dispose: () => {
      underwaterRT.dispose();
      waterGeo.dispose();
      waterMat.dispose();
    },
  };
}
