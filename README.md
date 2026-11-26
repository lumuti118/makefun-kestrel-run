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
(rings), `?demo=3` (landing approach, runway in frame), `?demo=4` (cockpit,
final approach after all 10 rings). The four screenshots are deterministic
staged scenes rendered live by the game code, with clock and score kept
consistent across them (0:45 / 0 → 1:35 / 400 → 2:20 / 880 → 3:05 / 1180) —
not a recording of one played run.

## v2 changes

- Single classic script (`game/game.js`): the game now opens from `file://`
  with no server and no module/CORS block.
- Landing scene re-staged close to the runway so the strip fills the frame.
- Cockpit scene re-staged after the last ring is cleared, on final approach
  with land ahead; the toast now matches the frame.
- Pitch ladder clipped to the sky above the instrument panel — no rung or
  label crosses a dial.
- Code implemented fresh in-session from the user's design reference.

---

Built for [make.fun](https://make.fun/r/7vjqmhmr) — best-flight-game-20261126-0057.
