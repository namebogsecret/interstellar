// Target-selection LIST overlay (key T) — a proximity-sorted ALTERNATIVE to
// the Tab/Shift+Tab cycle (js/render/controls.js), which this does NOT
// replace or change. Pure DOM (no canvas, no Three.js scene) so a row click
// is a native DOM click, not custom hit-testing. Mirrors js/render/map.js's
// house pattern (item 2): the module builds its own overlay element, reuses
// the existing --fg/--bg/--line CSS custom properties from css/style.css (no
// stylesheet/HTML edits needed), and adds ZERO per-frame cost — the list is a
// static snapshot taken once at open time, not redrawn every animation frame
// (see ТЗ: "live re-sort while open" is an explicit nice-to-have, not
// required, and is skipped here to keep the change scoped).
import { t, bodyName, fmtDist } from '../i18n.js';

// Only the first 9 rows get a digit shortcut (1-9). Rows beyond that are
// still visible and mouse-clickable, just without a number key — with 19
// bodies today that's the closer half of the list; if the body count grows
// well past 9, revisit (paging / two-digit entry) rather than silently
// stretching this cap.
const MAX_DIGIT_ROWS = 9;

export class TargetList {
  // hooks: { onSelect(body), onOpenChange(isOpen) } — both optional.
  constructor(BODIES, hooks = {}) {
    this.bodies = BODIES;
    this.hooks = hooks;
    this.open = false;
    this._rows = [];              // body objects in row order (index 0 = row "1")
    this._keydownHandler = null;  // only bound while open (§ toggle/_openWith/_close)

    this.panel = document.createElement('div');
    this.panel.id = 'targetlist';
    // Deliberately NOT the shared ".panel" class: that class sets
    // pointer-events:none (world-space HUD panels are click-through by
    // design), but this overlay needs real clicks on its rows. Font/color
    // values below match .panel exactly (css/style.css) so it still reads as
    // the same HUD family.
    this.panel.style.cssText = `
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      width: 320px; max-height: 66vh; overflow-y: auto; z-index: 9;
      font: 12px/1.5 "SF Mono", "Cascadia Code", Menlo, Consolas, monospace;
      color: var(--fg); background: var(--bg); border: 1px solid var(--line);
      border-radius: 8px; padding: 10px 12px; backdrop-filter: blur(4px);
      text-shadow: 0 0 6px rgba(0, 0, 0, 0.8); pointer-events: auto; display: none;
    `;
    const hud = document.getElementById('hud');
    document.body.insertBefore(this.panel, hud || null);
  }

  // Flip open/closed. Opening snapshots + sorts bodies by distance from
  // ship.pos (static snapshot, see house comment above); closing detaches the
  // keydown listener so it costs nothing while hidden. Returns the new open
  // state (mirrors SystemMap.toggle()'s contract) — callers that just want
  // the boolean can do `sim.showTargetList = targetList.toggle(...)` exactly
  // like the V/onMap wiring, but the module ALSO fires onOpenChange so that
  // flag stays correct even when the module closes itself internally (Esc,
  // or picking a row) rather than via a toggle() call.
  toggle(positions, ship) {
    if (this.open) this._close();
    else this._openWith(positions, ship);
    return this.open;
  }

  _openWith(positions, ship) {
    this.open = true;
    this._render(positions, ship);
    this.panel.style.display = 'block';
    this._keydownHandler = (e) => this._onKeydown(e);
    // Capture phase on `document` — ahead of controls.js's plain (bubble)
    // `window` keydown listener in the propagation order (capture always
    // reaches `document` before bubble reaches `window`, regardless of which
    // listener was attached first). stopPropagation() on the digit/Escape
    // keys we consume here means the event never reaches controls.js at all,
    // so there is no double-handling (a digit can't both "select row N" AND
    // fall through to `ship.throttle = powerToThrottle(n)`).
    document.addEventListener('keydown', this._keydownHandler, true);
    this.hooks.onOpenChange?.(true);
  }

  _close() {
    this.open = false;
    this.panel.style.display = 'none';
    if (this._keydownHandler) {
      document.removeEventListener('keydown', this._keydownHandler, true);
      this._keydownHandler = null;
    }
    this.hooks.onOpenChange?.(false);
  }

  // positions: Map<name, THREE.Vector3> (heliocentric, READ-ONLY here).
  // ship: the Ship instance (reads .pos only).
  _render(positions, ship) {
    const sorted = this.bodies
      .map((b) => ({ b, dist: ship.pos.distanceTo(positions.get(b.name)) }))
      .sort((x, y) => x.dist - y.dist);
    this._rows = sorted.map((entry) => entry.b);

    this.panel.innerHTML = '';

    const title = document.createElement('div');
    title.style.cssText = 'color:#eaffff; font-weight:600; letter-spacing:0.04em; margin-bottom:6px;';
    title.textContent = t('tlist.title');
    this.panel.appendChild(title);

    sorted.forEach((entry, i) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; justify-content:space-between; gap:10px; padding:4px 6px; border-radius:5px; cursor:pointer;';
      const label = i < MAX_DIGIT_ROWS ? `${i + 1}. ${bodyName(entry.b.name)}` : bodyName(entry.b.name);
      row.innerHTML = `<span style="color:var(--dim)">${label}</span><b style="color:#d7f6ff">${fmtDist(entry.dist)}</b>`;
      row.addEventListener('mouseenter', () => { row.style.background = 'rgba(60,116,148,0.35)'; });
      row.addEventListener('mouseleave', () => { row.style.background = ''; });
      row.addEventListener('click', () => this._select(entry.b));
      this.panel.appendChild(row);
    });

    const hint = document.createElement('div');
    hint.style.cssText = 'color:var(--dim); margin-top:8px; font-size:11px;';
    hint.textContent = t('tlist.hint');
    this.panel.appendChild(hint);
  }

  _select(body) {
    this.hooks.onSelect?.(body);
    this._close();
  }

  _onKeydown(e) {
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); this._close(); return; }
    if (k.toLowerCase() === 't') {
      // Deliberately NOT stopped/prevented here: let it keep propagating to
      // controls.js's window listener, which calls the SAME onTargetList ->
      // toggle() codepath as opening did. That keeps open/close on one single
      // toggle mechanism instead of this module closing itself AND
      // controls.js's hook also firing (which would double-close / desync
      // sim.showTargetList since toggle() would then re-open it).
      return;
    }
    if (/^[0-9]$/.test(k)) {
      // Swallow ALL digits while open, including '0' (no row 0 to select) —
      // the contract is "digits must not change throttle while the list is
      // open", not just "digits 1-9".
      e.preventDefault();
      e.stopPropagation();
      if (k !== '0') {
        const idx = Number(k) - 1;
        if (idx < this._rows.length) this._select(this._rows[idx]);
      }
    }
  }
}
