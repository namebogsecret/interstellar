import * as THREE from 'three';
import { fmtDist, bodyName } from '../i18n.js';

// Screen-space overlay drawn over the WebGL canvas: body name tags, a target
// reticle (with an off-screen direction arrow), prograde/retrograde flight
// markers, a live status line and a transient event log. All cheap DOM.
export class Overlay {
  constructor(views) {
    this.root = document.getElementById('overlay');
    this.labels = new Map();
    for (const [name] of views) {
      const el = document.createElement('div');
      el.className = 'wlabel';
      el.innerHTML = `<span class="dot"></span><span class="txt"></span>`;
      this.root.appendChild(el);
      this.labels.set(name, el);
    }
    this.reticle = mk('div', 'reticle', this.root);
    this.arrow = mk('div', 'edgearrow', this.root); this.arrow.textContent = '➤';
    this.pro = mk('div', 'marker prograde', this.root); this.pro.textContent = '⊕';
    this.retro = mk('div', 'marker retrograde', this.root); this.retro.textContent = '⊗';
    this.status = document.getElementById('status');
    this.log = document.getElementById('eventlog');
    this._events = [];
  }

  event(text) {
    this._events.push({ text, t: performance.now() });
    if (this._events.length > 4) this._events.shift();
    this._render_events();
  }
  _render_events() {
    this.log.innerHTML = this._events.map((e) => `<div>${e.text}</div>`).join('');
  }
  setStatus(html) { this.status.innerHTML = html; }

  // Project a world-relative point (camera is at the origin) to screen pixels.
  _project(world, camera, qInv, W, H, out) {
    out.copy(world).applyQuaternion(qInv);     // -> camera space
    const front = out.z < 0;
    const ndc = out.clone().applyMatrix4(camera.projectionMatrix); // divides by w
    return {
      front,
      x: (ndc.x * 0.5 + 0.5) * W,
      y: (-ndc.y * 0.5 + 0.5) * H,
      cam: out.clone(),
    };
  }

  update(camera, views, ship, target, targetRelPos) {
    const W = window.innerWidth, H = window.innerHeight;
    const qInv = camera.quaternion.clone().invert();
    const tmp = new THREE.Vector3();

    // --- body name tags ----------------------------------------------------
    for (const [name, view] of views) {
      const el = this.labels.get(name);
      const rel = view.group.position;                 // already ship-relative
      const p = this._project(rel, camera, qInv, W, H, tmp);
      const big = view.apparentPx > H * 0.6;            // fills the screen
      if (!p.front || big || (view.apparentPx < 0.5 && name !== 'Sun')) {
        el.style.display = 'none';
        continue;
      }
      el.style.display = 'flex';
      el.style.left = p.x + 'px';
      el.style.top = p.y + 'px';
      el.querySelector('.txt').textContent = `${bodyName(name)}  ·  ${fmtDist(view.dist)}`;
      el.classList.toggle('istarget', target && name === target.name);
    }

    // --- target reticle + off-screen arrow ---------------------------------
    if (target && targetRelPos) {
      const p = this._project(targetRelPos, camera, qInv, W, H, tmp);
      const onScreen = p.front && p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H;
      if (onScreen) {
        this.reticle.style.display = 'block';
        this.reticle.style.left = p.x + 'px';
        this.reticle.style.top = p.y + 'px';
        this.arrow.style.display = 'none';
      } else {
        this.reticle.style.display = 'none';
        // Direction to target in screen space (handle behind-camera).
        const d = new THREE.Vector2(p.cam.x, -p.cam.y);
        if (p.cam.z > 0) d.negate();            // behind -> opposite side
        if (d.lengthSq() < 1e-9) d.set(0, -1);
        d.normalize();
        const cx = W / 2, cy = H / 2, m = 60;
        const ex = cx + d.x * (cx - m), ey = cy + d.y * (cy - m);
        this.arrow.style.display = 'block';
        this.arrow.style.left = ex + 'px';
        this.arrow.style.top = ey + 'px';
        this.arrow.style.transform = `translate(-50%,-50%) rotate(${Math.atan2(d.y, d.x)}rad)`;
      }
    } else {
      this.reticle.style.display = 'none';
      this.arrow.style.display = 'none';
    }

    // --- prograde / retrograde flight markers ------------------------------
    if (ship.speed > 1) {
      const v = tmp.copy(ship.v).normalize().multiplyScalar(1e9);
      const pp = this._project(v, camera, qInv, W, H, new THREE.Vector3());
      this._place(this.pro, pp, W, H);
      const rr = this._project(v.multiplyScalar(-1), camera, qInv, W, H, new THREE.Vector3());
      this._place(this.retro, rr, W, H);
    } else {
      this.pro.style.display = 'none'; this.retro.style.display = 'none';
    }
  }

  _place(el, p, W, H) {
    if (p.front && p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H) {
      el.style.display = 'block';
      el.style.left = p.x + 'px';
      el.style.top = p.y + 'px';
    } else el.style.display = 'none';
  }
}

function mk(tag, cls, parent) {
  const e = document.createElement(tag);
  e.className = cls;
  parent.appendChild(e);
  return e;
}
