/* Shir ya Khat — the 3D coin.
   Lazy-loaded by site.js after first paint. An aged gold-bronze piece:
   heads (شیر) is the engraved hero from coin-hero.png when that file exists
   (otherwise the logo inlaid in enamel), tails (خط) is the logo struck in
   relief. Relief normals, patina, wear and the reeded edge are all generated
   at runtime, so the only assets are the artwork and the three.js bundle.

   About one toss in ten lands on its rim and teeters, undecided. */

import * as THREE from './vendor/three.min.js';

const TAU = Math.PI * 2;
const R = 1;            // coin radius (world units)
const T = 0.15;         // thickness
const BEVEL = 0.028;    // chamfer between face and edge
const ART = 0.80;       // artwork radius, as a fraction of the face
const EDGE_CHANCE = 0.1;
const ADDITIVE = 2;     // THREE.AdditiveBlending (the constant is not in the trimmed bundle)

// Aged gold-bronze, sRGB.
const GOLD = [204, 156, 74];
const GOLD_HI = [246, 214, 136];   // high points, polished by handling
const UMBER = [52, 36, 20];        // dirt and oxide in the recesses
const VERDIGRIS = [64, 112, 94];   // a breath of green where the patina pools

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const bell = (u) => Math.exp(-u * u);

/* Seeded, so the coin's wear is the same coin on every visit. */
function seeded(a) {
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('coin: ' + src + ' failed to load'));
    img.src = src;
  });
}

function canvasOf(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/* Separable box blur with clamped edges, in place. */
function blur(src, size, radius, passes) {
  const r = Math.max(1, Math.round(radius)), w = 2 * r + 1, last = size - 1;
  const a = src, b = new Float32Array(src.length);
  for (let p = 0; p < (passes || 1); p++) {
    for (let y = 0; y < size; y++) {
      const row = y * size;
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += a[row + (k < 0 ? 0 : k > last ? last : k)];
      for (let x = 0; x < size; x++) {
        b[row + x] = sum / w;
        const add = x + r + 1, sub = x - r;
        sum += a[row + (add > last ? last : add)] - a[row + (sub < 0 ? 0 : sub)];
      }
    }
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += b[(k < 0 ? 0 : k > last ? last : k) * size + x];
      for (let y = 0; y < size; y++) {
        a[y * size + x] = sum / w;
        const add = y + r + 1, sub = y - r;
        sum += b[(add > last ? last : add) * size + x] - b[(sub < 0 ? 0 : sub) * size + x];
      }
    }
  }
  return a;
}

