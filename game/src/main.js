// Kestrel Run — boot and the one loop. The sim advances in fixed 1/60 s
// steps; the renderer paints what is there. With ?demo=N the game instead
// stages that frozen scene, paints it twice and sets window.__shotReady so
// a screenshot can be taken of exactly that frame.
import { buildCourse } from './world.js';
import { createMission, setToast } from './missions.js';
import { placeOnRunway, resetMission, stepFlight } from './flight.js';
import { drawFrame } from './render.js';
import { drawHud } from './hud.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { applyDemo } from './shots.js';

const STEP = 1 / 60;
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const demoParam = Number.parseInt(params.get('demo') ?? '', 10);
const demo = Number.isInteger(demoParam) && demoParam >= 1 && demoParam <= 4 ? demoParam : 0;
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
