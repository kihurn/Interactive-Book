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
  readonly texture: THREE.CanvasTexture;
  readonly liveTexture: THREE.CanvasTexture;
  readonly canvas: HTMLCanvasElement;
  readonly supersampleScale: number;
  setSupersampleScale: (scale: number) => boolean;
  render: (timeSec: number, hovered: boolean, hoveredProjectId?: string | null) => void;
  renderLiveFrame: (timeSec: number, hovered: boolean) => THREE.CanvasTexture;
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

function valueNoise2D(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const a = seededNoise(ix, iy);
  const b = seededNoise(ix + 1, iy);
  const c = seededNoise(ix, iy + 1);
  const d = seededNoise(ix + 1, iy + 1);

  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbmWood2D(x: number, y: number): number {
  let sum = 0;
  let amp = 0.56;
  let freq = 1.0;
  for (let i = 0; i < 3; i++) {
    sum += valueNoise2D(x * freq, y * freq) * amp;
    freq *= 2.08;
    amp *= 0.46;
  }
  return sum;
}

/**
 * Procedurally generates smooth organic dark-oak desk-basecolor, desk-normal, and desk-roughness maps
 * free of uncorrelated pixel noise so lamplight glides across matte-oiled wood fibers.
 */
export function createDeskTextures(
  theme: SceneTheme,
  maxAnisotropy: number,
): DeskTextureSet {
  const size = 1024;
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

  const plankCount = 4;
  const plankHeight = size / plankCount;

  for (let y = 0; y < size; y++) {
    const plankIdx = Math.floor(y / plankHeight);
    const localY = (y % plankHeight) / plankHeight;
    // Chamfered non-conjoined plank bevel (6.5px) + recessed dark shadow gap crevice (2.2px)
    const seamEdgeDist = Math.min(localY, 1 - localY) * plankHeight;
    const seamBevel = Math.max(0, 1 - seamEdgeDist / 6.5);
    const crevice = Math.max(0, 1 - seamEdgeDist / 2.2);
    const plankTone = 0.8 + seededNoise(plankIdx, 13.7) * 0.26;
    const plankShiftX = seededNoise(plankIdx, 7.3) * 29.0;
    const plankShiftY = seededNoise(plankIdx, 19.1) * 17.0;

    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      const nx = x / size;
      const ny = y / size;

      // Smooth elongated oak cathedral & straight fibers along X (tileable in X via sin/cos blend)
      const angleX = nx * Math.PI * 2;
      const gx = Math.cos(angleX) * 1.4 + Math.sin(angleX) * 1.4 + nx * 3.2 + plankShiftX;
      const gy = ny * 18.0 + plankShiftY;

      const lowWarp = (fbmWood2D(gx * 0.65, gy * 0.35) - 0.5) * 4.2;
      const rings = 0.5 + 0.5 * Math.sin((ny * 26.0 + lowWarp + plankIdx * 3.7) * Math.PI);
      // Long smooth oak vessel fibers & silky medullary rays (zero raw white noise!)
      const fiberStreak = fbmWood2D(nx * 14.0 + plankShiftX, ny * 96.0 + plankShiftY);
      const oakPoreField = fbmWood2D(nx * 24.0 + plankShiftX * 0.5, ny * 190.0 + plankShiftY);
      const poreGroove = Math.max(0, 1 - Math.abs(oakPoreField - 0.48) * 11.5) * 0.24;

      const t = Math.max(0, Math.min(1, rings * 0.34 + fiberStreak * 0.52 - poreGroove * 0.65));
      const h = t * 0.48 - poreGroove * 0.32 - seamBevel * 1.15 - crevice * 1.45;
      heightField[idx] = h;

      let r: number;
      let g: number;
      let b: number;
      if (t < 0.5) {
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

      const seamDarken = Math.max(0.08, 1 - seamBevel * 0.62 - crevice * 0.34);
      const poreDarken = 1 - poreGroove * 0.42;
      const toneMul = plankTone * seamDarken * poreDarken;

      const p4 = idx * 4;
      cImg.data[p4] = Math.round(Math.min(1, r * toneMul) * 255);
      cImg.data[p4 + 1] = Math.round(Math.min(1, g * toneMul) * 255);
      cImg.data[p4 + 2] = Math.round(Math.min(1, b * toneMul) * 255);
      cImg.data[p4 + 3] = 255;

      // Hand-oiled dark oak roughness: satin-matte fibers (0.74..0.88) and deep matte recessed plank seams (0.98)
      const roughVal = Math.round(
        Math.min(1, 0.74 + (1 - t) * 0.16 + poreGroove * 0.3 + seamBevel * 0.24 + crevice * 0.12) *
          255,
      );
      rImg.data[p4] = roughVal;
      rImg.data[p4 + 1] = roughVal;
      rImg.data[p4 + 2] = roughVal;
      rImg.data[p4 + 3] = 255;
    }
  }

  // Soft 3x3-filtered normal derivation for strong plank separation depth without grain noise
  const strength = 0.56;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;
      const ym = (y - 1 + size) % size;
      const yp = (y + 1) % size;

      const hL = (heightField[ym * size + xm] + heightField[y * size + xm] * 2 + heightField[yp * size + xm]) * 0.25;
      const hR = (heightField[ym * size + xp] + heightField[y * size + xp] * 2 + heightField[yp * size + xp]) * 0.25;
      const hD = (heightField[ym * size + xm] + heightField[ym * size + x] * 2 + heightField[ym * size + xp]) * 0.25;
      const hU = (heightField[yp * size + xm] + heightField[yp * size + x] * 2 + heightField[yp * size + xp]) * 0.25;

      const dx = (hR - hL) * strength;
      const dy = (hU - hD) * strength;

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
  baseColorTex.repeat.set(3.4, 4.4);
  baseColorTex.anisotropy = maxAnisotropy;

  const normalTex = new THREE.CanvasTexture(normalCanvas);
  normalTex.wrapS = THREE.RepeatWrapping;
  normalTex.wrapT = THREE.RepeatWrapping;
  normalTex.repeat.set(3.4, 4.4);
  normalTex.anisotropy = maxAnisotropy;

  const roughnessTex = new THREE.CanvasTexture(roughCanvas);
  roughnessTex.wrapS = THREE.RepeatWrapping;
  roughnessTex.wrapT = THREE.RepeatWrapping;
  roughnessTex.repeat.set(3.4, 4.4);
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
  align: CanvasTextAlign = 'center',
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.font = `600 ${Math.round(25 * scale)}px "Plus Jakarta Sans", -apple-system, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(brandName, 0, 0);
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

  // Centered typographic wordmark on cover (no logo icon)
  drawBrandMark(fcCtx, 960, 540, 2.25, theme.palette.coverMark, brandName, 'center');

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

  // 7. Business card texture (1024x576 warm charcoal cotton stock with subtle border highlight)
  const bcCardCanvas = document.createElement('canvas');
  bcCardCanvas.width = 1024;
  bcCardCanvas.height = 576;
  const cardCtx = bcCardCanvas.getContext('2d')!;
  cardCtx.fillStyle = '#232226';
  cardCtx.fillRect(0, 0, 1024, 576);
  drawLinenGrain(cardCtx, 1024, 576, 0.028);
  cardCtx.strokeStyle = 'rgba(244, 240, 232, 0.18)';
  cardCtx.lineWidth = 4;
  cardCtx.strokeRect(18, 18, 1024 - 36, 576 - 36);
  drawBrandMark(cardCtx, 512, 266, 1.85, '#f6f3ec', brandName, 'center');
  cardCtx.fillStyle = 'rgba(246, 243, 236, 0.68)';
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
  // Soft perimeter edge tone so light paper borders cleanly against charcoal bookcloth without stair-step aliasing
  ctx.strokeStyle = 'rgba(130, 118, 100, 0.35)';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, w - 4, h - 4);
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
  drawPaperBase(ctx, w, h, '#dbd0be');

  // Top editorial bar (logical 1920x1080 rendered onto supersampled canvas for crisp ink)
  ctx.fillStyle = '#050403';
  ctx.font = '600 40px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(brandName, 112, 92);

  ctx.fillStyle = '#0e0c0a';
  ctx.font = '600 30px "JetBrains Mono", monospace';
  ctx.fillText(`INDEX  ·  ${PHYSICAL_PAGE_COUNT}-PAGE EDITION`, 604, 92);

  ctx.strokeStyle = 'rgba(10, 9, 8, 0.44)';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(112, 144);
  ctx.lineTo(w - 112, 144);
  ctx.stroke();

  // Main Contents Heading (balanced Georgia editorial serif keeps horizontal serifs legible at desk angle without heavy bolding)
  ctx.fillStyle = '#040302';
  ctx.font = '500 116px Georgia, "Fraunces", serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Contents', 112, 306);

  ctx.fillStyle = '#080706';
  ctx.font = '500 42px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Select an entry to turn', 112, 378);
  ctx.fillText('directly to its spread.', 112, 434);

  // Two balanced columns with slightly larger, naturally weighted type for effortless reading
  const hitboxes: ContentsHitbox[] = [];
  const colX = [604, 1226];
  const startY = 248;
  const rowHeight = 236;

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
      ctx.fillStyle = 'rgba(17, 16, 14, 0.1)';
      ctx.fillRect(x - 24, y - 46, 562, 188);
    }

    ctx.fillStyle = isHovered ? '#8f3210' : entry.isUpcoming ? '#231d17' : '#2d1a0a';
    ctx.font = '600 32px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${entry.indexNumber}  ·  p.${entry.pageNumber}`, x, y);

    ctx.fillStyle = entry.isUpcoming ? '#110f0d' : '#040302';
    ctx.font = '600 56px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(entry.title, x, y + 62);

    ctx.fillStyle = '#0d0b09';
    ctx.font = '500 36px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(entry.category, x, y + 112);

    ctx.strokeStyle = isHovered ? 'rgba(143, 50, 16, 0.86)' : 'rgba(10, 9, 8, 0.42)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(x, y + 144);
    ctx.lineTo(x + 518, y + 144);
    ctx.stroke();

    hitboxes.push({
      projectId: entry.id,
      title: entry.title,
      spreadIndex: entry.spreadIndex,
      side: entry.side,
      uMin: (x - 24) / w,
      uMax: (x + 538) / w,
      vMin: 1 - (y + 146) / h,
      vMax: 1 - (y - 46) / h,
    });
  });

  // Footer folio
  ctx.fillStyle = '#0e0c0a';
  ctx.font = '600 30px "JetBrains Mono", monospace';
  ctx.fillText('01', 112, h - 60);
  ctx.fillText(`${DEMO_PROJECTS.length} ACTIVE WORKS  ·  ${PHYSICAL_PAGE_COUNT} PP`, w - 588, h - 60);

  drawGutterShadow(ctx, w, h, 'left');
  return hitboxes;
}

