// Kestrel Run — one classic script (no modules, no imports) so the game
// opens straight from file:// in desktop Chrome as well as from a server.
// Implemented fresh in-session from the user's design reference: a 3D
// island flight game, software-rendered on a 2D canvas — no libraries, no
// network, no assets. Take off from Harbour Strip, thread 10 glowing rings
// around the archipelago, then land back on the runway for a mission rating.
//
// Sections, in load order: tuning constants; island world (heightfield,
// ring course, harbour town, clouds); mission rules; flight model;
// software 3D renderer; cockpit instruments and HUD; keyboard + mouse
// input; WebAudio sound; deterministic staged screenshot scenes
// (?demo=1..4); boot and the game loop.

/* ---------------- tuning constants ---------------- */

const WORLD = {
  RUNWAY_Y: 12,
  RUNWAY_HALF_LEN: 600,
  RUNWAY_HALF_W: 28,
  RING_COUNT: 10,
  RING_RADIUS: 60,
  GRID_CELL: 170,
  GRID_R: 34,
  HAZE_NEAR: 1500,
  HAZE_FAR: 5900,
  SKY_TOP: [46, 108, 184],
  SKY_MID: [150, 196, 230],
  HAZE: [208, 226, 236],
  SEA: [22, 94, 146],
  SAND: [224, 208, 158],
  CLOUD_TILE: 15000,
  CLOUD_COUNT: 40,
};

const PLANE = {
  THRUST: 22,
  DRAG: 0.0026,
  STALL_SPEED: 33,
  ROTATE_SPEED: 32,
  LIFTOFF_SPEED: 37,
  ROLL_RATE: 2.0,
  PITCH_RATE: 1.0,
  MAX_ROLL: 1.3,
  MAX_PITCH: 1.15,
  TURN_G: 9.8,
  GRAV: 9.8,
  CRASH_TIME: 2.6,
  START: { x: 0, y: 13, z: -520, yaw: 0 },
};

const SCORE = {
  RING: 100,
  BULLSEYE_MAX: 60,
  LANDING_BONUS: 300,
  RATING_S: 260,
  RATING_A: 340,
};

const SUN_DIR = [0.4494, 0.799, 0.3995];

/* ---------------- island world ---------------- */

const TAU = Math.PI * 2;

