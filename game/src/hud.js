// Kestrel Run — the cockpit: five analogue dials, speed/altitude tapes,
// heading tape, pitch ladder, guidance diamond and the mission panel.
// Everything is drawn from the live sim state, so the instruments always
// tell the truth about the flight.
import { clamp, groundHeight, TAU } from './world.js';
import { formatTime, missionLabel, missionTarget } from './missions.js';

const HUD = '#8dffd9';
const AMBER = '#ffb54a';
const PANEL = 'rgba(5,14,20,0.46)';

function text(ctx, s, x, y, size, color, align = 'center', weight = 600) {
  ctx.font = `${weight} ${size}px system-ui, "Segoe UI", Roboto, Arial, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
}

/** One scrolling tape (speed or altitude) with a boxed current value. */
function drawTape(ctx, U, x, y, h, val, minor, major, pxPer, side, label, fmt) {
  const w = 96 * U;
  ctx.save();
  ctx.fillStyle = PANEL;
  ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.beginPath();
  ctx.rect(x - w / 2, y - h / 2, w, h);
  ctx.clip();
  const lo = val - h / 2 / pxPer;
  const hi = val + h / 2 / pxPer;
  ctx.strokeStyle = HUD;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  const edge = x + side * (w / 2);
  for (let v = Math.ceil(lo / minor) * minor; v <= hi; v += minor) {
    const yy = y - (v - val) * pxPer;
    const big = Math.abs(v / major - Math.round(v / major)) < 1e-6;
    ctx.moveTo(edge, yy);
    ctx.lineTo(edge - side * (big ? 16 : 8) * U, yy);
  }
  ctx.stroke();
  for (let v = Math.ceil(lo / major) * major; v <= hi; v += major) {
    const yy = y - (v - val) * pxPer;
    if (Math.abs(yy - y) < 18 * U) continue;
    text(ctx, fmt(v), x - side * 8 * U, yy, 12 * U, HUD, 'center', 500);
  }
  ctx.restore();
  ctx.fillStyle = 'rgba(4,10,14,0.9)';
  ctx.strokeStyle = HUD;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.rect(x - 38 * U, y - 13 * U, 76 * U, 26 * U);
  ctx.fill();
  ctx.stroke();
  text(ctx, fmt(val), x, y + 1, 17 * U, '#eafff7', 'center', 700);
  text(ctx, label, x, y - h / 2 - 11 * U, 11 * U, HUD, 'center', 600);
}

function drawLadder(ctx, U, S, view) {
  const yawC = S.view === 'cockpit' ? S.plane.yaw : S.cam.yaw;
  const hs = Math.sin(yawC);
  const hc = Math.cos(yawC);
  const D2R = Math.PI / 180;
  ctx.save();
  ctx.strokeStyle = HUD;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.85;
  for (let a = -30; a <= 30; a += 10) {
    const ar = a * D2R;
    const ca = Math.cos(ar);
    const sa = Math.sin(ar);
    const half = a === 0 ? 260 : 90;
    const cxw = view.pos[0] + hs * ca * 1000;
    const cyw = view.pos[1] + sa * 1000;
    const czw = view.pos[2] + hc * ca * 1000;
    const l = view.project(cxw - hc * half, cyw, czw + hs * half);
    const r = view.project(cxw + hc * half, cyw, czw - hs * half);
    if (!l || !r || l.z < 5 || r.z < 5) continue;
    const mid = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    const lp = [l.x, l.y];
    const rp = [r.x, r.y];
    ctx.beginPath();
    const a1 = mid(lp, rp, 0.38);
    const a2 = mid(lp, rp, 0.62);
    ctx.moveTo(lp[0], lp[1]);
    ctx.lineTo(a1[0], a1[1]);
    ctx.moveTo(a2[0], a2[1]);
    ctx.lineTo(rp[0], rp[1]);
    ctx.stroke();
    if (a !== 0) {
      text(ctx, String(Math.abs(a)), lp[0] - 14 * U, lp[1], 11 * U, HUD, 'center', 500);
      text(ctx, String(Math.abs(a)), rp[0] + 14 * U, rp[1], 11 * U, HUD, 'center', 500);
    }
  }
  ctx.restore();
  // Flight-path marker: where the velocity vector actually points.
  const p = S.plane;
  const sp = Math.max(p.speed, 1);
  const vx = (p.speed * Math.cos(p.pitch) * Math.sin(p.yaw)) / sp;
  const vy = p.vy / sp;
  const vz = (p.speed * Math.cos(p.pitch) * Math.cos(p.yaw)) / sp;
  const fpm = view.project(view.pos[0] + vx * 600, view.pos[1] + vy * 600, view.pos[2] + vz * 600);
  if (fpm && fpm.z > 5) {
    ctx.strokeStyle = '#eafff7';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(fpm.x, fpm.y, 8 * U, 0, TAU);
    ctx.moveTo(fpm.x - 20 * U, fpm.y);
    ctx.lineTo(fpm.x - 8 * U, fpm.y);
    ctx.moveTo(fpm.x + 8 * U, fpm.y);
    ctx.lineTo(fpm.x + 20 * U, fpm.y);
    ctx.moveTo(fpm.x, fpm.y - 8 * U);
    ctx.lineTo(fpm.x, fpm.y - 15 * U);
    ctx.stroke();
  }
}

function drawHeadingTape(ctx, U, S, W) {
  const CX = W / 2;
  const D2R = Math.PI / 180;
  const hdg = (((S.plane.yaw / D2R) % 360) + 360) % 360;
  const y = 30 * U;
  const w = 360 * U;
  ctx.save();
  ctx.fillStyle = PANEL;
  ctx.fillRect(CX - w / 2, y - 14 * U, w, 28 * U);
  ctx.beginPath();
  ctx.rect(CX - w / 2, y - 14 * U, w, 28 * U);
  ctx.clip();
  const pxd = 5.2 * U;
  ctx.strokeStyle = HUD;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  for (let d = Math.ceil((hdg - 36) / 5) * 5; d <= hdg + 36; d += 5) {
    const x = CX + (d - hdg) * pxd;
    const big = d % 10 === 0;
    ctx.moveTo(x, y + 14 * U);
    ctx.lineTo(x, y + (big ? 3 : 8) * U);
  }
  ctx.stroke();
  for (let d = Math.ceil((hdg - 36) / 10) * 10; d <= hdg + 36; d += 10) {
    const dn = ((d % 360) + 360) % 360;
    const x = CX + (d - hdg) * pxd;
    if (Math.abs(x - CX) < 30 * U) continue;
    const lab = dn === 0 ? 'N' : dn === 90 ? 'E' : dn === 180 ? 'S' : dn === 270 ? 'W' : String(Math.floor(dn / 10)).padStart(2, '0');
    text(ctx, lab, x, y - 4 * U, lab.length === 1 ? 14 : 11 * U, lab.length === 1 ? AMBER : HUD, 'center', 600);
  }
  ctx.restore();
  ctx.fillStyle = 'rgba(4,10,14,0.92)';
  ctx.strokeStyle = HUD;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.rect(CX - 30 * U, y + 18 * U, 60 * U, 24 * U);
  ctx.fill();
  ctx.stroke();
  text(ctx, `${String(Math.round(hdg) % 360).padStart(3, '0')}°`, CX, y + 31 * U, 16 * U, '#eafff7', 'center', 700);
  ctx.fillStyle = AMBER;
  ctx.beginPath();
  ctx.moveTo(CX, y + 16 * U);
  ctx.lineTo(CX - 5 * U, y + 8 * U);
  ctx.lineTo(CX + 5 * U, y + 8 * U);
  ctx.closePath();
  ctx.fill();
}

function drawGuidance(ctx, U, S, view, W, H) {
  const CX = W / 2;
  const t = missionTarget(S);
  const p = S.plane;
  const proj = view.project(t.x, t.y, t.z);
  const dist = Math.hypot(t.x - p.x, t.y - p.y, t.z - p.z);
  const m = 74 * U;
  let sx;
  let sy;
  let inside = false;
  if (proj && proj.z > 1) {
    sx = proj.x;
    sy = proj.y;
    inside = sx > m && sx < W - m && sy > m && sy < H * 0.74;
  }
  let dxv = 0;
  let dyv = 0;
  if (!inside) {
    if (proj) {
      dxv = proj.x - CX;
      dyv = proj.y - H * 0.42;
    } else {
      // Target behind the camera: point at it through the view centre.
      const c = view.toCam(t.x, t.y, t.z);
      dxv = c[0];
      dyv = -c[1];
    }
    const len = Math.hypot(dxv, dyv) || 1;
    dxv /= len;
    dyv /= len;
    const k = Math.min((W / 2 - m) / (Math.abs(dxv) + 1e-6), (H * 0.36 - m * 0.4) / (Math.abs(dyv) + 1e-6));
    sx = CX + dxv * k;
    sy = H * 0.42 + dyv * k;
  }
  const distTxt = dist > 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`;
  const label = t.kind === 'runway' ? `RUNWAY ${distTxt}` : distTxt;
  ctx.save();
  ctx.strokeStyle = AMBER;
  ctx.fillStyle = AMBER;
  ctx.lineWidth = 2.4;
  if (inside) {
    const s = 16 * U;
    ctx.beginPath();
    ctx.moveTo(sx, sy - s);
    ctx.lineTo(sx + s, sy);
    ctx.lineTo(sx, sy + s);
    ctx.lineTo(sx - s, sy);
    ctx.closePath();
    ctx.stroke();
  } else {
    const ang = Math.atan2(dyv, dxv);
    ctx.translate(sx, sy);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(14 * U, 0);
    ctx.lineTo(-10 * U, -11 * U);
    ctx.lineTo(-4 * U, 0);
    ctx.lineTo(-10 * U, 11 * U);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  text(ctx, label, sx, sy + (inside ? 30 : 28) * U, 13 * U, AMBER, 'center', 700);
}

function dialFace(ctx, cx, cy, r, U) {
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
  g.addColorStop(0, '#1b252c');
  g.addColorStop(1, '#0a1014');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#59666f';
  ctx.lineWidth = 3 * U;
  ctx.stroke();
  ctx.strokeStyle = '#0b1115';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 2.5 * U, 0, TAU);
  ctx.stroke();
}