function drawComingSoonPage(ctx: CanvasRenderingContext2D, w: number, h: number, brandName: string) {
  drawPaperBase(ctx, w, h, '#dcd1bf');

  ctx.fillStyle = '#14120f';
  ctx.font = '600 28px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText('EDITION HORIZON  ·  MORE TO COME', 140, 112);

  ctx.strokeStyle = 'rgba(17, 16, 14, 0.32)';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(140, 152);
  ctx.lineTo(w - 140, 152);
  ctx.stroke();

  ctx.fillStyle = '#090806';
  ctx.font = '600 100px "Fraunces", Georgia, serif';
  ctx.fillText('More works', 140, 336);
  ctx.fillText('coming soon.', 140, 444);

  ctx.fillStyle = '#110f0c';
  ctx.font = '500 40px "Plus Jakarta Sans", sans-serif';
  const lines = [
    'This 20-page volume holds space for upcoming websites,',
    'interactive experiments, and client releases as they ship.',
    'Click any earlier spread to inspect full case notes.',
  ];
  lines.forEach((line, i) => {
    ctx.fillText(line, 140, 548 + i * 60);
  });

  ctx.fillStyle = '#14120f';
  ctx.font = '600 28px "JetBrains Mono", monospace';
  ctx.fillText('ACTIVE RANGE   ·  PAGES 01 – 07', 140, 774);
  ctx.fillText('RESERVED       ·  PAGES 08 – 20', 140, 822);

  drawBrandMark(ctx, 140, h - 134, 1.5, '#090806', brandName, 'left');

  ctx.fillStyle = '#14120f';
  ctx.font = '600 26px "JetBrains Mono", monospace';
  ctx.fillText('07', 140, h - 66);

  drawGutterShadow(ctx, w, h, 'left');
}

