// Kestrel Run — tuning constants. One place for every number that shapes
// how the island, the plane and the mission feel.
export const WORLD = {
  RUNWAY_Y: 12,
  RUNWAY_HALF_LEN: 600,
  RUNWAY_HALF_W: 28,
  RING_COUNT: 10,
  RING_RADIUS: 60,
  GRID_CELL: 170,
  GRID_R: 34,
  HAZE_NEAR: 1500,
  HAZE_FAR: 5900,
  SKY_TOP: [46, 108, 184],
  SKY_MID: [150, 196, 230],
  HAZE: [208, 226, 236],
  SEA: [22, 94, 146],
  SAND: [224, 208, 158],
};

export const PLANE = {
  THRUST: 22,
  DRAG: 0.0026,
  STALL_SPEED: 33,
  ROTATE_SPEED: 32,
  LIFTOFF_SPEED: 37,
  ROLL_RATE: 2.0,
  PITCH_RATE: 1.0,
  MAX_ROLL: 1.3,
  MAX_PITCH: 1.15,
  TURN_G: 9.8,
  GRAV: 9.8,
  CRASH_TIME: 2.6,
  START: { x: 0, y: 13, z: -520, yaw: 0 },
};

export const SCORE = {
  RING: 100,
  BULLSEYE_MAX: 60,
  LANDING_BONUS: 300,
  RATING_S: 260,
  RATING_A: 340,
};

export const SUN_DIR = [0.4494, 0.799, 0.3995];