/** Fast deterministic hash of an integer lattice point, in [0, 1). */
function latticeHash(ix, iz) {
  let h = (Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

/** Smoothstep that also works with a reversed edge pair (e0 > e1). */
function sstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Bilinear value noise over the integer lattice. */
function valueNoise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = smooth(fx);
  const v = smooth(fz);
  const a = latticeHash(ix, iz);
  const b = latticeHash(ix + 1, iz);
  const c = latticeHash(ix, iz + 1);
  const d = latticeHash(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Four-octave fractal noise, normalised to [0, 1]. */
function fbm(x, z) {
  let sum = 0;
  let amp = 0.55;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < 4; o += 1) {
    sum += amp * valueNoise(x * freq, z * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

/** Soft round bump, 1 at the centre fading to 0 at radius r. */
function islet(x, z, cx, cz, r) {
  const d = Math.hypot(x - cx, z - cz) / r;
  if (d >= 1) return 0;
  const t = 1 - d * d;
  return t * t;
}

const ISLETS = [
  { cx: 4300, cz: 3600, r: 1700, lift: 300 },
  { cx: -4300, cz: 3900, r: 1500, lift: 260 },
  { cx: 1800, cz: -5400, r: 1300, lift: 200 },
];

/** Ground height in metres at (x, z). Sea level is 0. */
function groundHeight(x, z) {
  const n = fbm(x * 0.00042 + 7.3, z * 0.00042 - 2.9);
  let h = (n - 0.43) * 1250;
  let cover = sstep(5800, 2600, Math.hypot(x, z));
  for (const isl of ISLETS) {
    const bump = islet(x, z, isl.cx, isl.cz, isl.r);
    h += isl.lift * bump;
    cover = Math.max(cover, bump);
  }
  if (h > 240) h += (h - 240) * 0.7; // sharp peaks
  h = -60 + (h + 60) * cover; // fade the archipelago out into open sea
  if (h < 0) h = 0;
  // Carve a gentle valley along the take-off corridor so the first leg and
  // the runway approach always have a clear line of sight.
  const corrX = sstep(950, 350, Math.abs(x));
  const corrZ = sstep(-2300, -1700, z) * (1 - sstep(2600, 3200, z));
  const corr = corrX * corrZ;
  h = h * (1 - corr) + 45 * corr;
  // Flatten the harbour strip so the runway sits on level ground.
  const flat = sstep(260, 90, Math.abs(x)) * sstep(900, 620, Math.abs(z));
  return h * (1 - flat) + WORLD.RUNWAY_Y * flat;
}

/** The 10-ring course looping around the archipelago. Ring 0 sits on the
 *  take-off line so the first target is visible the moment you rotate. */
function buildCourse() {
  const pts = [{ x: 60, z: 2000 }];
  for (let k = 1; k < WORLD.RING_COUNT; k += 1) {
    const ang = (k * 36 + 12 * Math.sin(k * 1.9)) * (Math.PI / 180);
    let radius = 2600 + 900 * Math.sin(k * 2.7 + 1.1) + 600 * Math.cos(k * 0.9);
    let x = radius * Math.sin(ang);
    let z = radius * Math.cos(ang);
    let guard = 0;
    while (groundHeight(x, z) > 210 && guard < 12) {
      radius += 320;
      x = radius * Math.sin(ang);
      z = radius * Math.cos(ang);
      guard += 1;
    }
    pts.push({ x, z });
  }
  return pts.map((p, k) => {
    const g = Math.max(0, groundHeight(p.x, p.z));
    const y = Math.max(g + 120, 165) + 22 * ((k * 3) % 3);
    const next = k + 1 < pts.length ? pts[k + 1] : { x: 0, z: 0 };
    return { x: p.x, y, z: p.z, yaw: Math.atan2(next.x - p.x, next.z - p.z) };
  });
}

/** Harbour town: hangars and a tower by the strip, houses to the east. */
const BUILDINGS = (() => {
  const list = [];
  const add = (cx, cz, w, d, h, wall, roof) => list.push({ cx, cz, w, d, h, wall, roof, y: groundHeight(cx, cz) });
  add(-120, -330, 44, 30, 13, [198, 202, 206], [118, 128, 138]);
  add(-120, -250, 44, 30, 13, [198, 202, 206], [118, 128, 138]);
  add(-120, -170, 44, 30, 13, [198, 202, 206], [118, 128, 138]);
  add(118, -120, 56, 26, 11, [230, 222, 205], [196, 84, 56]);
  add(96, 70, 10, 10, 28, [236, 236, 232], [236, 236, 232]); // tower shaft
  add(96, 70, 14, 14, 5, [70, 120, 150], [236, 236, 232]); // tower cab
  list[list.length - 1].y += 28;
  const walls = [[226, 214, 190], [200, 120, 96], [214, 206, 176], [176, 190, 200]];
  const roofs = [[168, 70, 52], [86, 92, 104]];
  for (let i = 0; i < 20; i += 1) {
    const x = 760 + latticeHash(i, 3) * 620;
    const z = -420 + latticeHash(i, 9) * 900;
    add(
      x, z,
      14 + latticeHash(i, 5) * 10, 12 + latticeHash(i, 6) * 8, 7 + latticeHash(i, 7) * 6,
      walls[i % 4], roofs[i % 2],
    );
  }
  return list;
})();

/** Puffy clouds tiled across a square that wraps around the camera. */
const CLOUDS = (() => {
  const out = [];
  const span = WORLD.CLOUD_TILE;
  for (let i = 0; i < WORLD.CLOUD_COUNT; i += 1) {
    out.push({
      x: (latticeHash(i, 41) - 0.5) * span,
      z: (latticeHash(i, 43) - 0.5) * span,
      y: 950 + latticeHash(i, 47) * 700,
      r: 140 + latticeHash(i, 53) * 200,
    });
  }
  return out;
})();

/* ---------------- mission rules ---------------- */

function createMission() {
  return {
    cleared: 0,
    score: 0,
    time: 0,
    running: false,
    done: false,
    rating: '',
    crashes: 0,
    toast: '',
    toastT: 0,
    lastCrash: '',
  };
}

function setToast(S, text, seconds = 2.6) {
  S.mission.toast = text;
  S.mission.toastT = seconds;
}

/** Where the guidance diamond points: next ring, or the runway once done.
 *  Staged scenes may pin a fixed target/label so a shot reads as intended. */
function missionTarget(S) {
  if (S.demoTarget) return S.demoTarget;
  const m = S.mission;
  if (m.cleared < S.course.length) {
    const r = S.course[m.cleared];
    return { x: r.x, y: r.y, z: r.z, kind: 'ring' };
  }
  return { x: 0, y: WORLD.RUNWAY_Y + 4, z: 0, kind: 'runway' };
}

/** Short label for the mission panel, e.g. "Ring 4 of 10". */
function missionLabel(S) {
  if (S.demoLabel) return S.demoLabel;
  const m = S.mission;
  if (m.done) return 'Mission complete';
  if (m.cleared < S.course.length) return `Ring ${Math.min(m.cleared + 1, WORLD.RING_COUNT)} of ${WORLD.RING_COUNT}`;
  return 'Land on the runway';
}

function formatTime(seconds) {
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(Math.floor(seconds % 60)).padStart(2, '0');
  return `${mm}:${ss}`;
}

/* ---------------- flight model ---------------- */

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function placeOnRunway(S) {
  const p = S.plane;
  const s = PLANE.START;
  Object.assign(p, {
    x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: 0, roll: 0,
    speed: 0, thr: 0, vy: 0, onGround: true, crashed: 0, crashT: 0, brake: false, prop: 0,
  });
  p.prev = [p.x, p.y, p.z];
  S.cam.yaw = 0;
  S.cam.pitch = 0;
  S.cam.roll = 0;
}

function respawn(S) {
  const p = S.plane;
  const m = S.mission;
  if (m.cleared === 0) {
    placeOnRunway(S);
    return;
  }
  const last = S.course[m.cleared - 1];
  const next = m.cleared < S.course.length ? S.course[m.cleared] : { x: 0, z: 0 };
  const yaw = Math.atan2(next.x - last.x, next.z - last.z);
  const x = last.x + Math.sin(yaw) * 150;
  const z = last.z + Math.cos(yaw) * 150;
  Object.assign(p, {
    x, z,
    y: Math.max(last.y, groundHeight(x, z) + 80),
    yaw, pitch: 0, roll: 0, speed: 62, thr: 0.65, onGround: false, vy: 0, crashed: 0, crashT: 0,
  });
  p.prev = [p.x, p.y, p.z];
  S.cam.yaw = yaw;
  S.cam.pitch = 0;
  S.cam.roll = 0;
}

function resetMission(S) {
  const m = S.mission;
  m.cleared = 0;
  m.score = 0;
  m.time = 0;
  m.running = false;
  m.done = false;
  m.rating = '';
  m.crashes = 0;
  m.toast = '';
  m.toastT = 0;
  m.lastCrash = '';
  S.fx = null;
  placeOnRunway(S);
}

/**
 * Advance the plane one fixed step.
 * ctl: { stickX (-1..1, + = bank right), stickY (-1..1, + = pull up),
 *        rudder, brake } — throttle lives on S.plane.thr, set by input.
 */
function stepFlight(S, dt, ctl) {
  const p = S.plane;
  const m = S.mission;
  const events = [];
  if (m.toastT > 0) m.toastT -= dt;
  p.prop += dt * (8 + p.thr * 60 + p.speed * 0.2);

  if (p.crashed > 0) {
    p.crashed -= dt;
    if (S.fx) S.fx.t += dt;
    if (p.crashed <= 0) {
      S.fx = null;
      respawn(S);
    }
    return events;
  }

  p.prev = [p.x, p.y, p.z];
  const drag = PLANE.DRAG * p.speed * p.speed;

  if (p.onGround) {
    p.roll = 0;
    const steer = (ctl.stickX * 0.55 + ctl.rudder * 0.35) * Math.min(1, p.speed / 9);
    p.yaw += steer * dt;
    const acc = p.thr * PLANE.THRUST - drag - (p.speed > 0.2 ? 1.1 : 0) - (ctl.brake ? 11 : 0);
    p.speed = Math.max(0, p.speed + acc * dt);
    if (p.speed > PLANE.ROTATE_SPEED) p.pitch += ctl.stickY * 0.6 * dt;
    else p.pitch += (0 - p.pitch) * dt * 3;
    p.pitch = Math.min(0.5, Math.max(0, p.pitch));
    p.x += p.speed * Math.sin(p.yaw) * dt;
    p.z += p.speed * Math.cos(p.yaw) * dt;
    p.y = groundHeight(p.x, p.z) + 1;
    p.vy = 0;
    if (p.speed > PLANE.LIFTOFF_SPEED && p.pitch > 0.07) {
      p.onGround = false;
      p.y += 0.4;
      m.running = true;
      events.push({ type: 'takeoff' });
    }
  } else {
    p.roll += ctl.stickX * PLANE.ROLL_RATE * dt;
    if (Math.abs(ctl.stickX) < 0.05) p.roll *= Math.exp(-0.55 * dt);
    p.roll = Math.min(PLANE.MAX_ROLL, Math.max(-PLANE.MAX_ROLL, p.roll));
    p.pitch += ctl.stickY * PLANE.PITCH_RATE * dt;
    const stall = Math.min(1, Math.max(0, (PLANE.STALL_SPEED - p.speed) / 14));
    if (stall > 0) p.pitch -= stall * 0.55 * dt;
    if (Math.abs(p.roll) > 0.6) p.pitch -= (Math.abs(p.roll) - 0.6) * 0.22 * dt;
    p.pitch = Math.min(PLANE.MAX_PITCH, Math.max(-1.2, p.pitch));
    const vSafe = Math.max(p.speed, 22);
    const turn = Math.min(1.3, Math.max(-1.3, (PLANE.TURN_G * Math.tan(p.roll)) / vSafe * 1.15 + ctl.rudder * 0.35));
    p.yaw += turn * dt;
    const acc = p.thr * PLANE.THRUST - drag - PLANE.GRAV * Math.sin(p.pitch) * 0.85 - (ctl.brake ? 6 : 0);
    p.speed = Math.max(0, p.speed + acc * dt);
    const cp = Math.cos(p.pitch);
    p.vy = p.speed * Math.sin(p.pitch) - stall * stall * 26;
    p.x += p.speed * cp * Math.sin(p.yaw) * dt;
    p.z += p.speed * cp * Math.cos(p.yaw) * dt;
    p.y += p.vy * dt;
    if (p.speed < PLANE.STALL_SPEED) events.push({ type: 'stallwarn' });

    const g = groundHeight(p.x, p.z);
    if (p.y - g < 1) {
      const onStrip = Math.abs(p.x) < WORLD.RUNWAY_HALF_W + 14 && Math.abs(p.z) < WORLD.RUNWAY_HALF_LEN + 40;
      const gentle = onStrip && p.vy > -7 && Math.abs(p.roll) < 0.45 && p.pitch > -0.22 && p.pitch < 0.36 && p.speed < 95;
      if (gentle) {
        p.onGround = true;
        p.y = g + 1;
        p.roll = 0;
        p.pitch = Math.max(0, p.pitch * 0.3);
        events.push({ type: 'land', smooth: p.vy > -2.5 });
      } else {
        const msg = onStrip
          ? 'Too hard — wings level, ease the descent'
          : (g <= 0.2 ? 'Splash — the sea has no runway' : 'Terrain impact');
        p.crashed = PLANE.CRASH_TIME;
        p.speed = 0;
        m.crashes += 1;
        m.lastCrash = msg;
        S.fx = { x: p.x, y: p.y, z: p.z, t: 0 };
        events.push({ type: 'crash', msg });
      }
    }

    if (m.cleared < S.course.length) {
      const ring = S.course[m.cleared];
      const nx = Math.sin(ring.yaw);
      const nz = Math.cos(ring.yaw);
      const a0 = (p.prev[0] - ring.x) * nx + (p.prev[2] - ring.z) * nz;
      const a1 = (p.x - ring.x) * nx + (p.z - ring.z) * nz;
      if (a0 < 0 && a1 >= 0) {
        const t = -a0 / (a1 - a0);
        const px = (p.prev[0] + (p.x - p.prev[0]) * t) - ring.x;
        const py = (p.prev[1] + (p.y - p.prev[1]) * t) - ring.y;
        const pz = (p.prev[2] + (p.z - p.prev[2]) * t) - ring.z;
        const off = Math.hypot(px, py, pz);
        if (off < WORLD.RING_RADIUS) {
          const bonus = Math.round(Math.min(1, Math.max(0, 1 - off / WORLD.RING_RADIUS)) * SCORE.BULLSEYE_MAX);
          const gained = SCORE.RING + bonus;
          m.score += gained;
          m.cleared += 1;
          events.push({ type: 'ring', ring: m.cleared, gained, bullseye: off < 14 });
          if (m.cleared >= S.course.length) events.push({ type: 'allrings' });
        }
      }
    }
  }

  if (m.running && !m.done) m.time += dt;
  if (m.cleared >= S.course.length && p.onGround && p.speed < 4 && !m.done) {
    m.done = true;
    m.score += SCORE.LANDING_BONUS;
    m.rating = m.time < SCORE.RATING_S ? 'S' : m.time < SCORE.RATING_A ? 'A' : 'B';
    events.push({ type: 'done', rating: m.rating });
  }

  // Chase camera eases after the plane so it never fights the pilot.
  S.cam.yaw += angDiff(p.yaw, S.cam.yaw) * Math.min(1, dt * 5);
  S.cam.pitch += (p.pitch * 0.5 - S.cam.pitch) * Math.min(1, dt * 4);
  S.cam.roll += (p.roll * 0.55 - S.cam.roll) * Math.min(1, dt * 4);
  return events;
}

/* ---------------- software 3D renderer ---------------- */

const NEAR = 1.2;
const LIGHT = SUN_DIR;
const RING_SEG = 26;

/** Yaw/pitch/roll basis: forward, right and up unit vectors. */
function makeBasis(yaw, pitch, roll) {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const f = [cp * sy, sp, cp * cy];
  const r0 = [cy, 0, -sy];
  const u0 = [
    f[1] * r0[2] - f[2] * r0[1],
    f[2] * r0[0] - f[0] * r0[2],
    f[0] * r0[1] - f[1] * r0[0],
  ];
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  // Roll the right/up pair around the forward axis, component by component.
  const r = [0, 1, 2].map((i) => r0[i] * cr - u0[i] * sr);
  const u = [0, 1, 2].map((i) => u0[i] * cr + r0[i] * sr);
  return { f, r, u };
}

/** Cross product of two 3-vectors, as [x, y, z]. */
function cross3(ax, ay, az, bx, by, bz) {
  return [
    ay * bz - az * by,
    az * bx - ax * bz,
    ax * by - ay * bx,
  ];
}

/** Per-frame view: camera position + basis + screen mapping + scratch. */
class View {
  constructor(ctx, W, H) {
    this.ctx = ctx;
    this.W = W;
    this.H = H;
    this.cx = W / 2;
    this.cy = H * 0.42;
    this.foc = H * 0.95;
    this.pos = [0, 0, 0];
    this.f = [0, 0, 1];
    this.r = [1, 0, 0];
    this.u = [0, 1, 0];
    this.buf = new Float64Array(3 * 48);
    this.buf2 = new Float64Array(3 * 48);
  }

  toCam(x, y, z) {
    const dx = x - this.pos[0];
    const dy = y - this.pos[1];
    const dz = z - this.pos[2];
    return [
      dx * this.r[0] + dy * this.r[1] + dz * this.r[2],
      dx * this.u[0] + dy * this.u[1] + dz * this.u[2],
      dx * this.f[0] + dy * this.f[1] + dz * this.f[2],
    ];
  }

  /** Clip a polygon (camera-space xyz triples in buf) against the near plane. */
  clipNear(n) {
    const src = this.buf;
    const dst = this.buf2;
    let m = 0;
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      const az = src[i * 3 + 2];
      const bz = src[j * 3 + 2];
      const ain = az >= NEAR;
      const bin = bz >= NEAR;
      if (ain) {
        dst[m * 3] = src[i * 3];
        dst[m * 3 + 1] = src[i * 3 + 1];
        dst[m * 3 + 2] = az;
        m += 1;
      }
      if (ain !== bin) {
        const t = (NEAR - az) / (bz - az);
        const ix = src[i * 3];
        const iy = src[i * 3 + 1];
        const jx = src[j * 3];
        const jy = src[j * 3 + 1];
        dst[m * 3] = ix + (jx - ix) * t;
        dst[m * 3 + 1] = iy + (jy - iy) * t;
        dst[m * 3 + 2] = NEAR;
        m += 1;
      }
    }
    return m;
  }

  /** Fill a world-space polygon. pts is a flat [x,y,z,...] list. */
  fillWorld(pts, r, g, b, alpha, hazeDepth, stroke = false) {
    const n = pts.length / 3;
    let anyIn = false;
    let allIn = true;
    for (let i = 0; i < n; i += 1) {
      const c = this.toCam(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
      this.buf[i * 3] = c[0];
      this.buf[i * 3 + 1] = c[1];
      this.buf[i * 3 + 2] = c[2];
      if (c[2] >= NEAR) anyIn = true;
      else allIn = false;
    }
    if (!anyIn) return;
    let src = this.buf;
    let m = n;
    if (!allIn) {
      m = this.clipNear(n);
      src = this.buf2;
      if (m < 3) return;
    }
    if (hazeDepth !== undefined) {
      const f = sstep(WORLD.HAZE_NEAR, WORLD.HAZE_FAR, hazeDepth);
      r += (WORLD.HAZE[0] - r) * f;
      g += (WORLD.HAZE[1] - g) * f;
      b += (WORLD.HAZE[2] - b) * f;
    }
    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = 0; i < m; i += 1) {
      const z = src[i * 3 + 2];
      const sx = this.cx + (src[i * 3] / z) * this.foc;
      const sy = this.cy - (src[i * 3 + 1] / z) * this.foc;
      if (i) ctx.lineTo(sx, sy);
      else ctx.moveTo(sx, sy);
    }
    ctx.closePath();
    if (alpha < 1) ctx.globalAlpha = alpha;
    ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (alpha < 1) ctx.globalAlpha = 1;
  }

  /** Project a world point to screen; returns null when behind the camera. */
  project(x, y, z) {
    const c = this.toCam(x, y, z);
    if (c[2] < 1) return null;
    return {
      x: this.cx + (c[0] / c[2]) * this.foc,
      y: this.cy - (c[1] / c[2]) * this.foc,
      d: Math.hypot(c[0], c[1], c[2]),
      z: c[2],
    };
  }
}

/* ---------------- sky ---------------- */

function drawSky(view, S) {
  const ctx = view.ctx;
  const { W, H } = view;
  const yawC = S.view === 'cockpit' ? S.plane.yaw : S.cam.yaw;
  // Two far points on the horizon line, left and right of the view.
  const ends = [];
  for (const da of [0.9, -0.9]) {
    const dx = Math.sin(yawC + da);
    const dz = Math.cos(yawC + da);
    const X = dx * view.r[0] + dz * view.r[2];
    const Y = dx * view.u[0] + dz * view.u[2];
    const Z = dx * view.f[0] + dz * view.f[2];
    const zz = Math.max(Z, 0.05);
    ends.push([view.cx + (X / zz) * view.foc, view.cy - (Y / zz) * view.foc]);
  }
  const mx = (ends[0][0] + ends[1][0]) / 2;
  const my = (ends[0][1] + ends[1][1]) / 2;
  // Screen direction toward the ground: project a point below the camera.
  const below = view.project(view.pos[0], view.pos[1] - 400, view.pos[2]);
  let nx = 0;
  let ny = 1;
  if (below) {
    const dx = below.x - mx;
    const dy = below.y - my;
    const len = Math.hypot(dx, dy) || 1;
    nx = dx / len;
    ny = dy / len;
  }
  const grad = ctx.createLinearGradient(mx, my, mx - nx * H * 1.1, my - ny * H * 1.1);
  grad.addColorStop(0, `rgb(${WORLD.HAZE[0]},${WORLD.HAZE[1]},${WORLD.HAZE[2]})`);
  grad.addColorStop(0.3, `rgb(${WORLD.SKY_MID[0]},${WORLD.SKY_MID[1]},${WORLD.SKY_MID[2]})`);
  grad.addColorStop(1, `rgb(${WORLD.SKY_TOP[0]},${WORLD.SKY_TOP[1]},${WORLD.SKY_TOP[2]})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  // Sun glow.
  const s = view.toCam(
    view.pos[0] + LIGHT[0] * 1000,
    view.pos[1] + LIGHT[1] * 1000,
    view.pos[2] + LIGHT[2] * 1000,
  );
  if (s[2] > 0.05) {
    const px = view.cx + (s[0] / s[2]) * view.foc;
    const py = view.cy - (s[1] / s[2]) * view.foc;
    const glowR = H * 0.32;
    const rg = ctx.createRadialGradient(px, py, 0, px, py, glowR);
    rg.addColorStop(0, 'rgba(255,250,225,0.95)');
    rg.addColorStop(0.12, 'rgba(255,240,200,0.55)');
    rg.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(px - H * 0.35, py - H * 0.35, H * 0.7, H * 0.7);
    ctx.fillStyle = '#fffbe8';
    ctx.beginPath();
    ctx.arc(px, py, H * 0.022, 0, TAU);
    ctx.fill();
  }
  // Haze sheet on the ground side of the horizon.
  const ex = -ny;
  const ey = nx;
  const L = Math.max(W, H) * 1.4;
  ctx.fillStyle = `rgb(${WORLD.HAZE[0]},${WORLD.HAZE[1]},${WORLD.HAZE[2]})`;
  ctx.beginPath();
  ctx.moveTo(mx - ex * L, my - ey * L);
  ctx.lineTo(mx + ex * L, my + ey * L);
  ctx.lineTo(mx + ex * L + nx * L, my + ey * L + ny * L);
  ctx.lineTo(mx - ex * L + nx * L, my - ey * L + ny * L);
  ctx.closePath();
  ctx.fill();
}

/* ---------------- terrain mesh ---------------- */

const CELL = WORLD.GRID_CELL;
const R = WORLD.GRID_R;
const GN = 2 * R + 1;
const VH = new Float32Array(GN * GN);
const VX = new Float32Array(GN * GN);
const VY = new Float32Array(GN * GN);
const VZ = new Float32Array(GN * GN);
const CD = new Float32Array(GN * GN);

function buildGrid(view) {
  const ci = Math.floor(view.pos[0] / CELL);
  const cj = Math.floor(view.pos[2] / CELL);
  const i0 = ci - R;
  const j0 = cj - R;
  for (let a = 0; a < GN; a += 1) {
    for (let b = 0; b < GN; b += 1) {
      const gx = (i0 + a) * CELL;
      const gz = (j0 + b) * CELL;
      const h = groundHeight(gx, gz);
      const idx = a * GN + b;
      VH[idx] = h;
      const c = view.toCam(gx, h, gz);
      VX[idx] = c[0];
      VY[idx] = c[1];
      VZ[idx] = c[2];
    }
  }
  for (let a = 0; a < GN - 1; a += 1) {
    for (let b = 0; b < GN - 1; b += 1) {
      const q0 = a * GN + b;
      const q1 = q0 + GN;
      const q2 = q1 + 1;
      const q3 = q0 + 1;
      const X = (VX[q0] + VX[q1] + VX[q2] + VX[q3]) / 4;
      const Y = (VY[q0] + VY[q1] + VY[q2] + VY[q3]) / 4;
      const Z = (VZ[q0] + VZ[q1] + VZ[q2] + VZ[q3]) / 4;
      CD[q0] = Math.hypot(X, Y, Z);
    }
  }
  return { i0, j0 };
}

function cellColour(view, grid, a, b) {
  const n = GN;
  const q0 = a * n + b;
  const q1 = q0 + n;
  const q2 = q1 + 1;
  const q3 = q0 + 1;
  const h0 = VH[q0];
  const h1 = VH[q1];
  const h2 = VH[q2];
  const h3 = VH[q3];
  const hmax = Math.max(h0, h1, h2, h3);
  const hmin = Math.min(h0, h1, h2, h3);
  const hm = (h0 + h1 + h2 + h3) / 4;
  const hs = latticeHash(a + grid.i0, b + grid.j0);
  let r;
  let g;
  let bl;
  if (hmax <= 0.2) {
    const v = (hs - 0.5) * 10;
    r = WORLD.SEA[0] + v;
    g = WORLD.SEA[1] + v;
    bl = WORLD.SEA[2] + v * 1.2;
  } else if (hmin <= 0.2) {
    r = WORLD.SAND[0];
    g = WORLD.SAND[1];
    bl = WORLD.SAND[2];
  } else {
    const t1 = sstep(10, 70, hm);
    const t2 = sstep(170, 300, hm);
    const t3 = sstep(390, 480, hm);
    r = (116 + (62 - 116) * t1) + (134 - (116 + (62 - 116) * t1)) * t2;
    g = (156 + (112 - 156) * t1) + (118 - (156 + (112 - 156) * t1)) * t2;
    bl = (74 + (54 - 74) * t1) + (102 - (74 + (54 - 74) * t1)) * t2;
    const ex = ((h1 - h0) + (h2 - h3)) / (2 * CELL);
    const ez = ((h3 - h0) + (h2 - h1)) / (2 * CELL);
    const sl = Math.hypot(ex, ez);
    const ln = Math.sqrt(ex * ex + 1 + ez * ez);
    const rk = sstep(0.4, 0.9, sl) * (1 - t3);
    r += (126 - r) * rk;
    g += (112 - g) * rk;
    bl += (98 - bl) * rk;
    r += (238 - r) * t3;
    g += (242 - g) * t3;
    bl += (246 - bl) * t3;
    let sh = 0.5 + 0.62 * ((-ex * LIGHT[0] + LIGHT[1] - ez * LIGHT[2]) / ln) + (hs - 0.5) * 0.12;
    sh = clamp(sh, 0.35, 1.25);
    r *= sh;
    g *= sh;
    bl *= sh;
  }
  return [r, g, bl];
}

function drawCell(view, grid, a, b) {
  const n = GN;
  const q0 = a * n + b;
  const q1 = q0 + n;
  const q2 = q1 + 1;
  const q3 = q0 + 1;
  const [r, g, bl] = cellColour(view, grid, a, b);
  const x0 = (grid.i0 + a) * CELL;
  const x1 = (grid.i0 + a + 1) * CELL;
  const z0 = (grid.j0 + b) * CELL;
  const z1 = (grid.j0 + b + 1) * CELL;
  // Route through fillWorld so cells straddling the camera get near-plane
  // clipped instead of projecting to screen-filling triangles.
  view.fillWorld(
    [x0, VH[q0], z0, x1, VH[q1], z0, x1, VH[q2], z1, x0, VH[q3], z1],
    r, g, bl, 1, CD[q0], true,
  );
}

/* ---------------- world objects ---------------- */

function drawRunwayStrip(view, k) {
  const z0 = -WORLD.RUNWAY_HALF_LEN + 80 * k;
  const z1 = z0 + 80;
  const y = WORLD.RUNWAY_Y + 0.06;
  const xw = WORLD.RUNWAY_HALF_W;
  const zc = (z0 + z1) / 2;
  const d = Math.hypot(0 - view.pos[0], y - view.pos[1], zc - view.pos[2]);
  view.fillWorld([-xw, y, z0, xw, y, z0, xw, y, z1, -xw, y, z1], 58, 62, 68, 1, d, true);
  const y2 = y + 0.04;
  view.fillWorld([-xw, y2, z0, -xw + 1.1, y2, z0, -xw + 1.1, y2, z1, -xw, y2, z1], 232, 232, 226, 1, d, true);
  view.fillWorld([xw - 1.1, y2, z0, xw, y2, z0, xw, y2, z1, xw - 1.1, y2, z1], 232, 232, 226, 1, d, true);
  if (k % 2 === 0) {
    view.fillWorld([-0.9, y2, z0 + 20, 0.9, y2, z0 + 20, 0.9, y2, z0 + 60, -0.9, y2, z0 + 60], 236, 236, 228, 1, d, true);
  }
  if (k === 0 || k === 14) {
    const zb0 = k === 0 ? z0 + 6 : z1 - 22;
    const zb1 = zb0 + 16;
    for (let i = 0; i < 6; i += 1) {
      for (const s of [-1, 1]) {
        const xa = s * (5 + i * 3.6);
        const xb = xa + s * 2;
        view.fillWorld([xa, y2, zb0, xb, y2, zb0, xb, y2, zb1, xa, y2, zb1], 238, 238, 232, 1, d, true);
      }
    }
  }
}

function drawBuilding(view, bd) {
  const x0 = bd.cx - bd.w / 2;
  const x1 = bd.cx + bd.w / 2;
  const z0 = bd.cz - bd.d / 2;
  const z1 = bd.cz + bd.d / 2;
  const y0 = bd.y;
  const y1 = bd.y + bd.h;
  const faces = [
    [[0, 1, 0],
     [x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1],
     bd.roof],
    [[1, 0, 0],
     [x1, y0, z0, x1, y0, z1, x1, y1, z1, x1, y1, z0],
     bd.wall],
    [[-1, 0, 0],
     [x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0],
     bd.wall],
    [[0, 0, 1],
     [x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1],
     bd.wall],
    [[0, 0, -1],
     [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0],
     bd.wall],
  ];
  const d = Math.hypot(bd.cx - view.pos[0], (y0 + y1) / 2 - view.pos[1], bd.cz - view.pos[2]);
  for (const [nrm, pts, col] of faces) {
    const fx = (pts[0] + pts[6]) / 2;
    const fy = (pts[1] + pts[7]) / 2;
    const fz = (pts[2] + pts[8]) / 2;
    if ((view.pos[0] - fx) * nrm[0] + (view.pos[1] - fy) * nrm[1] + (view.pos[2] - fz) * nrm[2] <= 0) continue;
    const sh = 0.55 + 0.5 * Math.max(0, nrm[0] * LIGHT[0] + nrm[1] * LIGHT[1] + nrm[2] * LIGHT[2]);
    view.fillWorld(pts, col[0] * sh, col[1] * sh, col[2] * sh, 1, d, true);
  }
}

function drawTree(view, x, z, hgt, hs) {
  const gh = groundHeight(x, z);
  const base = view.project(x, gh, z);
  if (!base || base.z < 8) return;
  const sx = base.x;
  const sy = base.y;
  const k = view.foc / base.z;
  const hh = hgt * k;
  const w = hgt * 0.3 * k;
  if (sx < -60 || sx > view.W + 60 || sy < -40 || sy - hh > view.H + 40) return;
  const f = sstep(WORLD.HAZE_NEAR, WORLD.HAZE_FAR, base.d);
  const mix = (v, h) => v + (h - v) * f;
  const gcol = 0.8 + hs * 0.35;
  const ctx = view.ctx;
  ctx.fillStyle = `rgb(${mix(82, WORLD.HAZE[0]) | 0},${mix(60, WORLD.HAZE[1]) | 0},${mix(40, WORLD.HAZE[2]) | 0})`;
  const trunkW = w * 0.24;
  const trunkH = hh * 0.22;
  ctx.fillRect(sx - w * 0.12, sy - hh * 0.22, trunkW, trunkH);
  for (let t = 0; t < 3; t += 1) {
    const yb = sy - hh * (0.16 + t * 0.26);
    const yt = yb - hh * 0.5;
    const ww = w * (1 - t * 0.28);
    ctx.fillStyle = `rgb(${mix(38 * gcol, WORLD.HAZE[0]) | 0},${mix(92 * gcol, WORLD.HAZE[1]) | 0},${mix(52 * gcol, WORLD.HAZE[2]) | 0})`;
    ctx.beginPath();
    ctx.moveTo(sx - ww, yb);
    ctx.lineTo(sx + ww, yb);
    ctx.lineTo(sx, yt);
    ctx.closePath();
    ctx.fill();
  }
}

function drawCloud(view, c) {
  const tile = WORLD.CLOUD_TILE;
  const wx = c.x + Math.round((view.pos[0] - c.x) / tile) * tile;
  const wz = c.z + Math.round((view.pos[2] - c.z) / tile) * tile;
  const p = view.project(wx, c.y, wz);
  if (!p || p.z < 200 || p.z > 11000) return;
  const rr = (c.r * view.foc) / p.z;
  if (p.x < -rr * 2 || p.x > view.W + rr * 2 || p.y < -rr || p.y > view.H + rr) return;
  const f = sstep(3000, 10000, p.d);
  const col = (v, h) => (v + (h - v) * f) | 0;
  const ctx = view.ctx;
  const parts = [
    [0, 0, 1], [-0.9, 0.12, 0.7], [0.95, 0.1, 0.75],
    [0.35, -0.25, 0.8], [-0.4, -0.2, 0.6],
  ];
  ctx.globalAlpha = 0.92 * (1 - f * 0.5);
  for (const pt of parts) {
    ctx.fillStyle = `rgb(${col(228, WORLD.HAZE[0])},${col(234, WORLD.HAZE[1])},${col(242, WORLD.HAZE[2])})`;
    ctx.beginPath();
    ctx.ellipse(p.x + pt[0] * rr * 1.2, p.y + pt[1] * rr * 0.4, rr * pt[2] * 0.9, rr * pt[2] * 0.42, 0, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = `rgb(${col(168, WORLD.HAZE[0])},${col(184, WORLD.HAZE[1])},${col(206, WORLD.HAZE[2])})`;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y + rr * 0.22, rr * 1.5, rr * 0.2, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawRing(view, S, i) {
  const ring = S.course[i];
  const a0 = Math.cos(ring.yaw);
  const a2 = -Math.sin(ring.yaw);
  const pulse = 0.5 + 0.5 * Math.sin(S.now * 0.006);
  let col;
  let alpha;
  if (i < S.mission.cleared) {
    col = [96, 214, 150];
    alpha = 0.4;
  } else if (i === S.mission.cleared) {
    col = [255, 170 + 50 * pulse, 56];
    alpha = 0.96;
  } else {
    col = [92, 196, 255];
    alpha = 0.7;
  }
  const SEG = RING_SEG;
  const Ro = WORLD.RING_RADIUS + 3;
  const Ri = WORLD.RING_RADIUS - 6;
  const dc = Math.hypot(ring.x - view.pos[0], ring.y - view.pos[1], ring.z - view.pos[2]);
  if (i === S.mission.cleared) {
    const disc = [];
    for (let k = 0; k < SEG; k += 1) {
      const t = (k / SEG) * TAU;
      disc.push(ring.x + a0 * Ro * Math.cos(t), ring.y + Ro * Math.sin(t), ring.z + a2 * Ro * Math.cos(t));
    }
    view.fillWorld(disc, 255, 190, 80, 0.12, undefined, false);
  }
  const segs = [];
  for (let k = 0; k < SEG; k += 1) {
    const t0 = (k / SEG) * TAU;
    const t1 = ((k + 1) / SEG) * TAU;
    const tm = (t0 + t1) / 2;
    const mxp = ring.x + a0 * WORLD.RING_RADIUS * Math.cos(tm);
    const myp = ring.y + WORLD.RING_RADIUS * Math.sin(tm);
    const mzp = ring.z + a2 * WORLD.RING_RADIUS * Math.cos(tm);
    segs.push({ k, t0, t1, d: Math.hypot(mxp - view.pos[0], myp - view.pos[1], mzp - view.pos[2]) });
  }
  segs.sort((a, b) => b.d - a.d);
  for (const s of segs) {
    const quad = [
      ring.x + a0 * Ro * Math.cos(s.t0), ring.y + Ro * Math.sin(s.t0), ring.z + a2 * Ro * Math.cos(s.t0),
      ring.x + a0 * Ro * Math.cos(s.t1), ring.y + Ro * Math.sin(s.t1), ring.z + a2 * Ro * Math.cos(s.t1),
      ring.x + a0 * Ri * Math.cos(s.t1), ring.y + Ri * Math.sin(s.t1), ring.z + a2 * Ri * Math.cos(s.t1),
      ring.x + a0 * Ri * Math.cos(s.t0), ring.y + Ri * Math.sin(s.t0), ring.z + a2 * Ri * Math.cos(s.t0),
    ];
    const shade = 0.8 + 0.2 * Math.cos(s.k * 0.7);
    view.fillWorld(quad, col[0] * shade, col[1] * shade, col[2] * shade, alpha, dc, false);
  }
}

/* ---------------- the Kestrel ---------------- */

const MODEL = (() => {
  const TOP = [34, 128, 146];
  const SIDE = [26, 104, 122];
  const BELLY = [18, 74, 90];
  const ORANGE = [244, 124, 40];
  const WING_TOP = [240, 234, 216];
  const WING_BOT = [186, 194, 200];
  const GLASS = [96, 150, 190];
  const faces = [];
  const add = (pts, c) => faces.push({ p: pts, c });
  // Fuselage loft: five stations from nose to tail.
  const stations = [
    { z: 4.6, w: 0.18, top: 0.18, bot: 0.18, y: 0 },
    { z: 3.4, w: 0.55, top: 0.58, bot: 0.5, y: 0.04 },
    { z: 1.2, w: 0.8, top: 0.88, bot: 0.58, y: 0.08 },
    { z: -1.6, w: 0.58, top: 0.6, bot: 0.38, y: 0.16 },
    { z: -4.8, w: 0.1, top: 0.12, bot: 0.1, y: 0.3 },
  ];
  for (let i = 0; i < stations.length - 1; i += 1) {
    const a = stations[i];
    const b = stations[i + 1];
    const TLa = [-a.w, a.y + a.top, a.z];
    const TRa = [a.w, a.y + a.top, a.z];
    const BRa = [a.w, a.y - a.bot, a.z];
    const BLa = [-a.w, a.y - a.bot, a.z];
    const TLb = [-b.w, b.y + b.top, b.z];
    const TRb = [b.w, b.y + b.top, b.z];
    const BRb = [b.w, b.y - b.bot, b.z];
    const BLb = [-b.w, b.y - b.bot, b.z];
    const top = i === 0 ? ORANGE : TOP;
    const side = i === 0 ? ORANGE : SIDE;
    add([...TLa, ...TRa, ...TRb, ...TLb], top);
    add([...TRa, ...BRa, ...BRb, ...TRb], side);
    add([...TLa, ...BLa, ...BLb, ...TLb], side);
    add([...BLa, ...BRa, ...BRb, ...BLb], BELLY);
  }
  for (const s of [1, -1]) {
    // Main wings with orange tips.
    add([0.6 * s, 0, 1.9, 5.6 * s, 0.45, 1.0, 5.6 * s, 0.45, 0.1, 0.6 * s, 0, -0.6], WING_TOP);
    add([0.6 * s, -0.08, 1.9, 5.6 * s, 0.37, 1.0, 5.6 * s, 0.37, 0.1, 0.6 * s, -0.08, -0.6], WING_BOT);
    add([5.0 * s, 0.41, 1.08, 5.6 * s, 0.45, 1.0, 5.6 * s, 0.45, 0.1, 5.0 * s, 0.41, 0.14], ORANGE);
    // Tailplane.
    add([0.3 * s, 0.34, -4.1, 2.3 * s, 0.4, -4.5, 2.3 * s, 0.4, -5.1, 0.2 * s, 0.34, -5.0], WING_TOP);
  }
  // Fin + rudder stripe, canopy glass.
  add(
    [0, 0.35, -3.5, 0, 1.95, -4.9, 0, 1.95, -5.3, 0, 0.35, -5.1],
    TOP,
  );
  add([0, 1.45, -4.55, 0, 1.95, -4.9, 0, 1.95, -5.3, 0, 1.45, -5.2], ORANGE);
  add([-0.4, 0.98, 1.3, 0.4, 0.98, 1.3, 0.3, 1.24, 0.5, -0.3, 1.24, 0.5], GLASS);
  add([-0.3, 1.24, 0.5, 0.3, 1.24, 0.5, 0.28, 1.2, -0.5, -0.28, 1.2, -0.5], GLASS);
  add([0.4, 0.98, 1.3, 0.3, 1.24, 0.5, 0.28, 1.2, -0.5, 0.4, 0.9, -1.2], GLASS);
  add([-0.4, 0.98, 1.3, -0.3, 1.24, 0.5, -0.28, 1.2, -0.5, -0.4, 0.9, -1.2], GLASS);
  return faces;
})();

function drawPlane(view, S) {
  const p = S.plane;
  const B = makeBasis(p.yaw, p.pitch, p.roll);
  const toWorld = (lx, ly, lz) => [
    p.x + B.r[0] * lx + B.u[0] * ly + B.f[0] * lz,
    p.y + B.r[1] * lx + B.u[1] * ly + B.f[1] * lz,
    p.z + B.r[2] * lx + B.u[2] * ly + B.f[2] * lz,
  ];
  const parts = [];
  const pushFace = (pts, c, alpha = 1) => {
    const w = [];
    let cx = 0;
    let cy = 0;
    let cz = 0;
    const n = pts.length / 3;
    for (let i = 0; i < n; i += 1) {
      const q = toWorld(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
      w.push(q[0], q[1], q[2]);
      cx += q[0];
      cy += q[1];
      cz += q[2];
    }
    parts.push({ w, c, a: alpha, d: Math.hypot(cx / n - view.pos[0], cy / n - view.pos[1], cz / n - view.pos[2]) });
  };
  for (const m of MODEL) pushFace(m.p, m.c);
  if (p.onGround || p.y - groundHeight(p.x, p.z) < 45) {
    for (const g of [[1.1, 0.9], [-1.1, 0.9], [0, -3.6]]) {
      const lz = g[1];
      const lx = g[0];
      const ly = lz < 0 ? -0.55 : -0.95;
      const r = lz < 0 ? 0.2 : 0.3;
      pushFace([lx - 0.25, ly + r, lz, lx + 0.25, ly + r, lz, lx + 0.25, ly - r, lz, lx - 0.25, ly - r, lz], [26, 26, 30]);
      pushFace([lx - 0.05, ly + r, lz - 0.2, lx + 0.05, ly + r, lz - 0.2, lx + 0.05, 0.0, lz - 0.1, lx - 0.05, 0.0, lz - 0.1], [90, 96, 104]);
    }
  }
  parts.sort((a, b) => b.d - a.d);
  for (const part of parts) {
    const w = part.w;
    const p0 = [w[0], w[1], w[2]];
    const p1 = [w[3], w[4], w[5]];
    const p2 = [w[6], w[7], w[8]];
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const nrm = cross3(e1[0], e1[1], e1[2], e2[0], e2[1], e2[2]);
    const nl = Math.hypot(nrm[0], nrm[1], nrm[2]) || 1;
    const nx = nrm[0] / nl;
    const ny = nrm[1] / nl;
    const nz = nrm[2] / nl;
    const facing = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2];
    const sh = 0.62 + 0.45 * Math.abs(facing);
    view.fillWorld(w, part.c[0] * sh, part.c[1] * sh, part.c[2] * sh, part.a, undefined, true);
  }
  // Propeller: faint disc + two spinning blades.
  const nose = 4.65;
  const disc = [];
  for (let i = 0; i < 14; i += 1) {
    const a = (i / 14) * TAU;
    const q = toWorld(Math.cos(a) * 1.55, Math.sin(a) * 1.55, nose);
    disc.push(q[0], q[1], q[2]);
  }
  view.fillWorld(disc, 226, 234, 238, 0.14, undefined, false);
  for (let k = 0; k < 2; k += 1) {
    const a = p.prop + k * Math.PI;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const len = 1.5;
    const wd = 0.1;
    const blade = [];
    for (const [px, py] of [[0, -wd], [len, -wd], [len, wd], [0, wd]]) {
      const q = toWorld(px * ca - py * sa, px * sa + py * ca, nose);
      blade.push(q[0], q[1], q[2]);
    }
    view.fillWorld(blade, 24, 24, 28, 0.55, undefined, false);
  }
}

function drawShadow(view, S) {
  const p = S.plane;
  const gh = groundHeight(p.x, p.z) + 0.25;
  const s = Math.sin(p.yaw);
  const c = Math.cos(p.yaw);
  const pts = [];
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * TAU;
    const lx = Math.cos(a) * 6.2;
    const lz = Math.sin(a) * 3.4;
    pts.push(p.x + lx * c + lz * s, gh, p.z - lx * s + lz * c);
  }
  const alt = clamp((p.y - gh) / 300, 0, 1);
  view.fillWorld(pts, 10, 18, 22, 0.38 * (1 - alt * 0.6), undefined, false);
}

function drawCrashFx(view, S) {
  const fx = S.fx;
  if (!fx) return;
  const p = view.project(fx.x, fx.y, fx.z);
  if (!p) return;
  const ctx = view.ctx;
  const k = view.foc / p.z;
  const t = fx.t;
  for (let i = 0; i < 5; i += 1) {
    const rr = (10 + t * (30 + i * 12)) * k;
    const a = clamp(1 - t / 2.4, 0, 1) * 0.55;
    ctx.globalAlpha = a;
    ctx.fillStyle = i % 2 ? '#ff8a2a' : '#ffd36a';
    ctx.beginPath();
    ctx.arc(p.x + Math.sin(i * 2.3) * rr * 0.5, p.y - rr * 0.3 * i * 0.4, rr, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/* ---------------- frame ---------------- */

function setCamera(view, S) {
  const p = S.plane;
  if (S.view === 'cockpit') {
    const B = makeBasis(p.yaw, p.pitch, p.roll);
    view.pos = [
      p.x + B.u[0] * 1.15 + B.f[0] * 1.1,
      p.y + B.u[1] * 1.15 + B.f[1] * 1.1,
      p.z + B.u[2] * 1.15 + B.f[2] * 1.1,
    ];
    view.f = B.f;
    view.r = B.r;
    view.u = B.u;
  } else {
    const B = makeBasis(S.cam.yaw, S.cam.pitch, S.cam.roll);
    view.pos = [
      p.x - B.f[0] * 26 + B.u[0] * 5.2,
      p.y - B.f[1] * 26 + B.u[1] * 5.2,
      p.z - B.f[2] * 26 + B.u[2] * 5.2,
    ];
    const gmin = groundHeight(view.pos[0], view.pos[2]) + 3;
    if (view.pos[1] < gmin) view.pos[1] = gmin;
    view.f = B.f;
    view.r = B.r;
    view.u = B.u;
  }
}

function cellDepth(x0, z0, x1, z1, grid) {
  let best = 1e9;
  const i0 = Math.floor(x0 / CELL);
  const i1 = Math.floor(x1 / CELL);
  const j0 = Math.floor(z0 / CELL);
  const j1 = Math.floor(z1 / CELL);
  for (let i = i0; i <= i1; i += 1) {
    for (let j = j0; j <= j1; j += 1) {
      const a = i - grid.i0;
      const b = j - grid.j0;
      if (a < 0 || b < 0 || a >= GN - 1 || b >= GN - 1) continue;
      const d = CD[a * GN + b];
      if (d < best) best = d;
    }
  }
  return best - 4;
}

function drawFrame(ctx, S) {
  const W = S.w;
  const H = S.h;
  const view = new View(ctx, W, H);
  setCamera(view, S);
  ctx.clearRect(0, 0, W, H);
  drawSky(view, S);
  const grid = buildGrid(view);
  const n = GN;
  const depths = [];
  const keys = [];
  const fns = [];
  for (let a = 0; a < n - 1; a += 1) {
    for (let b = 0; b < n - 1; b += 1) {
      const q0 = a * n + b;
      const q1 = q0 + n;
      const q2 = q1 + 1;
      const q3 = q0 + 1;
      const z0 = VZ[q0];
      const z1 = VZ[q1];
      const z2 = VZ[q2];
      const z3 = VZ[q3];
      if (z0 < 0.5 && z1 < 0.5 && z2 < 0.5 && z3 < 0.5) continue;
      if (z0 > 0.5 && z1 > 0.5 && z2 > 0.5 && z3 > 0.5) {
        const s0 = view.cx + (VX[q0] / z0) * view.foc;
        const s1 = view.cx + (VX[q1] / z1) * view.foc;
        const s2 = view.cx + (VX[q2] / z2) * view.foc;
        const s3 = view.cx + (VX[q3] / z3) * view.foc;
        const offLeft = s0 < -90 && s1 < -90 && s2 < -90 && s3 < -90;
        const offRight = s0 > W + 90 && s1 > W + 90 && s2 > W + 90 && s3 > W + 90;
        if (offLeft || offRight) continue;
        const y0 = view.cy - (VY[q0] / z0) * view.foc;
        const y1 = view.cy - (VY[q1] / z1) * view.foc;
        const y2 = view.cy - (VY[q2] / z2) * view.foc;
        const y3 = view.cy - (VY[q3] / z3) * view.foc;
        const above = y0 < -90 && y1 < -90 && y2 < -90 && y3 < -90;
        const below = y0 > H + 90 && y1 > H + 90 && y2 > H + 90 && y3 > H + 90;
        if (above || below) continue;
      }
      depths.push(CD[q0]);
      keys.push(a * n + b);
    }
  }
  const addObj = (d, fn) => {
    if (d > 1e8) return;
    depths.push(d);
    keys.push(-fns.length - 1);
    fns.push(fn);
  };
  for (let k = 0; k < 15; k += 1) {
    const z0 = -WORLD.RUNWAY_HALF_LEN + 80 * k;
    addObj(cellDepth(-WORLD.RUNWAY_HALF_W, z0, WORLD.RUNWAY_HALF_W, z0 + 80, grid) - 0.5, () => drawRunwayStrip(view, k));
  }
  const p = S.plane;
  addObj(cellDepth(p.x - 8, p.z - 8, p.x + 8, p.z + 8, grid) - 0.5, () => drawShadow(view, S));
  for (const bd of BUILDINGS) {
    if (Math.hypot(bd.cx - view.pos[0], bd.cz - view.pos[2]) > 5200) continue;
    addObj(cellDepth(bd.cx - bd.w / 2, bd.cz - bd.d / 2, bd.cx + bd.w / 2, bd.cz + bd.d / 2, grid) - 1, () => drawBuilding(view, bd));
  }
  const ci = Math.floor(view.pos[0] / CELL);
  const cj = Math.floor(view.pos[2] / CELL);
  const TR = 20;
  for (let i = ci - TR; i <= ci + TR; i += 1) {
    for (let j = cj - TR; j <= cj + TR; j += 1) {
      const hs = latticeHash(i + 777, j - 313);
      if (hs < 0.74) continue;
      const x = (i + latticeHash(i, j + 1)) * CELL;
      const z = (j + latticeHash(i + 5, j)) * CELL;
      if (Math.abs(x) < 120 && Math.abs(z) < 700) continue;
      const gh = groundHeight(x, z);
      if (gh < 14 || gh > 230) continue;
      if (x > 700 && x < 1450 && z > -480 && z < 520) continue;
      const dd = Math.hypot(x - view.pos[0], gh - view.pos[1], z - view.pos[2]);
      if (dd > 3300) continue;
      addObj(cellDepth(x, z, x, z, grid) - 1, () => drawTree(view, x, z, 14 + hs * 12, hs));
    }
  }
  for (const c of CLOUDS) {
    const tile = WORLD.CLOUD_TILE;
    const wx = c.x + Math.round((view.pos[0] - c.x) / tile) * tile;
    const wz = c.z + Math.round((view.pos[2] - c.z) / tile) * tile;
    addObj(Math.hypot(wx - view.pos[0], c.y - view.pos[1], wz - view.pos[2]), () => drawCloud(view, c));
  }
  for (let i = 0; i < S.course.length; i += 1) {
    const rg = S.course[i];
    const d = Math.hypot(rg.x - view.pos[0], rg.y - view.pos[1], rg.z - view.pos[2]);
    if (d > 7500) continue;
    addObj(d, () => drawRing(view, S, i));
  }
  const order = depths.map((_, i) => i);
  order.sort((x, y) => depths[y] - depths[x]);
  for (const o of order) {
    const k = keys[o];
    if (k >= 0) drawCell(view, grid, (k / n) | 0, k % n);
    else fns[-k - 1]();
  }
  if (S.view === 'chase' && p.crashed <= 0) drawPlane(view, S);
  if (S.fx) drawCrashFx(view, S);
  return view;
}

/* ---------------- minimap and PULL UP ---------------- */

// The minimap picture is painted once into an offscreen canvas and reused
// every frame; only the route, the ring marks and the plane arrow move.
let mapPic = null;

/** North-up island picture: sea, sand, grass, rock and snow from groundHeight. */
function paintMapPicture(S) {
  let half = 3200;
  for (const r of S.course) half = Math.max(half, Math.abs(r.x), Math.abs(r.z));
  half = Math.ceil((half * 1.15) / 100) * 100;
  const N = 96;
  const map = document.createElement('canvas');
  map.width = N;
  map.height = N;
  const c2 = map.getContext('2d');
  const img = c2.createImageData(N, N);
  for (let j = 0; j < N; j += 1) {
    for (let i = 0; i < N; i += 1) {
      const x = ((i + 0.5) / N * 2 - 1) * half;
      const z = (1 - (j + 0.5) / N * 2) * half;
      const h = groundHeight(x, z);
      let col;
      if (h <= 0.2) col = [24, 88, 132];
      else if (h < 12) col = [210, 196, 152];
      else if (h < 150) col = [96, 140, 74];
      else if (h < 360) col = [128, 116, 102];
      else col = [238, 242, 246];
      const k = (j * N + i) * 4;
      img.data[k] = col[0];
      img.data[k + 1] = col[1];
      img.data[k + 2] = col[2];
      img.data[k + 3] = 255;
    }
  }
  c2.putImageData(img, 0, 0);
  return { map, half };
}

function drawMinimap(ctx, U, S, W) {
  if (!mapPic) mapPic = paintMapPicture(S);
  const size = 132 * U;
  const x0 = W - 14 * U - size;
  const y0 = 80 * U;
  const px = (x) => x0 + (clamp(x / mapPic.half, -1, 1) * 0.5 + 0.5) * size;
  const pz = (z) => y0 + (0.5 - clamp(z / mapPic.half, -1, 1) * 0.5) * size;
  const m = S.mission;
  const p = S.plane;
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.drawImage(mapPic.map, x0, y0, size, size);
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.rect(x0, y0, size, size);
  ctx.clip();
  // Runway: a short white bar on the centreline.
  ctx.strokeStyle = '#f4f8fa';
  ctx.lineWidth = 2 * U;
  ctx.beginPath();
  ctx.moveTo(px(0), pz(-WORLD.RUNWAY_HALF_LEN));
  ctx.lineTo(px(0), pz(WORLD.RUNWAY_HALF_LEN));
  ctx.stroke();
  // Dashed route: ring to ring, then home to the strip.
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3 * U, 3 * U]);
  ctx.beginPath();
  S.course.forEach((r, i) => {
    if (i === 0) ctx.moveTo(px(r.x), pz(r.z));
    else ctx.lineTo(px(r.x), pz(r.z));
  });
  ctx.lineTo(px(0), pz(0));
  ctx.stroke();
  ctx.setLineDash([]);
  // Ring marks: cleared green, next one amber and pulsing, rest pale blue.
  const pulse = (1 + Math.sin(S.now * 0.006)) / 2;
  S.course.forEach((r, i) => {
    const cx = px(r.x);
    const cy = pz(r.z);
    if (i < m.cleared) {
      ctx.fillStyle = '#63dc92';
      ctx.beginPath();
      ctx.arc(cx, cy, 2.6 * U, 0, TAU);
      ctx.fill();
    } else if (i === m.cleared) {
      ctx.strokeStyle = '#ffb54a';
      ctx.lineWidth = 2 * U;
      ctx.beginPath();
      ctx.arc(cx, cy, (3.6 + 1.8 * pulse) * U, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = '#ffb54a';
      ctx.beginPath();
      ctx.arc(cx, cy, 2.4 * U, 0, TAU);
      ctx.fill();
    } else {
      ctx.fillStyle = '#7fd2ff';
      ctx.beginPath();
      ctx.arc(cx, cy, 2.4 * U, 0, TAU);
      ctx.fill();
    }
  });
  // Plane arrow, rotated so its nose follows the heading (north is up).
  ctx.save();
  ctx.translate(px(p.x), pz(p.z));
  ctx.rotate(p.yaw);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#0b1620';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, -7 * U);
  ctx.lineTo(4.4 * U, 5 * U);
  ctx.lineTo(0, 2 * U);
  ctx.lineTo(-4.4 * U, 5 * U);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  ctx.restore();
  ctx.strokeStyle = 'rgba(141,255,217,0.7)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x0, y0, size, size);
  text(ctx, 'N', x0 + 10 * U, y0 + 11 * U, 11 * U, '#ffffff', 'center', 700);
}

/** Big red PULL UP while the ground is only seconds away at the current sink. */
function drawPullUp(ctx, U, S, W, H) {
  const p = S.plane;
  if (p.onGround || p.crashed > 0) return;
  const sink = -p.vy;
  if (sink <= 6) return;
  const clearance = p.y - groundHeight(p.x, p.z);
  if (clearance / sink >= 4.5) return;
  if (Math.sin(S.now * 0.018) < -0.25) return; // blink: mostly on, brief gaps
  text(ctx, 'PULL UP', W / 2, H * 0.31, 34 * U, '#ff5340', 'center', 800);
}

/* ---------------- cockpit instruments and HUD ---------------- */

const HUD = '#8dffd9';
const AMBER = '#ffb54a';
const PANEL = 'rgba(5,14,20,0.46)';

function text(ctx, s, x, y, size, color, align = 'center', weight = 600) {
  ctx.save();
  ctx.font = `${weight} ${size}px system-ui, "Segoe UI", Roboto, Arial, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(2,12,18,0.8)';
  ctx.shadowBlur = 2 + size * 0.22;
  ctx.shadowOffsetY = 1;
  ctx.fillText(s, x, y);
  ctx.restore();
}

/** One scrolling tape (speed or altitude) with a boxed current value.
 *  floor clamps the tape (and the boxed value) so it never shows a
 *  negative reading — pass 0 for tapes that sit at zero on the ground. */
function drawTape(ctx, U, x, y, h, val, minor, major, pxPer, side, label, fmt, floor = -Infinity) {
  const w = 96 * U;
  ctx.save();
  ctx.fillStyle = PANEL;
  ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.beginPath();
  ctx.rect(x - w / 2, y - h / 2, w, h);
  ctx.clip();
  const lo = Math.max(val - h / 2 / pxPer, floor);
  const hi = val + h / 2 / pxPer;
  ctx.strokeStyle = HUD;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  const edge = x + side * (w / 2);
  const firstMinor = Math.ceil(lo / minor) * minor;
  for (let v = firstMinor; v <= hi; v += minor) {
    const yy = y - (v - val) * pxPer;
    const big = Math.abs(v / major - Math.round(v / major)) < 1e-6;
    ctx.moveTo(edge, yy);
    ctx.lineTo(edge - side * (big ? 16 : 8) * U, yy);
  }
  ctx.stroke();
  const firstMajor = Math.ceil(lo / major) * major;
  for (let v = firstMajor; v <= hi; v += major) {
    const yy = y - (v - val) * pxPer;
    if (Math.abs(yy - y) < 18 * U) continue;
    text(ctx, fmt(v), x - side * 8 * U, yy, 12 * U, HUD, 'center', 500);
  }
  ctx.restore();
  ctx.fillStyle = 'rgba(4,10,14,0.9)';
  ctx.strokeStyle = HUD;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.rect(x - 38 * U, y - 13 * U, 76 * U, 26 * U);
  ctx.fill();
  ctx.stroke();
  text(ctx, fmt(Math.max(val, floor)), x, y + 1, 17 * U, '#eafff7', 'center', 700);
  text(ctx, label, x, y - h / 2 - 11 * U, 11 * U, HUD, 'center', 600);
}

/**
 * Pitch ladder, clipped to the sky above the instrument panel so no rung
 * or label can ever paint across a dial. skyBottom is the panel's top edge
 * (in cockpit view, the glareshield edge when it sits higher).
 */
function drawLadder(ctx, U, S, view, skyBottom) {
  const yawC = S.view === 'cockpit' ? S.plane.yaw : S.cam.yaw;
  const hs = Math.sin(yawC);
  const hc = Math.cos(yawC);
  const D2R = Math.PI / 180;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, S.w, skyBottom);
  ctx.clip();
  ctx.strokeStyle = HUD;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.85;
  for (let a = -30; a <= 30; a += 10) {
    const ar = a * D2R;
    const ca = Math.cos(ar);
    const sa = Math.sin(ar);
    const half = a === 0 ? 260 : 90;
    const cxw = view.pos[0] + hs * ca * 1000;
    const cyw = view.pos[1] + sa * 1000;
    const czw = view.pos[2] + hc * ca * 1000;
    const l = view.project(cxw - hc * half, cyw, czw + hs * half);
    const r = view.project(cxw + hc * half, cyw, czw - hs * half);
    if (!l || !r || l.z < 5 || r.z < 5) continue;
    const mid = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    const lp = [l.x, l.y];
    const rp = [r.x, r.y];
    ctx.beginPath();
    const a1 = mid(lp, rp, 0.38);
    const a2 = mid(lp, rp, 0.62);
    ctx.moveTo(lp[0], lp[1]);
    ctx.lineTo(a1[0], a1[1]);
    ctx.moveTo(a2[0], a2[1]);
    ctx.lineTo(rp[0], rp[1]);
    ctx.stroke();
    if (a !== 0) {
      text(ctx, String(Math.abs(a)), lp[0] - 14 * U, lp[1], 11 * U, HUD, 'center', 500);
      text(ctx, String(Math.abs(a)), rp[0] + 14 * U, rp[1], 11 * U, HUD, 'center', 500);
    }
  }
  // Flight-path marker: where the velocity vector actually points.
  const p = S.plane;
  const sp = Math.max(p.speed, 1);
  const vx = (p.speed * Math.cos(p.pitch) * Math.sin(p.yaw)) / sp;
  const vy = p.vy / sp;
  const vz = (p.speed * Math.cos(p.pitch) * Math.cos(p.yaw)) / sp;
  const fpm = view.project(view.pos[0] + vx * 600, view.pos[1] + vy * 600, view.pos[2] + vz * 600);
  if (fpm && fpm.z > 5) {
    ctx.strokeStyle = '#eafff7';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(fpm.x, fpm.y, 8 * U, 0, TAU);
    ctx.moveTo(fpm.x - 20 * U, fpm.y);
    ctx.lineTo(fpm.x - 8 * U, fpm.y);
    ctx.moveTo(fpm.x + 8 * U, fpm.y);
    ctx.lineTo(fpm.x + 20 * U, fpm.y);
    ctx.moveTo(fpm.x, fpm.y - 8 * U);
    ctx.lineTo(fpm.x, fpm.y - 15 * U);
    ctx.stroke();
  }
  ctx.restore();
}

function drawHeadingTape(ctx, U, S, W) {
  const CX = W / 2;
  const D2R = Math.PI / 180;
  const hdg = (((S.plane.yaw / D2R) % 360) + 360) % 360;
  const y = 30 * U;
  const w = 360 * U;
  ctx.save();
  ctx.fillStyle = PANEL;
  ctx.fillRect(CX - w / 2, y - 14 * U, w, 28 * U);
  ctx.beginPath();
  ctx.rect(CX - w / 2, y - 14 * U, w, 28 * U);
  ctx.clip();
  const pxd = 5.2 * U;
  ctx.strokeStyle = HUD;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  const firstTick = Math.ceil((hdg - 36) / 5) * 5;
  for (let d = firstTick; d <= hdg + 36; d += 5) {
    const x = CX + (d - hdg) * pxd;
    const big = d % 10 === 0;
    ctx.moveTo(x, y + 14 * U);
    ctx.lineTo(x, y + (big ? 3 : 8) * U);
  }
  ctx.stroke();
  const firstLab = Math.ceil((hdg - 36) / 10) * 10;
  for (let d = firstLab; d <= hdg + 36; d += 10) {
    const dn = ((d % 360) + 360) % 360;
    const x = CX + (d - hdg) * pxd;
    if (Math.abs(x - CX) < 30 * U) continue;
    const lab = dn === 0 ? 'N' : dn === 90 ? 'E' : dn === 180 ? 'S' : dn === 270 ? 'W' : String(Math.floor(dn / 10)).padStart(2, '0');
    text(ctx, lab, x, y - 4 * U, lab.length === 1 ? 14 : 11 * U, lab.length === 1 ? AMBER : HUD, 'center', 600);
  }
  ctx.restore();
  ctx.fillStyle = 'rgba(4,10,14,0.92)';
  ctx.strokeStyle = HUD;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.rect(CX - 30 * U, y + 18 * U, 60 * U, 24 * U);
  ctx.fill();
  ctx.stroke();
  text(ctx, `${String(Math.round(hdg) % 360).padStart(3, '0')}°`, CX, y + 31 * U, 16 * U, '#eafff7', 'center', 700);
  ctx.fillStyle = AMBER;
  ctx.beginPath();
  ctx.moveTo(CX, y + 16 * U);
  ctx.lineTo(CX - 5 * U, y + 8 * U);
  ctx.lineTo(CX + 5 * U, y + 8 * U);
  ctx.closePath();
  ctx.fill();
}

function drawGuidance(ctx, U, S, view, W, H) {
  const CX = W / 2;
  const t = missionTarget(S);
  const p = S.plane;
  const proj = view.project(t.x, t.y, t.z);
  const dist = Math.hypot(t.x - p.x, t.y - p.y, t.z - p.z);
  const m = 74 * U;
  let sx;
  let sy;
  let inside = false;
  if (proj && proj.z > 1) {
    sx = proj.x;
    sy = proj.y;
    inside = sx > m && sx < W - m && sy > m && sy < H * 0.74;
  }
  let dxv = 0;
  let dyv = 0;
  if (!inside) {
    if (proj) {
      dxv = proj.x - CX;
      dyv = proj.y - H * 0.42;
    } else {
      // Target behind the camera: point at it through the view centre.
      const c = view.toCam(t.x, t.y, t.z);
      dxv = c[0];
      dyv = -c[1];
    }
    const len = Math.hypot(dxv, dyv) || 1;
    dxv /= len;
    dyv /= len;
    const reachX = (W / 2 - m) / (Math.abs(dxv) + 1e-6);
    const reachY = (H * 0.36 - m * 0.4) / (Math.abs(dyv) + 1e-6);
    const k = Math.min(reachX, reachY);
    sx = CX + dxv * k;
    sy = H * 0.42 + dyv * k;
  }
  const distTxt = dist > 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`;
  const label = t.kind === 'runway' ? `RUNWAY ${distTxt}` : distTxt;
  ctx.save();
  ctx.strokeStyle = AMBER;
  ctx.fillStyle = AMBER;
  ctx.lineWidth = 2.4;
  if (inside) {
    const s = 16 * U;
    ctx.beginPath();
    ctx.moveTo(sx, sy - s);
    ctx.lineTo(sx + s, sy);
    ctx.lineTo(sx, sy + s);
    ctx.lineTo(sx - s, sy);
    ctx.closePath();
    ctx.stroke();
  } else {
    const ang = Math.atan2(dyv, dxv);
    ctx.translate(sx, sy);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(14 * U, 0);
    ctx.lineTo(-10 * U, -11 * U);
    ctx.lineTo(-4 * U, 0);
    ctx.lineTo(-10 * U, 11 * U);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  text(ctx, label, sx, sy + (inside ? 30 : 28) * U, 13 * U, AMBER, 'center', 700);
}

function dialFace(ctx, cx, cy, r, U) {
  const gx = cx - r * 0.3;
  const gy = cy - r * 0.3;
  const g = ctx.createRadialGradient(gx, gy, r * 0.1, cx, cy, r);
  g.addColorStop(0, '#1b252c');
  g.addColorStop(1, '#0a1014');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#59666f';
  ctx.lineWidth = 3 * U;
  ctx.stroke();
  ctx.strokeStyle = '#0b1115';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 2.5 * U, 0, TAU);
  ctx.stroke();
}

function needle(ctx, cx, cy, ang, len, col, wd, U) {
  ctx.strokeStyle = col;
  ctx.lineWidth = wd;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - Math.cos(ang) * len * 0.18, cy - Math.sin(ang) * len * 0.18);
  ctx.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
  ctx.stroke();
  ctx.fillStyle = '#c8d2d8';
  ctx.beginPath();
  ctx.arc(cx, cy, 3.4 * U, 0, TAU);
  ctx.fill();
  ctx.lineCap = 'butt';
}

function drawInstruments(ctx, U, S, W, H) {
  const CX = W / 2;
  const D2R = Math.PI / 180;
  const p = S.plane;
  const ph = Math.round(clamp(H * 0.215, 126, 210));
  const top = H - ph;
  const gradP = ctx.createLinearGradient(0, top, 0, H);
  gradP.addColorStop(0, '#2b363e');
  gradP.addColorStop(0.04, '#1a2329');
  gradP.addColorStop(1, '#0d1317');
  ctx.fillStyle = gradP;
  ctx.beginPath();
  ctx.moveTo(0, top + 16 * U);
  ctx.lineTo(W * 0.5 - 330 * U, top);
  ctx.lineTo(W * 0.5 + 330 * U, top);
  ctx.lineTo(W, top + 16 * U);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#4a5963';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, top + 16 * U);
  ctx.lineTo(W * 0.5 - 330 * U, top);
  ctx.lineTo(W * 0.5 + 330 * U, top);
  ctx.lineTo(W, top + 16 * U);
  ctx.stroke();
  const r = Math.min(ph * 0.4, W / 12.6);
  const cy = top + ph * 0.52;
  const sp = r * 2.28;
  const xs = [-2, -1, 0, 1, 2].map((i) => CX + i * sp);
  const kmh = p.speed * 3.6;

  // 1 — airspeed, km/h, 0..360.
  dialFace(ctx, xs[0], cy, r, U);
  const sa = (v) => (135 + 270 * clamp(v / 360, 0, 1)) * D2R;
  ctx.strokeStyle = '#e8eef0';
  ctx.lineWidth = 3 * U;
  ctx.beginPath();
  ctx.arc(xs[0], cy, r * 0.93, sa(122), sa(250));
  ctx.stroke();
  ctx.strokeStyle = '#d6453b';
  ctx.beginPath();
  ctx.arc(xs[0], cy, r * 0.93, sa(0), sa(122));
  ctx.stroke();
  for (let v = 0; v <= 360; v += 20) {
    const a = sa(v);
    const big = v % 60 === 0;
    const r1 = r * (big ? 0.74 : 0.82);
    ctx.strokeStyle = '#c9d4d9';
    ctx.lineWidth = big ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(xs[0] + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.lineTo(xs[0] + Math.cos(a) * r * 0.88, cy + Math.sin(a) * r * 0.88);
    ctx.stroke();
    if (big) text(ctx, String(v), xs[0] + Math.cos(a) * r * 0.6, cy + Math.sin(a) * r * 0.6, r * 0.2, '#dbe6ea', 'center', 600);
  }
  text(ctx, 'KM/H', xs[0], cy + r * 0.34, r * 0.17, HUD, 'center', 600);
  needle(ctx, xs[0], cy, sa(kmh), r * 0.82, AMBER, 3 * U, U);

  // 2 — attitude ball.
  dialFace(ctx, xs[1], cy, r, U);
  ctx.save();
  ctx.beginPath();
  ctx.arc(xs[1], cy, r * 0.94, 0, TAU);
  ctx.clip();
  ctx.translate(xs[1], cy);
  ctx.rotate(-p.roll);
  const off = p.pitch * r * 2.0;
  ctx.fillStyle = '#3f86d0';
  ctx.fillRect(-r * 2, -r * 3 + off, r * 4, r * 3);
  ctx.fillStyle = '#85612f';
  ctx.fillRect(-r * 2, off, r * 4, r * 3);
  ctx.strokeStyle = '#f4f7f8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-r * 2, off);
  ctx.lineTo(r * 2, off);
  ctx.stroke();
  ctx.lineWidth = 1.4;
  for (let a = -30; a <= 30; a += 10) {
    if (!a) continue;
    const yy = off - a * D2R * r * 2.0;
    const w2 = a % 20 === 0 ? r * 0.36 : r * 0.2;
    ctx.beginPath();
    ctx.moveTo(-w2, yy);
    ctx.lineTo(w2, yy);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = AMBER;
  ctx.lineWidth = 3.4 * U;
  ctx.beginPath();
  ctx.moveTo(xs[1] - r * 0.62, cy);
  ctx.lineTo(xs[1] - r * 0.22, cy);
  ctx.lineTo(xs[1] - r * 0.22, cy + r * 0.1);
  ctx.moveTo(xs[1] + r * 0.62, cy);
  ctx.lineTo(xs[1] + r * 0.22, cy);
  ctx.lineTo(xs[1] + r * 0.22, cy + r * 0.1);
  ctx.stroke();
  ctx.fillStyle = AMBER;
  ctx.beginPath();
  ctx.arc(xs[1], cy, 3 * U, 0, TAU);
  ctx.fill();
  ctx.save();
  ctx.translate(xs[1], cy);
  ctx.rotate(-p.roll);
  ctx.fillStyle = '#f4f7f8';
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.9);
  ctx.lineTo(-5 * U, -r * 0.78);
  ctx.lineTo(5 * U, -r * 0.78);
  ctx.fill();
  ctx.restore();

  // 3 — compass rose.
  dialFace(ctx, xs[2], cy, r, U);
  const hdg = (((p.yaw / D2R) % 360) + 360) % 360;
  for (let d = 0; d < 360; d += 10) {
    const a = (d - hdg - 90) * D2R;
    const big = d % 30 === 0;
    ctx.strokeStyle = '#c9d4d9';
    ctx.lineWidth = big ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(xs[2] + Math.cos(a) * r * (big ? 0.76 : 0.84), cy + Math.sin(a) * r * (big ? 0.76 : 0.84));
    ctx.lineTo(xs[2] + Math.cos(a) * r * 0.9, cy + Math.sin(a) * r * 0.9);
    ctx.stroke();
    if (big) {
      const lab = d === 0 ? 'N' : d === 90 ? 'E' : d === 180 ? 'S' : d === 270 ? 'W' : String(d / 10);
      text(ctx, lab, xs[2] + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.62, r * 0.2, lab.length === 1 ? AMBER : '#dbe6ea', 'center', 700);
    }
  }
  ctx.fillStyle = AMBER;
  ctx.beginPath();
  ctx.moveTo(xs[2], cy - r * 0.97);
  ctx.lineTo(xs[2] - 5 * U, cy - r * 0.84);
  ctx.lineTo(xs[2] + 5 * U, cy - r * 0.84);
  ctx.fill();
  ctx.strokeStyle = '#e8eef0';
  ctx.lineWidth = 2.4 * U;
  ctx.beginPath();
  ctx.moveTo(xs[2], cy - r * 0.28);
  ctx.lineTo(xs[2], cy + r * 0.3);
  ctx.moveTo(xs[2] - r * 0.24, cy);
  ctx.lineTo(xs[2] + r * 0.24, cy);
  ctx.moveTo(xs[2] - r * 0.1, cy + r * 0.27);
  ctx.lineTo(xs[2] + r * 0.1, cy + r * 0.27);
  ctx.stroke();
  text(ctx, 'HDG', xs[2], cy + r * 0.5, r * 0.15, HUD, 'center', 600);

  // 4 — altimeter, metres, with a digital window.
  dialFace(ctx, xs[3], cy, r, U);
  const alt = p.y;
  for (let v = 0; v < 1000; v += 20) {
    const a = (-90 + v * 0.36) * D2R;
    const big = v % 100 === 0;
    ctx.strokeStyle = '#c9d4d9';
    ctx.lineWidth = big ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(xs[3] + Math.cos(a) * r * (big ? 0.74 : 0.83), cy + Math.sin(a) * r * (big ? 0.74 : 0.83));
    ctx.lineTo(xs[3] + Math.cos(a) * r * 0.89, cy + Math.sin(a) * r * 0.89);
    ctx.stroke();
    if (big) text(ctx, String(v / 100), xs[3] + Math.cos(a) * r * 0.6, cy + Math.sin(a) * r * 0.6, r * 0.22, '#dbe6ea', 'center', 600);
  }
  text(ctx, 'ALT M', xs[3], cy - r * 0.3, r * 0.15, HUD, 'center', 600);
  ctx.fillStyle = '#05090c';
  ctx.fillRect(xs[3] - r * 0.4, cy + r * 0.22, r * 0.8, r * 0.28);
  text(ctx, String(Math.round(alt)), xs[3], cy + r * 0.37, r * 0.22, '#eafff7', 'center', 700);
  needle(ctx, xs[3], cy, (-90 + ((((alt % 1000) + 1000) % 1000) * 0.36)) * D2R, r * 0.8, AMBER, 3 * U, U);

  // 5 — vertical speed, m/s.
  dialFace(ctx, xs[4], cy, r, U);
  for (let v = -15; v <= 15; v += 5) {
    const a = (180 + (v / 15) * 150) * D2R;
    ctx.strokeStyle = '#c9d4d9';
    ctx.lineWidth = v % 10 === 0 ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(xs[4] + Math.cos(a) * r * 0.76, cy + Math.sin(a) * r * 0.76);
    ctx.lineTo(xs[4] + Math.cos(a) * r * 0.9, cy + Math.sin(a) * r * 0.9);
    ctx.stroke();
    if (v % 10 === 0 || v === 0) text(ctx, String(Math.abs(v)), xs[4] + Math.cos(a) * r * 0.6, cy + Math.sin(a) * r * 0.6, r * 0.18, '#dbe6ea', 'center', 600);
  }
  text(ctx, 'V/S M/S', xs[4], cy + r * 0.38, r * 0.15, HUD, 'center', 600);
  needle(ctx, xs[4], cy, (180 + clamp(p.vy / 15, -1, 1) * 150) * D2R, r * 0.8, AMBER, 3 * U, U);

  // Throttle bar, right of the dials.
  const bx = xs[4] + r * 1.55;
  const bh = r * 1.7;
  const bw = 13 * U;
  ctx.fillStyle = '#05090c';
  ctx.fillRect(bx - bw / 2, cy - bh / 2, bw, bh);
  const fh = bh * p.thr;
  const tg = ctx.createLinearGradient(0, cy + bh / 2, 0, cy - bh / 2);
  tg.addColorStop(0, '#2fd6a2');
  tg.addColorStop(0.7, '#ffb54a');
  tg.addColorStop(1, '#ff6a3a');
  ctx.fillStyle = tg;
  ctx.fillRect(bx - bw / 2, cy + bh / 2 - fh, bw, fh);
  ctx.strokeStyle = '#59666f';
  ctx.lineWidth = 2;
  ctx.strokeRect(bx - bw / 2, cy - bh / 2, bw, bh);
  text(ctx, 'THR', bx, cy - bh / 2 - 10 * U, 11 * U, HUD, 'center', 600);
  text(ctx, `${Math.round(p.thr * 100)}%`, bx, cy + bh / 2 + 11 * U, 11 * U, '#eafff7', 'center', 600);
  if (p.brake) text(ctx, 'BRAKE', xs[0] - r * 1.5, cy, 11 * U, AMBER, 'center', 700);
  if (!p.onGround && p.speed < 38) {
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(S.now * 0.02);
    text(ctx, 'STALL', CX, top - 14 * U, 18 * U, '#ff6a52', 'center', 700);
    ctx.globalAlpha = 1;
  }
  return top;
}

function drawCockpitFrame(ctx, S, W, H) {
  ctx.fillStyle = '#0e1418';
  ctx.fillRect(0, 0, W, H * 0.04);
  for (const s of [1, -1]) {
    const x0 = s > 0 ? 0 : W;
    const g = s;
    ctx.fillStyle = '#10171c';
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.lineTo(x0 + g * W * 0.15, 0);
    ctx.lineTo(x0 + g * W * 0.05, H * 0.68);
    ctx.lineTo(x0, H * 0.78);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#2a363d';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x0 + g * W * 0.15, 0);
    ctx.lineTo(x0 + g * W * 0.05, H * 0.68);
    ctx.stroke();
  }
  ctx.fillStyle = '#121a1f';
  ctx.beginPath();
  ctx.moveTo(0, H * 0.8);
  ctx.lineTo(W * 0.28, H * 0.69);
  ctx.lineTo(W * 0.72, H * 0.69);
  ctx.lineTo(W, H * 0.8);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fill();
  // Nose + spinner seen over the glareshield.
  const g = ctx.createLinearGradient(0, H * 0.62, 0, H * 0.78);
  g.addColorStop(0, '#2a8aa0');
  g.addColorStop(1, '#14596c');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(W * 0.41, H * 0.76);
  ctx.lineTo(W * 0.465, H * 0.64);
  ctx.lineTo(W * 0.535, H * 0.64);
  ctx.lineTo(W * 0.59, H * 0.76);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#f47c28';
  ctx.beginPath();
  ctx.moveTo(W * 0.475, H * 0.655);
  ctx.lineTo(W * 0.525, H * 0.655);
  ctx.lineTo(W * 0.52, H * 0.64);
  ctx.lineTo(W * 0.48, H * 0.64);
  ctx.closePath();
  ctx.fill();
  // Prop blur.
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = '#e8f2f6';
  ctx.beginPath();
  ctx.ellipse(W / 2, H * 0.575, W * 0.2, H * 0.09, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawHud(ctx, S, view) {
  const W = S.w;
  const H = S.h;
  const CX = W / 2;
  const U = clamp(H / 820, 0.72, 1.35);
  const p = S.plane;
  const m = S.mission;
  ctx.save();
  if (S.view === 'cockpit') drawCockpitFrame(ctx, S, W, H);
  const top = drawInstruments(ctx, U, S, W, H);
  const skyBottom = S.view === 'cockpit' ? Math.min(top, H * 0.68) : top;
  drawLadder(ctx, U, S, view, skyBottom);
  drawHeadingTape(ctx, U, S, W);
  const tapeY = H * 0.42 - 10 * U;
  drawTape(ctx, U, CX - 250 * U, tapeY, 200 * U, p.speed * 3.6,
    10, 50, 1.1 * U, 1, 'KM/H', (v) => String(Math.round(v)), 0);
  drawTape(ctx, U, CX + 250 * U, tapeY, 200 * U, p.y,
    20, 100, 0.55 * U, -1, 'ALT M', (v) => String(Math.round(v)), 0);
  const agl = Math.max(0, p.y - groundHeight(p.x, p.z) - 1);
  text(ctx, `AGL ${Math.round(agl)} m`, CX + 250 * U, tapeY + 118 * U, 12 * U, HUD, 'center', 600);
  drawGuidance(ctx, U, S, view, W, H);
  drawMinimap(ctx, U, S, W);
  drawPullUp(ctx, U, S, W, H);
  // Mission panel.
  ctx.fillStyle = PANEL;
  ctx.fillRect(14 * U, 14 * U, 176 * U, 88 * U);
  ctx.strokeStyle = 'rgba(141,255,217,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(14 * U, 14 * U, 176 * U, 88 * U);
  text(ctx, missionLabel(S), 26 * U, 34 * U, 16 * U, AMBER, 'left', 700);
  text(ctx, `Time ${formatTime(m.time)}`, 26 * U, 56 * U, 14 * U, '#eafff7', 'left', 500);
  text(ctx, `Score ${m.score}`, 26 * U, 76 * U, 14 * U, '#eafff7', 'left', 500);
  text(ctx, `Crashes ${m.crashes}`, 26 * U, 94 * U, 12 * U, HUD, 'left', 500);
  ctx.fillStyle = PANEL;
  ctx.fillRect(W - 212 * U, 12 * U, 198 * U, 44 * U);
  ctx.strokeStyle = 'rgba(141,255,217,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(W - 212 * U, 12 * U, 198 * U, 44 * U);
  text(ctx, 'KESTREL RUN', W - 24 * U, 26 * U, 15 * U, HUD, 'right', 700);
  text(ctx, `${S.view === 'chase' ? 'Chase' : 'Cockpit'} view · C switch · H help`, W - 24 * U, 45 * U, 11 * U, 'rgba(141,255,217,0.85)', 'right', 500);
  if (S.mouse) text(ctx, 'MOUSE STEERING', W - 16 * U, 62 * U, 11 * U, AMBER, 'right', 700);
  // Toast banner.
  if (m.toastT > 0 && m.toast) {
    ctx.globalAlpha = clamp(m.toastT, 0, 1);
    text(ctx, m.toast, CX, H * 0.2, 26 * U, '#fff6dc', 'center', 700);
    ctx.globalAlpha = 1;
  }
  if (p.crashed > 0) {
    ctx.fillStyle = 'rgba(120,20,10,0.35)';
    ctx.fillRect(0, 0, W, H);
    text(ctx, 'CRASHED', CX, H * 0.38, 44 * U, '#ffd9cc', 'center', 800);
    text(ctx, m.lastCrash, CX, H * 0.38 + 40 * U, 16 * U, '#ffd9cc', 'center', 500);
  }
  if (m.done) {
    ctx.fillStyle = 'rgba(4,14,20,0.62)';
    ctx.fillRect(CX - 230 * U, H * 0.24, 460 * U, 150 * U);
    text(ctx, 'Mission complete', CX, H * 0.24 + 38 * U, 30 * U, AMBER, 'center', 800);
    text(ctx, `Rank ${m.rating} · ${formatTime(m.time)} · ${m.score} pts · ${m.crashes} crashes`, CX, H * 0.24 + 80 * U, 16 * U, '#eafff7', 'center', 600);
    text(ctx, 'Press Enter to fly again', CX, H * 0.24 + 112 * U, 14 * U, HUD, 'center', 500);
  }
  if (S.help) {
    const x = 14 * U;
    const y = 116 * U;
    const lines = [
      ['Throttle', 'Shift up · Ctrl down · wheel · 0–9'],
      ['Pitch', 'S / Down climb · W / Up dive'],
      ['Roll', 'A D or ← →  (banking turns)'],
      ['Rudder', 'Q E'],
      ['Brake', 'Space'],
      ['Mouse', 'click to steer, up = climb'],
      ['View', 'C · Pause P · Restart Enter'],
      ['Goal', 'Take off, fly all rings, land'],
    ];
    ctx.fillStyle = PANEL;
    ctx.fillRect(x, y, 292 * U, (lines.length * 20 + 18) * U);
    ctx.strokeStyle = 'rgba(141,255,217,0.5)';
    ctx.strokeRect(x, y, 292 * U, (lines.length * 20 + 18) * U);
    lines.forEach((l, i) => {
      text(ctx, l[0], x + 12 * U, y + (18 + i * 20) * U, 12.5 * U, AMBER, 'left', 700);
      text(ctx, l[1], x + 78 * U, y + (18 + i * 20) * U, 12.5 * U, '#eafff7', 'left', 500);
    });
  }
  if (S.paused) {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, W, H);
    text(ctx, 'Paused', CX, H / 2, 40 * U, '#fff', 'center', 700);
  }
  ctx.restore();
}

/* ---------------- keyboard + mouse input ---------------- */

function createInput(canvas, S) {
  const keys = {};
  let mx = 0;
  let my = 0;
  let stickX = 0;
  let stickY = 0;

  function deadzone(v) {
    return Math.abs(v) < 0.08 ? 0 : (v - Math.sign(v) * 0.08) / 0.92;
  }

  /** +1 when a "positive" key is held, -1 when a "negative" one is. */
  function keyAxis(negA, negB, posA, posB) {
    const neg = keys[negA] || keys[negB] ? 1 : 0;
    const pos = keys[posA] || keys[posB] ? 1 : 0;
    return pos - neg;
  }

  window.addEventListener('keydown', (e) => {
    const stopKeys = [
      'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab',
    ];
    if (stopKeys.includes(e.code)) e.preventDefault();
    keys[e.code] = true;
    if (e.repeat) return;
    if (e.code === 'KeyC') S.view = S.view === 'chase' ? 'cockpit' : 'chase';
    if (e.code === 'KeyH') S.help = !S.help;
    if (e.code === 'KeyP') S.paused = !S.paused;
    if (e.code === 'Enter') S.restartRequested = true;
    if (e.code === 'KeyM') {
      S.mouse = !S.mouse;
      S.mouseToast = S.mouse ? 'Mouse steering on' : 'Mouse steering off';
    }
    if (/^Digit\d$/.test(e.code)) S.plane.thr = parseInt(e.code[5], 10) / 9;
  });
  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
  });
  canvas.addEventListener('mousemove', (e) => {
    mx = (e.clientX / S.w - 0.5) * 2;
    my = (e.clientY / S.h - 0.5) * 2;
  });
  canvas.addEventListener('mousedown', () => {
    S.mouse = !S.mouse;
    S.mouseToast = S.mouse ? 'Mouse steering on — click to release' : 'Mouse steering off';
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    S.plane.thr = clamp(S.plane.thr - e.deltaY * 0.0008, 0, 1);
  }, { passive: false });

  return {
    keys,
    /** Read the current control frame and ease the stick toward it. */
    poll(dt) {
      const kx = keyAxis('KeyA', 'ArrowLeft', 'KeyD', 'ArrowRight');
      const ky = keyAxis('KeyW', 'ArrowUp', 'KeyS', 'ArrowDown');
      let tx = kx;
      let ty = ky;
      if (S.mouse) {
        tx += deadzone(mx);
        ty += -deadzone(my);
      }
      tx = clamp(tx, -1, 1);
      ty = clamp(ty, -1, 1);
      stickX += (tx - stickX) * Math.min(1, dt * 5);
      stickY += (ty - stickY) * Math.min(1, dt * 5);
      const p = S.plane;
      p.rudder = (keys.KeyE ? 1 : 0) - (keys.KeyQ ? 1 : 0);
      p.brake = !!(keys.Space || keys.KeyB);
      if (keys.ShiftLeft || keys.ShiftRight || keys.KeyR) p.thr += dt * 0.5;
      if (keys.ControlLeft || keys.ControlRight || keys.KeyF) p.thr -= dt * 0.5;
      p.thr = clamp(p.thr, 0, 1);
      return { stickX, stickY, rudder: p.rudder, brake: p.brake };
    },
  };
}

/* ---------------- WebAudio sound ---------------- */

function createAudio() {
  let ctx = null;
  let engine = null;

  function ensure() {
    if (ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      const o1 = ctx.createOscillator();
      const o2 = ctx.createOscillator();
      const g = ctx.createGain();
      const f = ctx.createBiquadFilter();
      o1.type = 'sawtooth';
      o2.type = 'square';
      f.type = 'lowpass';
      f.frequency.value = 600;
      g.gain.value = 0;
      o1.connect(f);
      o2.connect(f);
      f.connect(g);
      g.connect(ctx.destination);
      o1.start();
      o2.start();
      engine = { o1, o2, g, f };
    } catch (e) {
      ctx = null;
    }
  }

  function beep(freq, dur, type = 'sine',
    vol = 0.08, slide = 0) {
    if (!ctx) return;
    try {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const t = ctx.currentTime;
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slide) {
        const endFreq = freq + slide;
        o.frequency.linearRampToValueAtTime(endFreq, t + dur);
      }
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    } catch (e) {
      /* audio is decoration — never let it break the game */
    }
  }

  return {
    ensure,
    beep,
    ring(bullseye) {
      beep(880, 0.12, 'sine', 0.1, 440);
      setTimeout(() => beep(1320, 0.18, 'sine', 0.08), 90);
      if (bullseye) setTimeout(() => beep(1760, 0.2, 'sine', 0.07), 190);
    },
    takeoff() {
      beep(520, 0.15, 'triangle', 0.05, 160);
    },
    land(smooth) {
      beep(180, 0.12, 'triangle', 0.08);
      if (smooth) setTimeout(() => beep(660, 0.2, 'triangle', 0.06), 120);
    },
    crash() {
      beep(90, 0.6, 'sawtooth', 0.14, -50);
    },
    fanfare() {
      beep(660, 0.3, 'triangle', 0.1);
      setTimeout(() => beep(880, 0.4, 'triangle', 0.1), 250);
    },
    stallTick() {
      beep(620, 0.07, 'square', 0.03);
    },
    /** Engine hum follows throttle, speed and crash state. */
    update(S) {
      if (!engine) return;
      const p = S.plane;
      const t = ctx.currentTime;
      const rpm = 38 + p.thr * 62 + p.speed * 0.22;
      engine.o1.frequency.setTargetAtTime(rpm, t, 0.08);
      engine.o2.frequency.setTargetAtTime(rpm * 0.5, t, 0.08);
      engine.f.frequency.setTargetAtTime(380 + p.thr * 900, t, 0.1);
      engine.g.gain.setTargetAtTime(p.crashed > 0 ? 0 : 0.025 + p.thr * 0.045, t, 0.1);
    },
  };
}

/* ---------------- deterministic staged scenes ---------------- */

// The four screenshots are STAGED scenes (?demo=1..4) — frozen presets the
// game renders live, not frames cut from one played flight. They run in
// sortie order, and every clock and score on screen is one the real rules
// can produce:
//
//   1-cover   0:45  score 0     just airborne, ring 1 ahead, chase
//   2-rings   1:35  score 554   ring 4 just cleared (+147), chase,
//                               ring 5 ahead
//   3-cockpit 3:05  score 1390  all 10 rings done, cockpit, final
//                               approach with the strip ahead
//   4-landing 3:21  score 1390  short final, runway filling the frame
//
// A ring pays 100 plus a bullseye bonus of 0..60 (RING_BONUS below is the
// bonus each staged ring earned), so the totals add up: 4 rings = 554,
// 10 rings = 1390. The +300 landing bonus is only added once the plane
// has stopped on the runway, so it is not in these frames.

const DEMO_COUNT = 4;
const RING_BONUS = [
  34, 21, 52, 47, 28,
  60, 39, 23, 45, 41,
];

/** Score after clearing n rings, from the real rules (100 + bonus each). */
function scoreForRings(n) {
  let total = 0;
  for (let i = 0; i < n; i += 1) total += SCORE.RING + RING_BONUS[i];
  return total;
}

function placePlane(S, x, y, z, yaw, pitch, roll, speed, thr) {
  const p = S.plane;
  Object.assign(p, { x, y, z, yaw, pitch, roll, speed, thr, vy: 0, onGround: false, crashed: 0 });
  p.prev = [x, y, z];
  S.cam.yaw = yaw;
  S.cam.pitch = pitch * 0.5;
  S.cam.roll = roll * 0.55;
}

function baseState(S, time, cleared) {
  const m = S.mission;
  m.time = time;
  m.score = scoreForRings(cleared);
  m.cleared = cleared;
  m.running = true;
  m.done = false;
  m.crashes = 0;
  m.toast = '';
  m.toastT = 0;
  S.help = false;
  S.paused = false;
  S.mouse = false;
  S.view = 'chase';
  S.demoTarget = null;
  S.demoLabel = null;
  S.now = 1200; // fixed clock so the ring pulse is identical every run
}

function applyDemo(S, n) {
  if (n === 1) {
    baseState(S, 45, 0);
    // 3.4 km short of ring 1, climbing away from the strip.
    placePlane(S, 30, 215, -1400, 0.005, -0.02, 0.04, 68, 0.68);
    return;
  }
  if (n === 2) {
    baseState(S, 95, 4);
    const target = S.course[4];
    const from = S.course[3];
    const yaw = Math.atan2(target.x - from.x, target.z - from.z);
    let gmax = 0;
    for (let s = 0; s <= 440; s += 40) {
      gmax = Math.max(gmax, groundHeight(target.x - Math.sin(yaw) * s, target.z - Math.cos(yaw) * s));
    }
    placePlane(
      S,
      target.x - Math.sin(yaw) * 420,
      Math.max(target.y + 12, gmax + 90),
      target.z - Math.cos(yaw) * 420,
      yaw, 0.0, 0.3, 79, 0.75,
    );
    S.mission.toast = `Ring 4 cleared +${SCORE.RING + RING_BONUS[3]}`;
    S.mission.toastT = 2.6;
    return;
  }
  if (n === 3) {
    // Cockpit, all 10 rings done, on final approach with the strip ahead.
    baseState(S, 185, 10);
    placePlane(S, 24, 118, -880, 0, -0.02, 0.05, 62, 0.62);
    S.view = 'cockpit';
    S.mission.toast = 'All rings done — land on the runway';
    S.mission.toastT = 2.6;
    return;
  }
  // Demo 4: short final — 260 m out on the centreline, 14 m above the
  // strip, so the runway fills the frame ahead of the plane.
  baseState(S, 201, 10);
  placePlane(S, 10, 26, -260, 0, -0.03, 0, 46, 0.3);
  S.mission.toast = 'Short final';
  S.mission.toastT = 2.6;
}

/* ---------------- boot and the game loop ---------------- */

const STEP = 1 / 60;
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const demoParam = Number.parseInt(params.get('demo') ?? '', 10);
const demo = Number.isInteger(demoParam) && demoParam >= 1 && demoParam <= DEMO_COUNT ? demoParam : 0;
const viewParam = params.get('view');

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const ctx = canvas.getContext('2d');

const S = {
  plane: {
    x: 0, y: 13, z: -520, yaw: 0, pitch: 0, roll: 0,
    speed: 0, thr: 0, vy: 0, onGround: true, crashed: 0, crashT: 0,
    brake: false, rudder: 0, prop: 0, prev: [0, 13, -520],
  },
  cam: { yaw: 0, pitch: 0, roll: 0 },
  mission: createMission(),
  course: buildCourse(),
  view: viewParam === 'cockpit' ? 'cockpit' : 'chase',
  paused: false,
  help: true,
  mouse: false,
  mouseToast: '',
  restartRequested: false,
  now: 0,
  fx: null,
  w: 0,
  h: 0,
  demoTarget: null,
  demoLabel: null,
};

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  S.w = window.innerWidth;
  S.h = window.innerHeight;
  canvas.width = Math.round(S.w * dpr);
  canvas.height = Math.round(S.h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();
placeOnRunway(S);

const audio = createAudio();
const input = createInput(canvas, S);

function announce(message) {
  status.textContent = message;
}

function handleEvents(events) {
  for (const ev of events) {
    if (ev.type === 'takeoff') {
      setToast(S, 'Airborne');
      audio.takeoff();
      announce('Airborne.');
    } else if (ev.type === 'ring') {
      setToast(S, ev.bullseye ? `Bullseye! +${ev.gained}` : `Ring ${ev.ring} cleared +${ev.gained}`);
      audio.ring(ev.bullseye);
      announce(`Ring ${ev.ring} cleared, score ${S.mission.score}.`);
    } else if (ev.type === 'allrings') {
      setToast(S, 'All rings done — land on the runway', 4);
    } else if (ev.type === 'land') {
      setToast(S, ev.smooth ? 'Smooth touchdown' : 'Touchdown', 2.2);
      audio.land(ev.smooth);
    } else if (ev.type === 'crash') {
      setToast(S, ev.msg, 2.6);
      audio.crash();
      announce(`Crashed. ${ev.msg}`);
    } else if (ev.type === 'done') {
      setToast(S, `Mission complete — rank ${ev.rating}`, 8);
      audio.fanfare();
      announce(`Mission complete, rank ${ev.rating}, score ${S.mission.score}.`);
    } else if (ev.type === 'stallwarn') {
      audio.stallTick();
    }
  }
}

function render() {
  const view = drawFrame(ctx, S);
  drawHud(ctx, S, view);
}

function runShot() {
  applyDemo(S, demo);
  let painted = 0;
  function paint() {
    render();
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  let accumulator = 0;
  let last = performance.now();
  let stallTickAt = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    S.now = now;
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    if (S.restartRequested) {
      S.restartRequested = false;
      resetMission(S);
      announce('New flight. Throttle up and take off.');
    }
    if (S.mouseToast) {
      setToast(S, S.mouseToast);
      S.mouseToast = '';
    }
    if (!S.paused) {
      while (accumulator >= STEP) {
        const ctl = input.poll(STEP);
        const events = stepFlight(S, STEP, ctl);
        // Stall warning beeps at most ~4x a second.
        const warns = events.filter((e) => e.type === 'stallwarn');
        if (warns.length && now - stallTickAt > 250) {
          stallTickAt = now;
          audio.stallTick();
        }
        handleEvents(events.filter((e) => e.type !== 'stallwarn'));
        audio.update(S);
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    render();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !S.paused) {
      S.paused = true;
      announce('Paused.');
    }
  });

  // First user gesture unlocks the engine hum.
  window.addEventListener('pointerdown', () => audio.ensure(), { once: true });
  window.addEventListener('keydown', () => audio.ensure(), { once: true });

  announce('Kestrel Run. Throttle up with Shift and take off.');
  requestAnimationFrame(frame);
}

// Debug + play-test handle: live state for automated checks.
window.__kestrel = { S, input };

if (demo) runShot();
else runGame();