function drawReservedStackPage(ctx: CanvasRenderingContext2D, w: number, h: number) {
  drawPaperBase(ctx, w, h, '#d7cdba');

  // Restrained ruled endpaper indicating sealed remaining pages (pp. 08-20)
  ctx.strokeStyle = 'rgba(17, 16, 14, 0.22)';
  ctx.lineWidth = 2;
  ctx.strokeRect(120, 96, w - 240, h - 192);

  ctx.strokeStyle = 'rgba(17, 16, 14, 0.1)';
  for (let y = 210; y <= h - 220; y += 58) {
    ctx.beginPath();
    ctx.moveTo(200, y);
    ctx.lineTo(w - 200, y);
    ctx.stroke();
  }

  ctx.fillStyle = '#161411';
  ctx.font = '600 30px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('PAGES 08 – 20  ·  RESERVED', w / 2, h / 2 - 52);

  ctx.fillStyle = '#090806';
  ctx.font = '600 66px "Fraunces", Georgia, serif';
  ctx.fillText('Next chapters in production', w / 2, h / 2 + 26);

  ctx.fillStyle = '#12100d';
  ctx.font = '500 36px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Forward flipping stops here until new projects are added.', w / 2, h / 2 + 102);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#161411';
  ctx.font = '600 26px "JetBrains Mono", monospace';
  ctx.fillText('08 / 20', w - 258, h - 66);

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

      const canopyStep = t > 0 ? 2 : 1;
      for (let i = 0; i < 64; i += canopyStep) {
        const u = i / 63;
        const bx = w * (0.14 + u * 0.84) + Math.sin(i * 4.3) * 26;
        const by =
          h * (0.82 - u * 0.58) +
          Math.sin(u * Math.PI) * 24 +
          Math.cos(i * 2.9) * 24 +
          Math.sin(t * 1.8 + i * 0.4) * (t > 0 ? 4.5 : 0);
        const rad = (24 + seededNoise(i, 4.1) * 40) * (t > 0 ? 1.12 : 1.0);
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

      ctx.fillStyle = 'rgba(255,255,255,0.96)';
      ctx.font = '600 28px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('STRATA CANOPY', 112, 92);
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.font = '600 24px "JetBrains Mono", monospace';
      ctx.fillText('DEMO  ·  SPATIAL MONOGRAPH', w - 500, 92);

      ctx.fillStyle = '#ffffff';
      ctx.font = '600 116px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('Every layer', 112, 278);
      ctx.fillText('tells a story.', 112, 396);

      ctx.fillStyle = '#cfe556';
      ctx.fillRect(w - 394, h - 148, 282, 68);
      ctx.fillStyle = '#111706';
      ctx.font = '600 26px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('View project  →', w - 344, h - 104);
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
      ctx.fillRect(116, 94, 34, 34);

      ctx.fillStyle = '#f5f2eb';
      ctx.font = '600 26px "JetBrains Mono", monospace';
      ctx.fillText('02  ·  MONOLITH PRESS  ·  DEMO', 176, 120);

      ctx.font = '600 102px "Fraunces", Georgia, serif';
      ctx.fillText('The weight', 116, 326);
      ctx.fillText('of silent', 116, 434);
      ctx.fillText('pages.', 116, 542);

      ctx.fillStyle = '#c4bfb6';
      ctx.font = '500 34px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('Monochrome exhibition grid & broadsheet system.', 116, h - 98);
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

      ctx.fillStyle = 'rgba(255, 243, 230, 0.92)';
      ctx.font = '600 26px "JetBrains Mono", monospace';
      ctx.fillText('03  ·  SOLSTICE RECORDINGS  ·  DEMO', 116, 96);

      ctx.fillStyle = '#fff5eb';
      ctx.font = '600 102px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('Solstice Tape', 116, 246);
      ctx.fillStyle = '#f6cfa9';
      ctx.font = '500 38px "Fraunces", Georgia, serif';
      ctx.fillText('Theo Vance — Analog studio sessions', 116, 312);

      ctx.strokeStyle = 'rgba(255, 245, 235, 0.58)';
      ctx.lineWidth = 2;
      ctx.strokeRect(w - 394, h - 148, 282, 68);
      ctx.fillStyle = '#fff5eb';
      ctx.font = '600 26px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('View project  →', w - 344, h - 104);
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

      for (let i = 0; i < 28; i++) {
        const px = w * (0.26 + seededNoise(i, 2.2) * 0.5);
        const baseY = h * (0.24 + seededNoise(i, 5.1) * 0.5);
        const py = ((baseY - t * 32 + h) % (h * 0.65)) + h * 0.16;
        ctx.fillStyle = `rgba(195, 245, 255, ${0.38 + seededNoise(i, 8.4) * 0.48})`;
        ctx.beginPath();
        ctx.arc(px, py, 2.6 + seededNoise(i, 1.1) * 3.2, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = '#b4e4ff';
      ctx.font = '600 26px "JetBrains Mono", monospace';
      ctx.fillText('04  ·  SUBSURFACE ARCHIVE  ·  DEMO', 116, 96);

      ctx.fillStyle = '#f2f9ff';
      ctx.font = '600 72px "Fraunces", Georgia, serif';
      ctx.fillText('See through complexity.', 116, h - 188);
      ctx.fillStyle = '#8ad0fa';
      ctx.fillText('Find what matters.', 116, h - 104);
      break;
    }

    case 'dark-timepiece': {
      ctx.fillStyle = '#111214';
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = '#b8bcc4';
      ctx.font = '600 26px "JetBrains Mono", monospace';
      ctx.fillText('05  ·  NOCTURNE OS  ·  DEMO', 116, 96);

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
        ctx.font = '600 22px "JetBrains Mono", monospace';
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
 * Creates a dynamically supersampled 16:9 CanvasTexture for static reading (up to 3840x2160 4K at 2.0x)
 * plus a zero-mipmap 960x540 liveTexture for lag-free hover/video animation.
 */
export function createPageTextureHandle(
  slot: PageSlot,
  side: 'left' | 'right',
  brandName: string,
  maxAnisotropy: number,
  onMediaReady?: () => void,
  initialSupersampleScale = 1.5,
): PageTextureHandle {
  let staticScale = Math.max(1.0, Math.min(2.0, initialSupersampleScale));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(1920 * staticScale);
  canvas.height = Math.round(1080 * staticScale);
  const ctx = canvas.getContext('2d')!;

  const buildStaticTexture = () => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAnisotropy;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
  };

  let texture = buildStaticTexture();

  let liveCanvas: HTMLCanvasElement | null = null;
  let liveCtx: CanvasRenderingContext2D | null = null;
  let liveTex: THREE.CanvasTexture | null = null;

  const ensureLiveSurface = () => {
    if (liveTex && liveCanvas && liveCtx) {
      return { liveCanvas, liveCtx, liveTex };
    }
    liveCanvas = document.createElement('canvas');
    liveCanvas.width = 960;
    liveCanvas.height = 540;
    liveCtx = liveCanvas.getContext('2d')!;
    liveTex = new THREE.CanvasTexture(liveCanvas);
    liveTex.colorSpace = THREE.SRGBColorSpace;
    liveTex.generateMipmaps = false;
    liveTex.minFilter = THREE.LinearFilter;
    liveTex.magFilter = THREE.LinearFilter;
    liveTex.anisotropy = maxAnisotropy;
    return { liveCanvas, liveCtx, liveTex };
  };

  let contentsHitboxes: ContentsHitbox[] = [];
  let loadedImg: HTMLImageElement | null = null;
  let videoEl: HTMLVideoElement | null = null;
  let disposed = false;
  let lastHovered = false;
  let lastHoveredProjectId: string | null = null;

  if (slot.kind === 'project') {
    const media = slot.project.media;
    if (media?.screenshotUrl) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (disposed) return;
        loadedImg = img;
        render(0, lastHovered, lastHoveredProjectId);
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
        render(0, lastHovered, lastHoveredProjectId);
        onMediaReady?.();
      };
      videoEl = video;
    }
  }

  const drawIntoTarget = (
    targetCtx: CanvasRenderingContext2D,
    logicalW: number,
    logicalH: number,
    timeSec: number,
    hovered: boolean,
    hoveredProjectId: string | null,
  ) => {
    if (slot.kind === 'contents') {
      contentsHitboxes = drawContentsPage(
        targetCtx,
        logicalW,
        logicalH,
        brandName,
        hoveredProjectId,
      );
    } else if (slot.kind === 'coming-soon') {
      drawComingSoonPage(targetCtx, logicalW, logicalH, brandName);
    } else if (slot.kind === 'reserved-stack') {
      drawReservedStackPage(targetCtx, logicalW, logicalH);
    } else {
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
        targetCtx,
        logicalW,
        logicalH,
        slot.project,
        side,
        timeSec,
        hovered,
        activeMedia,
      );
    }
  };

  const render = (timeSec: number, hovered: boolean, hoveredProjectId: string | null = null) => {
    lastHovered = hovered;
    lastHoveredProjectId = hoveredProjectId;
    ctx.save();
    ctx.setTransform(staticScale, 0, 0, staticScale, 0, 0);
    drawIntoTarget(ctx, 1920, 1080, timeSec, hovered, hoveredProjectId);
    ctx.restore();
    texture.needsUpdate = true;
  };

  const setSupersampleScale = (nextScale: number): boolean => {
    const clamped = Math.max(1.0, Math.min(2.0, nextScale));
    if (Math.abs(clamped - staticScale) < 0.05) return false;
    staticScale = clamped;
    canvas.width = Math.round(1920 * staticScale);
    canvas.height = Math.round(1080 * staticScale);
    texture.dispose();
    texture = buildStaticTexture();
    render(0, lastHovered, lastHoveredProjectId);
    return true;
  };

  const renderLiveFrame = (timeSec: number, hovered: boolean): THREE.CanvasTexture => {
    const { liveCtx: lCtx, liveTex: lTex } = ensureLiveSurface();
    lCtx.save();
    lCtx.setTransform(0.5, 0, 0, 0.5, 0, 0);
    drawIntoTarget(lCtx, 1920, 1080, timeSec, hovered, null);
    lCtx.restore();
    lTex.needsUpdate = true;
    return lTex;
  };

  // Initial static render
  render(0, false, null);

  return {
    get texture() {
      return texture;
    },
    get liveTexture() {
      return ensureLiveSurface().liveTex;
    },
    canvas,
    get supersampleScale() {
      return staticScale;
    },
    setSupersampleScale,
    render,
    renderLiveFrame,
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
      liveTex?.dispose();
    },
  };
}
