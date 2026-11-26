// Kestrel Run — all sound is synthesised in code with WebAudio: an engine
// hum that follows throttle and speed, plus short beeps for rings, landings
// and crashes. No audio files, no network.
export function createAudio() {
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

  function beep(freq, dur, type = 'sine', vol = 0.08, slide = 0) {
    if (!ctx) return;
    try {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const t = ctx.currentTime;
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.linearRampToValueAtTime(freq + slide, t + dur);
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
