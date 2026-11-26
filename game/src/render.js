// Kestrel Run — software 3D renderer on a 2D canvas: camera basis,
// perspective projection, near-plane clipping, painter's sort, sky, terrain
// mesh, runway, town, trees, clouds, rings and the Kestrel herself.
import { WORLD, SUN_DIR } from './config.js';
import { BUILDINGS, CLOUDS, clamp, groundHeight, latticeHash, sstep, TAU } from './world.js';

const NEAR = 1.2;
const LIGHT = SUN_DIR;

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
  return {
    f,
    r: [r0[0] * cr - u0[0] * sr, r0[1] * cr - u0[1] * sr, r0[2] * cr - u0[2] * sr],
    u: [u0[0] * cr + r0[0] * sr, u0[1] * cr + r0[1] * sr, u0[2] * cr + r0[2] * sr],
  };
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
        dst[m * 3] = src[i * 3] + (src[j * 3] - src[i * 3]) * t;
        dst[m * 3 + 1] = src[i * 3 + 1] + (src[j * 3 + 1] - src[i * 3 + 1]) * t;
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
    const rg = ctx.createRadialGradient(px, py, 0, px, py, H * 0.32);
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
    [[0, 1, 0], [x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1], bd.roof],
    [[1, 0, 0], [x1, y0, z0, x1, y0, z1, x1, y1, z1, x1, y1, z0], bd.wall],
    [[-1, 0, 0], [x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0], bd.wall],
    [[0, 0, 1], [x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1], bd.wall],
    [[0, 0, -1], [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0], bd.wall],
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
  ctx.fillRect(sx - w * 0.12, sy - hh * 0.22, w * 0.24, hh * 0.22);
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
  const wx = c.x + Math.round((view.pos[0] - c.x) / 16000) * 16000;
  const wz = c.z + Math.round((view.pos[2] - c.z) / 16000) * 16000;
  const p = view.project(wx, c.y, wz);
  if (!p || p.z < 200 || p.z > 11000) return;
  const rr = (c.r * view.foc) / p.z;
  if (p.x < -rr * 2 || p.x > view.W + rr * 2 || p.y < -rr || p.y > view.H + rr) return;
  const f = sstep(3000, 10000, p.d);
  const col = (v, h) => (v + (h - v) * f) | 0;
  const ctx = view.ctx;
  const parts = [[0, 0, 1], [-0.9, 0.12, 0.7], [0.95, 0.1, 0.75], [0.35, -0.25, 0.8], [-0.4, -0.2, 0.6]];
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
  const SEG = 24;
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
  add([0, 0.35, -3.5, 0, 1.95, -4.9, 0, 1.95, -5.3, 0, 0.35, -5.1], TOP);
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
    let nx = (p1[1] - p0[1]) * (p2[2] - p0[2]) - (p1[2] - p0[2]) * (p2[1] - p0[1]);
    let ny = (p1[2] - p0[2]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[2] - p0[2]);
    let nz = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
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

export function drawFrame(ctx, S) {
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
        if ((s0 < -90 && s1 < -90 && s2 < -90 && s3 < -90) || (s0 > W + 90 && s1 > W + 90 && s2 > W + 90 && s3 > W + 90)) continue;
        const y0 = view.cy - (VY[q0] / z0) * view.foc;
        const y1 = view.cy - (VY[q1] / z1) * view.foc;
        const y2 = view.cy - (VY[q2] / z2) * view.foc;
        const y3 = view.cy - (VY[q3] / z3) * view.foc;
        if (y0 < -90 && y1 < -90 && y2 < -90 && y3 < -90) continue;
        if (y0 > H + 90 && y1 > H + 90 && y2 > H + 90 && y3 > H + 90) continue;
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
    const wx = c.x + Math.round((view.pos[0] - c.x) / 16000) * 16000;
    const wz = c.z + Math.round((view.pos[2] - c.z) / 16000) * 16000;
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
