// Kestrel Run — keyboard + mouse controls. Throttle, stick smoothing and
// toggles live here; the flight model only ever sees a clean control frame.
import { clamp } from './world.js';

export function createInput(canvas, S) {
  const keys = {};
  let mx = 0;
  let my = 0;
  let stickX = 0;
  let stickY = 0;

  function deadzone(v) {
    return Math.abs(v) < 0.08 ? 0 : (v - Math.sign(v) * 0.08) / 0.92;
  }

  window.addEventListener('keydown', (e) => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
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
      const kx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
      const ky = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
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