/* Height field -> tangent-space normal map (OpenGL convention, canvas y is down). */
function normalsFrom(height, size, strength) {
  const out = new ImageData(size, size);
  const d = out.data;
  const k = strength * (size / 1024);
  for (let y = 0; y < size; y++) {
    const yu = (y > 0 ? y - 1 : y) * size, yd = (y < size - 1 ? y + 1 : y) * size, row = y * size;
    for (let x = 0; x < size; x++) {
      const xl = x > 0 ? x - 1 : x, xr = x < size - 1 ? x + 1 : x;
      const nx = (height[row + xl] - height[row + xr]) * k;
      const ny = (height[yd + x] - height[yu + x]) * k;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const i = (row + x) * 4;
      d[i] = (nx * inv * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
      d[i + 2] = (inv * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  return out;
}

function texture(imageData, size, srgb, anisotropy) {
  const c = canvasOf(size);
  c.getContext('2d').putImageData(imageData, 0, 0);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  return t;
}

/* Centuries in a pocket: soft blotches where patina gathers, and hairline scratches. */
function wearMaps(size, rand) {
  const n = size * size;
  const c = canvasOf(size);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const noise = (cells, alpha) => {
    const s = canvasOf(cells), sctx = s.getContext('2d');
    const img = sctx.createImageData(cells, cells);
    for (let i = 0; i < cells * cells; i++) {
      const v = rand() * 255;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
    }
    sctx.putImageData(img, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(s, 0, 0, size, size);
  };
  noise(7, 1); noise(19, 0.5); noise(53, 0.3);
  let d = ctx.getImageData(0, 0, size, size).data;
  const blotch = new Float32Array(n);
  for (let i = 0; i < n; i++) blotch[i] = d[i * 4] / 255;

  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  ctx.lineCap = 'round';
  for (let i = 0; i < 46; i++) {
    const x = rand() * size, y = rand() * size, a = rand() * TAU, len = (0.03 + rand() * rand() * 0.3) * size;
    const bend = (rand() - 0.5) * 0.25 * len;
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.18 + rand() * 0.5).toFixed(2) + ')';
    ctx.lineWidth = (0.5 + rand() * 0.9) * (size / 1024);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(
      x + Math.cos(a) * len / 2 - Math.sin(a) * bend, y + Math.sin(a) * len / 2 + Math.cos(a) * bend,
      x + Math.cos(a) * len, y + Math.sin(a) * len
    );
    ctx.stroke();
  }
  d = ctx.getImageData(0, 0, size, size).data;
  const scratch = new Float32Array(n);
  for (let i = 0; i < n; i++) scratch[i] = d[i * 4] / 255;
  return { blotch, scratch };
}

/* One coin face, from `img`.
   style 'hero'   — a picture read as an engraving: its tones become relief and patina;
         'struck' — the logo's line art thickened and struck in relief;
         'enamel' — the logo inlaid in colour under a clear coat. */
function buildFace(img, size, style, wear, mirror, anisotropy, rand) {
  const half = size / 2, n = size * size;
  const art = canvasOf(size);
  const actx = art.getContext('2d', { willReadFrequently: true });
  const artPx = ART * size;
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const fit = artPx / Math.min(iw, ih);                    // cover the art circle
  actx.drawImage(img, half - iw * fit / 2, half - ih * fit / 2, iw * fit, ih * fit);
  const src = actx.getImageData(0, 0, size, size).data;

  const enamel = style === 'enamel';
  const height = new Float32Array(n);
  const color = new ImageData(size, size);
  const orm = new ImageData(size, size);        // G = roughness, B = metalness
  const glow = enamel ? new ImageData(size, size) : null;
  const BEADS = 64, beadR = 0.856, beadSize = 0.017;

  const lumAt = (i) => (0.2126 * src[i * 4] + 0.7152 * src[i * 4 + 1] + 0.0722 * src[i * 4 + 2]) / 255;
  let mask = new Float32Array(n);     // how far the die raised the metal, 0..1
  let tone = null;                    // hero only: the picture's own light and dark

  if (style === 'hero') {
    // Stretch the picture's tonal range (inside the art circle) to the full relief.
    const hist = new Uint32Array(256);
    let count = 0;
    const artR2 = (ART * half) * (ART * half);
    for (let y = 0; y < size; y += 2) for (let x = 0; x < size; x += 2) {
      const i = y * size + x, dx = x - half, dy = y - half;
      if (dx * dx + dy * dy > artR2 || src[i * 4 + 3] < 128) continue;
      hist[Math.round(lumAt(i) * 255)]++; count++;
    }
    let lo = 0, hi = 255, acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= count * 0.02) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= count * 0.02) { hi = v; break; } }
    const span = Math.max(24, hi - lo) / 255;
    tone = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      tone[i] = clamp01((lumAt(i) - lo / 255) / span);
      mask[i] = tone[i];
    }
    // Relief follows the broad forms; the fine lines ride on top of them.
    const broad = blur(Float32Array.from(tone), size, size / 90, 2);
    mask = blur(mask, size, size / 512, 2);
    for (let i = 0; i < n; i++) mask[i] = clamp01(0.55 * broad[i] + 0.45 * mask[i] + 0.35 * (mask[i] - broad[i]));
  } else {
    // Luminance mask of the neon line art.
    for (let i = 0; i < n; i++) mask[i] = smooth(0.2, 0.62, lumAt(i)) * (src[i * 4 + 3] / 255);
    if (style === 'struck') {
      // Thicken the hairline strokes into something a die could strike.
      mask = blur(mask, size, 1, size >= 1024 ? 2 : 1);
      for (let i = 0; i < n; i++) mask[i] = smooth(0.05, 0.38, mask[i]);
      mask = blur(mask, size, 1, 1);
    }
  }

  // Pass 1: the height field. Sunken field, raised artwork, beaded ring, raised rim.
  const inside = new Float32Array(n);   // 1 inside the art circle
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const dx = (x + 0.5 - half) / half, dy = (y + 0.5 - half) / half;
      const r = Math.sqrt(dx * dx + dy * dy);
      let inArt = 1 - smooth(ART - 0.012, ART - 0.002, r);
      if (style === 'hero') inArt *= src[i * 4 + 3] / 255;
      inside[i] = inArt;
      const m = mask[i] * inArt;
      let h = 0.42;
      if (style === 'hero') h += (0.2 + 0.62 * m - 0.42) * inArt;
      else if (style === 'struck') h += (0.30 + 0.55 * m - 0.42) * inArt;
      else h += (0.26 + 0.16 * m - 0.42) * inArt;
      if (r > 0.82 && r < 0.89) {
        const a = Math.atan2(dy, dx);
        const cell = (a / TAU) * BEADS;
        const da = (cell - Math.round(cell)) / BEADS * TAU * beadR;
        const bd = Math.sqrt(da * da + (r - beadR) * (r - beadR)) / beadSize;
        if (bd < 1) h += 0.3 * Math.sqrt(1 - bd * bd);
      }
      h += 0.58 * smooth(0.9, 0.925, r) - 0.3 * smooth(0.975, 1.0, r);
      height[i] = h;
    }
  }

  // Where the metal sits below its surroundings, dirt collects; where it stands
  // proud, a thousand thumbs have polished it.
  const around = blur(Float32Array.from(height), size, size / 85, 2);

  // Pass 2: colour, roughness, metalness.
  const mix = (a, b, t) => a + (b - a) * t;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x, j = i * 4;
      const wi = y * size + (mirror ? size - 1 - x : x);
      const blotch = wear.blotch[wi], scratch = wear.scratch[wi];
      const inArt = inside[i], m = mask[i] * inArt;
      const rel = height[i] - around[i];
      const pit = clamp01(-rel * 3.4), proud = clamp01(rel * 2.6);
      const pool = smooth(0.5, 0.82, blotch);            // patina gathers in patches

      let cr = GOLD[0], cg = GOLD[1], cb = GOLD[2], rough = 0.34, metal = 1, inlay = 0;
      if (style === 'hero') {
        const t = tone[i], dark = inArt * (1 - smooth(0.0, 0.6, t)), light = inArt * smooth(0.5, 1, t);
        cr = mix(mix(cr, UMBER[0], dark * 0.86), GOLD_HI[0], light * 0.55);
        cg = mix(mix(cg, UMBER[1], dark * 0.88), GOLD_HI[1], light * 0.55);
        cb = mix(mix(cb, UMBER[2], dark * 0.9), GOLD_HI[2], light * 0.55);
        rough = 0.36 + 0.26 * dark - 0.12 * light;
      } else if (style === 'struck') {
        const f = inArt * (1 - m), hi = inArt * m * 0.4;
        cr = mix(cr, GOLD_HI[0], hi) * (1 - 0.58 * f);
        cg = mix(cg, GOLD_HI[1], hi) * (1 - 0.63 * f);
        cb = mix(cb, GOLD_HI[2], hi) * (1 - 0.7 * f);
        rough = 0.28 + f * 0.3;
      } else if (inArt > 0) {
        inlay = inArt * (src[j + 3] / 255);
        cr = mix(cr, src[j], inlay); cg = mix(cg, src[j + 1], inlay); cb = mix(cb, src[j + 2], inlay);
        rough = mix(0.34, 0.18, inlay);
        metal = 1 - 0.85 * inlay;
        glow.data[j] = src[j] * inlay; glow.data[j + 1] = src[j + 1] * inlay; glow.data[j + 2] = src[j + 2] * inlay;
      }

      // Ageing — on the bare metal only; enamel keeps its colour.
      const bare = 1 - inlay;
      const grime = bare * clamp01(pit * (0.55 + 0.6 * blotch));
      const green = bare * pool * clamp01(0.1 + pit * 1.6) * 0.34;
      const shine = bare * proud * 0.34;
      const dull = 1 - bare * 0.2 * (1 - blotch);        // uneven toning across the face
      cr = mix(mix(mix(cr, UMBER[0], grime), VERDIGRIS[0], green), GOLD_HI[0], shine) * dull;
      cg = mix(mix(mix(cg, UMBER[1], grime), VERDIGRIS[1], green), GOLD_HI[1], shine) * dull;
      cb = mix(mix(mix(cb, UMBER[2], grime), VERDIGRIS[2], green), GOLD_HI[2], shine) * dull;
      rough += bare * (0.26 * grime + 0.2 * green - 0.1 * shine + 0.14 * (blotch - 0.5) + 0.2 * scratch + (rand() - 0.5) * 0.05);
      height[i] += bare * ((rand() - 0.5) * 0.012 - 0.03 * scratch);

      if (glow) glow.data[j + 3] = 255;
      color.data[j] = cr; color.data[j + 1] = cg; color.data[j + 2] = cb; color.data[j + 3] = 255;
      orm.data[j] = 255; orm.data[j + 1] = clamp01(rough) * 255; orm.data[j + 2] = metal * 255; orm.data[j + 3] = 255;
    }
  }

  const normal = normalsFrom(blur(height, size, 1, 1), size, style === 'enamel' ? 7 : style === 'hero' ? 11 : 9.5);
  const maps = {
    map: texture(color, size, true, anisotropy),
    normalMap: texture(normal, size, false, anisotropy),
    roughnessMap: texture(orm, size, false, anisotropy),
  };
  maps.metalnessMap = maps.roughnessMap;
  if (glow) maps.emissiveMap = texture(glow, size, true, anisotropy);
  return maps;
}

