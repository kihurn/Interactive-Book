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
}

/**
 * Custom post-processing GLSL shader delivering:
 * - Elliptical chiaroscuro lamplight vignette around viewport perimeter
 * - Tuned color saturation boost & gentle S-curve filmic contrast
 * - Subtle warm highlight grading and micro-dithering to prevent dark shadow banding
 */
export const VignetteGradingShader = {
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1440, 900) },
    uVignetteRadius: { value: 0.52 },
    uVignetteSoftness: { value: 0.62 },
    uVignetteStrength: { value: 0.78 },
    uSaturation: { value: 0.95 },
    uContrast: { value: 1.04 },
    uWarmth: { value: 0.008 },
    uGrainAmount: { value: 0.014 },
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

    varying vec2 vUv;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 col = texel.rgb;

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
      // Deepen top-edge shadow where intro text lives so white typography stays ultra crisp
      float topShade = smoothstep(0.62, 0.98, vUv.y) * 0.42;
      float darkness = clamp(1.0 - vig * uVignetteStrength - topShade, 0.04, 1.0);
      col *= darkness;

      // 4. Micro-dither grain to eliminate banding in dark wood shadows
      float n = hash12(vUv * uResolution) - 0.5;
      col += n * uGrainAmount;

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
