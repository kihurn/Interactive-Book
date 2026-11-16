import * as THREE from 'three';
import type { SceneTheme } from '../config/theme';
import { deformPageVertex } from './bookState';
import { enhancePaperShader } from './shaders';
import type { BookStaticTextureSet } from './textures';

export interface TurningSheetSlot {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  frontMaterial: THREE.MeshStandardMaterial;
  backMaterial: THREE.MeshStandardMaterial;
  progress: number;
  leftStackY: number;
  rightStackY: number;
  liftBias: number;
}

export interface BookRig {
  group: THREE.Group;
  frontCoverMesh: THREE.Mesh;
  insideCoverSurface: THREE.Mesh;
  leftPageSurface: THREE.Mesh;
  rightPageSurface: THREE.Mesh;
  turningSheets: TurningSheetSlot[];
  setOpenProgress: (progress: number) => void;
  setStackHeights: (currentSpread: number, physicalSpreads: number, openProgress: number) => void;
  setHoverLiftAngle: (angleRad: number) => void;
  updateTurningSheetGeometry: (slotIndex: number) => void;
  setSpreadTextures: (
    leftTexture: THREE.Texture,
    rightTexture: THREE.Texture,
  ) => void;
  setContentsTexture: (contentsTexture: THREE.Texture) => void;
  dispose: () => void;
}