/* Reeded edge: one groove, repeated around the circumference. Dirt sits in the
   grooves, the ridges are worn bright. */
function reeding() {
  const w = 32, h = 4;
  const nc = document.createElement('canvas'), cc = document.createElement('canvas');
  nc.width = cc.width = w; nc.height = cc.height = h;
  const nctx = nc.getContext('2d'), cctx = cc.getContext('2d');
  const nimg = nctx.createImageData(w, h), cimg = cctx.createImageData(w, h);
  const ridge = (x) => Math.pow(0.5 + 0.5 * Math.cos((((x % w) + w) % w) / w * TAU), 0.7);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, v = ridge(x);
    const nx = (ridge(x - 1) - ridge(x + 1)) * 6;
    const inv = 1 / Math.sqrt(nx * nx + 1);
    nimg.data[i] = (nx * inv * 0.5 + 0.5) * 255; nimg.data[i + 1] = 128; nimg.data[i + 2] = (inv * 0.5 + 0.5) * 255; nimg.data[i + 3] = 255;
    const t = smooth(0.05, 0.75, v);
    for (let c = 0; c < 3; c++) cimg.data[i + c] = UMBER[c] + (GOLD[c] + (GOLD_HI[c] - GOLD[c]) * 0.3 * t - UMBER[c]) * (0.25 + 0.75 * t);
    cimg.data[i + 3] = 255;
  }
  nctx.putImageData(nimg, 0, 0);
  cctx.putImageData(cimg, 0, 0);
  const make = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    t.repeat.set(132, 1);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { normalMap: make(nc, false), map: make(cc, true) };
}

