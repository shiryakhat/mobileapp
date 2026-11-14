/* Shir ya Khat — the 3D coin.
   Lazy-loaded by site.js after first paint. Heads (شیر) is the logo in glossy
   enamel; tails (خط) is the same artwork struck in brass relief. Both faces,
   their relief normals and the reeded edge are generated at runtime from
   logo.webp, so the only assets are the logo and the three.js bundle. */

import * as THREE from './vendor/three.min.js';

const TAU = Math.PI * 2;
const R = 1;            // coin radius (world units)
const T = 0.15;         // thickness
const BEVEL = 0.028;    // chamfer between face and edge
const ART = 0.80;       // artwork radius, as a fraction of the face
const BRASS = [228, 181, 74];

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('coin: logo failed to load'));
    img.src = src;
  });
}

function canvasOf(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function boxBlur(src, size, passes) {
  let a = src, b = new Float32Array(src.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < size; y++) {
      const row = y * size;
      for (let x = 0; x < size; x++) {
        const l = x > 0 ? x - 1 : x, r = x < size - 1 ? x + 1 : x;
        b[row + x] = (a[row + l] + a[row + x] + a[row + r]) / 3;
      }
    }
    for (let y = 0; y < size; y++) {
      const u = (y > 0 ? y - 1 : y) * size, d = (y < size - 1 ? y + 1 : y) * size, row = y * size;
      for (let x = 0; x < size; x++) a[row + x] = (b[u + x] + b[row + x] + b[d + x]) / 3;
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

/* One coin face. `relief` = true strikes the artwork in brass (tails);
   false inlays it in colour under a clear coat (heads). */
function buildFace(logo, size, relief, anisotropy) {
  const half = size / 2;
  const art = canvasOf(size);
  const actx = art.getContext('2d', { willReadFrequently: true });
  const artPx = ART * size;
  actx.drawImage(logo, half - artPx / 2, half - artPx / 2, artPx, artPx);
  const src = actx.getImageData(0, 0, size, size).data;

  const n = size * size;
  const height = new Float32Array(n);
  const color = new ImageData(size, size);
  const orm = new ImageData(size, size);        // G = roughness, B = metalness
  const glow = relief ? null : new ImageData(size, size);
  const BEADS = 64, beadR = 0.856, beadSize = 0.017;

  // Luminance mask of the neon line art, lightly blurred so the relief is soft-shouldered.
  let mask = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const lum = (0.2126 * src[i * 4] + 0.7152 * src[i * 4 + 1] + 0.0722 * src[i * 4 + 2]) / 255;
    mask[i] = smooth(0.2, 0.62, lum) * (src[i * 4 + 3] / 255);
  }
  if (relief) {
    // Thicken the hairline neon strokes into something a die could strike.
    mask = boxBlur(mask, size, size >= 1024 ? 2 : 1);
    for (let i = 0; i < n; i++) mask[i] = smooth(0.05, 0.38, mask[i]);
    mask = boxBlur(mask, size, 1);
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x, j = i * 4;
      const dx = (x + 0.5 - half) / half, dy = (y + 0.5 - half) / half;
      const r = Math.sqrt(dx * dx + dy * dy);
      const inArt = 1 - smooth(ART - 0.012, ART - 0.002, r);
      const m = mask[i] * inArt;

      // Height: sunken field, raised artwork, beaded ring, raised rim.
      let h = 0.42;
      h = h + (relief ? (0.30 + 0.55 * m - 0.42) : (0.26 + 0.16 * m - 0.42)) * inArt;
      if (r > 0.82 && r < 0.89) {
        const a = Math.atan2(dy, dx);
        const cell = (a / TAU) * BEADS;
        const da = (cell - Math.round(cell)) / BEADS * TAU * beadR;
        const bd = Math.sqrt(da * da + (r - beadR) * (r - beadR)) / beadSize;
        if (bd < 1) h += 0.3 * Math.sqrt(1 - bd * bd);
      }
      h += 0.58 * smooth(0.9, 0.925, r) - 0.3 * smooth(0.975, 1.0, r);
      height[i] = h;

      // Colour, roughness, metalness.
      let cr = BRASS[0], cg = BRASS[1], cb = BRASS[2], rough = 0.3, metal = 1;
      if (relief) {
        // Dark patina in the recesses, bright polished brass on the raised lines.
        const f = inArt * (1 - m);
        const hi = inArt * m * 0.35;
        cr = (cr + (250 - cr) * hi) * (1 - 0.72 * f);
        cg = (cg + (222 - cg) * hi) * (1 - 0.76 * f);
        cb = (cb + (150 - cb) * hi) * (1 - 0.82 * f);
        rough = 0.24 + f * 0.3;
      } else if (inArt > 0) {
        const a = inArt * (src[j + 3] / 255);
        cr = cr + (src[j] - cr) * a; cg = cg + (src[j + 1] - cg) * a; cb = cb + (src[j + 2] - cb) * a;
        rough = 0.3 + (0.18 - 0.3) * a;
        metal = 1 - 0.85 * a;
        glow.data[j] = src[j] * a; glow.data[j + 1] = src[j + 1] * a; glow.data[j + 2] = src[j + 2] * a;
      }
      if (glow) glow.data[j + 3] = 255;
      color.data[j] = cr; color.data[j + 1] = cg; color.data[j + 2] = cb; color.data[j + 3] = 255;
      orm.data[j] = 255; orm.data[j + 1] = rough * 255; orm.data[j + 2] = metal * 255; orm.data[j + 3] = 255;
    }
  }

  const normal = normalsFrom(boxBlur(height, size, 1), size, relief ? 9 : 7);
  const maps = {
    map: texture(color, size, true, anisotropy),
    normalMap: texture(normal, size, false, anisotropy),
    roughnessMap: texture(orm, size, false, anisotropy),
  };
  maps.metalnessMap = maps.roughnessMap;
  if (glow) maps.emissiveMap = texture(glow, size, true, anisotropy);
  return maps;
}

/* Reeded edge: one groove, repeated around the circumference. */
function reedingNormal() {
  const w = 32, h = 4;
  const height = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) height[y * w + x] = 0.5 + 0.5 * Math.cos((x / w) * TAU);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const img = c.getContext('2d').createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const nx = (height[y * w + ((x + w - 1) % w)] - height[y * w + ((x + 1) % w)]) * 4.5;
    const inv = 1 / Math.sqrt(nx * nx + 1), i = (y * w + x) * 4;
    img.data[i] = (nx * inv * 0.5 + 0.5) * 255; img.data[i + 1] = 128; img.data[i + 2] = (inv * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  c.getContext('2d').putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(150, 1);
  return t;
}

/* A small studio for reflections: a warm key softbox plus the logo's cyan and
   magenta neon as rim strips. Prefiltered once into the scene environment. */
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
    new THREE.MeshBasicMaterial({ color: 0x15130f, side: THREE.BackSide })
  );
  scene.add(room);
  panel(0xfff1d6, 14, 9, 5, -3, 9, 8);       // key, above front-left
  panel(0xffe2b0, 3, 14, 3, 0, -8, 9);       // warm bounce from below
  panel(0x35e8dc, 10, 1.6, 12, -11, 1, 4);   // cyan strip, left
  panel(0xff48c4, 10, 1.6, 12, 11, -1, 4);   // magenta strip, right
  panel(0xffffff, 5, 4, 4, 5, 4, 11);        // small crisp front highlight
  panel(0xfff1d6, 6, 8, 8, 0, 3, -11);       // back light, for the turn

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

