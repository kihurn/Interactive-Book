import * as THREE from 'three';
import type { SceneTheme } from '../config/theme';
import {
  BOOK_SPREADS,
  DEMO_PROJECTS,
  PHYSICAL_PAGE_COUNT,
  type PageSlot,
  type ProjectItem,
} from '../data/projects';

export interface ContentsHitbox {
  projectId: string;
  title: string;
  spreadIndex: number;
  side: 'left' | 'right';
  // Normalized page UV coordinates (u: 0..1 left-to-right, v: 0..1 bottom-to-top)
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
}

export interface DeskTextureSet {
  baseColor: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  dispose: () => void;
}

export interface BookStaticTextureSet {
  frontCoverMap: THREE.CanvasTexture;
  backCoverMap: THREE.CanvasTexture;
  coverRoughnessMap: THREE.CanvasTexture;
  coverBumpMap: THREE.CanvasTexture;
  stonewareMap: THREE.CanvasTexture;
  pageEdgeMap: THREE.CanvasTexture;
  coffeeLatteMap: THREE.CanvasTexture;
  businessCardMap: THREE.CanvasTexture;
  dispose: () => void;
}

export interface PageTextureHandle {
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  render: (timeSec: number, hovered: boolean, hoveredProjectId?: string | null) => void;
  contentsHitboxes: ContentsHitbox[];
  dispose: () => void;
}

function seededNoise(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function fbm1D(x: number): number {
  return (
    Math.sin(x * 1.0) * 0.5 +
    Math.sin(x * 2.3 + 1.4) * 0.28 +
    Math.sin(x * 5.7 + 3.1) * 0.14 +
    Math.sin(x * 11.3 + 0.7) * 0.08
  );
}

/**
 * Procedurally generates desk-basecolor, desk-normal, and desk-roughness maps
 * for the lamplit dark wood desk without external image dependencies.
 */
export function createDeskTextures(
  theme: SceneTheme,
  maxAnisotropy: number,
): DeskTextureSet {
  const size = 1536;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const cCtx = colorCanvas.getContext('2d')!;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d')!;

  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = size;
  normalCanvas.height = size;
  const nCtx = normalCanvas.getContext('2d')!;

  const cImg = cCtx.createImageData(size, size);
  const rImg = rCtx.createImageData(size, size);
  const nImg = nCtx.createImageData(size, size);

  const heightField = new Float32Array(size * size);

  const baseColor = new THREE.Color(theme.palette.deskBase);
  const darkColor = new THREE.Color(theme.palette.deskGrainDark);
  const hiColor = new THREE.Color(theme.palette.deskGrainHighlight);

  const plankHeight = size / 5;

  for (let y = 0; y < size; y++) {
    const plankIdx = Math.floor(y / plankHeight);
    const localY = (y % plankHeight) / plankHeight;
    const plankSeam = localY < 0.009 || localY > 0.991 ? 1 : 0;
    const plankShift = seededNoise(plankIdx, 7.3) * 40;

    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      const nx = x / size;
      const ny = y / size;

      // Fine linear oak wood fibers along X without wavy ripples
      const warp = fbm1D(nx * 3.8 + plankShift) * 6.5;
      const ringCoord = (y + warp) * 0.11 + plankIdx * 17.3;
      const grain = 0.5 + 0.5 * Math.sin(ringCoord + fbm1D(nx * 9.0 + ny * 1.8) * 0.9);
      const fineStreak = seededNoise(Math.floor(x * 0.12), y) * 0.28;
      const pore = seededNoise(x, Math.floor(y * 0.85)) * 0.08;

      const t = Math.max(0, Math.min(1, grain * 0.38 + fineStreak + pore));
      const h = (t - plankSeam * 0.35) * 0.55 + fineStreak * 0.3;
      heightField[idx] = h;

      let r: number;
      let g: number;
      let b: number;
      if (plankSeam > 0) {
        r = darkColor.r * 0.6;
        g = darkColor.g * 0.6;
        b = darkColor.b * 0.6;
      } else if (t < 0.5) {
        const k = t * 2;
        r = darkColor.r * (1 - k) + baseColor.r * k;
        g = darkColor.g * (1 - k) + baseColor.g * k;
        b = darkColor.b * (1 - k) + baseColor.b * k;
      } else {
        const k = (t - 0.5) * 2;
        r = baseColor.r * (1 - k) + hiColor.r * k;
        g = baseColor.g * (1 - k) + hiColor.g * k;
        b = baseColor.b * (1 - k) + hiColor.b * k;
      }

      const p4 = idx * 4;
      cImg.data[p4] = Math.round(Math.min(1, r) * 255);
      cImg.data[p4 + 1] = Math.round(Math.min(1, g) * 255);
      cImg.data[p4 + 2] = Math.round(Math.min(1, b) * 255);
      cImg.data[p4 + 3] = 255;

      const roughVal = Math.round((0.58 + (1 - t) * 0.28 + plankSeam * 0.12) * 255);
      rImg.data[p4] = roughVal;
      rImg.data[p4 + 1] = roughVal;
      rImg.data[p4 + 2] = roughVal;
      rImg.data[p4 + 3] = 255;
    }
  }

  const strength = 0.95;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;
      const ym = (y - 1 + size) % size;
      const yp = (y + 1) % size;

      const dx = (heightField[y * size + xp] - heightField[y * size + xm]) * strength;
      const dy = (heightField[yp * size + x] - heightField[ym * size + x]) * strength;

      const nx = -dx;
      const ny = -dy;
      const nz = 1.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

      const p4 = (y * size + x) * 4;
      nImg.data[p4] = Math.round(((nx / len) * 0.5 + 0.5) * 255);
      nImg.data[p4 + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
      nImg.data[p4 + 2] = Math.round(((nz / len) * 0.5 + 0.5) * 255);
      nImg.data[p4 + 3] = 255;
    }
  }

  cCtx.putImageData(cImg, 0, 0);
  rCtx.putImageData(rImg, 0, 0);
  nCtx.putImageData(nImg, 0, 0);

  const baseColorTex = new THREE.CanvasTexture(colorCanvas);
  baseColorTex.colorSpace = THREE.SRGBColorSpace;
  baseColorTex.wrapS = THREE.RepeatWrapping;
  baseColorTex.wrapT = THREE.RepeatWrapping;
  baseColorTex.repeat.set(4.8, 3.6);
  baseColorTex.anisotropy = maxAnisotropy;

  const normalTex = new THREE.CanvasTexture(normalCanvas);
  normalTex.wrapS = THREE.RepeatWrapping;
  normalTex.wrapT = THREE.RepeatWrapping;
  normalTex.repeat.set(4.8, 3.6);
  normalTex.anisotropy = maxAnisotropy;

  const roughnessTex = new THREE.CanvasTexture(roughCanvas);
  roughnessTex.wrapS = THREE.RepeatWrapping;
  roughnessTex.wrapT = THREE.RepeatWrapping;
  roughnessTex.repeat.set(4.8, 3.6);
  roughnessTex.anisotropy = maxAnisotropy;

  return {
    baseColor: baseColorTex,
    normalMap: normalTex,
    roughnessMap: roughnessTex,
    dispose: () => {
      baseColorTex.dispose();
      normalTex.dispose();
      roughnessTex.dispose();
    },
  };
}