/* Reflections: a lamp-lit room rather than a photo studio. A big warm key so
   the relief reads, amber from a low flame, a cool sliver of window, and the
   logo's cyan and magenta kept as thin strips that only show up as fringes on
   the rim. Prefiltered once into the scene environment. */
function studio(renderer) {
  const scene = new THREE.Scene();
  const panel = (color, intensity, w, h, x, y, z) => {
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, toneMapped: false });
    mat.color.multiplyScalar(intensity);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.set(x, y, z);
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
  };
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(30, 30, 30),
    new THREE.MeshBasicMaterial({ color: 0x1c140b, side: THREE.BackSide })
  );
  scene.add(room);
  panel(0xffe9c4, 15, 9, 5, -3.5, 9, 8);     // key, above front-left
  panel(0xffb45e, 5, 12, 3, 2, -8.5, 8);     // amber bounce, a flame below
  panel(0xcfe4ff, 5, 2.2, 9, 10.5, 4, 5);    // cool window, right
  panel(0x35e8dc, 5, 0.9, 11, -11.5, 0, 3);  // cyan sliver, left
  panel(0xff48c4, 5, 0.9, 11, 11.5, -3, 2);  // magenta sliver, right
  panel(0xffffff, 5, 3.5, 3.5, 5, 4, 11);    // small crisp front highlight
  panel(0xffe2b0, 6, 8, 8, 0, 3, -11);       // back light, for the turn
  panel(0xffd9a0, 3, 6, 2, -6, -3, 10);      // low front fill, so the lower relief isn't black

  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(scene, 0.03).texture;
  pmrem.dispose();
  scene.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  return env;
}

function shadowTexture() {
  const c = canvasOf(128);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.9)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.38)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/* A four-point glint with its colours slightly out of register. */
function glintTexture() {
  const S = 128, c = canvasOf(S), ctx = c.getContext('2d');
  ctx.globalCompositeOperation = 'lighter';
  const streak = (cx, cy, rgb, sx, sy, a) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(sx, sy);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, S / 2);
    g.addColorStop(0, 'rgba(' + rgb + ',' + a + ')');
    g.addColorStop(0.25, 'rgba(' + rgb + ',' + a * 0.35 + ')');
    g.addColorStop(1, 'rgba(' + rgb + ',0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, S / 2, 0, TAU); ctx.fill();
    ctx.restore();
  };
  const star = (dx, rgb, a) => {
    streak(64 + dx, 64, rgb, 0.92, 0.045, a);
    streak(64 + dx, 64, rgb, 0.045, 0.7, a);
    streak(64 + dx, 64, rgb, 0.2, 0.2, a * 0.7);
  };
  star(-3.5, '60,235,225', 0.6);
  star(3.5, '255,80,190', 0.6);
  star(0, '255,244,214', 1);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Mount the coin into `host` (a positioned element; the canvas fills it).
 * opts: {
 *   face: 'heads'|'tails', still: bool, intro: bool, assets: base URL,
 *   onLand(face)  — the coin came down on a face (also after tipping off its rim),
 *   onEdge()      — the coin came down on its rim and is teetering,
 *   onIdle()      — the result is stale; the coin has gone back to turning.
 * }
 * Returns { flip(to?), face, state, destroy() }. `to` may be 'heads', 'tails' or
 * 'edge'; left out, it is a fair toss with a small chance of the rim.
 * With `still`, or under prefers-reduced-motion, nothing animates: flip() just
 * shows the result. Rejects if WebGL or the logo is unavailable.
 */