/**
 * Mount the coin into `host` (a positioned element; the canvas fills it).
 * opts: { face: 'heads'|'tails', still: bool, intro: bool, onLand(face), onIdle(), assets: base URL }
 * Returns { flip(), face, destroy() }. Rejects if WebGL or the logo is unavailable.
 */
export async function mount(host, opts = {}) {
  const base = opts.assets || new URL('.', import.meta.url).href;
  const logo = await loadImage(base + 'logo.webp');

  const canvas = document.createElement('canvas');
  canvas.className = 'coin-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setClearAlpha(0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const small = Math.min(window.innerWidth, window.innerHeight) < 500 && (window.devicePixelRatio || 1) < 2;
  const size = small ? 512 : 1024;
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  scene.environment = studio(renderer);
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
  camera.position.set(0, 0, 9.06);

  const key = new THREE.DirectionalLight(0xfff0d8, 2.2);
  key.position.set(-2.5, 4, 6);
  const rim = new THREE.DirectionalLight(0x48e6de, 0.9);
  rim.position.set(5, -1, 2);
  scene.add(key, rim);

  // --- the coin ---
  const heads = new THREE.MeshPhysicalMaterial({
    ...buildFace(logo, size, false, aniso),
    metalness: 1, roughness: 1,
    emissive: 0xffffff, emissiveIntensity: 0.55,
    clearcoat: 0.7, clearcoatRoughness: 0.12,
    normalScale: new THREE.Vector2(1, 1),
  });
  const tails = new THREE.MeshStandardMaterial({
    ...buildFace(logo, size, true, aniso),
    metalness: 1, roughness: 1,
  });
  const edgeMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(BRASS[0] / 255, BRASS[1] / 255, BRASS[2] / 255).convertSRGBToLinear(),
    metalness: 1, roughness: 0.3, normalMap: reedingNormal(),
  });

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

  host.appendChild(canvas);

  // --- motion ---
  const yawOf = (face) => (face === 'tails' ? Math.PI : 0);
  const REST_TILT = -0.13;               // lean back a touch so the top edge catches the key light
  const FLIGHT = 1.55, SETTLE = 1.1, HOLD = 2.4, ANTIC = 0.22;
  const IDLE_SPEED = 0.55;               // rad/s

  let face = opts.face === 'tails' ? 'tails' : 'heads';
  let yaw = yawOf(face);
  let mode = 'hold';                     // 'idle' | 'flip' | 'hold'
  let modeT = 0;                         // seconds in current mode
  let idleRamp = 0;
  let flipFrom = 0, flipTo = 0, flipTurns = 3, flipNext = face, landed = false;
  let clock = 0;
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };

  function flip(to) {
    if (mode === 'flip') return false;
    flipNext = to === 'heads' || to === 'tails' ? to : (Math.random() < 0.5 ? 'heads' : 'tails');
    flipFrom = yaw;
    // Land on the chosen face: nearest matching yaw ahead of where we are.
    const target = yawOf(flipNext);
    flipTo = target + Math.ceil((yaw - target) / TAU - 1e-6) * TAU;
    if (flipTo - flipFrom < 0.01 && Math.random() < 0.5) flipTo += TAU;
    flipTurns = 3 + (Math.random() < 0.4 ? 1 : 0);
    mode = 'flip'; modeT = 0; landed = false;
    wake();
    return true;
  }

  function pose(dt) {
    clock += dt; modeT += dt;
    let y = 0, z = 0, rx = REST_TILT, rz = 0;

    if (mode === 'flip') {
      const t = modeT - ANTIC;
      if (t < 0) {
        // Anticipation: a small dip and lean before the thumb flicks.
        const a = Math.sin((modeT / ANTIC) * Math.PI * 0.5);
        y = -0.09 * a; rx = REST_TILT + 0.16 * a;
      } else if (t < FLIGHT) {
        const p = t / FLIGHT;
        const arc = 4 * p * (1 - p);                       // ballistic height
        y = -0.09 * (1 - Math.min(1, p * 8)) + 0.72 * arc;
        z = 0.6 * arc;                                     // rises toward the viewer
        const spin = 1 - Math.pow(1 - p, 1.7);             // fast off the thumb, slowing into the catch
        rx = REST_TILT + 0.16 * (1 - Math.min(1, p * 6)) - flipTurns * TAU * spin;
        rz = Math.sin(p * Math.PI) * 0.2 * Math.sin(t * 7.5);   // precession wobble
        yaw = flipFrom + (flipTo - flipFrom) * easeInOut(p);
      } else {
        const s = t - FLIGHT;
        if (!landed) {
          landed = true; face = flipNext; yaw = yawOf(face);
          if (opts.onLand) opts.onLand(face);
        }
        if (s < SETTLE) {
          // Landing: a damped bounce and rock that dies away.
          const d = Math.exp(-4.6 * s);
          y = 0.2 * d * Math.abs(Math.sin(s * 8.5));
          rx = REST_TILT + 0.34 * d * Math.sin(s * 13);
          rz = 0.11 * d * Math.sin(s * 10 + 0.8);
        } else { mode = 'hold'; modeT = 0; }
      }
    } else if (mode === 'hold') {
      yaw = yawOf(face) + 0.1 * Math.sin(modeT * 1.1);     // show the result, breathing
      if (modeT > HOLD && !opts.still && Math.abs(Math.sin(modeT * 1.1)) < 0.05) {
        yaw = yawOf(face); mode = 'idle'; modeT = 0; idleRamp = 0;
        if (opts.onIdle) opts.onIdle();
      }
    } else {
      idleRamp = Math.min(1, idleRamp + dt / 1.6);
      yaw += IDLE_SPEED * easeInOut(idleRamp) * dt;
      if (yaw > TAU) yaw -= TAU;
    }

    if (mode !== 'flip') y += 0.03 * Math.sin(clock * 1.3);

    pointer.sx += (pointer.x - pointer.sx) * Math.min(1, dt * 5);
    pointer.sy += (pointer.y - pointer.sy) * Math.min(1, dt * 5);

    coin.rotation.y = yaw;
    tumble.rotation.set(rx + pointer.sy * 0.14, pointer.sx * 0.2, rz);
    tumble.position.set(0, y, z);

    // Contact shadow: tighter and darker near the ground, wide and faint in the air.
    const lift = Math.max(0, y);
    const facing = Math.abs(Math.cos(yaw)) * Math.abs(Math.cos(rx)) ;
    const w = 0.5 + 1.7 * Math.max(facing, 0.12) + lift * 0.5;
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
    if (opts.still && mode !== 'flip') return;
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
  if (opts.intro && !opts.still) flip(face); else wake();

  return {
    flip,
    get face() { return face; },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect(); io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pointermove', onMove);
      renderer.dispose();
      canvas.remove();
    },
  };
}