function drawBrandMark(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
  color: string,
  brandName: string,
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;

  // Minimalist concentric editorial aperture emblem (geometric book-leaf icon)
  const r = 13 * scale;
  ctx.beginPath();
  ctx.arc(-26 * scale, 0, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#1b1b1f';
  ctx.beginPath();
  ctx.arc(-26 * scale, 0, r * 0.42, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(-26 * scale + r * 0.25, -r * 0.12, r * 0.18, 0, Math.PI * 2);
  ctx.fill();

  // Crisp sans-serif wordmark
  ctx.font = `600 ${Math.round(23 * scale)}px "Plus Jakarta Sans", -apple-system, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(brandName, -5 * scale, 1 * scale);
  ctx.restore();
}

function drawLinenGrain(ctx: CanvasRenderingContext2D, w: number, h: number, alpha = 0.04) {
  ctx.save();
  ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
  ctx.lineWidth = 1;
  for (let y = 0; y < h; y += 3) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.strokeStyle = `rgba(0, 0, 0, ${alpha * 1.4})`;
  for (let x = 0; x < w; x += 3) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  ctx.restore();
}

export function createBookStaticTextures(
  theme: SceneTheme,
  brandName: string,
  maxAnisotropy: number,
): BookStaticTextureSet {
  // 1. Front cover texture (1920x1080 16:9 HD woven charcoal bookcloth)
  const fcCanvas = document.createElement('canvas');
  fcCanvas.width = 1920;
  fcCanvas.height = 1080;
  const fcCtx = fcCanvas.getContext('2d')!;
  fcCtx.fillStyle = theme.palette.coverCharcoal;
  fcCtx.fillRect(0, 0, 1920, 1080);
  drawLinenGrain(fcCtx, 1920, 1080, 0.022);

  // Subtle debossed spine crease line on left edge of front cover
  const creaseGrad = fcCtx.createLinearGradient(0, 0, 64, 0);
  creaseGrad.addColorStop(0, 'rgba(0,0,0,0.52)');
  creaseGrad.addColorStop(0.52, 'rgba(255,255,255,0.05)');
  creaseGrad.addColorStop(1, 'rgba(0,0,0,0)');
  fcCtx.fillStyle = creaseGrad;
  fcCtx.fillRect(0, 0, 64, 1080);

  // Centered brand mark on cover
  drawBrandMark(fcCtx, 940, 540, 2.05, theme.palette.coverMark, brandName);

  const frontCoverMap = new THREE.CanvasTexture(fcCanvas);
  frontCoverMap.colorSpace = THREE.SRGBColorSpace;
  frontCoverMap.anisotropy = maxAnisotropy;

  // 2. Back cover / inside cover texture (1024x576 16:9)
  const bcCanvas = document.createElement('canvas');
  bcCanvas.width = 1024;
  bcCanvas.height = 576;
  const bcCtx = bcCanvas.getContext('2d')!;
  bcCtx.fillStyle = '#141416';
  bcCtx.fillRect(0, 0, 1024, 576);
  drawLinenGrain(bcCtx, 1024, 576, 0.02);

  const backCoverMap = new THREE.CanvasTexture(bcCanvas);
  backCoverMap.colorSpace = THREE.SRGBColorSpace;
  backCoverMap.anisotropy = maxAnisotropy;

  // 3. Cover roughness & linen weave bump map (512x512)
  const crCanvas = document.createElement('canvas');
  crCanvas.width = 512;
  crCanvas.height = 512;
  const crCtx = crCanvas.getContext('2d')!;
  const cbCanvas = document.createElement('canvas');
  cbCanvas.width = 512;
  cbCanvas.height = 512;
  const cbCtx = cbCanvas.getContext('2d')!;

  const crImg = crCtx.createImageData(512, 512);
  const cbImg = cbCtx.createImageData(512, 512);
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 512; x++) {
      const idx = (y * 512 + x) * 4;
      const warp = Math.sin(x * 1.45) * 0.5 + 0.5;
      const weft = Math.sin(y * 1.45) * 0.5 + 0.5;
      const weave = warp * 0.5 + weft * 0.5;
      const micro = seededNoise(x, y);
      const rVal = Math.round(168 + (1 - weave) * 38 + micro * 24);
      const bVal = Math.round(115 + weave * 95 + (micro - 0.5) * 28);
      crImg.data[idx] = rVal;
      crImg.data[idx + 1] = rVal;
      crImg.data[idx + 2] = rVal;
      crImg.data[idx + 3] = 255;

      cbImg.data[idx] = bVal;
      cbImg.data[idx + 1] = bVal;
      cbImg.data[idx + 2] = bVal;
      cbImg.data[idx + 3] = 255;
    }
  }
  crCtx.putImageData(crImg, 0, 0);
  cbCtx.putImageData(cbImg, 0, 0);

  const coverRoughnessMap = new THREE.CanvasTexture(crCanvas);
  coverRoughnessMap.wrapS = THREE.RepeatWrapping;
  coverRoughnessMap.wrapT = THREE.RepeatWrapping;
  coverRoughnessMap.repeat.set(5, 3);
  coverRoughnessMap.anisotropy = maxAnisotropy;

  const coverBumpMap = new THREE.CanvasTexture(cbCanvas);
  coverBumpMap.wrapS = THREE.RepeatWrapping;
  coverBumpMap.wrapT = THREE.RepeatWrapping;
  coverBumpMap.repeat.set(7, 4);
  coverBumpMap.anisotropy = maxAnisotropy;

  // 4. Matte speckled stoneware texture for succulent pot (512x512, warm greige ceramic)
  const swCanvas = document.createElement('canvas');
  swCanvas.width = 512;
  swCanvas.height = 512;
  const swCtx = swCanvas.getContext('2d')!;
  swCtx.fillStyle = '#857e75';
  swCtx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 4800; i++) {
    const px = seededNoise(i, 1.9) * 512;
    const py = seededNoise(i, 7.4) * 512;
    const dark = seededNoise(i, 4.3) > 0.45;
    swCtx.fillStyle = dark ? 'rgba(32, 28, 24, 0.32)' : 'rgba(218, 212, 202, 0.22)';
    swCtx.fillRect(px, py, 1.8, 1.8);
  }
  const stonewareMap = new THREE.CanvasTexture(swCanvas);
  stonewareMap.colorSpace = THREE.SRGBColorSpace;
  stonewareMap.wrapS = THREE.RepeatWrapping;
  stonewareMap.wrapT = THREE.RepeatWrapping;
  stonewareMap.anisotropy = maxAnisotropy;

  // 5. Page edge stack texture (20-page fine ivory paper striations, 512x512)
  const peCanvas = document.createElement('canvas');
  peCanvas.width = 512;
  peCanvas.height = 512;
  const peCtx = peCanvas.getContext('2d')!;
  peCtx.fillStyle = theme.palette.paperEdge;
  peCtx.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 512; y += 3) {
    const shade = Math.floor(204 + seededNoise(y, 1.3) * 26);
    peCtx.fillStyle = `rgb(${shade}, ${shade - 4}, ${shade - 12})`;
    peCtx.fillRect(0, y, 512, 2);
    peCtx.fillStyle = 'rgba(30, 25, 19, 0.22)';
    peCtx.fillRect(0, y + 2, 512, 1);
  }
  const pageEdgeMap = new THREE.CanvasTexture(peCanvas);
  pageEdgeMap.colorSpace = THREE.SRGBColorSpace;
  pageEdgeMap.wrapS = THREE.RepeatWrapping;
  pageEdgeMap.wrapT = THREE.RepeatWrapping;
  pageEdgeMap.anisotropy = maxAnisotropy;

  // 6. Espresso / Latte Art texture (512x512 subtle muted cinnamon micro-foam)
  const cfCanvas = document.createElement('canvas');
  cfCanvas.width = 512;
  cfCanvas.height = 512;
  const cfCtx = cfCanvas.getContext('2d')!;
  const cremaGrad = cfCtx.createRadialGradient(256, 256, 24, 256, 256, 252);
  cremaGrad.addColorStop(0, '#a66d3e');
  cremaGrad.addColorStop(0.58, '#854e25');
  cremaGrad.addColorStop(0.9, '#4c260f');
  cremaGrad.addColorStop(1, '#331707');
  cfCtx.fillStyle = cremaGrad;
  cfCtx.fillRect(0, 0, 512, 512);

  // Subtle organic micro-foam speckles
  for (let i = 0; i < 650; i++) {
    const a = seededNoise(i, 2.7) * Math.PI * 2;
    const rad = Math.sqrt(seededNoise(i, 6.1)) * 238;
    const bx = 256 + Math.cos(a) * rad;
    const by = 256 + Math.sin(a) * rad;
    cfCtx.fillStyle = i % 3 === 0 ? 'rgba(235, 214, 190, 0.14)' : 'rgba(40, 18, 6, 0.16)';
    cfCtx.beginPath();
    cfCtx.arc(bx, by, 1.2 + seededNoise(i, 9.2) * 2.1, 0, Math.PI * 2);
    cfCtx.fill();
  }

  // Natural poured latte heart foam
  cfCtx.save();
  cfCtx.translate(256, 256);
  cfCtx.fillStyle = '#e7dac8';
  cfCtx.beginPath();
  cfCtx.moveTo(0, 86);
  cfCtx.bezierCurveTo(-102, 24, -108, -68, -42, -78);
  cfCtx.bezierCurveTo(-8, -86, 0, -48, 0, -40);
  cfCtx.bezierCurveTo(0, -48, 8, -86, 42, -78);
  cfCtx.bezierCurveTo(108, -68, 102, 24, 0, 86);
  cfCtx.fill();
  cfCtx.restore();

  const coffeeLatteMap = new THREE.CanvasTexture(cfCanvas);
  coffeeLatteMap.colorSpace = THREE.SRGBColorSpace;
  coffeeLatteMap.anisotropy = maxAnisotropy;

  // 7. Business card texture (1024x576 crisp charcoal stock)
  const bcCardCanvas = document.createElement('canvas');
  bcCardCanvas.width = 1024;
  bcCardCanvas.height = 576;
  const cardCtx = bcCardCanvas.getContext('2d')!;
  cardCtx.fillStyle = '#151517';
  cardCtx.fillRect(0, 0, 1024, 576);
  drawLinenGrain(cardCtx, 1024, 576, 0.025);
  drawBrandMark(cardCtx, 476, 266, 1.65, '#f2efe8', brandName);
  cardCtx.fillStyle = 'rgba(242, 239, 232, 0.56)';
  cardCtx.font = '500 24px "Plus Jakarta Sans", sans-serif';
  cardCtx.textAlign = 'center';
  cardCtx.fillText('SPATIAL & EDITORIAL DESIGN', 512, 404);

  const businessCardMap = new THREE.CanvasTexture(bcCardCanvas);
  businessCardMap.colorSpace = THREE.SRGBColorSpace;
  businessCardMap.anisotropy = maxAnisotropy;

  return {
    frontCoverMap,
    backCoverMap,
    coverRoughnessMap,
    coverBumpMap,
    stonewareMap,
    pageEdgeMap,
    coffeeLatteMap,
    businessCardMap,
    dispose: () => {
      frontCoverMap.dispose();
      backCoverMap.dispose();
      coverRoughnessMap.dispose();
      coverBumpMap.dispose();
      stonewareMap.dispose();
      pageEdgeMap.dispose();
      coffeeLatteMap.dispose();
      businessCardMap.dispose();
    },
  };
}

function drawPaperBase(ctx: CanvasRenderingContext2D, w: number, h: number, baseHex: string) {
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, w, h);

  // Subtle cotton paper tooth
  ctx.save();
  ctx.fillStyle = 'rgba(20, 18, 12, 0.018)';
  for (let i = 0; i < 420; i++) {
    const px = seededNoise(i, 3.1) * w;
    const py = seededNoise(i, 9.7) * h;
    ctx.fillRect(px, py, 2, 1.5);
  }
  ctx.restore();
}

function drawGutterShadow(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  side: 'left' | 'right',
) {
  ctx.save();
  if (side === 'left') {
    const g = ctx.createLinearGradient(w - 58, 0, w, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.75, 'rgba(0,0,0,0.06)');
    g.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = g;
    ctx.fillRect(w - 58, 0, 58, h);
  } else {
    const g = ctx.createLinearGradient(0, 0, 58, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.22)');
    g.addColorStop(0.25, 'rgba(0,0,0,0.06)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 58, h);
  }
  ctx.restore();
}

function drawContentsPage(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  brandName: string,
  hoveredProjectId: string | null,
): ContentsHitbox[] {
  drawPaperBase(ctx, w, h, '#ebe3d4');

  // Top editorial bar (1920x1080 16:9 HD layout)
  ctx.fillStyle = '#141311';
  ctx.beginPath();
  ctx.arc(136, 98, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = '600 28px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(brandName, 162, 98);

  ctx.fillStyle = '#2d2923';
  ctx.font = '500 21px "JetBrains Mono", monospace';
  ctx.fillText(`INDEX  ·  ${PHYSICAL_PAGE_COUNT}-PAGE EDITION`, 680, 98);

  ctx.strokeStyle = 'rgba(20, 19, 17, 0.28)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(124, 148);
  ctx.lineTo(w - 124, 148);
  ctx.stroke();

  // Main Contents Heading
  ctx.fillStyle = '#121110';
  ctx.font = '500 90px "Fraunces", Georgia, serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Contents', 124, 304);

  ctx.fillStyle = '#26231e';
  ctx.font = '500 27px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Select an entry to turn', 124, 362);
  ctx.fillText('directly to its spread.', 124, 402);

  // Two balanced columns for 16:9 wide proportion
  const hitboxes: ContentsHitbox[] = [];
  const colX = [680, 1260];
  const startY = 266;
  const rowHeight = 205;

  type IndexRow = {
    id: string;
    indexNumber: string;
    pageNumber: string;
    title: string;
    category: string;
    spreadIndex: number;
    side: 'left' | 'right';
    isUpcoming?: boolean;
  };

  const rows: IndexRow[] = [
    ...DEMO_PROJECTS.map((p) => ({
      id: p.id,
      indexNumber: p.indexNumber,
      pageNumber: p.pageNumber,
      title: p.title,
      category: p.category,
      spreadIndex: p.spreadIndex,
      side: p.side,
    })),
    {
      id: 'coming-soon',
      indexNumber: '06+',
      pageNumber: '07–20',
      title: 'More Coming Soon',
      category: 'Upcoming Works',
      spreadIndex: BOOK_SPREADS.length - 1,
      side: 'left',
      isUpcoming: true,
    },
  ];

  rows.forEach((entry, i) => {
    const col = i < 3 ? 0 : 1;
    const row = i % 3;
    const x = colX[col];
    const y = startY + row * rowHeight;
    const isHovered = hoveredProjectId === entry.id;

    if (isHovered) {
      ctx.fillStyle = 'rgba(20, 19, 17, 0.08)';
      ctx.fillRect(x - 24, y - 40, 500, 154);
    }

    ctx.fillStyle = isHovered ? '#8f3210' : entry.isUpcoming ? '#403b34' : '#2d2a24';
    ctx.font = '500 21px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${entry.indexNumber}  ·  p.${entry.pageNumber}`, x, y);

    ctx.fillStyle = entry.isUpcoming ? '#2c2924' : '#121110';
    ctx.font = '600 36px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(entry.title, x, y + 48);

    ctx.fillStyle = '#2d2a24';
    ctx.font = '500 23px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(entry.category, x, y + 86);

    ctx.strokeStyle = isHovered ? 'rgba(143, 50, 16, 0.78)' : 'rgba(20, 19, 17, 0.24)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y + 114);
    ctx.lineTo(x + 455, y + 114);
    ctx.stroke();

    hitboxes.push({
      projectId: entry.id,
      title: entry.title,
      spreadIndex: entry.spreadIndex,
      side: entry.side,
      uMin: (x - 24) / w,
      uMax: (x + 476) / w,
      vMin: 1 - (y + 118) / h,
      vMax: 1 - (y - 40) / h,
    });
  });

  // Footer folio
  ctx.fillStyle = '#2c2924';
  ctx.font = '500 20px "JetBrains Mono", monospace';
  ctx.fillText('01', 124, h - 72);
  ctx.fillText(`${DEMO_PROJECTS.length} ACTIVE WORKS  ·  ${PHYSICAL_PAGE_COUNT} PP`, w - 455, h - 72);

  drawGutterShadow(ctx, w, h, 'left');
  return hitboxes;
}

