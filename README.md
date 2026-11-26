[![Kestrel Run — best-flight-game-20261126-0057](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun)
[![Rank](https://make.fun/badge/best-flight-game-20261126-0057/lumuti118/makefun-kestrel-run/rank.svg)](https://make.fun)
[![Reward](https://make.fun/badge/best-flight-game-20261126-0057/lumuti118/makefun-kestrel-run/reward.svg)](https://make.fun)

# Kestrel Run

**Kestrel Run: 3D island flight, 10 rings, takeoff + landing, full HUD**

A 3D island flight game, software-rendered on a 2D canvas — no libraries, no
network, no assets. Take off from Harbour Strip, thread 10 glowing rings
around the archipelago, then land back on the runway for a mission rating.

- **Fly it:** throttle (Shift / Ctrl, wheel, or 0–9), pitch (W/S or arrows),
  bank to turn (A/D or arrows), rudder (Q/E), brake (Space), mouse steering
  (click), chase/cockpit view (C), pause (P), restart (Enter).
- **Feel it:** stall sink and warning, banked turns, ground roll and
  rotation, gentle landings vs. crashes with respawn at the last ring.
- **Score it:** 100 points per ring plus a bullseye bonus up to 60, +300 for
  landing after all 10 rings, and an S/A/B mission rating on your time.
- **Read it:** five analogue dials (airspeed, attitude, compass, altimeter,
  vertical speed), speed and altitude tapes, heading tape, pitch ladder
  clipped to the sky above the instrument panel, guidance diamond to the
  next ring or the runway, and a WebAudio engine hum generated in code.

## Run it

Double-click `game/index.html` — it plays straight from `file://` in desktop
Chrome (the game is one classic script, `game/game.js`, no modules, no
server needed). Or serve it:

```sh
node serve.ts
```

Then open http://localhost:8080 in a browser.

Deterministic staged screenshot scenes: `?demo=1` (takeoff), `?demo=2`
(rings), `?demo=3` (cockpit, final approach after all 10 rings), `?demo=4`
(short final, runway filling the frame). The four screenshots are staged
scenes rendered live by the game code, in chronological order, with clock and
score that the real scoring rules can produce (0:45 / 0 → 1:35 / 554 after 4
rings → 3:05 / 1390 after 10 rings → 3:21 / short final) — not a recording of
one played run.

## v3 changes

- **Minimap** (top right): north-up island picture with the runway, the ring
  route, cleared / next / remaining rings and the plane's heading.
- **PULL UP** warning when the ground is under ~4.5 s away at the current sink.
- Altitude and speed tapes no longer draw negative values on the ground.
- HUD text has a soft shadow and the title block a backing panel, so it stays
  readable over clouds and bright terrain.
- Staged scenes re-ordered and re-scored: cockpit final approach (3:05) now
  comes before the short-final landing frame (3:21), and every score is
  computed from the real rules (100 + bullseye bonus per ring).
- Play-tested in headless Chromium from `file://`: take-off, ring pass,
  crash + respawn and a full landing to "Mission complete", no console errors.

## Provenance

Built with AI assistance. An earlier single-file prototype of the same game
informed the design, constants and structure; this is a restructured
re-implementation of it, not a from-scratch design.

---

Built for [make.fun](https://make.fun/r/7vjqmhmr) — best-flight-game-20261126-0057.