function needle(ctx, cx, cy, ang, len, col, wd, U) {
  ctx.strokeStyle = col;
  ctx.lineWidth = wd;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - Math.cos(ang) * len * 0.18, cy - Math.sin(ang) * len * 0.18);
  ctx.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
  ctx.stroke();
  ctx.fillStyle = '#c8d2d8';
  ctx.beginPath();
  ctx.arc(cx, cy, 3.4 * U, 0, TAU);
  ctx.fill();
  ctx.lineCap = 'butt';
}

function drawInstruments(ctx, U, S, W, H) {
  const CX = W / 2;
  const D2R = Math.PI / 180;
  const p = S.plane;
  const ph = Math.round(clamp(H * 0.215, 126, 210));
  const top = H - ph;
  const gradP = ctx.createLinearGradient(0, top, 0, H);
  gradP.addColorStop(0, '#2b363e');
  gradP.addColorStop(0.04, '#1a2329');
  gradP.addColorStop(1, '#0d1317');
  ctx.fillStyle = gradP;
  ctx.beginPath();
  ctx.moveTo(0, top + 16 * U);
  ctx.lineTo(W * 0.5 - 330 * U, top);
  ctx.lineTo(W * 0.5 + 330 * U, top);
  ctx.lineTo(W, top + 16 * U);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#4a5963';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, top + 16 * U);
  ctx.lineTo(W * 0.5 - 330 * U, top);
  ctx.lineTo(W * 0.5 + 330 * U, top);
  ctx.lineTo(W, top + 16 * U);
  ctx.stroke();
  const r = Math.min(ph * 0.4, W / 12.6);
  const cy = top + ph * 0.52;
  const sp = r * 2.28;
  const xs = [-2, -1, 0, 1, 2].map((i) => CX + i * sp);
  const kmh = p.speed * 3.6;

  // 1 — airspeed, km/h, 0..360.
  dialFace(ctx, xs[0], cy, r, U);
  const sa = (v) => (135 + 270 * clamp(v / 360, 0, 1)) * D2R;
  ctx.strokeStyle = '#e8eef0';
  ctx.lineWidth = 3 * U;
  ctx.beginPath();
  ctx.arc(xs[0], cy, r * 0.93, sa(122), sa(250));
  ctx.stroke();
  ctx.strokeStyle = '#d6453b';
  ctx.beginPath();
  ctx.arc(xs[0], cy, r * 0.93, sa(0), sa(122));
  ctx.stroke();
  for (let v = 0; v <= 360; v += 20) {
    const a = sa(v);
    const big = v % 60 === 0;
    const r1 = r * (big ? 0.74 : 0.82);
    ctx.strokeStyle = '#c9d4d9';
    ctx.lineWidth = big ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(xs[0] + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.lineTo(xs[0] + Math.cos(a) * r * 0.88, cy + Math.sin(a) * r * 0.88);
    ctx.stroke();
    if (big) text(ctx, String(v), xs[0] + Math.cos(a) * r * 0.6, cy + Math.sin(a) * r * 0.6, r * 0.2, '#dbe6ea', 'center', 600);
  }
  text(ctx, 'KM/H', xs[0], cy + r * 0.34, r * 0.17, HUD, 'center', 600);
  needle(ctx, xs[0], cy, sa(kmh), r * 0.82, AMBER, 3 * U, U);

  // 2 — attitude ball.
  dialFace(ctx, xs[1], cy, r, U);
  ctx.save();
  ctx.beginPath();
  ctx.arc(xs[1], cy, r * 0.94, 0, TAU);
  ctx.clip();
  ctx.translate(xs[1], cy);
  ctx.rotate(-p.roll);
  const off = p.pitch * r * 2.0;
  ctx.fillStyle = '#3f86d0';
  ctx.fillRect(-r * 2, -r * 3 + off, r * 4, r * 3);
  ctx.fillStyle = '#85612f';
  ctx.fillRect(-r * 2, off, r * 4, r * 3);
  ctx.strokeStyle = '#f4f7f8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-r * 2, off);
  ctx.lineTo(r * 2, off);
  ctx.stroke();
  ctx.lineWidth = 1.4;
  for (let a = -30; a <= 30; a += 10) {
    if (!a) continue;
    const yy = off - a * D2R * r * 2.0;
    const w2 = a % 20 === 0 ? r * 0.36 : r * 0.2;
    ctx.beginPath();
    ctx.moveTo(-w2, yy);
    ctx.lineTo(w2, yy);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = AMBER;
  ctx.lineWidth = 3.4 * U;
  ctx.beginPath();
  ctx.moveTo(xs[1] - r * 0.62, cy);
  ctx.lineTo(xs[1] - r * 0.22, cy);
  ctx.lineTo(xs[1] - r * 0.22, cy + r * 0.1);
  ctx.moveTo(xs[1] + r * 0.62, cy);
  ctx.lineTo(xs[1] + r * 0.22, cy);
  ctx.lineTo(xs[1] + r * 0.22, cy + r * 0.1);
  ctx.stroke();
  ctx.fillStyle = AMBER;
  ctx.beginPath();
  ctx.arc(xs[1], cy, 3 * U, 0, TAU);
  ctx.fill();
  ctx.save();
  ctx.translate(xs[1], cy);
  ctx.rotate(-p.roll);
  ctx.fillStyle = '#f4f7f8';
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.9);
  ctx.lineTo(-5 * U, -r * 0.78);
  ctx.lineTo(5 * U, -r * 0.78);
  ctx.fill();
  ctx.restore();

  // 3 — compass rose.
  dialFace(ctx, xs[2], cy, r, U);
  const hdg = (((p.yaw / D2R) % 360) + 360) % 360;
  for (let d = 0; d < 360; d += 10) {
    const a = (d - hdg - 90) * D2R;
    const big = d % 30 === 0;
    ctx.strokeStyle = '#c9d4d9';
    ctx.lineWidth = big ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(xs[2] + Math.cos(a) * r * (big ? 0.76 : 0.84), cy + Math.sin(a) * r * (big ? 0.76 : 0.84));
    ctx.lineTo(xs[2] + Math.cos(a) * r * 0.9, cy + Math.sin(a) * r * 0.9);
    ctx.stroke();
    if (big) {
      const lab = d === 0 ? 'N' : d === 90 ? 'E' : d === 180 ? 'S' : d === 270 ? 'W' : String(d / 10);
      text(ctx, lab, xs[2] + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.62, r * 0.2, lab.length === 1 ? AMBER : '#dbe6ea', 'center', 700);
    }
  }
  ctx.fillStyle = AMBER;
  ctx.beginPath();
  ctx.moveTo(xs[2], cy - r * 0.97);
  ctx.lineTo(xs[2] - 5 * U, cy - r * 0.84);
  ctx.lineTo(xs[2] + 5 * U, cy - r * 0.84);
  ctx.fill();
  ctx.strokeStyle = '#e8eef0';
  ctx.lineWidth = 2.4 * U;
  ctx.beginPath();
  ctx.moveTo(xs[2], cy - r * 0.28);
  ctx.lineTo(xs[2], cy + r * 0.3);
  ctx.moveTo(xs[2] - r * 0.24, cy);
  ctx.lineTo(xs[2] + r * 0.24, cy);
  ctx.moveTo(xs[2] - r * 0.1, cy + r * 0.27);
  ctx.lineTo(xs[2] + r * 0.1, cy + r * 0.27);
  ctx.stroke();
  text(ctx, 'HDG', xs[2], cy + r * 0.5, r * 0.15, HUD, 'center', 600);

  // 4 — altimeter, metres, with a digital window.
  dialFace(ctx, xs[3], cy, r, U);
  const alt = p.y;
  for (let v = 0; v < 1000; v += 20) {
    const a = (-90 + v * 0.36) * D2R;
    const big = v % 100 === 0;
    ctx.strokeStyle = '#c9d4d9';
    ctx.lineWidth = big ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(xs[3] + Math.cos(a) * r * (big ? 0.74 : 0.83), cy + Math.sin(a) * r * (big ? 0.74 : 0.83));
    ctx.lineTo(xs[3] + Math.cos(a) * r * 0.89, cy + Math.sin(a) * r * 0.89);
    ctx.stroke();
    if (big) text(ctx, String(v / 100), xs[3] + Math.cos(a) * r * 0.6, cy + Math.sin(a) * r * 0.6, r * 0.22, '#dbe6ea', 'center', 600);
  }
  text(ctx, 'ALT M', xs[3], cy - r * 0.3, r * 0.15, HUD, 'center', 600);
  ctx.fillStyle = '#05090c';
  ctx.fillRect(xs[3] - r * 0.4, cy + r * 0.22, r * 0.8, r * 0.28);
  text(ctx, String(Math.round(alt)), xs[3], cy + r * 0.37, r * 0.22, '#eafff7', 'center', 700);
  needle(ctx, xs[3], cy, (-90 + ((((alt % 1000) + 1000) % 1000) * 0.36)) * D2R, r * 0.8, AMBER, 3 * U, U);

  // 5 — vertical speed, m/s.
  dialFace(ctx, xs[4], cy, r, U);
  for (let v = -15; v <= 15; v += 5) {
    const a = (180 + (v / 15) * 150) * D2R;
    ctx.strokeStyle = '#c9d4d9';
    ctx.lineWidth = v % 10 === 0 ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(xs[4] + Math.cos(a) * r * 0.76, cy + Math.sin(a) * r * 0.76);
    ctx.lineTo(xs[4] + Math.cos(a) * r * 0.9, cy + Math.sin(a) * r * 0.9);
    ctx.stroke();
    if (v % 10 === 0 || v === 0) text(ctx, String(Math.abs(v)), xs[4] + Math.cos(a) * r * 0.6, cy + Math.sin(a) * r * 0.6, r * 0.18, '#dbe6ea', 'center', 600);
  }
  text(ctx, 'V/S M/S', xs[4], cy + r * 0.38, r * 0.15, HUD, 'center', 600);
  needle(ctx, xs[4], cy, (180 + clamp(p.vy / 15, -1, 1) * 150) * D2R, r * 0.8, AMBER, 3 * U, U);

  // Throttle bar, right of the dials.
  const bx = xs[4] + r * 1.55;
  const bh = r * 1.7;
  const bw = 13 * U;
  ctx.fillStyle = '#05090c';
  ctx.fillRect(bx - bw / 2, cy - bh / 2, bw, bh);
  const fh = bh * p.thr;
  const tg = ctx.createLinearGradient(0, cy + bh / 2, 0, cy - bh / 2);
  tg.addColorStop(0, '#2fd6a2');
  tg.addColorStop(0.7, '#ffb54a');
  tg.addColorStop(1, '#ff6a3a');
  ctx.fillStyle = tg;
  ctx.fillRect(bx - bw / 2, cy + bh / 2 - fh, bw, fh);
  ctx.strokeStyle = '#59666f';
  ctx.lineWidth = 2;
  ctx.strokeRect(bx - bw / 2, cy - bh / 2, bw, bh);
  text(ctx, 'THR', bx, cy - bh / 2 - 10 * U, 11 * U, HUD, 'center', 600);
  text(ctx, `${Math.round(p.thr * 100)}%`, bx, cy + bh / 2 + 11 * U, 11 * U, '#eafff7', 'center', 600);
  if (p.brake) text(ctx, 'BRAKE', xs[0] - r * 1.5, cy, 11 * U, AMBER, 'center', 700);
  if (!p.onGround && p.speed < 38) {
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(S.now * 0.02);
    text(ctx, 'STALL', CX, top - 14 * U, 18 * U, '#ff6a52', 'center', 700);
    ctx.globalAlpha = 1;
  }
  return top;
}

function drawCockpitFrame(ctx, S, W, H) {
  ctx.fillStyle = '#0e1418';
  ctx.fillRect(0, 0, W, H * 0.04);
  for (const s of [1, -1]) {
    const x0 = s > 0 ? 0 : W;
    const g = s;
    ctx.fillStyle = '#10171c';
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.lineTo(x0 + g * W * 0.15, 0);
    ctx.lineTo(x0 + g * W * 0.05, H * 0.68);
    ctx.lineTo(x0, H * 0.78);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#2a363d';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x0 + g * W * 0.15, 0);
    ctx.lineTo(x0 + g * W * 0.05, H * 0.68);
    ctx.stroke();
  }
  ctx.fillStyle = '#121a1f';
  ctx.beginPath();
  ctx.moveTo(0, H * 0.8);
  ctx.lineTo(W * 0.28, H * 0.69);
  ctx.lineTo(W * 0.72, H * 0.69);
  ctx.lineTo(W, H * 0.8);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fill();
  // Nose + spinner seen over the glareshield.
  const g = ctx.createLinearGradient(0, H * 0.62, 0, H * 0.78);
  g.addColorStop(0, '#2a8aa0');
  g.addColorStop(1, '#14596c');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(W * 0.41, H * 0.76);
  ctx.lineTo(W * 0.465, H * 0.64);
  ctx.lineTo(W * 0.535, H * 0.64);
  ctx.lineTo(W * 0.59, H * 0.76);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#f47c28';
  ctx.beginPath();
  ctx.moveTo(W * 0.475, H * 0.655);
  ctx.lineTo(W * 0.525, H * 0.655);
  ctx.lineTo(W * 0.52, H * 0.64);
  ctx.lineTo(W * 0.48, H * 0.64);
  ctx.closePath();
  ctx.fill();
  // Prop blur.
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = '#e8f2f6';
  ctx.beginPath();
  ctx.ellipse(W / 2, H * 0.575, W * 0.2, H * 0.09, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
}

export function drawHud(ctx, S, view) {
  const W = S.w;
  const H = S.h;
  const CX = W / 2;
  const U = clamp(H / 820, 0.72, 1.35);
  const p = S.plane;
  const m = S.mission;
  ctx.save();
  if (S.view === 'cockpit') drawCockpitFrame(ctx, S, W, H);
  const top = drawInstruments(ctx, U, S, W, H);
  drawLadder(ctx, U, S, view);
  drawHeadingTape(ctx, U, S, W);
  const tapeY = H * 0.42 - 10 * U;
  drawTape(ctx, U, CX - 250 * U, tapeY, 200 * U, p.speed * 3.6, 10, 50, 1.1 * U, 1, 'KM/H', (v) => String(Math.round(v)));
  drawTape(ctx, U, CX + 250 * U, tapeY, 200 * U, p.y, 20, 100, 0.55 * U, -1, 'ALT M', (v) => String(Math.round(v)));
  const agl = Math.max(0, p.y - groundHeight(p.x, p.z) - 1);
  text(ctx, `AGL ${Math.round(agl)} m`, CX + 250 * U, tapeY + 118 * U, 12 * U, HUD, 'center', 600);
  drawGuidance(ctx, U, S, view, W, H);
  // Mission panel.
  ctx.fillStyle = PANEL;
  ctx.fillRect(14 * U, 14 * U, 176 * U, 88 * U);
  ctx.strokeStyle = 'rgba(141,255,217,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(14 * U, 14 * U, 176 * U, 88 * U);
  text(ctx, missionLabel(S), 26 * U, 34 * U, 16 * U, AMBER, 'left', 700);
  text(ctx, `Time ${formatTime(m.time)}`, 26 * U, 56 * U, 14 * U, '#eafff7', 'left', 500);
  text(ctx, `Score ${m.score}`, 26 * U, 76 * U, 14 * U, '#eafff7', 'left', 500);
  text(ctx, `Crashes ${m.crashes}`, 26 * U, 94 * U, 12 * U, HUD, 'left', 500);
  text(ctx, 'KESTREL RUN', W - 16 * U, 24 * U, 15 * U, HUD, 'right', 700);
  text(ctx, `${S.view === 'chase' ? 'Chase' : 'Cockpit'} view · C switch · H help`, W - 16 * U, 44 * U, 11 * U, 'rgba(141,255,217,0.75)', 'right', 500);
  if (S.mouse) text(ctx, 'MOUSE STEERING', W - 16 * U, 62 * U, 11 * U, AMBER, 'right', 700);
  // Toast banner.
  if (m.toastT > 0 && m.toast) {
    ctx.globalAlpha = clamp(m.toastT, 0, 1);
    text(ctx, m.toast, CX, H * 0.2, 26 * U, '#fff6dc', 'center', 700);
    ctx.globalAlpha = 1;
  }
  if (p.crashed > 0) {
    ctx.fillStyle = 'rgba(120,20,10,0.35)';
    ctx.fillRect(0, 0, W, H);
    text(ctx, 'CRASHED', CX, H * 0.38, 44 * U, '#ffd9cc', 'center', 800);
    text(ctx, m.lastCrash, CX, H * 0.38 + 40 * U, 16 * U, '#ffd9cc', 'center', 500);
  }
  if (m.done) {
    ctx.fillStyle = 'rgba(4,14,20,0.62)';
    ctx.fillRect(CX - 230 * U, H * 0.24, 460 * U, 150 * U);
    text(ctx, 'Mission complete', CX, H * 0.24 + 38 * U, 30 * U, AMBER, 'center', 800);
    text(ctx, `Rank ${m.rating} · ${formatTime(m.time)} · ${m.score} pts · ${m.crashes} crashes`, CX, H * 0.24 + 80 * U, 16 * U, '#eafff7', 'center', 600);
    text(ctx, 'Press Enter to fly again', CX, H * 0.24 + 112 * U, 14 * U, HUD, 'center', 500);
  }
  if (S.help) {
    const x = 14 * U;
    const y = 116 * U;
    const lines = [
      ['Throttle', 'Shift up · Ctrl down · wheel · 0–9'],
      ['Pitch', 'S / Down climb · W / Up dive'],
      ['Roll', 'A D or ← →  (banking turns)'],
      ['Rudder', 'Q E'],
      ['Brake', 'Space'],
      ['Mouse', 'click to steer, up = climb'],
      ['View', 'C · Pause P · Restart Enter'],
      ['Goal', 'Take off, fly all rings, land'],
    ];
    ctx.fillStyle = PANEL;
    ctx.fillRect(x, y, 292 * U, (lines.length * 20 + 18) * U);
    ctx.strokeStyle = 'rgba(141,255,217,0.5)';
    ctx.strokeRect(x, y, 292 * U, (lines.length * 20 + 18) * U);
    lines.forEach((l, i) => {
      text(ctx, l[0], x + 12 * U, y + (18 + i * 20) * U, 12.5 * U, AMBER, 'left', 700);
      text(ctx, l[1], x + 78 * U, y + (18 + i * 20) * U, 12.5 * U, '#eafff7', 'left', 500);
    });
  }
  if (S.paused) {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, W, H);
    text(ctx, 'Paused', CX, H / 2, 40 * U, '#fff', 'center', 700);
  }
  ctx.restore();
}
