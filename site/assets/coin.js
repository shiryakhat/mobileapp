/* Shir ya Khat — the 3D coin.
   Lazy-loaded by site.js after first paint. A worn silver piece whose two
   faces are pre-rendered artwork: heads (خط) is coin-face-heads.png, the
   microphone with the calligraphy escaping it; tails (شیر) is
   coin-face-tails.png, the astronaut. The art already carries its relief,
   patina and border, so each face is simply that picture on lightly metallic
   stock; the reeded edge, the lighting and the reflections are generated here.

   About one toss in ten lands on its rim and teeters, undecided.

   A tap tosses it; a tap while it is in the air bats it again — more spin, a
   little more height, a fresh outcome — so a rhythm of taps keeps it tumbling. */

import * as THREE from './vendor/three.min.js';

const TAU = Math.PI * 2;
const R = 1;            // coin radius (world units)
const T = 0.15;         // thickness
const BEVEL = 0.028;    // chamfer between face and edge
const FACE_INSET = 0.985;  // use this much of the art's disc, to stay clear of its cut-out fringe
const FACE_GLOW = 0.7;     // how much of the art shows regardless of the light
const FACE_METAL = 0.9;    // ...and how metallic the rest of its response is
const FACE_ROUGH = 0.58;
const FACE_ENV = 0.18;     // reflections on the faces, kept under the art
const EDGE_ENV = 0.3;      // ...and on the edge, so it stays the faces' silver
const IRIDESCENCE = 0.12;  // a thin toning film; swells during a shimmer
const KEY = 1.2;           // key light intensity
const LAMP = 0.6;          // the low warm lamp
const EDGE_CHANCE = 0.1;
const ADDITIVE = 2;     // THREE.AdditiveBlending (the constant is not in the trimmed bundle)

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const wrapPi = (a) => a - TAU * Math.round(a / TAU);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const bell = (u) => Math.exp(-u * u);

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

/* One coin face from a pre-rendered coin on a transparent background.
   Finds the opaque disc, and crops the picture so that disc exactly fills the
   texture (and so the round face geometry). Returns the colour map and the
   average colour of the metal, which tints the edge to match. */
function faceTexture(img, size, anisotropy) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;

  // Where is the disc? Bounding box of the opaque pixels, measured on a small copy.
  const P = 128;
  const probe = canvasOf(P);
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  pctx.drawImage(img, 0, 0, P, P);
  const d = pctx.getImageData(0, 0, P, P).data;
  let x0 = P, y0 = P, x1 = -1, y1 = -1, sr = 0, sg = 0, sb = 0, count = 0;
  for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) {
    const i = (y * P + x) * 4;
    if (d[i + 3] < 200) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; count++;
  }
  if (!count) { x0 = y0 = 0; x1 = y1 = P - 1; sr = sg = sb = 128; count = 1; }   // no alpha to go by: use it all
  const tint = [sr / count, sg / count, sb / count];
  const cx = (x0 + x1 + 1) / 2 * (iw / P), cy = (y0 + y1 + 1) / 2 * (ih / P);
  const r = Math.min((x1 - x0 + 1) * (iw / P), (y1 - y0 + 1) * (ih / P)) / 2 * FACE_INSET;

  const c = canvasOf(size);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, cx - r, cy - r, 2 * r, 2 * r, 0, 0, size, size);
  // Bare metal behind any nick in the cut-out, so the rim never shows a hole.
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = 'rgb(' + tint.map(Math.round).join(',') + ')';
  ctx.fillRect(0, 0, size, size);

  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = anisotropy;
  return { map, tint };
}

/* Reeded edge: one groove, repeated around the circumference. Dirt sits in the
   grooves, the ridges are worn bright. `tint` is the faces' metal, sRGB 0..255. */