export async function mount(host, opts = {}) {
  const base = opts.assets || new URL('.', import.meta.url).href;
  const [logo, hero] = await Promise.all([
    loadImage(base + 'logo.webp'),
    loadImage(base + 'coin-hero.png').catch(() => null),   // optional: the engraved hero for heads
  ]);

  const canvas = document.createElement('canvas');
  canvas.className = 'coin-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setClearAlpha(0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const EXPOSURE = 1.08;
  renderer.toneMappingExposure = EXPOSURE;

  const small = Math.min(window.innerWidth, window.innerHeight) < 500 && (window.devicePixelRatio || 1) < 2;
  const size = small ? 512 : 1024;
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  scene.environment = studio(renderer);
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
  camera.position.set(0, 0, 9.06);

  // Raking key from the upper left so the relief throws shade; a low warm
  // lamp that flickers a little; a cool kiss on the far rim.
  const key = new THREE.DirectionalLight(0xffecd0, 2.5);
  key.position.set(-3.4, 4.2, 3.6);
  const lamp = new THREE.DirectionalLight(0xffa24a, 0.85);
  lamp.position.set(3, -3.5, 3);
  const rim = new THREE.DirectionalLight(0x8fdfe6, 0.55);
  rim.position.set(5, 1, 1.5);
  scene.add(key, lamp, rim);

  // --- the coin ---
  const rand = seeded(1403);
  const wear = wearMaps(size, rand);
  const patina = { iridescence: 0.22, iridescenceIOR: 1.7, iridescenceThicknessRange: [180, 420] };
  const heads = hero
    ? new THREE.MeshPhysicalMaterial({
      ...buildFace(hero, size, 'hero', wear, false, aniso, rand),
      metalness: 1, roughness: 1, ...patina,
      normalScale: new THREE.Vector2(1.15, 1.15),
    })
    : new THREE.MeshPhysicalMaterial({
      ...buildFace(logo, size, 'enamel', wear, false, aniso, rand),
      metalness: 1, roughness: 1, ...patina,
      emissive: 0xffffff, emissiveIntensity: 0.5,
      clearcoat: 0.6, clearcoatRoughness: 0.16,
    });
  const tails = new THREE.MeshPhysicalMaterial({
    ...buildFace(logo, size, 'struck', wear, true, aniso, rand),
    metalness: 1, roughness: 1, ...patina,
  });
  const edgeMat = new THREE.MeshPhysicalMaterial({
    ...reeding(), metalness: 1, roughness: 0.36, ...patina,
  });
  const metals = [heads, tails, edgeMat];

  const faceGeo = new THREE.CircleGeometry(R - BEVEL, 128);
  const front = new THREE.Mesh(faceGeo, heads);
  front.position.z = T / 2;
  const back = new THREE.Mesh(faceGeo, tails);
  back.rotation.y = Math.PI;             // tails reads upright after a half-turn about Y
  back.position.z = -T / 2;
  const profile = [
    new THREE.Vector2(R - BEVEL, -T / 2), new THREE.Vector2(R, -T / 2 + BEVEL),
    new THREE.Vector2(R, T / 2 - BEVEL), new THREE.Vector2(R - BEVEL, T / 2),
  ];
  const edge = new THREE.Mesh(new THREE.LatheGeometry(profile, 128), edgeMat);
  edge.rotation.x = Math.PI / 2;

  const coin = new THREE.Group();        // yaw: which face is showing
  coin.add(front, back, edge);
  const tumble = new THREE.Group();      // the toss: end-over-end, height, wobble
  tumble.add(coin);
  scene.add(tumble);

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, toneMapped: false })
  );
  const SHADOW_Y = -1.3;
  shadow.position.set(0, SHADOW_Y, -0.4);
  scene.add(shadow);

  const glint = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: glintTexture(), transparent: true, opacity: 0, blending: ADDITIVE,
      depthWrite: false, depthTest: false, toneMapped: false,
    })
  );
  glint.renderOrder = 2;
  glint.visible = false;
  scene.add(glint);

  host.appendChild(canvas);

  // --- motion ---
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
  const isStill = () => !!opts.still || calm.matches;
  const yawOf = (face) => (face === 'tails' ? Math.PI : 0);
  const REST_TILT = -0.13;               // lean back a touch so the top edge catches the key light
  const ANTIC = 0.38;                    // the thumb loads
  const FLIGHT = 2.35;                   // up, over, down
  const SETTLE = 1.7;                    // rocking to rest
  const HOLD = 3.2;                      // showing the result
  const EDGE_WAIT = 3.4;                 // teetering before it may make up its mind
  const TIP = 1.25;                      // falling off the rim
  const IDLE_SPEED = 0.3;                // rad/s

  let face = opts.face === 'tails' ? 'tails' : 'heads';
  let yaw = yawOf(face);
  let mode = 'hold';                     // 'idle' | 'flip' | 'settle' | 'edge' | 'tip' | 'hold'
  let modeT = 0;                         // seconds in current mode
  let idleRamp = 0;
  let flipFrom = 0, flipTo = 0, flipTurns = 3, flipNext = face, flipEdge = false;
  let wobAmp = 0.2, wobPhase = 0, stutter = 0;
  let settleAmp = 1, yawKick = 0;
  let edgeYaw = 0, edgeTips = false, tipFrom = 0, tipTo = 0, tipRoll = 0;
  let clock = 0;
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };

  // Little imperfections: a shimmer across the metal, a glint off the rim, a hiccup in the turn.
  const quirk = { kind: '', t: 0, next: 5 + Math.random() * 5, angle: 2.2 };
  function startQuirk(kind) {
    quirk.kind = kind; quirk.t = 0;
    quirk.angle = 1.75 + Math.random() * 0.9;            // upper-left rim, toward the key light
  }

  function enter(next) { mode = next; modeT = 0; }

  function land(result, amp, kick) {
    face = result; yaw = yawOf(face);
    settleAmp = amp; yawKick = kick;
    enter('settle');
    if (Math.random() < 0.45) startQuirk('glint');
    if (opts.onLand) opts.onLand(face);
  }

  function flip(to) {
    if (mode === 'flip' || mode === 'tip') return false;
    flipEdge = to === 'edge' || (to !== 'heads' && to !== 'tails' && Math.random() < EDGE_CHANCE);
    flipNext = to === 'heads' || to === 'tails' ? to : (Math.random() < 0.5 ? 'heads' : 'tails');

    if (isStill()) {                     // no animation: just show the result
      face = flipNext; yaw = yawOf(face); enter('hold');
      if (opts.onLand) opts.onLand(face);
      wake();
      return true;
    }

    yaw = ((yaw % TAU) + TAU) % TAU;
    flipFrom = yaw;
    // Come down on the chosen face — or side-on — at the nearest matching yaw ahead of where we are.
    const target = flipEdge ? Math.PI / 2 + (Math.random() < 0.5 ? Math.PI : 0) : yawOf(flipNext);
    flipTo = target + Math.ceil((yaw - target) / TAU - 1e-6) * TAU;
    if (!flipEdge && flipTo - flipFrom < 0.01 && Math.random() < 0.5) flipTo += TAU;
    flipTurns = 3 + (Math.random() < 0.4 ? 1 : 0);
    wobAmp = 0.14 + Math.random() * 0.12;
    wobPhase = Math.random() * TAU;
    stutter = Math.random() < 0.3 ? 0.7 + Math.random() * 0.3 : 0;   // now and then it catches at the top
    quirk.kind = '';
    enter('flip');
    wake();
    return true;
  }

  function pose(dt) {
    clock += dt; modeT += dt;
    let x = 0, y = 0, z = 0, rx = REST_TILT, ry = 0, rz = 0;

    if (mode === 'flip') {
      const t = modeT - ANTIC;
      if (t < 0) {
        // Anticipation: a slow dip and lean before the thumb flicks.
        const a = smooth(0, 1, modeT / ANTIC);
        y = -0.1 * a; rx = REST_TILT + 0.18 * a;
      } else if (t < FLIGHT) {
        const p = t / FLIGHT;
        const arc = 4 * p * (1 - p);                       // ballistic height
        const off = 1 - smooth(0, 0.14, p);                // letting go of the anticipation pose
        y = -0.1 * off + 0.78 * arc;
        z = 0.6 * arc;                                     // rises toward the viewer
        // Fast off the thumb, bleeding speed all the way down; a little is left for the landing to absorb.
        const spin = 0.86 * (1 - Math.pow(1 - p, 2.5)) + 0.14 * p;
        const apex = bell((p - 0.5) / 0.07);
        const angle = flipTurns * TAU * spin - stutter * apex;   // the catch: lags, then makes it up
        rx = REST_TILT + 0.18 * off - angle;
        // The spin axis is never quite true: it precesses, most at the top of the arc.
        const loose = Math.sin(p * Math.PI);
        rz = loose * wobAmp * Math.sin(angle * 0.31 + wobPhase) + stutter * apex * 0.07 * Math.sin((p - 0.5) * 90);
        ry = loose * wobAmp * 0.6 * Math.cos(angle * 0.31 + wobPhase);
        yaw = flipFrom + (flipTo - flipFrom) * easeInOut(p);
        if (stutter && quirk.kind !== 'shimmer' && p > 0.44 && p < 0.5) startQuirk('shimmer');
      } else if (flipEdge) {
        edgeYaw = ((flipTo % TAU) + TAU) % TAU; yaw = edgeYaw;
        edgeTips = Math.random() < 0.6;
        enter('edge');
        if (opts.onEdge) opts.onEdge();
      } else {
        land(flipNext, 1, 0);
      }
    } else if (mode === 'settle') {
      // Landing: a damped bounce and rock that dies away.
      const s = modeT, d = Math.exp(-3.1 * s);
      y = settleAmp * 0.17 * d * Math.abs(Math.sin(s * 7.2));
      rx = REST_TILT - settleAmp * 0.3 * d * Math.sin(s * 9.4);
      rz = settleAmp * 0.1 * d * Math.sin(s * 6.8);
      yaw = yawOf(face) + yawKick * d * Math.sin(s * 7.5);
      if (s >= SETTLE) { yaw = yawOf(face); enter('hold'); }
    } else if (mode === 'edge') {
      // On its rim, side-on, rocking between the two answers without choosing.
      const s = modeT, d = Math.exp(-3.1 * s);
      const sway = 0.17 + 0.4 * Math.exp(-0.8 * s);
      const lean = sway * Math.sin(s * 2.1) + 0.045 * Math.sin(s * 5.3);
      y = 0.15 * d * Math.abs(Math.sin(s * 7.2));
      rx = REST_TILT * (0.45 + 0.55 * d) - 0.26 * d * Math.sin(s * 9.4);
      rz = 0.075 * Math.sin(s * 1.3) + 0.1 * d * Math.sin(s * 6.8);
      x = -rz * 0.9;                                       // rolling on the rim, not sliding
      yaw = edgeYaw + lean;
      if (edgeTips && s > EDGE_WAIT) {
        // Go over the next time it is leaning well toward the chosen face.
        tipTo = yawOf(flipNext) + Math.round((edgeYaw - yawOf(flipNext)) / TAU) * TAU;
        if (lean * Math.sign(tipTo - edgeYaw) > 0.7 * sway) { tipFrom = yaw; tipRoll = rz; enter('tip'); }
      }
    } else if (mode === 'tip') {
      // It makes up its mind: slow at first, then all at once.
      const p = Math.min(1, modeT / TIP), e = Math.pow(p, 2.6);
      yaw = tipFrom + (tipTo - tipFrom) * e;
      rz = tipRoll * (1 - smooth(0, 0.7, p));
      x = -rz * 0.9;
      rx = REST_TILT * (0.45 + 0.55 * smooth(0.2, 1, p));
      if (p >= 1) land(flipNext, 0.3, 0.2 * Math.sign(tipTo - tipFrom));
    } else if (mode === 'hold') {
      yaw = yawOf(face) + 0.08 * Math.sin(modeT * 0.8);    // show the result, breathing
      if (modeT > HOLD && !isStill() && Math.abs(Math.sin(modeT * 0.8)) < 0.04 && Math.cos(modeT * 0.8) > 0) {
        yaw = yawOf(face); enter('idle'); idleRamp = 0.25;
        if (opts.onIdle) opts.onIdle();
      }
    } else {
      idleRamp = Math.min(1, idleRamp + dt / 2.4);
      // Lingers a little on each face, hurries a little through the edge-on part of the turn.
      let rate = IDLE_SPEED * easeInOut(idleRamp) * (1 - 0.3 * Math.cos(2 * yaw));
      if (quirk.kind === 'hiccup') rate *= 1 - 0.92 * bell((quirk.t - 0.14) / 0.08) + 0.5 * bell((quirk.t - 0.36) / 0.12);
      yaw += rate * dt;
      if (yaw > TAU) yaw -= TAU;
    }

    const resting = mode === 'idle' || mode === 'hold' || mode === 'edge';
    if (mode !== 'flip') y += 0.028 * Math.sin(clock * 1.1) * (mode === 'edge' ? 0.3 : 1);

    // --- quirks ---
    let shimmer = 0, glintU = -1;
    if (!quirk.kind && resting && clock > quirk.next && !isStill()) {
      const pick = Math.random();
      startQuirk(pick < 0.45 ? 'shimmer' : pick < 0.8 ? 'glint' : mode === 'idle' ? 'hiccup' : 'shimmer');
    }
    if (quirk.kind) {
      quirk.t += dt;
      const dur = quirk.kind === 'shimmer' ? 0.7 : quirk.kind === 'glint' ? 0.55 : 0.6;
      const u = quirk.t / dur;
      if (u >= 1) { quirk.kind = ''; quirk.next = clock + 6 + Math.random() * 9; }
      else if (quirk.kind === 'shimmer') {
        const s = Math.sin(u * Math.PI);
        shimmer = s * s * (0.55 + 0.45 * Math.cos(u * 4 * Math.PI));   // two soft swells, no strobing
      } else if (quirk.kind === 'glint') glintU = u;
      else if (quirk.kind === 'hiccup') rz += 0.035 * Math.exp(-6 * quirk.t) * Math.sin(quirk.t * 24);
    }
    for (const m of metals) { m.envMapIntensity = 1 + 0.5 * shimmer; m.iridescence = 0.22 + 0.6 * shimmer; }
    renderer.toneMappingExposure = EXPOSURE * (1 + 0.05 * shimmer);

    // Lamplight is never perfectly steady.
    const flame = 1 + 0.07 * Math.sin(clock * 2.3) * Math.sin(clock * 5.1 + 1) + 0.035 * Math.sin(clock * 11.7);
    lamp.intensity = 0.85 * flame;
    key.intensity = 2.5 * (1 + 0.02 * Math.sin(clock * 0.7));

    pointer.sx += (pointer.x - pointer.sx) * Math.min(1, dt * 4);
    pointer.sy += (pointer.y - pointer.sy) * Math.min(1, dt * 4);

    coin.rotation.y = yaw;
    tumble.rotation.set(rx + pointer.sy * 0.14, ry + pointer.sx * 0.2, rz);
    tumble.position.set(x, y, z);

    if (glintU >= 0) {
      const g = Math.pow(Math.sin(glintU * Math.PI), 1.5);
      const broad = Math.max(Math.abs(Math.cos(yaw)), 0.06);
      glint.visible = true;
      glint.position.set(x + Math.cos(quirk.angle) * 0.95 * broad, y + Math.sin(quirk.angle) * 0.95, z + 0.3);
      glint.scale.setScalar(0.25 + 0.75 * g);
      glint.rotation.z = 0.3 + glintU * 0.5;
      glint.material.opacity = 0.9 * g;
    } else if (glint.visible) { glint.visible = false; glint.material.opacity = 0; }

    // Contact shadow: tighter and darker near the ground, wide and faint in the air.
    const lift = Math.max(0, y);
    const facing = Math.abs(Math.cos(yaw)) * Math.abs(Math.cos(rx));
    const w = 0.5 + 1.7 * Math.max(facing, 0.12) + lift * 0.5;
    shadow.position.x = x;
    shadow.scale.set(w, 0.3 + lift * 0.1, 1);
    shadow.material.opacity = 0.42 / (1 + lift * 2.2);
  }

  // --- render loop: only while on screen and the tab is visible ---
  let raf = 0, last = 0, onscreen = true, destroyed = false;
  function frame(now) {
    raf = 0;
    if (destroyed) return;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
    last = now;
    pose(dt);
    renderer.render(scene, camera);
    const busy = mode === 'flip' || mode === 'settle' || mode === 'tip';
    if (isStill() && !busy) return;
    if (onscreen && !document.hidden) raf = requestAnimationFrame(frame);
  }
  function wake() { if (!raf && !destroyed) { last = 0; raf = requestAnimationFrame(frame); } }

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (!raf) { pose(0); renderer.render(scene, camera); }
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  const io = new IntersectionObserver((entries) => {
    onscreen = entries[entries.length - 1].isIntersecting;
    if (onscreen) wake();
  });
  io.observe(host);
  const onVisibility = () => { if (!document.hidden) wake(); };
  document.addEventListener('visibilitychange', onVisibility);
  const onCalm = () => { if (!calm.matches) wake(); };
  if (calm.addEventListener) calm.addEventListener('change', onCalm);

  const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
  const onMove = (e) => {
    if (!fine.matches) return;
    const b = host.getBoundingClientRect();
    pointer.x = Math.max(-1, Math.min(1, (e.clientX - (b.left + b.width / 2)) / (window.innerWidth / 2)));
    pointer.y = Math.max(-1, Math.min(1, (e.clientY - (b.top + b.height / 2)) / (window.innerHeight / 2)));
  };
  window.addEventListener('pointermove', onMove, { passive: true });
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); cancelAnimationFrame(raf); raf = 0; });
  canvas.addEventListener('webglcontextrestored', wake);

  resize();
  pose(0);
  renderer.render(scene, camera);
  if (opts.intro && !isStill()) flip(face); else wake();

  return {
    flip,
    get face() { return face; },
    /** 'edge' while the coin is balanced on its rim; otherwise the motion phase. */
    get state() { return mode; },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect(); io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      if (calm.removeEventListener) calm.removeEventListener('change', onCalm);
      window.removeEventListener('pointermove', onMove);
      renderer.dispose();
      canvas.remove();
    },
  };
}
