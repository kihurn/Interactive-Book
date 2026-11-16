import * as THREE from 'three';
import type { PropLayout, SceneTheme } from '../config/theme';
import type { BookStaticTextureSet } from './textures';

export interface DeskPropsRig {
  group: THREE.Group;
  succulent: THREE.Group;
  pencil: THREE.Group;
  coffee: THREE.Group;
  cards: THREE.Group;
  applyLayout: (layout: SceneTheme['props']['desktop']) => void;
  dispose: () => void;
}

function applyPropPlacement(obj: THREE.Object3D, placement: PropLayout) {
  obj.position.set(placement.position.x, placement.position.y, placement.position.z);
  obj.rotation.y = placement.rotationY;
  obj.scale.setScalar(placement.scale);
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 10, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0,0,0,0.68)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.28)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

/**
 * Builds composite 3–12 part procedural 3D desk props with bottom-center pivots,
 * tactile matte/stoneware/ceramic PBR finishes, contact shadows, and dynamic lighting response.
 */
export function createDeskProps(staticTextures: BookStaticTextureSet): DeskPropsRig {
  const disposables: Array<{ dispose: () => void }> = [];
  const root = new THREE.Group();

  const propShadowTex = createContactShadowTexture();
  const propShadowMat = new THREE.MeshBasicMaterial({
    map: propShadowTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.72,
  });
  disposables.push(propShadowTex, propShadowMat);

  const addContactShadow = (parent: THREE.Group, width: number, depth: number, offsetX = 0, offsetZ = 0) => {
    const geo = new THREE.PlaneGeometry(width, depth);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, propShadowMat);
    mesh.position.set(offsetX, 0.0014, offsetZ);
    parent.add(mesh);
    disposables.push(geo);
  };

  // 1. SUCCULENT (left): Speckled matte stoneware pot + soil + 3 tiers of soft matte botanical rosette leaves
  const succulent = new THREE.Group();
  addContactShadow(succulent, 0.42, 0.42, 0.015, 0.012);

  const potProfile = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.115, 0.0),
    new THREE.Vector2(0.135, 0.16),
    new THREE.Vector2(0.145, 0.184),
    new THREE.Vector2(0.125, 0.184),
    new THREE.Vector2(0.115, 0.14),
    new THREE.Vector2(0.0, 0.14),
  ];
  const potGeo = new THREE.LatheGeometry(potProfile, 48);
  const potMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: staticTextures.stonewareMap,
    roughness: 0.92,
    metalness: 0.01,
    envMapIntensity: 0.12,
  });
  const potMesh = new THREE.Mesh(potGeo, potMat);
  potMesh.castShadow = true;
  potMesh.receiveShadow = true;
  succulent.add(potMesh);

  const soilGeo = new THREE.CylinderGeometry(0.12, 0.115, 0.02, 36);
  const soilMat = new THREE.MeshStandardMaterial({
    color: 0x1e1712,
    roughness: 0.98,
    metalness: 0.0,
    envMapIntensity: 0.08,
  });
  const soilMesh = new THREE.Mesh(soilGeo, soilMat);
  soilMesh.position.y = 0.145;
  soilMesh.receiveShadow = true;
  succulent.add(soilMesh);

  // Sculpted smooth rosette leaf geometry
  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, 0);
  leafShape.quadraticCurveTo(0.032, 0.03, 0.024, 0.082);
  leafShape.quadraticCurveTo(0, 0.105, 0, 0.108);
  leafShape.quadraticCurveTo(0, 0.105, -0.024, 0.082);
  leafShape.quadraticCurveTo(-0.032, 0.03, 0, 0);

  const leafGeo = new THREE.ExtrudeGeometry(leafShape, {
    depth: 0.014,
    curveSegments: 14,
    bevelEnabled: true,
    bevelSegments: 4,
    steps: 1,
    bevelSize: 0.0045,
    bevelThickness: 0.0045,
  });
  leafGeo.translate(0, 0, -0.007);

  const leafMatOuter = new THREE.MeshStandardMaterial({
    color: 0x577566,
    roughness: 0.85,
    metalness: 0.0,
    envMapIntensity: 0.14,
  });
  const leafMatInner = new THREE.MeshStandardMaterial({
    color: 0x6f8f7e,
    roughness: 0.82,
    metalness: 0.0,
    envMapIntensity: 0.14,
  });

  const tiers = [
    { count: 10, tilt: 1.05, radius: 0.035, y: 0.155, scale: 1.0, mat: leafMatOuter },
    { count: 8, tilt: 0.72, radius: 0.022, y: 0.165, scale: 0.82, mat: leafMatOuter },
    { count: 6, tilt: 0.38, radius: 0.01, y: 0.175, scale: 0.62, mat: leafMatInner },
  ];
  tiers.forEach((tier, tIdx) => {
    for (let i = 0; i < tier.count; i++) {
      const angle = (i / tier.count) * Math.PI * 2 + tIdx * 0.42;
      const leaf = new THREE.Mesh(leafGeo, tier.mat);
      leaf.position.set(Math.cos(angle) * tier.radius, tier.y, Math.sin(angle) * tier.radius);
      leaf.rotation.order = 'YXZ';
      leaf.rotation.y = -angle + Math.PI / 2;
      leaf.rotation.x = tier.tilt;
      leaf.scale.setScalar(tier.scale);
      leaf.castShadow = true;
      leaf.receiveShadow = true;
      succulent.add(leaf);
    }
  });
  root.add(succulent);
  disposables.push(potGeo, potMat, soilGeo, soilMat, leafGeo, leafMatOuter, leafMatInner);

  // 2. DIAGONAL PENCIL (lower-left): Matte lacquer barrel + brushed brass ferrule + muted eraser + cedar cone
  const pencil = new THREE.Group();
  addContactShadow(pencil, 0.86, 0.11, 0.0, 0.004);

  const pencilRadius = 0.016;
  const shaftLen = 0.62;
  const shaftGeo = new THREE.CylinderGeometry(pencilRadius, pencilRadius, shaftLen, 6);
  shaftGeo.rotateZ(Math.PI / 2);
  const shaftMat = new THREE.MeshStandardMaterial({
    color: 0x2b2c30,
    roughness: 0.52,
    metalness: 0.12,
    envMapIntensity: 0.22,
  });
  const shaftMesh = new THREE.Mesh(shaftGeo, shaftMat);
  shaftMesh.position.y = pencilRadius;
  shaftMesh.castShadow = true;
  shaftMesh.receiveShadow = true;
  pencil.add(shaftMesh);

  const ferruleGeo = new THREE.CylinderGeometry(
    pencilRadius * 1.04,
    pencilRadius * 1.04,
    0.055,
    24,
  );
  ferruleGeo.rotateZ(Math.PI / 2);
  const ferruleMat = new THREE.MeshStandardMaterial({
    color: 0xb89f6d,
    roughness: 0.34,
    metalness: 0.82,
    envMapIntensity: 0.42,
  });
  const ferruleMesh = new THREE.Mesh(ferruleGeo, ferruleMat);
  ferruleMesh.position.set(-shaftLen / 2 - 0.027, pencilRadius, 0);
  ferruleMesh.castShadow = true;
  pencil.add(ferruleMesh);

  const eraserGeo = new THREE.CylinderGeometry(
    pencilRadius * 0.96,
    pencilRadius * 0.96,
    0.036,
    24,
  );
  eraserGeo.rotateZ(Math.PI / 2);
  const eraserMat = new THREE.MeshStandardMaterial({
    color: 0x6b4544,
    roughness: 0.9,
    metalness: 0.0,
    envMapIntensity: 0.1,
  });
  const eraserMesh = new THREE.Mesh(eraserGeo, eraserMat);
  eraserMesh.position.set(-shaftLen / 2 - 0.072, pencilRadius, 0);
  eraserMesh.castShadow = true;
  pencil.add(eraserMesh);

  const woodConeGeo = new THREE.ConeGeometry(pencilRadius, 0.075, 24);
  woodConeGeo.rotateZ(-Math.PI / 2);
  const woodMat = new THREE.MeshStandardMaterial({
    color: 0xb89062,
    roughness: 0.84,
    metalness: 0.0,
    envMapIntensity: 0.12,
  });
  const woodConeMesh = new THREE.Mesh(woodConeGeo, woodMat);
  woodConeMesh.position.set(shaftLen / 2 + 0.037, pencilRadius, 0);
  woodConeMesh.castShadow = true;
  pencil.add(woodConeMesh);

  const leadGeo = new THREE.ConeGeometry(pencilRadius * 0.34, 0.028, 16);
  leadGeo.rotateZ(-Math.PI / 2);
  const leadMat = new THREE.MeshStandardMaterial({
    color: 0x1f2023,
    roughness: 0.42,
    metalness: 0.3,
    envMapIntensity: 0.25,
  });
  const leadMesh = new THREE.Mesh(leadGeo, leadMat);
  leadMesh.position.set(shaftLen / 2 + 0.068, pencilRadius, 0);
  pencil.add(leadMesh);

  root.add(pencil);
  disposables.push(
    shaftGeo,
    shaftMat,
    ferruleGeo,
    ferruleMat,
    eraserGeo,
    eraserMat,
    woodConeGeo,
    woodMat,
    leadGeo,
    leadMat,
  );

  // 3. COFFEE CUP, SAUCER & SPOON (upper-right): Warm glazed porcelain responsive to lamp cone
  const coffee = new THREE.Group();
  addContactShadow(coffee, 0.62, 0.62, 0.015, 0.012);

  const ceramicMat = new THREE.MeshPhysicalMaterial({
    color: 0xdad4c8,
    roughness: 0.34,
    metalness: 0.01,
    clearcoat: 0.2,
    clearcoatRoughness: 0.3,
    envMapIntensity: 0.16,
  });

  const saucerPoints = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.11, 0.0),
    new THREE.Vector2(0.19, 0.018),
    new THREE.Vector2(0.245, 0.038),
    new THREE.Vector2(0.242, 0.044),
    new THREE.Vector2(0.165, 0.026),
    new THREE.Vector2(0.09, 0.015),
    new THREE.Vector2(0.0, 0.015),
  ];
  const saucerGeo = new THREE.LatheGeometry(saucerPoints, 64);
  const saucerMesh = new THREE.Mesh(saucerGeo, ceramicMat);
  saucerMesh.castShadow = true;
  saucerMesh.receiveShadow = true;
  coffee.add(saucerMesh);

  const cupPoints = [
    new THREE.Vector2(0.0, 0.016),
    new THREE.Vector2(0.088, 0.016),
    new THREE.Vector2(0.128, 0.11),
    new THREE.Vector2(0.138, 0.165),
    new THREE.Vector2(0.128, 0.168),
    new THREE.Vector2(0.116, 0.11),
    new THREE.Vector2(0.08, 0.032),
    new THREE.Vector2(0.0, 0.032),
  ];
  const cupGeo = new THREE.LatheGeometry(cupPoints, 64);
  const cupMesh = new THREE.Mesh(cupGeo, ceramicMat);
  cupMesh.castShadow = true;
  cupMesh.receiveShadow = true;
  coffee.add(cupMesh);

  // Cup handle
  const handleCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.13, 0.14, 0),
    new THREE.Vector3(0.185, 0.145, 0),
    new THREE.Vector3(0.18, 0.085, 0),
    new THREE.Vector3(0.11, 0.06, 0),
  ]);
  const handleGeo = new THREE.TubeGeometry(handleCurve, 28, 0.012, 14, false);
  const handleMesh = new THREE.Mesh(handleGeo, ceramicMat);
  handleMesh.castShadow = true;
  coffee.add(handleMesh);

  // Organic matte latte crema disc
  const cremaGeo = new THREE.CircleGeometry(0.123, 48);
  cremaGeo.rotateX(-Math.PI / 2);
  const cremaMat = new THREE.MeshStandardMaterial({
    map: staticTextures.coffeeLatteMap,
    roughness: 0.42,
    metalness: 0.0,
    envMapIntensity: 0.14,
  });
  const cremaMesh = new THREE.Mesh(cremaGeo, cremaMat);
  cremaMesh.position.y = 0.145;
  cremaMesh.rotation.y = 0.4;
  cremaMesh.receiveShadow = true;
  coffee.add(cremaMesh);

  // Metallic spoon resting clearly across the front-left saucer rim
  const spoonGroup = new THREE.Group();
  const spoonMat = new THREE.MeshStandardMaterial({
    color: 0xd0d4da,
    roughness: 0.28,
    metalness: 0.86,
    envMapIntensity: 0.48,
  });
  const spoonBowlGeo = new THREE.SphereGeometry(0.03, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.46);
  spoonBowlGeo.scale(0.84, 0.46, 1.38);
  spoonBowlGeo.rotateX(Math.PI);
  const spoonBowl = new THREE.Mesh(spoonBowlGeo, spoonMat);
  spoonBowl.position.set(-0.165, 0.042, 0.035);
  spoonBowl.rotation.y = -0.72;
  spoonBowl.castShadow = true;
  spoonGroup.add(spoonBowl);

  const spoonStemCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.145, 0.044, 0.058),
    new THREE.Vector3(-0.075, 0.05, 0.13),
    new THREE.Vector3(0.005, 0.058, 0.205),
  ]);
  const spoonStemGeo = new THREE.TubeGeometry(spoonStemCurve, 20, 0.006, 10, false);
  const spoonStem = new THREE.Mesh(spoonStemGeo, spoonMat);
  spoonStem.castShadow = true;
  spoonGroup.add(spoonStem);
  coffee.add(spoonGroup);

  root.add(coffee);
  disposables.push(
    ceramicMat,
    saucerGeo,
    cupGeo,
    handleGeo,
    cremaGeo,
    cremaMat,
    spoonMat,
    spoonBowlGeo,
    spoonStemGeo,
  );

  // 4. TWO OFFSET BUSINESS CARDS (lower-right)
  const cards = new THREE.Group();
  addContactShadow(cards, 0.42, 0.28, 0.01, 0.008);

  const cardGeo = new THREE.BoxGeometry(0.28, 0.004, 0.165);
  const cardTopMat = new THREE.MeshStandardMaterial({
    map: staticTextures.businessCardMap,
    roughness: 0.88,
    metalness: 0.02,
    envMapIntensity: 0.14,
  });
  const cardEdgeMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a1d,
    roughness: 0.9,
    metalness: 0.0,
    envMapIntensity: 0.12,
  });
  const cardMaterials = [
    cardEdgeMat,
    cardEdgeMat,
    cardTopMat,
    cardEdgeMat,
    cardEdgeMat,
    cardEdgeMat,
  ];
  const cardLightMat = new THREE.MeshStandardMaterial({
    color: 0xe6e1d7,
    roughness: 0.86,
    metalness: 0.01,
    envMapIntensity: 0.14,
  });

  const cardBottom = new THREE.Mesh(cardGeo, cardLightMat);
  cardBottom.position.set(-0.028, 0.002, 0.02);
  cardBottom.rotation.y = -0.32;
  cardBottom.castShadow = true;
  cardBottom.receiveShadow = true;
  cards.add(cardBottom);

  const cardTop = new THREE.Mesh(cardGeo, cardMaterials);
  cardTop.position.set(0.022, 0.007, -0.012);
  cardTop.rotation.y = 0.2;
  cardTop.castShadow = true;
  cardTop.receiveShadow = true;
  cards.add(cardTop);

  root.add(cards);
  disposables.push(cardGeo, cardTopMat, cardEdgeMat, cardLightMat);

  return {
    group: root,
    succulent,
    pencil,
    coffee,
    cards,
    applyLayout: (layout) => {
      applyPropPlacement(succulent, layout.succulent);
      applyPropPlacement(pencil, layout.pencil);
      applyPropPlacement(coffee, layout.coffee);
      applyPropPlacement(cards, layout.cards);
    },
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}
