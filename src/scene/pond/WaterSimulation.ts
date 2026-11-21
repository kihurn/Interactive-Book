import * as THREE from 'three';
import {
  POND_BOUNDS,
  POND_OBSTACLES,
  worldToPondUv,
} from './constants';

export interface CpuWaveImpulse {
  x: number;
  z: number;
  startTime: number;
  radius: number;
  strength: number;
}

const PASS_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const INIT_OBSTACLE_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform vec4 uPondBounds; // minX, maxX, minZ, maxZ
  uniform vec4 uPedestal;   // x, z, halfW, halfD
  uniform float uPedestalCorner;
  uniform vec4 uCircles[4]; // x, z, radius, active

  float sdRoundedRect(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + vec2(r);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }

  void main() {
    float wx = mix(uPondBounds.x, uPondBounds.y, vUv.x);
    float wz = mix(uPondBounds.w, uPondBounds.z, vUv.y);
    vec2 wp = vec2(wx, wz);

    float minD = sdRoundedRect(
      wp - uPedestal.xy,
      uPedestal.zw,
      uPedestalCorner
    );

    for (int i = 0; i < 4; i++) {
      if (uCircles[i].w > 0.5) {
        float d = length(wp - uCircles[i].xy) - uCircles[i].z;
        minD = min(minD, d);
      }
    }

    // Soft boundary feather (~0.08 world units ~2 texels) so ripples reflect cleanly without aliasing
    float openMask = smoothstep(-0.015, 0.075, minD);
    gl_FragColor = vec4(0.0, 0.0, openMask, 1.0);
  }
`;

const STEP_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform sampler2D tWave;
  uniform vec2 uTexelSize;
  uniform float uDamping;

  void main() {
    vec4 info = texture2D(tWave, vUv);
    float mask = info.b;

    // Sample 4 orthogonal neighbors
    vec4 nL = texture2D(tWave, vUv - vec2(uTexelSize.x, 0.0));
    vec4 nR = texture2D(tWave, vUv + vec2(uTexelSize.x, 0.0));
    vec4 nU = texture2D(tWave, vUv + vec2(0.0, uTexelSize.y));
    vec4 nD = texture2D(tWave, vUv - vec2(0.0, uTexelSize.y));

    // Reflect energy gently off stone obstacle edges by substituting center height at solid neighbors
    float hL = mix(info.r, nL.r, nL.b);
    float hR = mix(info.r, nR.r, nR.b);
    float hU = mix(info.r, nU.r, nU.b);
    float hD = mix(info.r, nD.r, nD.b);

    float avg = (hL + hR + hU + hD) * 0.25;
    float next = (avg * 2.0 - info.g) * uDamping;

    // Gentle wall absorption at pond bounds edge
    float edgeFade = smoothstep(0.0, 0.04, vUv.x)
                   * smoothstep(0.0, 0.04, 1.0 - vUv.x)
                   * smoothstep(0.0, 0.04, vUv.y)
                   * smoothstep(0.0, 0.04, 1.0 - vUv.y);
    next *= mask * edgeFade;
    next = clamp(next, -1.0, 1.0);

    gl_FragColor = vec4(next, info.r, mask, 1.0);
  }
`;

const DROP_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform sampler2D tWave;
  uniform vec2 uCenter;
  uniform float uRadius;
  uniform float uStrength;
  uniform float uAspect;

  void main() {
    vec4 info = texture2D(tWave, vUv);
    vec2 diff = vUv - uCenter;
    diff.x *= uAspect;
    float dist = length(diff);
    float normD = dist / max(0.001, uRadius);
    // Zero-integral 2D wave packet forms sharp concentric rings with crisp troughs and no flat milky saucer
    float r2 = normD * normD * 4.2;
    float packet = (1.0 - r2) * exp(-r2) * smoothstep(1.0, 0.78, normD);
    float h = clamp(info.r + packet * uStrength * info.b, -1.0, 1.0);
    gl_FragColor = vec4(h, info.g, info.b, 1.0);
  }