function drawComingSoonPage(ctx: CanvasRenderingContext2D, w: number, h: number, brandName: string) {
  drawPaperBase(ctx, w, h, '#ebe3d4');

  ctx.fillStyle = '#2e2a24';
  ctx.font = '500 22px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText('EDITION HORIZON  ·  MORE TO COME', 148, 114);

  ctx.strokeStyle = 'rgba(20, 19, 17, 0.25)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(148, 150);
  ctx.lineTo(w - 148, 150);
  ctx.stroke();

  ctx.fillStyle = '#141311';
  ctx.font = '500 88px "Fraunces", Georgia, serif';
  ctx.fillText('More works', 148, 344);
  ctx.fillText('coming soon.', 148, 444);

  ctx.fillStyle = '#24211c';
  ctx.font = '500 34px "Plus Jakarta Sans", sans-serif';
  const lines = [
    'This 20-page volume holds space for upcoming websites,',
    'interactive experiments, and client releases as they ship.',
    'Click any earlier spread to inspect full case notes.',
  ];
  lines.forEach((line, i) => {
    ctx.fillText(line, 148, 548 + i * 54);
  });

  ctx.fillStyle = '#332e27';
  ctx.font = '500 23px "JetBrains Mono", monospace';
  ctx.fillText('ACTIVE RANGE   ·  PAGES 01 – 07', 148, 768);
  ctx.fillText('RESERVED       ·  PAGES 08 – 20', 148, 812);

  drawBrandMark(ctx, 224, h - 134, 1.45, '#141414', brandName);

  ctx.fillStyle = '#2e2a24';
  ctx.font = '500 20px "JetBrains Mono", monospace';
  ctx.fillText('07', 148, h - 72);

  drawGutterShadow(ctx, w, h, 'left');
}

