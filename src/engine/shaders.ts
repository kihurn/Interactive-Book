import * as THREE from 'three';

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

