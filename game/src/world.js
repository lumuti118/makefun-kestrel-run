// Kestrel Run — the island world: heightfield, ring course, harbour town,
// trees and clouds. Everything here is deterministic: same input, same island.
import { WORLD } from './config.js';

const TAU = Math.PI * 2;

/** Fast deterministic hash of an integer lattice point, in [0, 1). */
export function latticeHash(ix, iz) {
  let h = (Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

/** Smoothstep that also works with a reversed edge pair (e0 > e1). */
export function sstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Bilinear value noise over the integer lattice. */
export function valueNoise(x, z) {
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
export function fbm(x, z) {
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
export function groundHeight(x, z) {
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
export function buildCourse() {
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
export const BUILDINGS = (() => {
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

/** Puffy clouds tiled across a 16 km square that wraps around the camera. */
export const CLOUDS = (() => {
  const out = [];
  for (let i = 0; i < 42; i += 1) {
    out.push({
      x: (latticeHash(i, 41) - 0.5) * 16000,
      z: (latticeHash(i, 43) - 0.5) * 16000,
      y: 950 + latticeHash(i, 47) * 700,
      r: 140 + latticeHash(i, 53) * 200,
    });
  }
  return out;
})();

export { TAU };
