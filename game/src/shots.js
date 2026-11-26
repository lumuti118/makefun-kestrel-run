// Kestrel Run — deterministic screenshot scenes behind ?demo=1..4. Each one
// is a frozen snapshot of a single coherent run: the clock and the score
// rise from shot to shot, and every number on screen comes from the preset
// state below, never from thin air.
//
//   1-cover   0:45   score 0     ring 1 of 10, chase, just airborne
//   2-rings   1:35   score 400   ring 4 just cleared (+150), chase
//   3-landing 2:20   score 880   8 rings done, on the strip centreline
//   4-cockpit 3:05   score 1180  all 10 rings done, cockpit, final approach
//
// Ring values are 100 + a bullseye bonus up to 60, so the totals check out:
// 4 rings = 400, 8 rings = 880, 10 rings = 1180.
import { groundHeight } from './world.js';

export const DEMO_COUNT = 4;

function placePlane(S, x, y, z, yaw, pitch, roll, speed, thr) {
  const p = S.plane;
  Object.assign(p, { x, y, z, yaw, pitch, roll, speed, thr, vy: 0, onGround: false, crashed: 0 });
  p.prev = [x, y, z];
  S.cam.yaw = yaw;
  S.cam.pitch = pitch * 0.5;
  S.cam.roll = roll * 0.55;
}

function baseState(S, time, score, cleared) {
  const m = S.mission;
  m.time = time;
  m.score = score;
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

export function applyDemo(S, n) {
  if (n === 1) {
    baseState(S, 45, 0, 0);
    // 3.4 km short of ring 1, climbing away from the strip.
    placePlane(S, 30, 215, -1400, 0.005, -0.02, 0.04, 68, 0.68);
    return;
  }
  if (n === 2) {
    baseState(S, 95, 400, 4);
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
    S.mission.toast = 'Ring 4 cleared +150';
    S.mission.toastT = 2.6;
    return;
  }
  if (n === 3) {
    baseState(S, 140, 880, 8);
    // Down the runway centreline, 1.7 km out. The next ring sits just past
    // the strip, so the shot reads as a landing approach.
    placePlane(S, 14, 95, -1700, 0, -0.05, -0.05, 49, 0.26);
    S.demoTarget = { x: 0, y: 16, z: 0, kind: 'runway' };
    S.demoLabel = 'Land on the runway';
    return;
  }
  // Demo 4: cockpit, all 10 rings done, on final approach with the last
  // ring still visible ahead through the windshield.
  baseState(S, 185, 1180, 10);
  const last = S.course[9];
  const prev = S.course[8];
  const yaw = Math.atan2(last.x - prev.x, last.z - prev.z);
  placePlane(
    S,
    last.x - Math.sin(yaw) * 600,
    last.y - 5,
    last.z - Math.cos(yaw) * 600,
    yaw, 0.0, 0.1, 67, 0.72,
  );
  S.view = 'cockpit';
  S.mission.toast = 'Ring 10 cleared +150';
  S.mission.toastT = 2.6;
}
