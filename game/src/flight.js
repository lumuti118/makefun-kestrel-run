// Kestrel Run — arcade flight model: ground roll and rotation, banked turns,
// stall sink, runway landings and crashes, ring crossings. Returns a list of
// events each step so main.js can play sounds and show toasts.
import { PLANE, SCORE, WORLD } from './config.js';
import { groundHeight } from './world.js';

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function placeOnRunway(S) {
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

export function respawn(S) {
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

export function resetMission(S) {
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
export function stepFlight(S, dt, ctl) {
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