function drawReservedStackPage(ctx: CanvasRenderingContext2D, w: number, h: number) {
  drawPaperBase(ctx, w, h, '#e3dbc9');

  // Restrained ruled endpaper indicating sealed remaining pages (pp. 08-20)
  ctx.strokeStyle = 'rgba(20, 19, 17, 0.16)';
  ctx.lineWidth = 1.6;
  ctx.strokeRect(128, 100, w - 256, h - 200);

  ctx.strokeStyle = 'rgba(20, 19, 17, 0.09)';
  for (let y = 210; y <= h - 220; y += 58) {
    ctx.beginPath();
    ctx.moveTo(210, y);
    ctx.lineTo(w - 210, y);
    ctx.stroke();
  }

  ctx.fillStyle = '#2f2b25';
  ctx.font = '500 24px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('PAGES 08 – 20  ·  RESERVED', w / 2, h / 2 - 44);

  ctx.fillStyle = '#181613';
  ctx.font = '500 54px "Fraunces", Georgia, serif';
  ctx.fillText('Next chapters in production', w / 2, h / 2 + 26);

  ctx.fillStyle = '#2e2a24';
  ctx.font = '500 27px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Forward flipping stops here until new projects are added.', w / 2, h / 2 + 94);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#2f2b25';
  ctx.font = '500 20px "JetBrains Mono", monospace';
  ctx.fillText('08 / 20', w - 245, h - 72);

  drawGutterShadow(ctx, w, h, 'right');
}

function drawCustomMediaFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  project: ProjectItem,
  mediaSource: HTMLImageElement | HTMLVideoElement,
  hovered: boolean,
) {
  // Deep gallery backdrop behind 16:9 website capture
  ctx.fillStyle = project.palette.bg;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = project.palette.fg;
  ctx.globalAlpha = 0.84;
  ctx.font = '500 21px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`${project.indexNumber}  ·  ${project.category.toUpperCase()}`, 112, 82);
  ctx.globalAlpha = 1;

  // True 16:9 container inside 1920x1080 sheet
  const frameX = 112;
  const frameY = 122;
  const frameW = w - 224;
  const frameH = Math.round(frameW * (9 / 16) * 0.82);

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 36;
  ctx.shadowOffsetY = 16;
  ctx.fillStyle = '#0d0d10';
  ctx.fillRect(frameX, frameY, frameW, frameH);
  ctx.restore();

  const srcW =
    mediaSource instanceof HTMLVideoElement
      ? mediaSource.videoWidth || frameW
      : mediaSource.naturalWidth || frameW;
  const srcH =
    mediaSource instanceof HTMLVideoElement
      ? mediaSource.videoHeight || frameH
      : mediaSource.naturalHeight || frameH;
  const scale = Math.max(frameW / srcW, frameH / srcH);
  const drawW = srcW * scale;
  const drawH = srcH * scale;
  const dx = frameX + (frameW - drawW) / 2;
  const dy = frameY + (frameH - drawH) / 2;

  ctx.save();
  ctx.beginPath();
  ctx.rect(frameX, frameY, frameW, frameH);
  ctx.clip();
  ctx.drawImage(mediaSource, dx, dy, drawW, drawH);
  ctx.restore();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.lineWidth = 2;
  ctx.strokeRect(frameX, frameY, frameW, frameH);

  ctx.fillStyle = project.palette.fg;
  ctx.font = '600 62px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(project.title, 112, h - 86);

  ctx.fillStyle = hovered ? project.palette.accent : project.palette.fg;
  ctx.font = '500 24px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Click to view project  →', w - 385, h - 92);
}

