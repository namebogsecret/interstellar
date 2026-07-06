// Top-down (ecliptic-plane) system map — its OWN 2D canvas overlay, drawn
// with the plain 2D context. Deliberately does NOT touch the Three.js scene /
// relativistic pass (ГРАБЛИ.md item 5 risk area) — it only READS the shared
// `positions` Map / ship state that main.js already computes each frame, and
// keeps all its own scratch (orbit cache, last-heading) local to this module.
// World X/Z are the ecliptic plane, world Y is "up" out of the ecliptic (see
// orbits.js::orbitalPosition) — so every point here is just `.x`/`.z`, no
// projection math needed.
import { AU } from '../physics/constants.js';
import { orbitEllipse } from '../physics/orbits.js';
import { t, bodyName } from '../i18n.js';

// Zoom bounds (metres/pixel). MIN shows the Earth-Moon system in detail; MAX
// comfortably frames Neptune's orbit with margin.
const MIN_MPP = 1e5;
const MAX_MPP = 1e11;
// Default view: fit ~2.5 AU (out past Mars) inside ~42% of the smaller screen
// dimension, leaving margin for labels/chrome.
const DEFAULT_HALF_EXTENT = 2.5 * AU;
// Below this zoom (metres/pixel), moon labels start cluttering more than they
// help, so only planets/Sun are labelled beyond it.
const MOON_LABEL_MPP = 3e7;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const hexColor = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0');

// Screen radius for a body's dot: log-scaled off its physical radius so inner
// (small) planets stay visible next to gas giants, clamped to a sane range.
function bodyPixelSize(radiusM) {
  const v = 1.4 + 1.7 * Math.log10(Math.max(radiusM, 2e5) / 2e5);
  return clamp(v, 1.4, 8);
}

