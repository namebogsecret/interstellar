// First-30-seconds onboarding hint (C3) — a single, small nudge for someone
// who has never flown before: (1) move/look, then (2) the instant
// fast-travel "wow" (key G / touch ⤓ jump). There is no timer — it dismisses
// only on action (noteThrust()/noteJump()) or explicitly via the "Пропустить"
// span or Escape (both call skip()), and stays gone for good via localStorage.
// Mirrors js/missions.js's
// MissionTracker house pattern: the class owns its own DOM overlay +
// localStorage, `t` is injected by the caller (main.js) rather than this
// module importing ./i18n.js itself — same reasoning as missions.js, though
// this module is render-only and never runs under the Node test harness
// (unlike missions.js's pure predicates), so constructor injection here is
// purely for house-style consistency, not a Node-compat requirement.
export class Onboarding {
  constructor(t, isTouch) {
    this._t = t;
    this._isTouch = isTouch;
    this.el = document.createElement('div');
    this.el.id = 'onboardhint';
    // top / font-size / max-width are deliberately NOT set here — they live
    // in css/style.css (#onboardhint + its @media max-width:760px override)
    // because they need a real responsive correction, and an inline style
    // always beats an external rule short of !important; see the comment in
    // style.css next to #onboardhint for the exact clearance math against
    // #hud/#nav. Everything below is static regardless of viewport, so it
    // stays inline like missionpanel/targetlist's cssText.
    this.el.style.cssText = `
      position: fixed; left: 50%; transform: translateX(-50%);
      text-align: center; z-index: 6;
      font-family: "SF Mono", "Cascadia Code", Menlo, Consolas, monospace;
      line-height: 1.6;
      color: var(--fg); background: var(--bg); border: 1px solid var(--line);
      border-radius: 8px; padding: 8px 14px; backdrop-filter: blur(4px);
      text-shadow: 0 0 6px rgba(0,0,0,0.8); pointer-events: none; display: none;
    `;
    document.body.appendChild(this.el);
    // Escape is the one input Pointer Lock never retargets (unlike click,
    // which the browser redirects to the locked element while flying — see
    // js/main.js's `H` handler and TouchControls' openHelp for the same
    // reasoning). Wiring it to skip() gives "Пропустить" a path that works
    // even if the mouse is locked and the player never presses G.
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.el.style.display === 'block') this.skip();
    });
  }

  _done(key) { try { return localStorage.getItem(key) === '1'; } catch { return false; } }
  _mark(key) { try { localStorage.setItem(key, '1'); } catch { /* storage disabled */ } }

  // Renders whichever of the two hints is still outstanding (thrust first,
  // then jump), or hides the element once both are done. Safe to call
  // repeatedly — noteThrust()/noteJump() call back into this to advance the
  // visible hint without the caller needing to know the internal sequencing.
  show() {
    if (this._done('iss_onboard_thrust') && this._done('iss_onboard_jump')) { this.el.style.display = 'none'; return; }
    const t = this._t;
    const key = !this._done('iss_onboard_thrust')
      ? (this._isTouch ? 'onboard.hint1.touch' : 'onboard.hint1.desktop')
      : (this._isTouch ? 'onboard.hint2.touch' : 'onboard.hint2.desktop');
    this.el.innerHTML = `<span>${t(key)}</span> &nbsp;·&nbsp; <span class="skip" style="pointer-events:auto; cursor:pointer; color:var(--dim); text-decoration:underline dotted;">${t('onboard.skip')}</span>`;
    this.el.style.display = 'block';
    this.el.querySelector('.skip').addEventListener('click', () => this.skip());
  }

  // Called every frame the ship has a nonzero thrust direction (main.js
  // frame loop). No-op once already marked — cheap to call unconditionally.
  noteThrust() {
    if (this._done('iss_onboard_thrust')) return;
    this._mark('iss_onboard_thrust');
    if (this.el.style.display === 'block') this.show();
  }

  // Called on fast-travel (G / touch jump button) via controls' onFastTravel
  // hook in main.js.
  noteJump() {
    if (this._done('iss_onboard_jump')) return;
    this._mark('iss_onboard_jump');
    if (this.el.style.display === 'block') this.show();
  }

  skip() {
    this._mark('iss_onboard_thrust');
    this._mark('iss_onboard_jump');
    this.el.style.display = 'none';
  }
}