function drawProjectArt(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  project: ProjectItem,
  side: 'left' | 'right',
  timeSec: number,
  hovered: boolean,
  mediaSource?: HTMLImageElement | HTMLVideoElement | null,
) {
  if (mediaSource) {
    drawCustomMediaFrame(ctx, w, h, project, mediaSource, hovered);
    if (hovered) {
      ctx.save();
      ctx.strokeStyle = 'rgba(223, 188, 134, 0.85)';
      ctx.lineWidth = 8;
      ctx.strokeRect(14, 14, w - 28, h - 28);
      ctx.restore();
    }
    drawGutterShadow(ctx, w, h, side);
    return;
  }

  const t = timeSec;

  switch (project.artDirection) {
    case 'moss-sky': {
      // Rich cobalt-cerulean sky so the ~10° closed cover peek matches the deep blue wedge
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#0b3e75');
      sky.addColorStop(0.55, '#1b63ab');
      sky.addColorStop(1, '#4f96cf');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);

      const mistShift = Math.sin(t * 1.1) * 44;
      const sunGlow = ctx.createRadialGradient(
        w * 0.72 + mistShift,
        h * 0.22,
        18,
        w * 0.72 + mistShift,
        h * 0.22,
        620,
      );
      sunGlow.addColorStop(0, 'rgba(255, 252, 232, 0.28)');
      sunGlow.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = sunGlow;
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      const sway = Math.sin(t * 1.6) * 8;
      ctx.beginPath();
      ctx.moveTo(w + 30, h * 0.22 + sway);
      ctx.bezierCurveTo(w * 0.76, h * 0.29, w * 0.48, h * 0.51, 56, h * 0.85 - sway * 0.4);
      ctx.lineTo(270, h + 30);
      ctx.bezierCurveTo(w * 0.54, h * 0.69, w * 0.78, h * 0.49, w + 30, h * 0.44 + sway);
      ctx.closePath();
      const barkGrad = ctx.createLinearGradient(0, h * 0.28, w, h * 0.85);
      barkGrad.addColorStop(0, '#1e160d');
      barkGrad.addColorStop(0.55, '#3b2d1c');
      barkGrad.addColorStop(1, '#140f08');
      ctx.fillStyle = barkGrad;
      ctx.fill();

      for (let i = 0; i < 64; i++) {
        const u = i / 63;
        const bx = w * (0.14 + u * 0.84) + Math.sin(i * 4.3) * 26;
        const by =
          h * (0.82 - u * 0.58) +
          Math.sin(u * Math.PI) * 24 +
          Math.cos(i * 2.9) * 24 +
          Math.sin(t * 1.8 + i * 0.4) * (t > 0 ? 4.5 : 0);
        const rad = 24 + seededNoise(i, 4.1) * 40;
        const shade = seededNoise(i, 9.2);
        ctx.fillStyle =
          shade > 0.66
            ? '#648f31'
            : shade > 0.33
              ? '#456b20'
              : '#2a4713';
        ctx.beginPath();
        ctx.arc(bx, by, rad, 0, Math.PI * 2);
        ctx.fill();

        if (shade > 0.5) {
          ctx.fillStyle = 'rgba(176, 212, 82, 0.24)';
          ctx.beginPath();
          ctx.arc(bx - rad * 0.25, by - rad * 0.32, rad * 0.48, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();

      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = '600 24px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('STRATA CANOPY', 112, 92);
      ctx.fillStyle = 'rgba(255,255,255,0.82)';
      ctx.font = '500 19px "JetBrains Mono", monospace';
      ctx.fillText('DEMO  ·  SPATIAL MONOGRAPH', w - 430, 92);

      ctx.fillStyle = '#ffffff';
      ctx.font = '600 112px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('Every layer', 112, 278);
      ctx.fillText('tells a story.', 112, 392);

      ctx.fillStyle = '#cfe556';
      ctx.fillRect(w - 374, h - 144, 260, 64);
      ctx.fillStyle = '#111706';
      ctx.font = '600 22px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('View project  →', w - 332, h - 104);
      break;
    }

    case 'monochrome-editorial': {
      ctx.fillStyle = '#131315';
      ctx.fillRect(0, 0, w, h);

      const gridShift = Math.sin(t * 1.4) * 20;
      ctx.strokeStyle = 'rgba(245, 242, 235, 0.14)';
      ctx.lineWidth = 1.5;
      for (let gx = 136; gx < w; gx += 186) {
        ctx.beginPath();
        ctx.moveTo(gx, 76);
        ctx.lineTo(gx, h - 76);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(108, 456 + gridShift);
      ctx.lineTo(w - 108, 456 + gridShift);
      ctx.stroke();

      ctx.fillStyle = '#eae5dc';
      ctx.fillRect(1020, 178 - gridShift * 0.5, 690, 610);
      ctx.fillStyle = '#232327';
      ctx.fillRect(1130, 258 + gridShift * 0.4, 470, 450);

      ctx.fillStyle = '#d4513b';
      ctx.fillRect(116, 94, 32, 32);

      ctx.fillStyle = '#f5f2eb';
      ctx.font = '500 22px "JetBrains Mono", monospace';
      ctx.fillText('02  ·  MONOLITH PRESS  ·  DEMO', 174, 118);

      ctx.font = '500 98px "Fraunces", Georgia, serif';
      ctx.fillText('The weight', 116, 324);
      ctx.fillText('of silent', 116, 428);
      ctx.fillText('pages.', 116, 532);

      ctx.fillStyle = '#a8a49c';
      ctx.font = '500 27px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('Monochrome exhibition grid & broadsheet system.', 116, h - 106);
      break;
    }

    case 'warm-orange-music': {
      const bg = ctx.createLinearGradient(0, 0, w, h);
      bg.addColorStop(0, '#1c0903');
      bg.addColorStop(0.5, '#6e2409');
      bg.addColorStop(1, '#240b03');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      const pulse = 1 + Math.sin(t * 2.4) * 0.06;
      const halo = ctx.createRadialGradient(w * 0.56, h * 0.55, 32, w * 0.56, h * 0.55, 560 * pulse);
      halo.addColorStop(0, 'rgba(255, 212, 132, 0.88)');
      halo.addColorStop(0.32, 'rgba(235, 112, 30, 0.68)');
      halo.addColorStop(0.68, 'rgba(165, 45, 10, 0.25)');
      halo.addColorStop(1, 'rgba(28, 9, 3, 0)');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = 'rgba(24, 6, 2, 0.72)';
      ctx.beginPath();
      ctx.arc(w * 0.56, h * 0.52, 122, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(w * 0.56, h * 0.86, 290, 220, 0, Math.PI, 0);
      ctx.fill();

      ctx.strokeStyle = 'rgba(255, 232, 185, 0.36)';
      ctx.lineWidth = 2.5;
      for (let i = 0; i < 9; i++) {
        const y = 460 + i * 48;
        const amp = Math.sin(t * 3.0 + i * 0.7) * (t > 0 ? 24 : 0);
        ctx.beginPath();
        ctx.moveTo(68, y);
        ctx.bezierCurveTo(w * 0.33, y + amp, w * 0.66, y - amp, w - 68, y);
        ctx.stroke();
      }

      ctx.fillStyle = 'rgba(255, 243, 230, 0.82)';
      ctx.font = '500 22px "JetBrains Mono", monospace';
      ctx.fillText('03  ·  SOLSTICE RECORDINGS  ·  DEMO', 116, 94);

      ctx.fillStyle = '#fff5eb';
      ctx.font = '600 98px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('Solstice Tape', 116, 244);
      ctx.fillStyle = '#f2c396';
      ctx.font = '400 34px "Fraunces", Georgia, serif';
      ctx.fillText('Theo Vance — Analog studio sessions', 116, 306);

      ctx.fillStyle = 'rgba(255, 245, 235, 0.14)';
      ctx.strokeStyle = 'rgba(255, 245, 235, 0.52)';
      ctx.lineWidth = 2;
      ctx.strokeRect(w - 374, h - 144, 260, 64);
      ctx.fillStyle = '#fff5eb';
      ctx.font = '500 22px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('View project  →', w - 332, h - 104);
      break;
    }

    case 'cool-blue-cavern': {
      const cav = ctx.createLinearGradient(0, 0, 0, h);
      cav.addColorStop(0, '#020b16');
      cav.addColorStop(0.55, '#0a2b4d');
      cav.addColorStop(1, '#03101e');
      ctx.fillStyle = cav;
      ctx.fillRect(0, 0, w, h);

      const shimmer = Math.sin(t * 2.0) * 0.08;
      const coreGlow = ctx.createRadialGradient(w * 0.52, h * 0.44, 36, w * 0.52, h * 0.44, 540);
      coreGlow.addColorStop(0, `rgba(182, 240, 255, ${0.9 + shimmer})`);
      coreGlow.addColorStop(0.32, 'rgba(42, 160, 235, 0.62)');
      coreGlow.addColorStop(0.7, 'rgba(10, 58, 114, 0.3)');
      coreGlow.addColorStop(1, 'rgba(2, 11, 22, 0)');
      ctx.fillStyle = coreGlow;
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = '#030d19';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w, 0);
      ctx.lineTo(w, h);
      ctx.lineTo(w * 0.84, h);
      ctx.bezierCurveTo(w * 0.81, h * 0.52, w * 0.74, h * 0.28, w * 0.64, h * 0.24);
      ctx.lineTo(w * 0.61, h * 0.36);
      ctx.lineTo(w * 0.58, h * 0.21);
      ctx.lineTo(w * 0.52, h * 0.32);
      ctx.lineTo(w * 0.47, h * 0.19);
      ctx.bezierCurveTo(w * 0.32, h * 0.24, w * 0.24, h * 0.48, w * 0.2, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fill();

      const floorRef = ctx.createLinearGradient(0, h * 0.68, 0, h);
      floorRef.addColorStop(0, 'rgba(48, 172, 242, 0.16)');
      floorRef.addColorStop(1, 'rgba(2, 9, 18, 0.88)');
      ctx.fillStyle = floorRef;
      ctx.fillRect(0, h * 0.68, w, h * 0.32);

      for (let i = 0; i < 32; i++) {
        const px = w * (0.26 + seededNoise(i, 2.2) * 0.5);
        const baseY = h * (0.24 + seededNoise(i, 5.1) * 0.5);
        const py = ((baseY - t * 32 + h) % (h * 0.65)) + h * 0.16;
        ctx.fillStyle = `rgba(195, 245, 255, ${0.38 + seededNoise(i, 8.4) * 0.48})`;
        ctx.beginPath();
        ctx.arc(px, py, 2.6 + seededNoise(i, 1.1) * 3.2, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = '#9dd8ff';
      ctx.font = '500 22px "JetBrains Mono", monospace';
      ctx.fillText('04  ·  SUBSURFACE ARCHIVE  ·  DEMO', 116, 94);

      ctx.fillStyle = '#f2f9ff';
      ctx.font = '500 68px "Fraunces", Georgia, serif';
      ctx.fillText('See through complexity.', 116, h - 186);
      ctx.fillStyle = '#7ec8f8';
      ctx.fillText('Find what matters.', 116, h - 108);
      break;
    }

    case 'dark-timepiece': {
      ctx.fillStyle = '#111214';
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = '#9b9ea5';
      ctx.font = '500 22px "JetBrains Mono", monospace';
      ctx.fillText('05  ·  NOCTURNE OS  ·  DEMO', 116, 94);

      ctx.fillStyle = '#f5f5f2';
      ctx.font = '700 184px "JetBrains Mono", monospace';
      ctx.fillText('NOCTURNE', 102, h - 110);

      const phoneW = 390;
      const phoneH = 680;
      const phoneX = w * 0.5 - phoneW / 2;
      const phoneY = 152;
      ctx.fillStyle = '#070809';
      ctx.strokeStyle = '#3b3d42';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.roundRect(phoneX, phoneY, phoneW, phoneH, 46);
      ctx.fill();
      ctx.stroke();

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(phoneX + 16, phoneY + 16, phoneW - 32, phoneH - 32, 34);
      ctx.clip();

      const scr = ctx.createLinearGradient(0, phoneY, 0, phoneY + phoneH);
      scr.addColorStop(0, '#1f2329');
      scr.addColorStop(0.55, '#464a52');
      scr.addColorStop(1, '#15171a');
      ctx.fillStyle = scr;
      ctx.fillRect(phoneX + 16, phoneY + 16, phoneW - 32, phoneH - 32);

      const ridgeShift = Math.sin(t * 0.8) * 14;
      ctx.fillStyle = '#14161a';
      ctx.beginPath();
      ctx.moveTo(phoneX, phoneY + 455);
      ctx.lineTo(phoneX + 132 + ridgeShift, phoneY + 310);
      ctx.lineTo(phoneX + 240 + ridgeShift, phoneY + 395);
      ctx.lineTo(phoneX + 332 + ridgeShift, phoneY + 290);
      ctx.lineTo(phoneX + phoneW, phoneY + 415);
      ctx.lineTo(phoneX + phoneW, phoneY + phoneH);
      ctx.lineTo(phoneX, phoneY + phoneH);
      ctx.closePath();
      ctx.fill();

      const sec = Math.floor(t) % 60;
      const secStr = sec < 10 ? `0${sec}` : `${sec}`;
      ctx.fillStyle = '#f5f5f2';
      ctx.textAlign = 'center';
      ctx.font = '600 84px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('6:34', phoneX + phoneW / 2, phoneY + 205);
      if (t > 0) {
        ctx.fillStyle = '#e04f3a';
        ctx.font = '500 20px "JetBrains Mono", monospace';
        ctx.fillText(`:${secStr} LIVE`, phoneX + phoneW / 2, phoneY + 246);
      }
      ctx.restore();
      ctx.textAlign = 'left';
      break;
    }
  }

  if (hovered) {
    ctx.save();
    ctx.strokeStyle = 'rgba(223, 188, 134, 0.85)';
    ctx.lineWidth = 8;
    ctx.strokeRect(14, 14, w - 28, h - 28);
    ctx.restore();
  }

  drawGutterShadow(ctx, w, h, side);
}

/**
 * Creates a full-HD 16:9 (1920x1080) CanvasTexture handle for a given page slot.
 */
export function createPageTextureHandle(
  slot: PageSlot,
  side: 'left' | 'right',
  brandName: string,
  maxAnisotropy: number,
  onMediaReady?: () => void,
): PageTextureHandle {
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const ctx = canvas.getContext('2d')!;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;

  let contentsHitboxes: ContentsHitbox[] = [];
  let loadedImg: HTMLImageElement | null = null;
  let videoEl: HTMLVideoElement | null = null;
  let disposed = false;

  if (slot.kind === 'project') {
    const media = slot.project.media;
    if (media?.screenshotUrl) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (disposed) return;
        loadedImg = img;
        render(0, false, null);
        onMediaReady?.();
      };
      img.src = media.screenshotUrl;
    }
    if (media?.videoUrl) {
      const video = document.createElement('video');
      video.src = media.videoUrl;
      video.crossOrigin = 'anonymous';
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.onloadeddata = () => {
        if (disposed) return;
        render(0, false, null);
        onMediaReady?.();
      };
      videoEl = video;
    }
  }

  const render = (timeSec: number, hovered: boolean, hoveredProjectId: string | null = null) => {
    if (slot.kind === 'contents') {
      contentsHitboxes = drawContentsPage(
        ctx,
        canvas.width,
        canvas.height,
        brandName,
        hoveredProjectId,
      );
    } else if (slot.kind === 'coming-soon') {
      drawComingSoonPage(ctx, canvas.width, canvas.height, brandName);
    } else if (slot.kind === 'reserved-stack') {
      drawReservedStackPage(ctx, canvas.width, canvas.height);
    } else {
      // Manage video playback when previewing or hovering
      if (videoEl) {
        if (timeSec > 0 || hovered) {
          if (videoEl.paused) {
            void videoEl.play().catch(() => {});
          }
        } else if (!videoEl.paused) {
          videoEl.pause();
        }
      }

      const activeMedia =
        videoEl && videoEl.readyState >= 2 && (timeSec > 0 || hovered || !loadedImg)
          ? videoEl
          : loadedImg;

      drawProjectArt(
        ctx,
        canvas.width,
        canvas.height,
        slot.project,
        side,
        timeSec,
        hovered,
        activeMedia,
      );
    }
    texture.needsUpdate = true;
  };

  // Initial static render
  render(0, false, null);

  return {
    texture,
    canvas,
    render,
    get contentsHitboxes() {
      return contentsHitboxes;
    },
    dispose: () => {
      disposed = true;
      if (videoEl) {
        videoEl.pause();
        videoEl.removeAttribute('src');
        videoEl.load();
        videoEl = null;
      }
      loadedImg = null;
      texture.dispose();
    },
  };
}