// Minimal top-down map: bodies + orbit ellipses + ship + velocity vector +
// target highlight. Toggled by V (wired in main.js); zero per-frame cost
// while closed (draw() early-returns, and the caller guards on sim.showMap).
export class SystemMap {
  constructor(BODIES, byName) {
    this.bodies = BODIES;
    this.byName = byName;
    this.open = false;
    this.metersPerPixel = this._defaultZoom();
    this._lastHeading = -Math.PI / 2;   // arrow points "up" before any motion

    // Parent-relative orbit ellipses are sampled ONCE (not per frame) — same
    // spirit as main.js's static orbitLines geometry, just kept as plain
    // number pairs here since we draw with the 2D context, not Three.js.
    this._orbitCache = new Map();
    this._buildOrbitCache();

    this.canvas = document.createElement('canvas');
    this.canvas.id = 'mapcanvas';
    // No explicit z-index: stays in the same auto-stacking bucket as #hud/
    // #nav/#help (all position:fixed, z-index:auto) and is inserted BEFORE
    // them in the DOM below, so it paints above the WebGL <canvas id="view">
    // (which is unpositioned and always paints first) but below the HUD text.
    this.canvas.style.cssText = 'position:fixed; inset:0; display:none;';
    const hud = document.getElementById('hud');
    document.body.insertBefore(this.canvas, hud || null);
    this.ctx = this.canvas.getContext('2d');

    this._wheelHandler = (e) => this._onWheel(e);
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _defaultZoom() {
    const minDim = Math.min(window.innerWidth, window.innerHeight) || 1;
    return DEFAULT_HALF_EXTENT / (minDim * 0.42);
  }

  _buildOrbitCache() {
    for (const b of this.bodies) {
      if (!b.parent || !b.period) continue;
      const pts = orbitEllipse(b, 128);   // fewer segments than the 3D render; a flat 2D line doesn't need 256
      const flat = new Float64Array(pts.length * 2);
      for (let i = 0; i < pts.length; i++) { flat[i * 2] = pts[i].x; flat[i * 2 + 1] = pts[i].z; }
      const isMoon = this.byName(b.parent).parent != null;
      this._orbitCache.set(b.name, { flat, parent: b.parent, isMoon });
    }
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    this._cssW = window.innerWidth;
    this._cssH = window.innerHeight;
    this.canvas.width = Math.round(this._cssW * dpr);
    this.canvas.height = Math.round(this._cssH * dpr);
    // Draw in CSS-pixel coordinates; the backing store is DPR-scaled.
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _onWheel(e) {
    e.preventDefault();
    // Scroll up/forward (negative deltaY) zooms in; down zooms out.
    const factor = Math.exp(e.deltaY * 0.0015);
    this.metersPerPixel = clamp(this.metersPerPixel * factor, MIN_MPP, MAX_MPP);
  }

  // Flip open/closed; wires/unwires the wheel listener so zoom only ever
  // acts while the map is actually visible. Returns the new open state
  // (main.js mirrors it into sim.showMap).
  toggle() {
    this.open = !this.open;
    this.canvas.style.display = this.open ? 'block' : 'none';
    if (this.open) this.canvas.addEventListener('wheel', this._wheelHandler, { passive: false });
    else this.canvas.removeEventListener('wheel', this._wheelHandler);
    return this.open;
  }

  // positions: Map<name, THREE.Vector3> (heliocentric, READ-ONLY here).
  // ship: the Ship instance (reads .pos/.v only). sim: reads .target only.
  draw(positions, ship, sim) {
    if (!this.open) return;
    const ctx = this.ctx, w = this._cssW, h = this._cssH, mpp = this.metersPerPixel;
    const cx = w / 2, cy = h / 2;
    // Centred on the Sun, which is always the world origin (see main.js
    // computePositions: `if (!b.parent) p.set(0, 0, 0);`).
    const sx = (wx) => cx + wx / mpp;
    const sy = (wz) => cy - wz / mpp;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(4, 10, 16, 0.6)';
    ctx.fillRect(0, 0, w, h);

    // --- orbit ellipses (parent-relative cache + current parent position) ---
    ctx.lineWidth = 1;
    for (const entry of this._orbitCache.values()) {
      const pp = positions.get(entry.parent);
      if (!pp) continue;
      ctx.strokeStyle = entry.isMoon ? 'rgba(68, 85, 102, 0.35)' : 'rgba(74, 107, 136, 0.55)';
      ctx.beginPath();
      const flat = entry.flat;
      for (let i = 0; i < flat.length; i += 2) {
        const px = sx(pp.x + flat[i]), py = sy(pp.z + flat[i + 1]);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    // --- bodies: Sun distinct at centre, planets/moons as sized dots + labels ---
    ctx.textBaseline = 'middle';
    ctx.font = '11px "SF Mono", Menlo, Consolas, monospace';
    for (const b of this.bodies) {
      const p = positions.get(b.name);
      if (!p) continue;
      const px = sx(p.x), py = sy(p.z);
      const isSun = !b.parent;
      const r = isSun ? 9 : bodyPixelSize(b.radius);

      if (isSun) { ctx.shadowColor = 'rgba(255, 223, 140, 0.9)'; ctx.shadowBlur = 14; }
      ctx.fillStyle = isSun ? '#fff3c4' : hexColor(b.color);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      const isMoon = b.parent && this.byName(b.parent).parent != null;
      if (!isMoon || mpp < MOON_LABEL_MPP) {
        ctx.fillStyle = 'rgba(190, 230, 245, 0.85)';
        ctx.fillText(bodyName(b.name), px + r + 4, py);
      }
    }

    // --- target: ring + dashed line from the ship ---
    if (sim.target) {
      const tp = positions.get(sim.target.name);
      if (tp) {
        const tx = sx(tp.x), ty = sy(tp.z);
        const shx = sx(ship.pos.x), shy = sy(ship.pos.z);
        ctx.save();
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = 'rgba(255, 210, 122, 0.45)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(shx, shy); ctx.lineTo(tx, ty); ctx.stroke();
        ctx.restore();

        ctx.strokeStyle = '#ffd27a';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(tx, ty, 10, 0, Math.PI * 2); ctx.stroke();
      }
    }

    // --- ship: triangle marker (heading) + velocity arrow ---
    {
      const shx = sx(ship.pos.x), shy = sy(ship.pos.z);
      const vx = ship.v.x, vz = ship.v.z;
      const speed2d = Math.hypot(vx, vz);
      // Screen-space heading: y grows downward while our sy() flips z, so the
      // on-screen angle is atan2(-vz, vx). Below the noise floor, keep the
      // last drawn heading instead of snapping to an arbitrary direction.
      const heading = speed2d > 1 ? Math.atan2(-vz, vx) : this._lastHeading;
      this._lastHeading = heading;

      if (speed2d > 1) {
        const len = 28;
        const ex = shx + Math.cos(heading) * len, ey = shy + Math.sin(heading) * len;
        ctx.strokeStyle = '#7CFC8A';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(shx, shy); ctx.lineTo(ex, ey); ctx.stroke();
        const ah = 6;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - ah * Math.cos(heading - 0.4), ey - ah * Math.sin(heading - 0.4));
        ctx.lineTo(ex - ah * Math.cos(heading + 0.4), ey - ah * Math.sin(heading + 0.4));
        ctx.closePath();
        ctx.fillStyle = '#7CFC8A';
        ctx.fill();
      }

      const size = 7;
      ctx.save();
      ctx.translate(shx, shy);
      ctx.rotate(heading);
      ctx.beginPath();
      ctx.moveTo(size, 0);
      ctx.lineTo(-size * 0.7, size * 0.6);
      ctx.lineTo(-size * 0.7, -size * 0.6);
      ctx.closePath();
      ctx.fillStyle = '#eaffff';
      ctx.fill();
      ctx.restore();
    }

    // --- chrome: title / current target / legend / zoom hint ---
    ctx.textBaseline = 'top';
    ctx.font = '13px "SF Mono", Menlo, Consolas, monospace';
    ctx.fillStyle = 'rgba(159, 231, 255, 0.9)';
    ctx.fillText(t('map.title'), 16, 16);

    ctx.font = '11px "SF Mono", Menlo, Consolas, monospace';
    ctx.fillStyle = 'rgba(215, 246, 255, 0.85)';
    if (sim.target) ctx.fillText(t('map.target', { name: bodyName(sim.target.name) }), 16, 36);

    ctx.fillStyle = 'rgba(91, 124, 136, 0.9)';
    ctx.fillText(t('map.legend'), 16, h - 40);
    ctx.fillText(t('map.hint'), 16, h - 24);
  }
}
