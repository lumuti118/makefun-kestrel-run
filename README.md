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
  vertical speed), speed and altitude tapes, heading tape, pitch ladder,
  guidance diamond to the next ring or the runway, and a WebAudio engine hum
  generated in code.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080 in a browser.

Deterministic screenshot scenes: `?demo=1` (takeoff), `?demo=2` (rings),
`?demo=3` (landing approach), `?demo=4` (cockpit, final ring).

---

Built for [make.fun](https://make.fun/r/7vjqmhmr) — best-flight-game-20261126-0057.
