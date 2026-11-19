import * as THREE from 'three';
import type { PropLayout } from '../../config/theme';
import { createBusinessCardStack } from '../../engine/props';
import {
  createLilyPadDroplets,
  createMeniscusShadowTexture,
  createSculptedLilyPadGeometry,
  type LilyPadSculptOptions,
  type LilyPadTextures,
} from './PondFlora';
import type { WaterSimulation } from './WaterSimulation';

export interface BusinessCardPadRig {
  group: THREE.Group;
  hitTargets: THREE.Object3D[];
  cardVisualGroup: THREE.Group;
  applyPlacement: (layout: PropLayout) => void;
  update: (
    dtSec: number,
    elapsedSec: number,
    waterSim: WaterSimulation,
    hovered: boolean,
  ) => void;
  dispose: () => void;
}

/**
 * Places a wide, flatter cupped 3D lily pad directly underneath the cloned KIHURN
 * business card stack so the card sits flush and dry atop the pad with zero clipping.
 */
export function createBusinessCardPad(
  businessCardMap: THREE.CanvasTexture,
  padTextures: LilyPadTextures,
  waterY: number,
): BusinessCardPadRig {
  const disposables: Array<{ dispose: () => void }> = [];
  const group = new THREE.Group();
  group.name = 'pond-business-card-pad';

  const floatGroup = new THREE.Group();
  group.add(floatGroup);

  const meniscusTex = createMeniscusShadowTexture();
  const meniscusMat = new THREE.MeshBasicMaterial({
    map: meniscusTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.92,
  });
  const meniscusGeo = new THREE.PlaneGeometry(0.56, 0.56);
  meniscusGeo.rotateX(-Math.PI / 2);
  const meniscusMesh = new THREE.Mesh(meniscusGeo, meniscusMat);
  meniscusMesh.position.y = -0.002;
  meniscusMesh.renderOrder = 2;
  floatGroup.add(meniscusMesh);

  // Radius 0.194 (scaled 0.9 -> 0.1746m < 0.1852m corner distance) + V-notch aimed directly toward open book corner (1.472, 0.437)
  const padOpts: LilyPadSculptOptions = {
    radius: 0.194,
    notchAngleRad: 0.44,
    cupHeight: 0.009,
    waveAmp: 0.0038,
    flatCenterRatio: 0.62,
  };
  const padGeo = createSculptedLilyPadGeometry(padOpts);
  const padMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: padTextures.map,
    bumpMap: padTextures.bumpMap,
    bumpScale: 0.0035,
    roughnessMap: padTextures.roughnessMap,
    roughness: 0.42,
    metalness: 0.0,
    clearcoat: 0.34,
    clearcoatRoughness: 0.32,
    envMapIntensity: 0.24,
    side: THREE.DoubleSide,
  });
  const padMesh = new THREE.Mesh(padGeo, padMat);
  padMesh.rotation.y = 1.847;
  padMesh.castShadow = true;
  padMesh.receiveShadow = true;
  floatGroup.add(padMesh);

  // Delicate glistening droplets placed around outer pad perimeter safely clear of the central card stack
  const padDroplets = createLilyPadDroplets(padOpts, [
    { rNorm: 0.78, theta: 1.85, scale: 0.85 },
    { rNorm: 0.83, theta: 3.65, scale: 0.72 },
    { rNorm: 0.80, theta: 4.95, scale: 0.82 },
    { rNorm: 0.85, theta: 5.55, scale: 0.66 },
  ]);
  padMesh.add(padDroplets.group);

  // Subtle shadow catcher & contact AO directly on top of the flat pad cradle beneath cards
  const cardShadowMat = new THREE.ShadowMaterial({
    color: 0x050908,
    opacity: 0.45,
    transparent: true,
    depthWrite: false,
  });
  const cardShadowGeo = new THREE.PlaneGeometry(0.32, 0.24);
  cardShadowGeo.rotateX(-Math.PI / 2);
  const cardShadowCatcher = new THREE.Mesh(cardShadowGeo, cardShadowMat);
  cardShadowCatcher.position.y = 0.0018;
  cardShadowCatcher.receiveShadow = true;
  cardShadowCatcher.renderOrder = 2;
  floatGroup.add(cardShadowCatcher);

  // Exact cloned business card stack resting cleanly atop the dry flat center of the pad
  const cardStack = createBusinessCardStack(businessCardMap);
  const baseCardY = 0.0032;
  cardStack.cardsMeshGroup.position.y = baseCardY;
  cardStack.group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
  floatGroup.add(cardStack.group);

  let currentX = 1.56;
  let currentZ = 0.6;
  let lift = 0;

  disposables.push(
    meniscusTex,
    meniscusMat,
    meniscusGeo,
    padGeo,
    padMat,
    padDroplets,
    cardShadowMat,
    cardShadowGeo,
    cardStack,
  );

  return {
    group,
    hitTargets: cardStack.hitTargets,
    cardVisualGroup: cardStack.cardsMeshGroup,
    applyPlacement: (layout: PropLayout) => {
      currentX = layout.position.x;
      currentZ = layout.position.z;
      group.position.set(currentX, waterY + 0.004, currentZ);
      group.rotation.y = layout.rotationY;
      group.scale.setScalar(layout.scale);
    },
    update: (dtSec, elapsedSec, waterSim, hovered) => {
      const targetLift = hovered ? 0.012 : 0;
      const alpha = 1 - Math.exp(-14 * Math.min(0.05, Math.max(0.001, dtSec)));
      lift += (targetLift - lift) * alpha;
      cardStack.cardsMeshGroup.position.y = baseCardY + lift;

      const wave = waterSim.sampleCpuWaveAt(currentX, currentZ);
      floatGroup.position.y =
        wave.height * 0.075 + Math.sin(elapsedSec * 1.05 + 1.4) * 0.002;
      floatGroup.rotation.x = wave.slopeZ * 0.2 + Math.sin(elapsedSec * 0.85) * 0.01;
      floatGroup.rotation.z = -wave.slopeX * 0.2 + Math.cos(elapsedSec * 0.78) * 0.01;
    },
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}