function reeding(tint) {
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
    for (let c = 0; c < 3; c++) cimg.data[i + c] = Math.min(255, tint[c] * (0.38 + 0.92 * t));
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

/* Reflections: a lamp-lit room rather than a photo studio. A big warm key,
   amber from a low flame, a cool sliver of window, and the logo's cyan and
   magenta kept as thin strips that only show up as fringes on the rim. Prefiltered once into the scene environment. */
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
 * Returns { flip(to?, tap?), face, state, destroy() }. `to` may be 'heads',
 * 'tails' or 'edge'; left out, it is a fair toss with a small chance of the rim.
 * `tap` is the pointer event behind it, if any: the coin tips away from where it
 * was hit. flip() never refuses: called while the coin is in the air it kicks it
 * again (more spin, more airtime) and re-rolls how it will come down.
 * With `still`, or under prefers-reduced-motion, nothing animates: flip() just
 * shows the result. Rejects if WebGL or the face artwork is unavailable.
 */
export async function mount(host, opts = {}) {
  const base = opts.assets || new URL('.', import.meta.url).href;
  const [headsArt, tailsArt] = await Promise.all([
    loadImage(base + 'coin-face-heads.png'),
    loadImage(base + 'coin-face-tails.png'),
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
  const env = studio(renderer);   // set per material, so each can weigh its reflections
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
  camera.position.set(0, 0, 9.06);

  // Key from the upper left; a low warm lamp that flickers a little; a cool
  // kiss on the far rim.
  const key = new THREE.DirectionalLight(0xfff2e0, KEY);
  key.position.set(-3.4, 4.2, 3.6);
  const lamp = new THREE.DirectionalLight(0xffa24a, LAMP);
  lamp.position.set(3, -3.5, 3);
  const rim = new THREE.DirectionalLight(0x8fdfe6, 0.55);
  rim.position.set(5, 1, 1.5);
  scene.add(key, lamp, rim);

  // --- the coin ---
  // The faces are the artwork itself. Its light and shade are already painted
  // in, so the material only has to add a little life on top: mostly the
  // picture (partly self-lit, so it never goes dark mid-turn), with a soft
  // metallic response to the room as the coin moves.
  const headsFace = faceTexture(headsArt, size, aniso);
  const tailsFace = faceTexture(tailsArt, size, aniso);
  const faceMaterial = (f) => new THREE.MeshPhysicalMaterial({
    map: f.map, emissiveMap: f.map, emissive: 0xffffff, emissiveIntensity: FACE_GLOW,
    envMap: env, envMapIntensity: FACE_ENV,
    metalness: FACE_METAL, roughness: FACE_ROUGH,
    iridescence: IRIDESCENCE, iridescenceIOR: 1.7, iridescenceThicknessMinimum: 180, iridescenceThicknessMaximum: 420,
  });
  const heads = faceMaterial(headsFace);
  const tails = faceMaterial(tailsFace);
  const edgeTex = reeding(headsFace.tint.map((v, i) => (v + tailsFace.tint[i]) / 2));
  const edgeMat = new THREE.MeshPhysicalMaterial({
    ...edgeTex, emissiveMap: edgeTex.map, emissive: 0xffffff, emissiveIntensity: 0.45,
    envMap: env, envMapIntensity: EDGE_ENV, metalness: 1, roughness: 0.45,
    iridescence: IRIDESCENCE, iridescenceIOR: 1.7, iridescenceThicknessMinimum: 180, iridescenceThicknessMaximum: 420,
  });
  const metals = [heads, tails, edgeMat];
  const textures = [headsFace.map, tailsFace.map, edgeTex.map, edgeTex.normalMap];

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
  const APEX = 0.78;                     // height of a plain toss
  const APEX_MAX = 0.86;                 // ...and the most a volley of taps can keep it at (the stage's headroom)
  const GRAVITY = 8 * APEX / (FLIGHT * FLIGHT);
  const LAUNCH = 4 * APEX / FLIGHT;      // upward speed off the thumb
  const SPIN_LEAD = 0.86 * 2.5 + 0.14;   // how much faster than its average the tumble starts (see `spin` below)
  const SPIN_FLOOR = 9;                  // rad/s: a tap in the air counts the tumble as at least this fast,
  const SPIN_KICK = 14;                  // ...adds this much,
  const SPIN_MAX = 42;                   // ...and stops here, short of strobing
  const SPRING_K = 320, SPRING_C = 14;   // the pop and tilt of a tap: quick, a little underdamped

  let face = opts.face === 'tails' ? 'tails' : 'heads';
  let yaw = yawOf(face);
  let mode = 'hold';                     // 'idle' | 'flip' | 'settle' | 'edge' | 'tip' | 'hold'
  let modeT = 0;                         // seconds in current mode
  let idleRamp = 0;
  let flipFrom = 0, flipTo = 0, flipNext = face, flipEdge = false;
  // The current flight: anticipation, then a ballistic arc from height h0 at
  // speed v0 lasting flightD, tumbling from angle a0 through spinA more.
  let antic = ANTIC, lean = 1, flightD = FLIGHT, h0 = 0, v0 = LAUNCH, a0 = 0, spinA = 3 * TAU, yawV = 0;
  let spinRate = 0, yawRate = 0, spinAngle = 0, volley = 0;
  // What a tap adds on top: a scale pop and a tilt, on springs, and the
  // leftover of the pose it interrupted, which fades instead of snapping.
  const pop = { x: 0, v: 0 }, tiltY = { x: 0, v: 0 }, tiltZ = { x: 0, v: 0 };
  const prev = { x: 0, y: 0, z: 0, rx: REST_TILT, ry: 0, rz: 0 };
  const res = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
  let carry = false;
  function spring(s, dt) { s.v += (-SPRING_K * s.x - SPRING_C * s.v) * dt; s.x += s.v * dt; }
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
    spinRate = yawRate = 0; volley = 0;
    enter('settle');
    if (Math.random() < 0.45) startQuirk('glint');
    if (opts.onLand) opts.onLand(face);
  }

  function flip(to, tap) {
    flipEdge = to === 'edge' || (to !== 'heads' && to !== 'tails' && Math.random() < EDGE_CHANCE);
    flipNext = to === 'heads' || to === 'tails' ? to : (Math.random() < 0.5 ? 'heads' : 'tails');

    if (isStill()) {                     // no animation: just show the result
      face = flipNext; yaw = yawOf(face); enter('hold');
      if (opts.onLand) opts.onLand(face);
      wake();
      return true;
    }

    const flying = mode === 'flip' && modeT >= antic;     // already in the air: bat it again
    const loading = mode === 'flip' && !flying;           // still in the anticipation: let go now
    let turns = 3 + (Math.random() < 0.4 ? 1 : 0);
    if (flying) {
      volley++;
      h0 = Math.max(0, Math.min(APEX_MAX, prev.y));
      // A bump upward, less of one the higher it already is, so a volley hovers instead of leaving the stage.
      v0 = Math.min(LAUNCH, Math.sqrt(2 * GRAVITY * (APEX_MAX - h0)));
      a0 = ((spinAngle % TAU) + TAU) % TAU;
      antic = 0; lean = 0; stutter = 0;
    } else {
      volley = 0; h0 = 0; v0 = LAUNCH; a0 = 0;
      if (loading) { lean = smooth(0, 1, modeT / antic); antic = 0; }
      else { lean = 1; antic = mode === 'settle' ? 0.2 : ANTIC; }   // barely down and off again: a quicker thumb
      stutter = Math.random() < 0.3 ? 0.7 + Math.random() * 0.3 : 0;   // now and then it catches at the top
    }
    flightD = (v0 + Math.sqrt(v0 * v0 + 2 * GRAVITY * h0)) / GRAVITY;
    if (flying) {
      // Faster than it was turning, and still due to come down flat: a whole number of turns from here.
      const rate = Math.min(SPIN_MAX, Math.max(spinRate, SPIN_FLOOR) + SPIN_KICK);
      turns = Math.round((a0 + rate * flightD / SPIN_LEAD) / TAU);
      while (turns * TAU - a0 < 0.75 * TAU) turns++;
    }
    spinA = turns * TAU - a0;

    yaw = ((yaw % TAU) + TAU) % TAU;
    flipFrom = yaw;
    yawV = flying ? Math.max(0, Math.min(8, yawRate)) : 0;
    // Come down on the chosen face — or side-on — at the nearest matching yaw ahead of where we are
    // (and far enough ahead that the turn it already has never needs to reverse).
    const target = flipEdge ? Math.PI / 2 + (Math.random() < 0.5 ? Math.PI : 0) : yawOf(flipNext);
    flipTo = target + Math.ceil((yaw + 0.4 * yawV * flightD - target) / TAU - 1e-6) * TAU;
    if (!flipEdge && flipTo - flipFrom < 0.01 && Math.random() < 0.5) flipTo += TAU;
    if (flying && volley > 1 && Math.random() < 0.5) flipTo += TAU;   // a volley sets it spinning as well as tumbling
    wobAmp = 0.14 + Math.random() * 0.12 + Math.min(0.1, 0.025 * volley);
    wobPhase = Math.random() * TAU;
    quirk.kind = '';
    if (flying && volley % 3 === 0) startQuirk('shimmer');

    // The kick itself: a pop of scale, and a tip away from where it was hit.
    let side = Math.random() < 0.5 ? -0.6 : 0.6;
    if (tap && tap.detail !== 0 && typeof tap.clientX === 'number') {
      const b = host.getBoundingClientRect();
      if (b.width) side = Math.max(-1, Math.min(1, (tap.clientX - (b.left + b.width / 2)) / (b.width * 0.4)));
    }
    const hard = flying ? 1 : 0.6;
    pop.v = Math.min(3.2, pop.v + 1.8 * hard);
    tiltY.v = Math.max(-4, Math.min(4, tiltY.v + 2.2 * hard * side));
    tiltZ.v = Math.max(-4, Math.min(4, tiltZ.v - 2.4 * hard * side));

    carry = true;
    enter('flip');
    wake();
    return true;
  }

  function pose(dt) {
    clock += dt; modeT += dt;
    let x = 0, y = 0, z = 0, rx = REST_TILT, ry = 0, rz = 0;

    if (mode === 'flip') {
      const t = modeT - antic;
      if (t < 0) {
        // Anticipation: a slow dip and lean before the thumb flicks.
        const a = smooth(0, 1, modeT / antic);
        y = -0.1 * a; rx = REST_TILT + 0.18 * a;
      } else if (t < flightD) {
        const p = t / flightD;
        const alt = Math.max(0, h0 + v0 * t - 0.5 * GRAVITY * t * t);   // ballistic height
        const off = lean * (1 - smooth(0, 0.14, p));       // letting go of the anticipation pose
        y = -0.1 * off + alt;
        z = (0.6 / APEX) * alt;                            // rises toward the viewer
        // Fast off the thumb (or the tap), bleeding speed all the way down; a little is left for the landing to absorb.
        const spin = 0.86 * (1 - Math.pow(1 - p, 2.5)) + 0.14 * p;
        const apex = bell((p - 0.5) / 0.07);
        const angle = a0 + spinA * spin - stutter * apex;  // the catch: lags, then makes it up
        spinAngle = angle;
        spinRate = spinA * (0.86 * 2.5 * Math.pow(1 - p, 1.5) + 0.14) / flightD;
        rx = REST_TILT + 0.18 * off - angle;
        // The spin axis is never quite true: it precesses, most at the top of the arc.
        const loose = Math.sin(p * Math.PI);
        rz = loose * wobAmp * Math.sin(angle * 0.31 + wobPhase) + stutter * apex * 0.07 * Math.sin((p - 0.5) * 90);
        ry = loose * wobAmp * 0.6 * Math.cos(angle * 0.31 + wobPhase);
        // Yaw eases to the face it will land on, starting from whatever turn it already had.
        const span = flipTo - flipFrom, lead = yawV * flightD;
        yaw = flipFrom + lead * p * (1 - p) * (1 - p) + span * p * p * (3 - 2 * p);
        yawRate = (lead * (1 - 4 * p + 3 * p * p) + span * 6 * p * (1 - p)) / flightD;
        if (stutter && quirk.kind !== 'shimmer' && p > 0.44 && p < 0.5) startQuirk('shimmer');
      } else if (flipEdge) {
        edgeYaw = ((flipTo % TAU) + TAU) % TAU; yaw = edgeYaw;
        edgeTips = Math.random() < 0.6;
        enter('edge');
        if (opts.onEdge) opts.onEdge();
      } else {
        // A coin that was batted about comes down harder.
        land(flipNext, 1 + 0.5 * clamp01((0.14 * spinA / flightD - 1.6) / 2), 0);
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
    for (const m of metals) {
      m.envMapIntensity = (m === edgeMat ? EDGE_ENV : FACE_ENV) * (1 + 0.5 * shimmer);
      m.iridescence = IRIDESCENCE + 0.5 * shimmer;
    }
    renderer.toneMappingExposure = EXPOSURE * (1 + 0.05 * shimmer);

    // Lamplight is never perfectly steady.
    const flame = 1 + 0.07 * Math.sin(clock * 2.3) * Math.sin(clock * 5.1 + 1) + 0.035 * Math.sin(clock * 11.7);
    lamp.intensity = LAMP * flame;
    key.intensity = KEY * (1 + 0.02 * Math.sin(clock * 0.7));

    pointer.sx += (pointer.x - pointer.sx) * Math.min(1, dt * 4);
    pointer.sy += (pointer.y - pointer.sy) * Math.min(1, dt * 4);

    // A tap never snaps the coin: whatever pose it interrupted is carried over and fades out.
    if (carry) {
      carry = false;
      res.x = prev.x - x; res.y = prev.y - y; res.z = prev.z - z;
      res.rx = wrapPi(prev.rx - rx); res.ry = prev.ry - ry; res.rz = prev.rz - rz;
    }
    x += res.x; y += res.y; z += res.z; rx += res.rx; ry += res.ry; rz += res.rz;
    prev.x = x; prev.y = y; prev.z = z; prev.rx = rx; prev.ry = ry; prev.rz = rz;
    const fade = Math.exp(-9 * dt);
    res.x *= fade; res.y *= fade; res.z *= fade; res.rx *= fade; res.ry *= fade; res.rz *= fade;
    spring(pop, dt); spring(tiltY, dt); spring(tiltZ, dt);

    coin.rotation.y = yaw;
    tumble.rotation.set(rx + pointer.sy * 0.14, ry + tiltY.x + pointer.sx * 0.2, rz + tiltZ.x);
    tumble.position.set(x, y, z);
    tumble.scale.setScalar(1 + pop.x);

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
      scene.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.dispose();
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      });
      for (const t of textures) t.dispose();           // incl. the edge's normal map
      env.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