function createDualSidedSheetGeometry(
  pageWidth: number,
  pageHeight: number,
  segX = 36,
  segY = 18,
): THREE.BufferGeometry {
  const cols = segX + 1;
  const rows = segY + 1;
  const halfVerts = cols * rows;
  const totalVerts = halfVerts * 2;

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);

  for (let iy = 0; iy < rows; iy++) {
    const v = iy / segY;
    for (let ix = 0; ix < cols; ix++) {
      const u = ix / segX;
      const idx = iy * cols + ix;

      const x = u * pageWidth;
      const z = (0.5 - v) * pageHeight;

      // Front side vertex
      positions[idx * 3] = x;
      positions[idx * 3 + 1] = 0;
      positions[idx * 3 + 2] = z;
      normals[idx * 3] = 0;
      normals[idx * 3 + 1] = 1;
      normals[idx * 3 + 2] = 0;
      uvs[idx * 2] = u;
      uvs[idx * 2 + 1] = v;

      // Back side vertex (flipped U for right-reading back-face typography)
      const bIdx = halfVerts + idx;
      positions[bIdx * 3] = x;
      positions[bIdx * 3 + 1] = 0;
      positions[bIdx * 3 + 2] = z;
      normals[bIdx * 3] = 0;
      normals[bIdx * 3 + 1] = -1;
      normals[bIdx * 3 + 2] = 0;
      uvs[bIdx * 2] = 1 - u;
      uvs[bIdx * 2 + 1] = v;
    }
  }

  const indicesPerSide = segX * segY * 6;
  const indices = new Uint16Array(indicesPerSide * 2);
  let ptr = 0;

  // Front side triangles (CCW from +Y)
  for (let iy = 0; iy < segY; iy++) {
    for (let ix = 0; ix < segX; ix++) {
      const i0 = iy * cols + ix;
      const i1 = i0 + 1;
      const i2 = i0 + cols;
      const i3 = i2 + 1;
      indices[ptr++] = i0;
      indices[ptr++] = i1;
      indices[ptr++] = i3;
      indices[ptr++] = i0;
      indices[ptr++] = i3;
      indices[ptr++] = i2;
    }
  }

  // Back side triangles (reversed winding so FrontSide faces opposite direction)
  for (let iy = 0; iy < segY; iy++) {
    for (let ix = 0; ix < segX; ix++) {
      const i0 = halfVerts + iy * cols + ix;
      const i1 = i0 + 1;
      const i2 = i0 + cols;
      const i3 = i2 + 1;
      indices[ptr++] = i0;
      indices[ptr++] = i3;
      indices[ptr++] = i1;
      indices[ptr++] = i0;
      indices[ptr++] = i2;
      indices[ptr++] = i3;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.clearGroups();
  geometry.addGroup(0, indicesPerSide, 0);
  geometry.addGroup(indicesPerSide, indicesPerSide, 1);

  geometry.userData = { segX, segY, halfVerts };
  return geometry;
}

export function createBookRig(
  theme: SceneTheme,
  staticTextures: BookStaticTextureSet,
  maxTurningSheets = 3,
): BookRig {
  const {
    pageWidth,
    pageHeight,
    coverOverhang,
    coverThickness,
    maxStackHeight,
  } = theme.bookDimensions;

  const coverWidth = pageWidth + coverOverhang;
  const coverHeight = pageHeight + coverOverhang * 2;
  const disposables: Array<{ dispose: () => void }> = [];

  const group = new THREE.Group();

  // Base cover material (dark charcoal woven linen cloth)
  const coverClothMat = new THREE.MeshStandardMaterial({
    map: staticTextures.backCoverMap,
    roughnessMap: staticTextures.coverRoughnessMap,
    bumpMap: staticTextures.coverBumpMap,
    bumpScale: 0.0045,
    roughness: theme.materials.coverRoughness,
    metalness: theme.materials.coverMetalness,
    envMapIntensity: 0.16,
  });
  const frontCoverTopMat = new THREE.MeshStandardMaterial({
    map: staticTextures.frontCoverMap,
    roughnessMap: staticTextures.coverRoughnessMap,
    bumpMap: staticTextures.coverBumpMap,
    bumpScale: 0.0045,
    roughness: theme.materials.coverRoughness,
    metalness: theme.materials.coverMetalness,
    envMapIntensity: 0.16,
  });

  // Back cover resting flat on the desk (right side from x=0 to coverWidth)
  const coverGeo = new THREE.BoxGeometry(coverWidth, coverThickness, coverHeight);
  const backCoverMesh = new THREE.Mesh(coverGeo, coverClothMat);
  backCoverMesh.position.set(coverWidth / 2 - 0.008, coverThickness / 2, 0);
  backCoverMesh.castShadow = true;
  backCoverMesh.receiveShadow = true;
  group.add(backCoverMesh);

  // Spine cloth bridge connecting covers smoothly at x = 0
  const spineGeo = new THREE.CylinderGeometry(
    coverThickness * 1.15,
    coverThickness * 1.15,
    coverHeight,
    24,
    1,
    false,
    Math.PI * 0.5,
    Math.PI,
  );
  spineGeo.rotateX(Math.PI / 2);
  const spineMesh = new THREE.Mesh(spineGeo, coverClothMat);
  spineMesh.position.set(-0.006, coverThickness * 0.65, 0);
  spineMesh.castShadow = true;
  spineMesh.receiveShadow = true;
  group.add(spineMesh);

  // Front cover pivot at spine (x = 0)
  const frontCoverPivot = new THREE.Group();
  frontCoverPivot.position.set(0, coverThickness + maxStackHeight + coverThickness * 0.5, 0);

  // Multi-material BoxGeometry: index 2 (+Y) gets frontCoverTopMat (KIHURN mark)
  const frontCoverMats = [
    coverClothMat,
    coverClothMat,
    frontCoverTopMat,
    coverClothMat,
    coverClothMat,
    coverClothMat,
  ];
  const frontCoverMesh = new THREE.Mesh(coverGeo, frontCoverMats);
  frontCoverMesh.position.set(coverWidth / 2 - 0.008, 0, 0);
  frontCoverMesh.castShadow = true;
  frontCoverMesh.receiveShadow = true;
  frontCoverMesh.name = 'book-front-cover';
  frontCoverPivot.add(frontCoverMesh);
  group.add(frontCoverPivot);

  // Left & Right page blocks (stacked paper thickness) + dedicated top page planes
  const blockGeo = new THREE.BoxGeometry(pageWidth, 1, pageHeight);
  const edgeMat = new THREE.MeshStandardMaterial({
    map: staticTextures.pageEdgeMap,
    roughness: 0.92,
    metalness: 0.0,
    envMapIntensity: 0.14,
  });
  const blockTopHiddenMat = new THREE.MeshStandardMaterial({
    color: theme.palette.paperIvory,
    roughness: theme.materials.paperRoughness,
    envMapIntensity: 0.14,
  });
  const blockMats = [edgeMat, edgeMat, blockTopHiddenMat, edgeMat, edgeMat, edgeMat];

  const leftBlockMesh = new THREE.Mesh(blockGeo, blockMats);
  leftBlockMesh.position.set(-pageWidth / 2, coverThickness, 0);
  leftBlockMesh.castShadow = true;
  leftBlockMesh.receiveShadow = true;
  group.add(leftBlockMesh);

  const rightBlockMesh = new THREE.Mesh(blockGeo, blockMats);
  rightBlockMesh.position.set(pageWidth / 2, coverThickness, 0);
  rightBlockMesh.castShadow = true;
  rightBlockMesh.receiveShadow = true;
  group.add(rightBlockMesh);

  // Top page surfaces (PlaneGeometry rotated flat onto +Y)
  const pageSurfaceGeo = new THREE.PlaneGeometry(pageWidth, pageHeight, 1, 1);
  pageSurfaceGeo.rotateX(-Math.PI / 2);

  // Inside front cover flyleaf/Contents mesh attached inside frontCoverPivot so it folds cleanly with cover
  const insideCoverGeo = pageSurfaceGeo.clone();
  insideCoverGeo.rotateZ(Math.PI);
  const insideCoverMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.62,
    metalness: 0.0,
    clearcoat: 0.12,
    clearcoatRoughness: 0.45,
    reflectivity: 0.42,
    ior: 1.46,
    specularIntensity: 0.24,
    envMapIntensity: 0.14,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  enhancePaperShader(insideCoverMat, 'left');
  const insideCoverSurface = new THREE.Mesh(insideCoverGeo, insideCoverMat);
  insideCoverSurface.position.set(pageWidth / 2, -coverThickness / 2 - 0.0014, 0);
  insideCoverSurface.receiveShadow = true;
  insideCoverSurface.name = 'book-inside-cover';
  frontCoverPivot.add(insideCoverSurface);

  const leftPageMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: theme.materials.paperRoughness,
    metalness: 0.0,
    clearcoat: 0.34,
    clearcoatRoughness: 0.24,
    reflectivity: 0.56,
    ior: 1.5,
    specularIntensity: 0.44,
    envMapIntensity: 0.2,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  enhancePaperShader(leftPageMat, 'left');

  const rightPageMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: theme.materials.paperRoughness,
    metalness: 0.0,
    clearcoat: 0.34,
    clearcoatRoughness: 0.24,
    reflectivity: 0.56,
    ior: 1.5,
    specularIntensity: 0.44,
    envMapIntensity: 0.2,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  enhancePaperShader(rightPageMat, 'right');

  const leftPageSurface = new THREE.Mesh(pageSurfaceGeo, leftPageMat);
  leftPageSurface.position.set(-pageWidth / 2, coverThickness + 0.01, 0);
  leftPageSurface.receiveShadow = true;
  leftPageSurface.name = 'book-left-page';
  group.add(leftPageSurface);

  const rightPageSurface = new THREE.Mesh(pageSurfaceGeo, rightPageMat);
  rightPageSurface.position.set(pageWidth / 2, coverThickness + 0.01, 0);
  rightPageSurface.receiveShadow = true;
  rightPageSurface.name = 'book-right-page';
  group.add(rightPageSurface);

  // Pool of deforming turning sheets (glossy coated stock catching specular arcs mid-curl)
  const turningSheets: TurningSheetSlot[] = [];
  for (let i = 0; i < maxTurningSheets; i++) {
    const geom = createDualSidedSheetGeometry(pageWidth, pageHeight, 40, 20);
    const frontMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: theme.materials.paperRoughness,
      metalness: 0.0,
      clearcoat: 0.72,
      clearcoatRoughness: 0.16,
      reflectivity: 0.68,
      ior: 1.52,
      specularIntensity: 0.78,
      envMapIntensity: 0.46,
      side: THREE.FrontSide,
    });
    enhancePaperShader(frontMat, 'sheet');
    const backMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: theme.materials.paperRoughness,
      metalness: 0.0,
      clearcoat: 0.72,
      clearcoatRoughness: 0.16,
      reflectivity: 0.68,
      ior: 1.52,
      specularIntensity: 0.78,
      envMapIntensity: 0.46,
      side: THREE.FrontSide,
    });
    enhancePaperShader(backMat, 'sheet');
    const mesh = new THREE.Mesh(geom, [frontMat, backMat]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.visible = false;
    mesh.frustumCulled = false;
    group.add(mesh);

    turningSheets.push({
      mesh,
      geometry: geom,
      frontMaterial: frontMat,
      backMaterial: backMat,
      progress: 0,
      leftStackY: coverThickness + 0.02,
      rightStackY: coverThickness + 0.02,
      liftBias: i * 0.65,
    });
    disposables.push(geom, frontMat, backMat);
  }

  disposables.push(
    coverClothMat,
    frontCoverTopMat,
    coverGeo,
    spineGeo,
    blockGeo,
    edgeMat,
    blockTopHiddenMat,
    pageSurfaceGeo,
    insideCoverGeo,
    insideCoverMat,
    leftPageMat,
    rightPageMat,
  );

  let currentOpenProgress = 0;
  let currentHoverLift = 0;
  let lastSpreadPos = 0;
  let lastPhysicalSpreads = 10;

  const updateTurningSheetGeometry = (slotIndex: number) => {
    const slot = turningSheets[slotIndex];
    if (!slot) return;
    const { segX, segY, halfVerts } = slot.geometry.userData as {
      segX: number;
      segY: number;
      halfVerts: number;
    };
    const cols = segX + 1;
    const rows = segY + 1;
    const posAttr = slot.geometry.attributes.position as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;

    for (let iy = 0; iy < rows; iy++) {
      const v = iy / segY;
      for (let ix = 0; ix < cols; ix++) {
        const u = ix / segX;
        const p = deformPageVertex(
          u,
          v,
          pageWidth,
          pageHeight,
          slot.progress,
          slot.leftStackY,
          slot.rightStackY,
          slot.liftBias,
        );
        const f3 = (iy * cols + ix) * 3;
        arr[f3] = p.x;
        arr[f3 + 1] = p.y;
        arr[f3 + 2] = p.z;

        const b3 = (halfVerts + iy * cols + ix) * 3;
        arr[b3] = p.x;
        arr[b3 + 1] = p.y;
        arr[b3 + 2] = p.z;
      }
    }

    posAttr.needsUpdate = true;
    slot.geometry.computeVertexNormals();
  };

  const setOpenProgress = (progress: number) => {
    currentOpenProgress = Math.max(0, Math.min(1, progress));
    const smooth = currentOpenProgress * currentOpenProgress * (3 - 2 * currentOpenProgress);

    // Center closed cover on X=0, slide smoothly to X=0 open spread center
    group.position.x = (-pageWidth / 2) * (1 - smooth);
    // Subtle editorial tabletop tilt when closed, straightening cleanly for reading
    group.rotation.y = 0.08 * (1 - smooth);

    // Front cover rotates from 0 (right) to +PI (left) around spine hinge
    frontCoverPivot.rotation.z = Math.PI * smooth + currentHoverLift * (1 - smooth);
    const closedPivotY = coverThickness + maxStackHeight + coverThickness * 0.5;
    const openPivotY = coverThickness * 0.5;
    frontCoverPivot.position.y = closedPivotY * (1 - smooth) + openPivotY * smooth;

    // Spine bridges subtly as cover opens
    spineMesh.position.x = -0.008 * (1 - smooth * 0.5);
  };

  const setStackHeights = (
    currentSpread: number,
    physicalSpreads: number,
    openProgress: number,
  ) => {
    lastSpreadPos = currentSpread;
    lastPhysicalSpreads = Math.max(2, physicalSpreads);
    const ratio = lastSpreadPos / (lastPhysicalSpreads - 1);
    const p = Math.max(0, Math.min(1, openProgress));
    const smoothP = p * p * (3 - 2 * p);

    // Continuously blend between closed full-right stack and open split stack (no sudden pop!)
    const openRightH = Math.max(0.012, (1 - ratio * 0.78) * maxStackHeight);
    const openLeftH = Math.max(0.002, (ratio * 0.88) * maxStackHeight);

    const rightH = maxStackHeight * (1 - smoothP) + openRightH * smoothP;
    const leftH = Math.max(0.001, openLeftH * smoothP);

    rightBlockMesh.scale.y = rightH;
    rightBlockMesh.position.y = coverThickness + rightH / 2;
    rightPageSurface.position.y = coverThickness + rightH + 0.0012;
    // Show vivid first page beneath cover whenever opening OR hovering the closed cover
    rightPageSurface.visible = p > 0.03 || currentHoverLift > 0.015;

    const hasLeftPages = lastSpreadPos > 0.025;
    leftBlockMesh.visible = p > 0.02 && hasLeftPages;
    leftBlockMesh.scale.y = leftH;
    leftBlockMesh.position.y = coverThickness + leftH / 2;
    leftPageSurface.position.y = coverThickness + leftH + 0.0014;
    leftPageSurface.visible = p > 0.14 && hasLeftPages;
  };

  const setHoverLiftAngle = (angleRad: number) => {
    currentHoverLift = Math.max(0, angleRad);
    if (currentOpenProgress < 0.05) {
      frontCoverPivot.rotation.z = currentHoverLift;
      setStackHeights(lastSpreadPos, lastPhysicalSpreads, currentOpenProgress);
    }
  };

  const setSpreadTextures = (leftTex: THREE.Texture, rightTex: THREE.Texture) => {
    leftPageMat.map = leftTex;
    leftPageMat.needsUpdate = true;
    rightPageMat.map = rightTex;
    rightPageMat.needsUpdate = true;
  };

  const setContentsTexture = (contentsTex: THREE.Texture) => {
    insideCoverMat.map = contentsTex;
    insideCoverMat.needsUpdate = true;
  };

  // Initialize closed pose with full 20-page physical stack
  setOpenProgress(0);
  setStackHeights(0, 10, 0);

  return {
    group,
    frontCoverMesh,
    insideCoverSurface,
    leftPageSurface,
    rightPageSurface,
    turningSheets,
    setOpenProgress,
    setStackHeights,
    setHoverLiftAngle,
    updateTurningSheetGeometry,
    setSpreadTextures,
    setContentsTexture,
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}
