import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';

export interface DepthOfFieldUniforms {
  tDiffuse: { value: THREE.Texture | null };
  tDepth: { value: THREE.Texture | null };
  uResolution: { value: THREE.Vector2 };
  uCameraNear: { value: number };
  uCameraFar: { value: number };
  uFocusDist: { value: number };
  uNearDeadzone: { value: number };
  uFarDeadzone: { value: number };
  uNearBlurRange: { value: number };
  uFarBlurRange: { value: number };
  uMaxBlurPx: { value: number };
  uEnabled: { value: number };
}

/**
 * Depth-aware soft Depth-of-Field shader running in linear HDR color space
 * prior to grading & ACES tone mapping. Uses a 16-tap golden-angle Vogel disk
 * with a wide crisp focal deadzone around the book and foreground-safe gather weights
 * to prevent blurred backgrounds from bleeding halos onto sharp book edges.
 */
export const DepthOfFieldShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    uResolution: { value: new THREE.Vector2(1440, 900) },
    uCameraNear: { value: 0.1 },
    uCameraFar: { value: 40.0 },
    uFocusDist: { value: 3.8 },
    uNearDeadzone: { value: 0.36 },
    uFarDeadzone: { value: 0.34 },
    uNearBlurRange: { value: 1.0 },
    uFarBlurRange: { value: 1.05 },
    uMaxBlurPx: { value: 2.92 },
    uEnabled: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec2 uResolution;
    uniform float uCameraNear;
    uniform float uCameraFar;
    uniform float uFocusDist;
    uniform float uNearDeadzone;
    uniform float uFarDeadzone;
    uniform float uNearBlurRange;
    uniform float uFarBlurRange;
    uniform float uMaxBlurPx;
    uniform float uEnabled;

    varying vec2 vUv;

    float getLinearDepth(vec2 uv) {
      float zNdc = texture2D(tDepth, uv).r * 2.0 - 1.0;
      return (2.0 * uCameraNear * uCameraFar) /
        max(0.0001, uCameraFar + uCameraNear - zNdc * (uCameraFar - uCameraNear));
    }

    float computeCoc(float linearDepth) {
      float delta = linearDepth - uFocusDist;
      if (delta >= 0.0) {
        return smoothstep(uFarDeadzone, uFarDeadzone + uFarBlurRange, delta);
      }
      return smoothstep(uNearDeadzone, uNearDeadzone + uNearBlurRange, -delta);
    }

    void main() {
      vec4 centerTex = texture2D(tDiffuse, vUv);
      if (uEnabled < 0.5 || uMaxBlurPx <= 0.01) {
        gl_FragColor = centerTex;
        return;
      }

      float centerDepth = getLinearDepth(vUv);
      float centerCoc = computeCoc(centerDepth);

      // Keep in-focus book pages, ink stems, and focal plane bit-exact sharp
      if (centerCoc < 0.004) {
        gl_FragColor = centerTex;
        return;
      }

      float refHeightScale = max(0.65, uResolution.y / 900.0);
      vec2 texelSize = 1.0 / max(vec2(1.0), uResolution);
      vec2 radiusUv = texelSize * (centerCoc * uMaxBlurPx * refHeightScale);

      // 16-tap golden-angle Vogel disk rotated without per-tap trig
      const mat2 GOLDEN_ROT = mat2(-0.73736888, 0.67549029, -0.67549029, -0.73736888);
      vec2 dir = vec2(1.0, 0.0);

      vec3 acc = centerTex.rgb * 0.16;
      float weightSum = 0.16;

      for (int i = 0; i < 16; i++) {
        dir = GOLDEN_ROT * dir;
        float r = sqrt((float(i) + 0.5) / 16.0);
        vec2 tapUv = clamp(vUv + dir * (r * radiusUv), vec2(0.001), vec2(0.999));

        float tapDepth = getLinearDepth(tapUv);
        float tapCoc = computeCoc(tapDepth);

        // Depth-aware gather weighting: suppress sharp foreground objects ghosting into background
        float depthWeight = tapDepth < centerDepth - 0.04
          ? clamp(max(tapCoc, centerCoc * 0.14), 0.04, 1.0)
          : clamp(tapCoc + 0.08, 0.08, 1.0);
        float apertureFalloff = mix(1.0, 0.72, r);
        float w = depthWeight * apertureFalloff;

        acc += texture2D(tDiffuse, tapUv).rgb * w;
        weightSum += w;
      }

      vec3 blurred = acc / max(0.0001, weightSum);
      float blend = smoothstep(0.0, 0.08, centerCoc);
      gl_FragColor = vec4(mix(centerTex.rgb, blurred, blend), centerTex.a);
    }
  `,
};

/**
 * Custom EffectComposer Pass wrapping DepthOfFieldShader so it dynamically binds
 * `readBuffer.depthTexture` on every frame across EffectComposer ping-pong swaps.
 */
export class DepthOfFieldPass extends Pass {
  public uniforms: DepthOfFieldUniforms;
  private material: THREE.ShaderMaterial;
  private fsQuad: FullScreenQuad;

  constructor() {
    super();
    this.uniforms = THREE.UniformsUtils.clone(DepthOfFieldShader.uniforms) as DepthOfFieldUniforms;
    this.material = new THREE.ShaderMaterial({
      name: 'DepthOfFieldShader',
      uniforms: this.uniforms as unknown as Record<string, THREE.IUniform>,
      vertexShader: DepthOfFieldShader.vertexShader,
      fragmentShader: DepthOfFieldShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.fsQuad = new FullScreenQuad(this.material);
  }

  public override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.tDepth.value = readBuffer.depthTexture;
    this.uniforms.uEnabled.value = readBuffer.depthTexture ? 1.0 : 0.0;

    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) {
      renderer.clear(renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil);
    }
    this.fsQuad.render(renderer);
  }

  public override dispose(): void {
    this.material.dispose();
    this.fsQuad.dispose();
  }
}

export interface VignetteGradingUniforms {
  tDiffuse: { value: THREE.Texture | null };
  uResolution: { value: THREE.Vector2 };
  uVignetteRadius: { value: number };
  uVignetteSoftness: { value: number };
  uVignetteStrength: { value: number };
  uSaturation: { value: number };
  uContrast: { value: number };
  uWarmth: { value: number };
  uGrainAmount: { value: number };
  uBookBounds: { value: THREE.Vector4 };
  uBookSharpen: { value: number };
}

/**
 * Custom post-processing GLSL shader delivering:
 * - Adaptive unsharp-mask text sharpening constrained strictly within the book's screen bounds
 * - Elliptical chiaroscuro lamplight vignette around viewport perimeter
 * - Tuned color saturation boost & gentle S-curve filmic contrast
 * - Subtle warm highlight grading and micro-dithering to prevent dark shadow banding
 */
export const VignetteGradingShader = {
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1440, 900) },
    uVignetteRadius: { value: 0.68 },
    uVignetteSoftness: { value: 0.74 },
    uVignetteStrength: { value: 0.38 },
    uSaturation: { value: 0.96 },
    uContrast: { value: 1.03 },
    uWarmth: { value: 0.008 },
    uGrainAmount: { value: 0.012 },
    uBookBounds: { value: new THREE.Vector4(0.1, 0.2, 0.9, 0.85) },
    uBookSharpen: { value: 0.44 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uVignetteRadius;
    uniform float uVignetteSoftness;
    uniform float uVignetteStrength;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uWarmth;
    uniform float uGrainAmount;
    uniform vec4 uBookBounds;
    uniform float uBookSharpen;

    varying vec2 vUv;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 col = texel.rgb;

      // 0. Adaptive text & glyph edge sharpening restricted strictly inside the book's projected UV bounds
      float feather = 0.022;
      float inBookX = smoothstep(uBookBounds.x - feather, uBookBounds.x + feather, vUv.x)
                    * (1.0 - smoothstep(uBookBounds.z - feather, uBookBounds.z + feather, vUv.x));
      float inBookY = smoothstep(uBookBounds.y - feather, uBookBounds.y + feather, vUv.y)
                    * (1.0 - smoothstep(uBookBounds.w - feather, uBookBounds.w + feather, vUv.y));
      float bookMask = clamp(inBookX * inBookY, 0.0, 1.0);

      if (bookMask > 0.001 && uBookSharpen > 0.001) {
        vec2 px = 1.0 / max(vec2(1.0), uResolution);
        vec3 nUp = texture2D(tDiffuse, vUv + vec2(0.0, px.y)).rgb;
        vec3 nDn = texture2D(tDiffuse, vUv - vec2(0.0, px.y)).rgb;
        vec3 nLt = texture2D(tDiffuse, vUv - vec2(px.x, 0.0)).rgb;
        vec3 nRt = texture2D(tDiffuse, vUv + vec2(px.x, 0.0)).rgb;
        vec3 nNW = texture2D(tDiffuse, vUv + vec2(-px.x, px.y)).rgb;
        vec3 nNE = texture2D(tDiffuse, vUv + vec2(px.x, px.y)).rgb;
        vec3 nSW = texture2D(tDiffuse, vUv + vec2(-px.x, -px.y)).rgb;
        vec3 nSE = texture2D(tDiffuse, vUv + vec2(px.x, -px.y)).rgb;
        vec3 blur = (nUp + nDn + nLt + nRt) * 0.15 + (nNW + nNE + nSW + nSE) * 0.1;
        vec3 edgeDelta = col - blur;
        float edgeMag = abs(dot(edgeDelta, vec3(0.299, 0.587, 0.114)));
        // Gate micro noise while sharpening dark type stems cleanly without bright halo clipping
        float gate = smoothstep(0.004, 0.036, edgeMag);
        col = clamp(col + clamp(edgeDelta, -0.26, 0.14) * (uBookSharpen * bookMask * gate), 0.0, 1.0);
      }

      // 1. Luminance-preserving saturation boost
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSaturation);

      // 2. Subtle midtone contrast curve & warm lamplight highlight tint
      col = (col - 0.5) * uContrast + 0.5;
      col = clamp(col, 0.0, 1.0);
      vec3 warmTint = vec3(1.0 + uWarmth, 1.0 + uWarmth * 0.35, 1.0 - uWarmth * 0.65);
      col *= mix(vec3(1.0), warmTint, smoothstep(0.18, 0.88, luma));

      // 3. Elliptical desk-lamp vignette (shifts focus slightly toward lower-center book zone)
      float aspect = max(1.0, uResolution.x) / max(1.0, uResolution.y);
      vec2 centered = vUv - vec2(0.5, 0.44);
      centered.x *= mix(1.0, aspect * 0.78, 0.55);
      float dist = length(centered);
      float vig = smoothstep(uVignetteRadius, uVignetteRadius + uVignetteSoftness, dist);
      // Soft top-edge darkening behind intro headline without crushing oak tabletop
      float topShade = smoothstep(0.76, 0.995, vUv.y) * 0.12;
      float darkness = clamp(1.0 - vig * uVignetteStrength - topShade, 0.28, 1.0);
      col *= darkness;

      // 4. Micro-dither grain to eliminate banding in dark wood shadows
      float n = hash12(vUv * uResolution) - 0.5;
      col += n * uGrainAmount * (1.0 - bookMask * 0.55);

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), texel.a);
    }
  `,
};