`;

export class WaterSimulation {
  public readonly resolution: number;
  public readonly texelSize: THREE.Vector2;

  private rtA: THREE.WebGLRenderTarget;
  private rtB: THREE.WebGLRenderTarget;
  private readTarget: THREE.WebGLRenderTarget;
  private writeTarget: THREE.WebGLRenderTarget;

  private simScene = new THREE.Scene();
  private simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quadGeo = new THREE.PlaneGeometry(2, 2);
  private quadMesh: THREE.Mesh;

  private initMat: THREE.ShaderMaterial;
  private stepMat: THREE.ShaderMaterial;
  private dropMat: THREE.ShaderMaterial;

  private initializedMask = false;
  private elapsedSec = 0;
  private stepAccumulator = 0;
  private impulses: CpuWaveImpulse[] = [];
  private cpuWaveResult = { height: 0, slopeX: 0, slopeZ: 0 };

  constructor(_isSoftwareGl: boolean) {
    this.resolution = 256;
    this.texelSize = new THREE.Vector2(1 / this.resolution, 1 / this.resolution);

    const opts: THREE.RenderTargetOptions = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    };

    this.rtA = new THREE.WebGLRenderTarget(this.resolution, this.resolution, opts);
    this.rtB = new THREE.WebGLRenderTarget(this.resolution, this.resolution, opts);
    this.readTarget = this.rtA;
    this.writeTarget = this.rtB;

    const plankObs = POND_OBSTACLES.find((o) => o.id === 'floating-plank' || o.id === 'stone-pedestal');
    const circles = POND_OBSTACLES.filter((o) => o.kind === 'circle').slice(0, 4);
    const circleVecs = [0, 1, 2, 3].map((i) => {
      const c = circles[i];
      return c && c.kind === 'circle'
        ? new THREE.Vector4(c.x, c.z, c.radius, 1)
        : new THREE.Vector4(0, 0, 0, 0);
    });

    this.initMat = new THREE.ShaderMaterial({
      uniforms: {
        uPondBounds: {
          value: new THREE.Vector4(
            POND_BOUNDS.minX,
            POND_BOUNDS.maxX,
            POND_BOUNDS.minZ,
            POND_BOUNDS.maxZ,
          ),
        },
        uPedestal: {
          value:
            plankObs && plankObs.kind === 'roundedRect'
              ? new THREE.Vector4(
                  plankObs.x,
                  plankObs.z,
                  plankObs.halfW,
                  plankObs.halfD,
                )
              : new THREE.Vector4(0, 0, 1.27, 0.38),
        },
        uPedestalCorner: {
          value: plankObs && plankObs.kind === 'roundedRect' ? plankObs.cornerRadius : 0.08,
        },
        uCircles: { value: circleVecs },
      },
      vertexShader: PASS_VERTEX_SHADER,
      fragmentShader: INIT_OBSTACLE_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });

    this.stepMat = new THREE.ShaderMaterial({
      uniforms: {
        tWave: { value: this.readTarget.texture },
        uTexelSize: { value: this.texelSize },
        uDamping: { value: 0.981 },
      },
      vertexShader: PASS_VERTEX_SHADER,
      fragmentShader: STEP_FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
    });

    this.dropMat = new THREE.ShaderMaterial({
      uniforms: {
        tWave: { value: this.readTarget.texture },
        uCenter: { value: new THREE.Vector2(0.5, 0.5) },
        uRadius: { value: 0.03 },
        uStrength: { value: 0.08 },
        uAspect: { value: POND_BOUNDS.width / POND_BOUNDS.depth },
      },
      vertexShader: PASS_VERTEX_SHADER,
      fragmentShader: DROP_FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
    });

    this.quadMesh = new THREE.Mesh(this.quadGeo, this.initMat);
    this.quadMesh.frustumCulled = false;
    this.simScene.add(this.quadMesh);
  }

  public get texture(): THREE.Texture {
    return this.readTarget.texture;
  }

  private renderSimPass(
    renderer: THREE.WebGLRenderer,
    material: THREE.Material,
    target: THREE.WebGLRenderTarget,
  ) {
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    const prevShadowAuto = renderer.shadowMap.autoUpdate;

    this.quadMesh.material = material;
    renderer.autoClear = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(target);
    renderer.render(this.simScene, this.simCamera);

    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
    renderer.shadowMap.autoUpdate = prevShadowAuto;
  }

  private swapTargets() {
    const tmp = this.readTarget;
    this.readTarget = this.writeTarget;
    this.writeTarget = tmp;
  }

  public ensureInitialized(renderer: THREE.WebGLRenderer) {
    if (this.initializedMask) return;
    this.initializedMask = true;
    this.renderSimPass(renderer, this.initMat, this.rtA);
    this.renderSimPass(renderer, this.initMat, this.rtB);
  }

  public addDrop(
    renderer: THREE.WebGLRenderer,
    worldX: number,
    worldZ: number,
    worldRadius: number,
    strength: number,
  ) {
    this.ensureInitialized(renderer);
    const { u, v } = worldToPondUv(worldX, worldZ);
    const uvRadius = Math.max(0.008, worldRadius / POND_BOUNDS.depth);

    this.dropMat.uniforms.tWave.value = this.readTarget.texture;
    this.dropMat.uniforms.uCenter.value.set(u, v);
    this.dropMat.uniforms.uRadius.value = uvRadius;
    this.dropMat.uniforms.uStrength.value = strength;

    this.renderSimPass(renderer, this.dropMat, this.writeTarget);
    this.swapTargets();

    // Maintain lightweight 8-item CPU ripple ring for lily pad bobbing & koi reactions (zero readPixels)
    this.impulses.push({
      x: worldX,
      z: worldZ,
      startTime: this.elapsedSec,
      radius: worldRadius,
      strength,
    });
    if (this.impulses.length > 8) {
      this.impulses.shift();
    }
  }

  public step(renderer: THREE.WebGLRenderer, dtSec: number, elapsedSec: number) {
    this.elapsedSec = elapsedSec;
    this.ensureInitialized(renderer);

    // Fixed-cadence wave propagation (1-3 substeps max) so ripple travel speed stays independent of framerate
    const fixedStep = 1 / 60;
    this.stepAccumulator = Math.min(0.06, this.stepAccumulator + Math.max(0, dtSec));
    let substeps = 0;
    while (this.stepAccumulator >= fixedStep && substeps < 3) {
      this.stepMat.uniforms.tWave.value = this.readTarget.texture;
      this.renderSimPass(renderer, this.stepMat, this.writeTarget);
      this.swapTargets();
      this.stepAccumulator -= fixedStep;
      substeps++;
    }
    if (substeps === 0) {
      this.stepMat.uniforms.tWave.value = this.readTarget.texture;
      this.renderSimPass(renderer, this.stepMat, this.writeTarget);
      this.swapTargets();
    }
  }

  /**
   * Evaluates lightweight analytical ripple displacement & tilt at any world XZ without touching GPU pixels.
   */
  public sampleCpuWaveAt(worldX: number, worldZ: number): { height: number; slopeX: number; slopeZ: number } {
    let height = 0;
    let slopeX = 0;
    let slopeZ = 0;

    for (let i = 0; i < this.impulses.length; i++) {
      const imp = this.impulses[i];
      const age = this.elapsedSec - imp.startTime;
      if (age < 0 || age > 3.2) continue;

      const dx = worldX - imp.x;
      const dz = worldZ - imp.z;
      const dist = Math.hypot(dx, dz);
      const ringRadius = age * 1.15;
      const bandDist = dist - ringRadius;
      const envelope = Math.exp(-age * 1.15) * Math.exp(-(bandDist * bandDist) * 3.8);
      const wave = Math.sin(bandDist * 11.0) * imp.strength * envelope;
      height += wave;
      if (dist > 0.01) {
        const radialSlope = Math.cos(bandDist * 11.0) * imp.strength * envelope * 0.45;
        slopeX += (dx / dist) * radialSlope;
        slopeZ += (dz / dist) * radialSlope;
      }
    }

    this.cpuWaveResult.height = height;
    this.cpuWaveResult.slopeX = slopeX;
    this.cpuWaveResult.slopeZ = slopeZ;
    return this.cpuWaveResult;
  }

  public getRecentImpulses(): readonly CpuWaveImpulse[] {
    return this.impulses;
  }

  public dispose() {
    this.rtA.dispose();
    this.rtB.dispose();
    this.quadGeo.dispose();
    this.initMat.dispose();
    this.stepMat.dispose();
    this.dropMat.dispose();
  }
}
