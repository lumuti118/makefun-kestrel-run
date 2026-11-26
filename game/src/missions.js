// Kestrel Run — mission state: rings, score, rating, and where the pilot
// should fly next. No rendering here, just the rules of the sortie.
import { SCORE, WORLD } from './config.js';

export function createMission() {
  return {
    cleared: 0,
    score: 0,
    time: 0,
    running: false,
    done: false,
    rating: '',
    crashes: 0,
    toast: '',
    toastT: 0,
    lastCrash: '',
  };
}

export function setToast(S, text, seconds = 2.6) {
  S.mission.toast = text;
  S.mission.toastT = seconds;
}

/** Where the guidance diamond points: next ring, or the runway once done.
 *  Demo scenes may pin a fixed target/label so a shot reads as intended. */
export function missionTarget(S) {
  if (S.demoTarget) return S.demoTarget;
  const m = S.mission;
  if (m.cleared < S.course.length) {
    const r = S.course[m.cleared];
    return { x: r.x, y: r.y, z: r.z, kind: 'ring' };
  }
  return { x: 0, y: WORLD.RUNWAY_Y + 4, z: 0, kind: 'runway' };
}

/** Short label for the mission panel, e.g. "Ring 4 of 10". */
export function missionLabel(S) {
  if (S.demoLabel) return S.demoLabel;
  const m = S.mission;
  if (m.done) return 'Mission complete';
  if (m.cleared < S.course.length) return `Ring ${Math.min(m.cleared + 1, WORLD.RING_COUNT)} of ${WORLD.RING_COUNT}`;
  return 'Land on the runway';
}

export function formatTime(seconds) {
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(Math.floor(seconds % 60)).padStart(2, '0');
  return `${mm}:${ss}`;
}

export { SCORE };
