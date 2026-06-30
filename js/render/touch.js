// Touch / mobile controls. Reuses the existing FlightControls plumbing: the
// virtual joystick injects W/A/S/D into the same key set the keyboard uses, and
// drag-to-look writes into the same pitch/yaw accumulator the mouse uses — so
// the flight model and all hooks work identically on a phone.
//
// Layout: a full-screen look-pad (drag to aim) behind a left thumb-stick
// (translate) and a right button cluster (up/down thrust, STOP), plus a bottom
// strip (target / jump / time − + / help). Shown only on coarse-pointer devices.
export class TouchControls {
  constructor(controls, ship, canvas, openHelp) {
    this.controls = controls;
    this.ship = ship;
    this.openHelp = openHelp;
    this.lookSens = 0.0042;
    this._lookId = null;
    this._lookX = 0; this._lookY = 0;
    this._build();
  }

  _build() {
    const root = document.createElement('div');
    root.id = 'touchui';
    root.innerHTML = `
      <div id="joy"><div id="joyknob"></div></div>
      <div id="tbtns-r">
        <button class="tbtn" data-hold="r" title="up">▲</button>
        <button class="tbtn" data-hold="f" title="down">▼</button>
        <button class="tbtn stop" data-tap="kill" title="stop">✖</button>
      </div>
      <div id="tbtns-b">
        <button class="tbtn" data-tap="target">⇆ target</button>
        <button class="tbtn" data-tap="jump">⤓ jump</button>
        <button class="tbtn" data-tap="warpdn">«</button>
        <button class="tbtn" data-tap="warpup">»</button>
        <button class="tbtn" data-tap="help">?</button>
      </div>`;
    document.body.appendChild(root);
    this.root = root;

    // --- look: drag anywhere that isn't a control or a modal to aim ----------
    // No overlay div (it would steal taps from the buttons); we listen on the
    // document and ignore touches that begin on a UI control or the briefing.
    const isUI = (el) => el && el.closest &&
      el.closest('#joy, .tbtn, #startscreen, #langtoggle, #langtoggle2, button, a');
    document.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || isUI(e.target)) return;
      this._lookId = e.pointerId; this._lookX = e.clientX; this._lookY = e.clientY;
    });
    window.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._lookId) return;
      const dx = e.clientX - this._lookX, dy = e.clientY - this._lookY;
      this._lookX = e.clientX; this._lookY = e.clientY;
      this.controls.pitchYawFromMouse.x += -dy * this.lookSens;  // pitch
      this.controls.pitchYawFromMouse.y += -dx * this.lookSens;  // yaw
    });
    const endLook = (e) => { if (e.pointerId === this._lookId) this._lookId = null; };
    window.addEventListener('pointerup', endLook);
    window.addEventListener('pointercancel', endLook);

    // --- left thumb-stick: translate (forward/back + strafe) -----------------
    const joy = root.querySelector('#joy');
    const knob = root.querySelector('#joyknob');
    let joyId = null;
    const keys = this.controls.keys;
    const clearJoy = () => { ['w', 'a', 's', 'd'].forEach((k) => keys.delete(k)); knob.style.transform = ''; };
    joy.addEventListener('pointerdown', (e) => {
      e.preventDefault(); joyId = e.pointerId;
      try { joy.setPointerCapture(e.pointerId); } catch (_) { /* synthetic/edge */ }
    });
    joy.addEventListener('pointermove', (e) => {
      if (e.pointerId !== joyId) return;
      const r = joy.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const max = r.width / 2;
      let nx = (e.clientX - cx) / max, ny = (e.clientY - cy) / max;
      const len = Math.hypot(nx, ny);
      if (len > 1) { nx /= len; ny /= len; }
      knob.style.transform = `translate(${nx * max * 0.6}px, ${ny * max * 0.6}px)`;
      const dz = 0.28;
      ny < -dz ? keys.add('w') : keys.delete('w');
      ny >  dz ? keys.add('s') : keys.delete('s');
      nx >  dz ? keys.add('d') : keys.delete('d');
      nx < -dz ? keys.add('a') : keys.delete('a');
    });
    const endJoy = (e) => { if (e.pointerId === joyId) { joyId = null; clearJoy(); } };
    joy.addEventListener('pointerup', endJoy);
    joy.addEventListener('pointercancel', endJoy);

    // --- buttons: hold = thrust axis, tap = discrete action ------------------
    root.querySelectorAll('.tbtn').forEach((btn) => {
      const hold = btn.dataset.hold, tap = btn.dataset.tap;
      if (hold) {
        const down = (e) => { e.preventDefault(); btn.classList.add('on'); keys.add(hold); };
        const up = (e) => { e.preventDefault(); btn.classList.remove('on'); keys.delete(hold); };
        btn.addEventListener('pointerdown', down);
        btn.addEventListener('pointerup', up);
        btn.addEventListener('pointercancel', up);
        btn.addEventListener('pointerleave', up);
      } else if (tap) {
        btn.addEventListener('pointerdown', (e) => { e.preventDefault(); this._action(tap); });
      }
    });
  }

  _action(name) {
    const h = this.controls.hooks;
    switch (name) {
      case 'kill':   h.onKill?.(); break;
      case 'target': h.onTarget?.(1); break;
      case 'jump':   h.onFastTravel?.(); break;
      case 'warpup': h.onWarp?.(1); break;
      case 'warpdn': h.onWarp?.(-1); break;
      case 'help':   this.openHelp?.(); break;
    }
  }
}
