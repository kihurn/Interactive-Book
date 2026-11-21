import * as THREE from 'three';
import { POND_CAUSTICS_GLSL } from './causticsShader';
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

  let compiledWaveUniform: THREE.IUniform | null = null;

  waterMat.onBeforeCompile = (shader) => {
    waterMat.userData.shader = shader;
    Object.assign(shader.uniforms, uniforms);
    compiledWaveUniform = shader.uniforms.tWave ?? null;

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

        ${POND_CAUSTICS_GLSL}`,
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

        // 2. Clearer shallow jade-slate water absorption gradient so pond floor, base stones, and koi stay luminous
        float wRadialFade = exp(-dot(vWaterWorld.xz, vWaterWorld.xz) * 0.055);
        vec3 wDeepTint = mix(vec3(0.010, 0.026, 0.028), vec3(0.020, 0.060, 0.058), wRadialFade);
        vec3 wTransmitted = mix(wUnderwater, wDeepTint, mix(0.30, 0.07, wRadialFade));

        // 3. Real directional soft shadow cast onto water surface + meniscus contact occlusion
        wTransmitted *= mix(0.48, 1.0, waterShadow);

        float wDBook = pondSdRoundedBox(vWaterWorld.xz, uBookShadowHalfSize, 0.04);
        float wBookOcc = smoothstep(-0.08, 0.22, wDBook);
        wTransmitted *= mix(0.64, 1.0, wBookOcc);

        float wDCardPad = length(vWaterWorld.xz - uCardPos) - 0.30;
        float wCardOcc = smoothstep(-0.04, 0.10, wDCardPad);
        wTransmitted *= mix(0.58, 1.0, wCardOcc);

        float wDLotusPad = length(vWaterWorld.xz - uLotusPos) - 0.26;
        float wLotusOcc = smoothstep(-0.04, 0.10, wDLotusPad);
        wTransmitted *= mix(0.58, 1.0, wLotusOcc);

        // 4. Wave-driven convex-crest Laplacian caustics + softened trough darkening + thin warm pale-gold filaments
        float wFocus = (wHC - (wHL + wHR + wHU + wHD) * 0.25) * 40.0;
        float wCrestLight = pow(clamp(wFocus, 0.0, 1.25), 1.55);
        float wTroughDark = clamp(-wFocus, 0.0, 0.36);
        float wSlopeMag = length(wWorldN.xz);
        float wThreads = pondAmbientSunThreads(vWaterWorld.xz + wSafeSlope * 0.30, uTime);
        float wCover = pondCausticCoverMask(vWaterWorld.xz, waterShadow) * wBookOcc;
        wTransmitted *= (1.0 - min(0.32, wTroughDark * 0.42));
        wTransmitted += (vec3(0.11, 0.10, 0.075) * wCrestLight + vec3(1.0, 0.94, 0.76) * (wThreads * 0.042)) * wCover;

        // 5. Subtle directional Fresnel sheen + narrow optical ripple-crest highlights (preserves water transparency)
        vec3 wV = normalize(uCameraPos - vWaterWorld);
        float wFresnel = 0.015 + 0.985 * pow(1.0 - max(dot(wWorldN, wV), 0.0), 5.2);
        float wSunFacing = clamp(dot(wWorldN.xz, normalize(uSunDir.xz)) * 2.4 + 0.35, 0.0, 1.0);
        vec3 wSkyReflect = mix(vec3(0.014, 0.032, 0.036), vec3(0.034, 0.064, 0.066), wSunFacing);
        wTransmitted = mix(wTransmitted, wSkyReflect, wFresnel * (0.14 + 0.26 * clamp(wSlopeMag * 2.2, 0.0, 1.0)));

        // Narrow optical rim along crisp wave slopes facing key light
        float wSlopeRim = smoothstep(0.024, 0.14, wSlopeMag) * (0.30 + 0.70 * wSunFacing);
        wTransmitted += vec3(0.024, 0.044, 0.040) * wSlopeRim * mix(0.45, 1.0, waterShadow);

        // Sharp high-exponent sunlight glints riding narrow ripple crests (masked by real bamboo/book shadows)
        vec3 wLsun = normalize(uSunDir);
        vec3 wHsun = normalize(wLsun + wV);
        float wSunBroad = pow(max(dot(wWorldN, wHsun), 0.0), 86.0);
        float wSunCrisp = pow(max(dot(wWorldN, wHsun), 0.0), 240.0);
        wTransmitted += vec3(0.88, 0.95, 0.89) * (wSunBroad * 0.18 + wSunCrisp * 0.78) * waterShadow * wBookOcc * smoothstep(0.006, 0.042, wSlopeMag);

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
  waterMat.customProgramCacheKey = () => 'pond-water-standard-laplacian-v11';

  const waterMesh = new THREE.Mesh(waterGeo, waterMat);
  waterMesh.name = 'pond-water-surface';
  waterMesh.position.y = waterY;
  waterMesh.receiveShadow = true;
  waterMesh.castShadow = false;
  waterMesh.renderOrder = 1;

  const tmpSize = new THREE.Vector2();
  const prevVis: boolean[] = [];

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

      if (compiledWaveUniform) {
        compiledWaveUniform.value = waveTex;
      }
    },
    renderUnderwater: (renderer, scene, camera, aboveWaterObjects) => {
      renderer.getDrawingBufferSize(tmpSize);
      if (
        tmpSize.x > 0 &&
        tmpSize.y > 0 &&
        (uniforms.uResolution.value.x !== tmpSize.x ||
          uniforms.uResolution.value.y !== tmpSize.y)
      ) {
        uniforms.uResolution.value.copy(tmpSize);
      }

      const prevTarget = renderer.getRenderTarget();
      const prevShadowAuto = renderer.shadowMap.autoUpdate;
      const prevShadowNeeds = renderer.shadowMap.needsUpdate;
      const len = aboveWaterObjects.length;
      const prevWaterVis = waterMesh.visible;

      waterMesh.visible = false;
      for (let i = 0; i < len; i++) {
        prevVis[i] = aboveWaterObjects[i].visible;
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
      for (let i = 0; i < len; i++) {
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