/**
 * Extends Three.js MeshStandardMaterial via onBeforeCompile to add
 * subtle spine-gutter ambient occlusion and grazing fiber sheen on curved paper sheets.
 */
export function enhancePaperShader(
  material: THREE.MeshStandardMaterial,
  side: 'left' | 'right' | 'sheet',
) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPageSide = { value: side === 'left' ? -1.0 : side === 'right' ? 1.0 : 0.0 };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vPaperUv;`,
      )
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        vPaperUv = uv;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uPageSide;
        varying vec2 vPaperUv;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Subtle spine crease darkening for physical page-curl depth
        float spineDist = uPageSide < -0.5 ? (1.0 - vPaperUv.x) : vPaperUv.x;
        float creaseAO = mix(0.84, 1.0, smoothstep(0.0, 0.09, spineDist));
        diffuseColor.rgb *= creaseAO;`,
      );
  };
  material.customProgramCacheKey = () => `paper-crease-${side}`;
}

/**
 * Extends Three.js MeshStandardMaterial for the dark oak desk with:
 * - World-space macro wood patina & plank-to-plank tonal variation to break texture repetition
 * - Pore-aligned micro depth darkening & grazing matte-oiled roughness modulation (eliminates plastic glare)
 */
export function enhanceDeskShader(material: THREE.MeshStandardMaterial) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vDeskWorldPos;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vDeskWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vDeskWorldPos;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Macro low-frequency organic oak patina across planks to eliminate tiling & plastic uniformity
        float macroWave = sin(vDeskWorldPos.x * 1.15 + sin(vDeskWorldPos.z * 2.4) * 0.8) * 0.5 + 0.5;
        float macroCross = cos(vDeskWorldPos.z * 1.65 - vDeskWorldPos.x * 0.45) * 0.5 + 0.5;
        float woodTone = mix(0.88, 1.08, macroWave * 0.62 + macroCross * 0.38);
        // Slightly richer shadow depth in dark oak pores
        float albedoLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        float poreDepth = smoothstep(0.02, 0.14, albedoLum);
        diffuseColor.rgb *= woodTone * mix(0.82, 1.0, poreDepth);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        // Raise roughness in oak pores & at shallow viewing angles so light glides like hand-oiled hardwood
        float oakMicroVar = sin(vDeskWorldPos.x * 5.2 + vDeskWorldPos.z * 1.8) * 0.035;
        float viewGrazing = 1.0 - clamp(abs(dot(normalize(vNormal), normalize(vViewPosition))), 0.0, 1.0);
        roughnessFactor = clamp(roughnessFactor + oakMicroVar + pow(viewGrazing, 2.0) * 0.12, 0.64, 0.96);`,
      );
  };
  material.customProgramCacheKey = () => 'dark-oak-desk-v2';
}

