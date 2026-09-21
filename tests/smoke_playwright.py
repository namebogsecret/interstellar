#!/usr/bin/env python3
"""Playwright smoke test for interstellar.

Starts its own static server on a free port, loads index.html in headless
Chromium, waits for WebGL init, and exercises the key handlers that our
changes touch (pause P, circularize K, target Tab, and any new toggles).
FAILS (exit 1) on any console error / page error / failed request.

Run:
  PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-arm64 \
    ~/.venv/playwright/bin/python tests/smoke_playwright.py [extra_keys...]

extra_keys: optional space-separated keys to press (e.g. "v t j") for new features.
"""
import http.server
import socketserver
import functools
import os
import socket
import re
import sys
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):  # silence per-request access log
        pass


def serve(port):
    handler = functools.partial(QuietHandler, directory=ROOT)
    httpd = socketserver.TCPServer(("127.0.0.1", port), handler)
    httpd.allow_reuse_address = True
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd


# ---------------------------------------------------------------------------
# --mirror: objective left/right mirror check, cube-path vs wide-2D-path.
#
# See tests/README or the WI-5 ТЗ for full rationale. Short version: at β=0
# both render paths MUST produce the identical frame (the 90°-source 2D path
# re-projects the display ray to exactly 60°; the cube path samples the cube
# along the display ray, also exactly 60° — no aberration is involved at
# β=0, so this isolates any left/right (or up/down) flip introduced by the
# cube path's own face/sample-direction convention from the aberration math
# entirely). A bright marker (the Sun) is placed off-axis (left+above centre)
# via window.SIM and its position is measured on the rendered PNG via a
# brightness-weighted centroid. Both paths must land the marker in the same
# place; if the cube path mirrors it, that is a real bug in cubeDir()'s
# CUBE_X_SIGN (js/render/relativisticPass.js) — NOT something this test
# should paper over.
# ---------------------------------------------------------------------------

C_LIGHT = 299792458.0  # m/s — SI, not re-derived from anywhere in the app

# JS run once right after the page is interactive: freezes physics, places
# the ship, orients it (look-at-Sun composed with a further yaw+pitch turn
# so the Sun ends up off-axis), and hides every DOM element except the WebGL
# canvas so a plain viewport screenshot == the render-path pixels with zero
# HUD/overlay contamination (the #hud panel sits top-left 14,14/270px wide,
# which overlaps the exact quadrant the Sun marker lands in).
#
# The quaternion is built with ONLY ship.quat.setFromAxisAngle,
# ship.quat.setFromUnitVectors + fresh instances of `ship.quat.constructor()`
# / `ship.pos.constructor()` (== the page's own THREE.Quaternion/Vector3) —
# no THREE import here, per the WI-5 instruction not to reach into js/.
#
# ship.pos deliberately has THREE DISTINCT NONZERO components (not the
# tidier (0, k, k) that would let the base "look at Sun" rotation collapse
# to a single clean axis-angle turn by hand). That symmetry was tried first
# and is a trap: the pre-wired bug-fix knob CUBE_X_SIGN (see
# js/render/relativisticPass.js) mirrors the CUBE SAMPLE DIRECTION across
# the WORLD x=0 plane, not the screen. With ship.pos.x == 0 the direction to
# the Sun also has world-x == 0, which sits exactly ON that plane — i.e. the
# Sun would be a near-fixed point of precisely the bug this test exists to
# catch, and the whole test would silently pass even with CUBE_X_SIGN wired
# backwards. Verified directly: flipping CUBE_X_SIGN to -1.0 against the
# x=0 fixture left the measured Sun centroid unchanged (confirmed both by
# the numbers and by eye). With a genuinely 3-axis-asymmetric position this
# is no longer possible — any world-X mirror measurably displaces the Sun's
# world direction, and thus its rendered centroid, by construction.
_FIXTURE_JS = """() => {
  const { sim, ship } = window.SIM;
  if (!sim || !ship) return { ok: false, reason: 'no SIM' };
  sim.paused = true;
  sim.showLabels = false;
  sim.showOrbits = false;
  sim.showMap = false;
  sim.showTargetList = false;
  sim.showMissions = false;
  sim.time = 0;
  ship.pos.set(0.90e11, 1.00e11, 0.68e11);   // |pos| ~ 1.01 AU, x/y/z all distinct & nonzero
  ship.v.set(0, 0, 0);
  if (ship.w && ship.w.set) ship.w.set(0, 0, 0);

  const Q = ship.quat.constructor;
  const V3 = ship.pos.constructor;
  const dirToSun = ship.pos.clone().negate().normalize();
  const base = new Q().setFromUnitVectors(new V3(0, 0, -1), dirToSun);   // look at Sun (origin)
  const yaw = new Q();
  yaw.setFromAxisAngle({ x: 0, y: 1, z: 0 }, -25 * Math.PI / 180);   // then yaw
  const pitch = new Q();
  pitch.setFromAxisAngle({ x: 1, y: 0, z: 0 }, -18 * Math.PI / 180); // then pitch
  ship.quat.copy(base).multiply(yaw).multiply(pitch);

  // Hide every non-canvas DOM element (HUD/nav/overlay/help/reticle/...) so
  // the viewport screenshot is exactly the render-path pixels.
  for (const el of Array.from(document.body.children)) {
    if (el.tagName !== 'CANVAS') el.style.display = 'none';
  }
  return { ok: true };
}"""

# Self-check: the page computes, from its OWN ship.quat and ship.pos, the
# view-space direction to the Sun (conjugate ship.quat applied to normalized
# -pos). This is the mandatory closed loop from the ТЗ — if this doesn't
# land where hand-arithmetic predicts, the test must FAIL loudly instead of
# silently measuring pixels against a fixture that isn't what we think it is.
_SELFCHECK_JS = """() => {
  const { ship } = window.SIM;
  const dir = ship.pos.clone().negate().normalize();
  const inv = ship.quat.clone().invert();
  const view = dir.clone().applyQuaternion(inv);
  return { vx: view.x, vy: view.y, vz: view.z };
}"""

_SET_PATH_JS = """(cube) => {
  const { sim } = window.SIM;
  sim.relFx = true;
  sim.cubeAberr = cube;
}"""

_SET_BETA_JS = """(vmag) => {
  const { ship } = window.SIM;
  ship.v.set(0, 0, -1).applyQuaternion(ship.quat).multiplyScalar(vmag);
}"""

_WAIT_PATH_JS = """(want) => {
  const { sim } = window.SIM;
  if (sim.renderPath !== want) return false;
  if (want === 'cube' && sim.cubeReady !== true) return false;
  return true;
}"""


# DEVIATION FROM THE LITERAL ТЗ FORMULA — see _analyze_png docstring below
# for the measured evidence from the real scene. Flagged prominently here AND
# in the final report printed by run_mirror(), per the WI-5 instruction to
# say plainly when a criterion had to be softened and why, rather than paint
# it green.
_LUMA_FLOOR = 20.0     # absolute 0-255 luma floor (not relative to frame max)
_CHROMA_FLOOR = 60.0   # R-B "warmth" floor that separates the Sun from stars


def _analyze_png(path):
    """Centroid of the marker (the Sun disc) in a rendered frame.

    The ТЗ specifies L = 0.2126R + 0.7152G + 0.0722B, mask = L > 0.6*L.max().
    Two independent problems were measured on the real scene that make this
    literal formula not work, in order of discovery:

    1. 0.6*L.max() is dominated by the WRONG thing. The 2k Milky Way skybox
       aliases into dozens of 1-4px fully-saturated (255,255,255) specks
       scattered evenly across the frame (confirmed by eye on
       mirror_wide_0.png and by a direct pixel dump). Those specks, not the
       Sun, set L.max()=255. The Sun is an UNLIT MeshBasicMaterial(0xffffff)
       disc modulated by an orange photo-texture plus an additively-blended
       corona/halo — real, but its brightest pixel measured only ~179/255,
       and the disc's bulk sits far below that. A plain 0.6*L.max() mask
       kept ~1px of the Sun plus ~14 unrelated star specks: exactly the
       "MIRROR: FAIL — marker not visible" (n<40) seen on the first run of
       this test at β=0.
    2. Restricting to the LARGEST connected bright component (still by raw
       luma, now with an absolute floor instead of a frame-relative one)
       fixes β=0 perfectly — swept thresholds 30-100 all agree on one
       dominant blob at cx≈0.2606-0.2608, cy≈0.2174-0.2179, matching the
       ТЗ's own "ожидаемо ≈0.27/0.22" almost exactly — but breaks again at
       β=0.5: relativistic aberration bunches the ENTIRE background
       starfield toward the forward direction (the textbook "starbow"), so
       the whole sky's worth of star specks lands close enough together to
       fuse, via bloom bleed, into ONE giant connected blob that dwarfs the
       Sun — confirmed by eye on mirror_wide_0.5.png/mirror_cube_0.5.png (a
       dense packed "disc" of stars) and numerically (measured "biggest
       blob" centroids of (0.68, 0.96) / (0.89, 0.50) — nowhere near the
       Sun, which is still plainly visible by eye at ~(0.37, 0.35)).

    Both failures share a root cause: luma alone cannot tell the Sun's warm
    orange disc apart from the (numerous, and at high β densely packed)
    pale blue-white stars. The fix kept here swaps the discriminator from
    brightness to COLOUR: mask = (R-B > _CHROMA_FLOOR) AND (L > _LUMA_FLOOR),
    then centroid of the largest connected component of THAT mask. Swept
    chroma thresholds 40-100 on all four real renders agree to within
    <0.001 on cx/cy in every case, with the runner-up component always
    <20% the size of the winner (measured ratios: 6/17 to 30/187 across the
    four frames) — this is markedly more robust than the luma-only version,
    not merely a different arbitrary knob. It is still reported here as a
    deviation from the literal ТЗ formula, not a silent substitution: color
    was not part of the specified metric.

    Returns (cx, cy, n_bright, lmax) with cx/cy normalized to [0,1] in the
    image's own coordinate frame (column/width, row/height — row 0 = top,
    matching how a screen-space "up" маркер should read as a SMALL cy).
    n_bright is the size of the largest connected component of the
    colour+luma mask (NOT a raw pixel count over the whole frame) — this is
    what the antivacuum guard (>=40) gates on. lmax (plain luma, per the ТЗ
    formula) is still reported for diagnostics even though it no longer
    drives the mask. Returns (None, None, n_bright, lmax) if the guard
    trips: no component big enough to be a real marker, so any centroid
    would be meaningless.
    """
    import numpy as np
    from PIL import Image
    from scipy import ndimage

    img = Image.open(path).convert("RGB")
    arr = np.asarray(img).astype(np.float64)
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    lmax = float(luma.max())
    mask = (luma > _LUMA_FLOOR) & ((r - b) > _CHROMA_FLOOR)

    labels, nlabels = ndimage.label(mask)   # default 4-connectivity structure
    if nlabels == 0:
        return None, None, 0, lmax
    sizes = ndimage.sum(mask, labels, index=range(1, nlabels + 1))
    biggest = int(np.argmax(sizes)) + 1
    n = int(sizes[int(np.argmax(sizes))])
    if n < 40:
        return None, None, n, lmax
    ys, xs = np.nonzero(labels == biggest)
    h, w = luma.shape
    return float(xs.mean() / w), float(ys.mean() / h), n, lmax


def run_mirror(out_dir):
    from playwright.sync_api import sync_playwright

    os.makedirs(out_dir, exist_ok=True)
    port = free_port()
    httpd = serve(port)
    url = f"http://127.0.0.1:{port}/index.html"
    lines = []          # full numeric report, printed at the end regardless of verdict
    fails = []          # (criterion_id, message) — non-empty => exit 1
    shots = {}          # label -> png path

    def log(s=""):
        lines.append(s)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 1280, "height": 720})
            pageerrors = []
            page.on("pageerror", lambda e: pageerrors.append(str(e)))
            page.goto(url, wait_until="load", timeout=30000)
            page.wait_for_timeout(2500)
            page.locator("body").click()
            page.wait_for_timeout(300)
            page.keyboard.press("Enter")   # dismiss start screen
            page.wait_for_timeout(300)

            page.wait_for_function(
                "() => !!window.SIM && !!window.SIM.ship && !!window.SIM.sim",
                timeout=15000,
            )

            fx = page.evaluate(_FIXTURE_JS)
            if not fx or not fx.get("ok"):
                print("MIRROR: FAIL")
                print(f"  - fixture setup failed: {fx}")
                browser.close()
                httpd.shutdown()
                sys.exit(1)
            page.wait_for_timeout(200)

            sc = page.evaluate(_SELFCHECK_JS)
            vx, vy, vz = sc["vx"], sc["vy"], sc["vz"]
            log("== fixture self-check (view-space direction to Sun) ==")
            log(f"  vx={vx:.4f}  vy={vy:.4f}  vz={vz:.4f}")
            log("  required: vx < -0.25  and  vy > 0.10  and  vz < -0.85")
            selfcheck_ok = (vx < -0.25) and (vy > 0.10) and (vz < -0.85)
            if not selfcheck_ok:
                print("MIRROR: FAIL (fixture self-check did not pass — refusing to measure pixels)")
                for ln in lines:
                    print(" ", ln)
                browser.close()
                httpd.shutdown()
                sys.exit(1)

            def snap(cube, fname):
                page.evaluate(_SET_PATH_JS, cube)
                want = "cube" if cube else "wide"
                page.wait_for_function(_WAIT_PATH_JS, arg=want, timeout=10000)
                page.wait_for_timeout(1600)   # >=1500ms / >=5 frames past readiness
                path = os.path.join(out_dir, fname)
                page.screenshot(path=path)
                return path

            shots["wide_0"] = snap(False, "mirror_wide_0.png")
            shots["cube_0"] = snap(True, "mirror_cube_0.png")

            page.evaluate(_SET_BETA_JS, 0.5 * C_LIGHT)
            page.wait_for_timeout(100)

            shots["wide_0.5"] = snap(False, "mirror_wide_0.5.png")
            shots["cube_0.5"] = snap(True, "mirror_cube_0.5.png")

            browser.close()
            if pageerrors:
                log("== page errors observed during --mirror run (diagnostic only) ==")
                for e in pageerrors:
                    log(f"  pageerror: {e}")
    finally:
        httpd.shutdown()

    metrics = {}
    log("")
    log("== per-frame metrics (cx, cy normalized; row 0 = top, col 0 = left) ==")
    for label, path in shots.items():
        cx, cy, n, lmax = _analyze_png(path)
        metrics[label] = (cx, cy, n, lmax)
        if cx is None:
            log(f"  {label:10s} {path}: FAIL marker not visible (bright px={n} < 40, lmax={lmax:.1f})")
            fails.append((f"vacuum-guard[{label}]", f"only {n} bright px (<40) in {path}"))
        else:
            log(f"  {label:10s} {path}: cx={cx:.4f} cy={cy:.4f}  (bright px={n}, lmax={lmax:.1f})")

    if fails:
        print("MIRROR: FAIL")
        for ln in lines:
            print(" ", ln)
        for cid, msg in fails:
            print(f"  - [{cid}] {msg}")
        sys.exit(1)

    cxA0, cyA0, _, _ = metrics["wide_0"]
    cxB0, cyB0, _, _ = metrics["cube_0"]
    cxA5, cyA5, _, _ = metrics["wide_0.5"]
    cxB5, cyB5, _, _ = metrics["cube_0.5"]

    log("")
    log("== acceptance criteria ==")

    def check(cid, ok, detail):
        fails_local = [] if ok else [(cid, detail)]
        log(f"  {cid}: {'PASS' if ok else 'FAIL'} — {detail}")
        fails.extend(fails_local)

    check("A1", cxA0 < 0.35 and cyA0 < 0.40,
          f"wide β=0 upper-left: cx={cxA0:.4f}(<0.35) cy={cyA0:.4f}(<0.40)")
    check("A2", cxB0 < 0.35 and cyB0 < 0.40,
          f"cube β=0 upper-left: cx={cxB0:.4f}(<0.35) cy={cyB0:.4f}(<0.40)")
    check("A3", abs(cxB0 - cxA0) <= 0.05 and abs(cyB0 - cyA0) <= 0.05,
          f"β=0 paths agree: |dcx|={abs(cxB0 - cxA0):.4f}(<=0.05) |dcy|={abs(cyB0 - cyA0):.4f}(<=0.05)")
    check("A4", abs(cxB0 - (1 - cxA0)) >= 0.15 and abs(cyB0 - (1 - cyA0)) >= 0.15,
          f"NOT mirrored: |cxB-(1-cxA)|={abs(cxB0 - (1 - cxA0)):.4f}(>=0.15) "
          f"|cyB-(1-cyA)|={abs(cyB0 - (1 - cyA0)):.4f}(>=0.15)")

    moveA = abs(cxA0 - 0.5) - abs(cxA5 - 0.5)
    moveB = abs(cxB0 - 0.5) - abs(cxB5 - 0.5)
    check("A5", moveA >= 0.03 and moveB >= 0.03 and abs(cxB5 - cxA5) <= 0.08,
          f"β=0.5 aberrates toward centre: wide Δ={moveA:.4f}(>=0.03) cube Δ={moveB:.4f}(>=0.03); "
          f"|cxB'-cxA'|={abs(cxB5 - cxA5):.4f}(<=0.08)  [cxA0={cxA0:.4f} cxA5={cxA5:.4f} cxB0={cxB0:.4f} cxB5={cxB5:.4f}]")

    lines.append("")
    lines.append("== artifacts ==")
    for label, path in shots.items():
        lines.append(f"  {label}: {path}")

    print("MIRROR: " + ("FAIL" if fails else "PASS"))
    for ln in lines:
        print(" ", ln)

    sys.exit(1 if fails else 0)


# ---------------------------------------------------------------------------
# --touch: mobile-viewport smoke for the touch panel (work item wi2, ТЗ
# "interstellar-touch-panel"). Loads the page in a has_touch+is_mobile
# context and, for EACH of three viewports (a bug found by adversarial
# review only shows up in one of them — see _TOUCH_VIEWPORTS below), confirms
# the coarse-pointer branch actually took (body.touch / #touchui), that every
# one of the 10 js/render/touchPanel.js PANEL_ACTIONS buttons is actually
# reachable (not just present in the DOM — see item 2 below) and dispatches,
# that flight controls are not intercepted while the panel is closed, and
# that tapping outside the panel sheet closes it. FAILS on a missing/
# unreachable button, an exception from a tap, or a pageerror/console error
# not attributable to the pre-existing external-beacon noise documented below
# (and in CLAUDE.md for the default scenario). Runs ONE browser process for
# all three viewports (a fresh BrowserContext per viewport) to keep the CPU
# footprint down when other agents are working the machine concurrently.
# ---------------------------------------------------------------------------

# Three viewports, not one. 390x844/360x640 are portraits; 844x390 is the
# LANDSCAPE case where the regression this file was extended for actually
# reproduces: the bottom (REL) row of the panel is clipped by a
# `max-height:44vh` rule while `touch-action` is suppressed, so a button can
# end up with < 44px of tappable height, or fall partly/wholly outside the
# viewport, or sit under a sibling element at its own visual centre. All
# three of those are things elementFromPoint()/bounding_box() can catch
# directly; none of them raises a JS exception, so the ORIGINAL (single
# 390x844, no hit-test) --touch mode could not see this class of bug at all.
_TOUCH_VIEWPORTS = [
    {"width": 390, "height": 844, "label": "portrait 390x844 (standard)"},
    {"width": 360, "height": 640, "label": "portrait 360x640 (small)"},
    {"width": 844, "height": 390, "label": "landscape 844x390"},
]

# 44 CSS px — the same minimum tap-target guidance interaction design and
# accessibility review both use (iOS HIG / Android Material / WCAG 2.5.5).
# Not an interstellar-specific number: it's the bar "a human thumb can hit
# this reliably", which is exactly what item 2 of this work item is about.
_MIN_TAP_PX = 44

# Direct hit-test: does document.elementFromPoint() at a button's own visual
# centre resolve to that button (or a descendant of it, e.g. an inner <span>/
# icon), or does something else — a clipped ancestor, a sibling panel row, an
# invisible backdrop, the WebGL canvas itself — intercept the tap instead?
# This is the literal mechanism behind "тап попадает не в ту кнопку": a
# button can be perfectly present and even individually >=44px, and still
# not be what a real tap at its coordinates would actually hit, if something
# else is layered on top. Checking `elementFromPoint(cx, cy) === target ||
# target.contains(elementFromPoint(...))` is a direct model of what iOS/
# Android hit-testing does; a pure DOM query (e.g. checking the button is
# `:visible`) would NOT catch an occluding sibling.
_ELEMENT_AT_POINT_JS = """([x, y, selector]) => {
  const el = document.elementFromPoint(x, y);
  const target = document.querySelector(selector);
  if (!el) return {hit: false, tag: null, id: null, cls: null, reason: 'elementFromPoint(x,y) returned null (out of any element, or point is off-screen)'};
  if (!target) return {hit: false, tag: el.tagName, id: el.id, cls: null, reason: 'selector not found in DOM'};
  const hit = (el === target) || target.contains(el);
  const cls = (el.className && el.className.toString) ? el.className.toString() : String(el.className);
  return {hit, tag: el.tagName, id: el.id, cls};
}"""

# Mirrors js/render/touchPanel.js's PANEL_ACTIONS names exactly (ТЗ list, not
# discovered from the DOM) — if a name here and the real table ever disagree,
# that mismatch IS the bug this sweep exists to catch (a button silently
# missing from the rendered drawer), so the list must not be self-referential.
_TOUCH_PANEL_NAMES = ['autopilot', 'hohmann', 'map', 'targets', 'missions',
                      'cockpit', 'sound', 'bloom', 'relfx', 'cube']
# kind:'action' entries close the drawer after dispatch (js/render/touch.js
# ::_action -> this._closePanel()) — the sweep must re-open #tpanel before
# tapping the next button, and it is itself a mini-assertion: an action
# button that does NOT close the panel is a real, catchable regression.
_TOUCH_PANEL_ACTION_CLOSERS = {'autopilot', 'hohmann'}
# js/main.js's initial sim object ships with bloom:true and relFx:true — a
# deterministic, load-order-independent probe of whether the panel's on/off
# highlighting is wired at all (js/render/touch.js::_updatePanelState reads
# sim[stateKey], guarded to a silent no-op if `sim` was never handed to
# TouchControls). Reported as a WARNING, not a FAIL: cosmetic highlighting is
# outside this work item's acceptance criteria (button-reaches-hook is what
# matters for "works from a phone"), but a silent no-op is exactly the class
# of bug a human reading smoke output should be told about.
_TOUCH_PANEL_INITIALLY_ON = {'bloom': 'bloom', 'relfx': 'relFx'}

# Flight controls that must NOT be intercepted while the panel is CLOSED
# (item 3 of the ТЗ contract for this extension) — the thrust button ▲ in the
# bottom-right cluster, and the movement joystick. Selectors are the exact
# ones the ТЗ specified, not rediscovered from touch.js, so a rename of
# either control in the implementation shows up here as "selector not found"
# rather than silently testing nothing.
_TOUCH_FLIGHT_CONTROLS = [
    ('#tbtns-r [data-hold="r"]', "thrust button ▲"),
    ("#joy", "joystick"),
]


def _is_beacon_noise(text):
    # Same call already made (and explained) for the default desktop
    # scenario — see CLAUDE.md "Как проверить": stats.podlevskikh.com is an
    # external analytics beacon embedded in index.html, unreachable from a
    # machine without direct access to that host, and its 400/network-error
    # noise is pre-existing baseline behaviour with nothing to do with touch
    # controls. Filtering it here (with this comment) is not silently
    # papering over it — see the ADR-length rationale at that CLAUDE.md
    # anchor for why treating it as a real failure would just make every run
    # of this mode permanently red for an unrelated reason.
    return 'stats.podlevskikh.com' in text


def _bbox_retry(page, locator, label, errors, attempts=8, wait_ms=350):
    """bounding_box() with retries, plus a CPU-starvation escape hatch.

    Per dev-quality-gates' hang protocol: a machine loaded by a parallel
    agent must not have its CPU starvation misread as a layout defect. A
    single bounding_box() timeout/None is retried several times with a short
    wait before it is recorded as a real error; a transiently-unready element
    (mid-transition, or momentarily starved of a paint frame) gets a fair
    chance to settle first. Returns the box dict, or None (already appended
    to `errors`) once every attempt is exhausted.

    Flake observed 2026-09-21 (ГРАБЛИ): on a loaded 6-core box the software
    (SwiftShader) WebGL render loop can starve the renderer badly enough that
    Locator.bounding_box() times out 6× in a row on an element that is
    provably present, visible and correctly laid out — the smoke reported
    "thrust button ▲ bounding_box unavailable" at 360x640 while an isolated
    probe on the same build returned rect 284,422,56x56. So after the retries
    are exhausted we ask the PAGE for the geometry (getBoundingClientRect +
    computed style) — that path does not go through Playwright actionability
    waiting. If the DOM itself says the element is visible with a non-zero
    box, this was scheduler starvation, not a defect: record a warning and
    return the JS-measured box. A missing / display:none / zero-size element
    still fails the smoke, which is the property the check exists for.
    """
    last = None
    for _ in range(attempts):
        try:
            box = locator.bounding_box(timeout=8000)
        except Exception as ex:
            box = None
            last = f"raised {ex!r}"
        if box:
            return box
        last = last or "bounding_box() returned None (not attached/visible)"
        page.wait_for_timeout(wait_ms)

    # Escape hatch: measure in-page, bypassing actionability waiting.
    js_box = None
    try:
        js_box = page.evaluate(
            """(sel) => { const e = document.querySelector(sel); if (!e) return null;
                 const cs = getComputedStyle(e);
                 if (cs.display === 'none' || cs.visibility === 'hidden') return null;
                 const r = e.getBoundingClientRect();
                 if (!(r.width > 0 && r.height > 0)) return null;
                 return {x: r.x, y: r.y, width: r.width, height: r.height}; }""",
            _locator_selector(locator))
    except Exception:
        js_box = None
    if js_box:
        _BBOX_STARVATION_WARNINGS.append(
            f"{label}: Playwright bounding_box timed out {attempts}× but the DOM reports a "
            f"visible {js_box['width']:.0f}x{js_box['height']:.0f} box at "
            f"({js_box['x']:.0f},{js_box['y']:.0f}) — treated as renderer starvation, not a "
            f"layout defect (last: {last})")
        return js_box

    errors.append(f"{label}: bounding_box unavailable after {attempts} retries (last: {last})")
    return None


# Warnings raised by _bbox_retry's escape hatch; drained per viewport by
# _run_touch_viewport so they are printed with their viewport label.
_BBOX_STARVATION_WARNINGS = []


def _locator_selector(locator):
    """The CSS selector a Locator was built from (Playwright keeps it in repr
    as `<Locator frame=... selector='...'>`), needed because the escape hatch
    above re-queries the DOM directly. Falls back to a selector that matches
    nothing, so a repr change degrades to the old behaviour (a real error)
    instead of silently passing."""
    m = re.search(r"selector=[\'\"](.+)[\'\"]>?$", repr(locator))
    return m.group(1) if m else "#__bbox_retry_selector_unavailable__"


def _run_touch_viewport(browser, url, vp):
    """Full sweep (items 1-5 of the ТЗ contract) against ONE viewport.

    Returns (errors, warnings) — lists of plain strings, NOT yet labelled
    with the viewport (the caller does that, so every message printed at the
    end says which of the three viewports it came from, per the ТЗ's
    "печатать, в каком viewport'е что упало").
    """
    errors = []
    warnings = []
    vw, vh, label = vp["width"], vp["height"], vp["label"]

    context = browser.new_context(
        viewport={"width": vw, "height": vh},
        has_touch=True,
        is_mobile=True,
    )
    page = context.new_page()
    # Same beacon-noise filtering as the original single-viewport --touch
    # (see _is_beacon_noise docstring): the native "Failed to load resource"
    # console line carries the URL in m.location()['url'], not m.text.
    page.on("console", lambda m: (
        errors.append(f"console.{m.type}: {m.text}")
        if m.type == "error" and not _is_beacon_noise(m.text)
        and not _is_beacon_noise((m.location or {}).get("url", "")) else None))
    page.on("pageerror", lambda e: (
        None if _is_beacon_noise(str(e)) else errors.append(f"pageerror: {e}")))
    page.on("requestfailed", lambda r: (
        None if _is_beacon_noise(r.url) else errors.append(f"requestfailed: {r.url} {r.failure}")))

    try:
        try:
            page.goto(url, wait_until="load", timeout=30000)
            page.wait_for_function(
                "() => !!window.SIM && !!window.SIM.ship && !!window.SIM.sim",
                timeout=15000,
            )
        except Exception as ex:
            errors.append(f"page bootstrap failed (goto/wait_for_function): {ex}")
        else:
            # Tap helper: page.touchscreen.tap() at a locator's own
            # bounding-box centre — see the original --touch's long comment
            # (kept in git history / ГРАБЛИ for why Locator.click()/.tap()
            # is unreliable against the full-bleed WebGL canvas here).
            def tap_locator(locator, tlabel):
                box = _bbox_retry(page, locator, tlabel, errors)
                if not box:
                    return False
                cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
                try:
                    page.touchscreen.tap(cx, cy)
                except Exception as ex:
                    errors.append(f"{tlabel}: touchscreen.tap raised: {ex}")
                    return False
                return True

            def element_hits(selector, x, y):
                return page.evaluate(_ELEMENT_AT_POINT_JS, [x, y, selector])

            def panel_is_open():
                return page.evaluate(
                    "() => { const e = document.getElementById('tpanel'); "
                    "return !!e && e.classList.contains('open'); }")

            def open_panel():
                if panel_is_open():
                    return
                if not tap_locator(page.locator('[data-tap="panel"]'), '[data-tap="panel"] (open)'):
                    return
                page.wait_for_timeout(250)
                if not panel_is_open():
                    errors.append(
                        "#tpanel did not gain class 'open' after tapping "
                        '[data-tap="panel"]')

            # --- item 3: flight controls reachable while panel is CLOSED ---
            # (checked below, both before the panel is ever opened and again
            # after the tap-outside-to-close test, per item 4 — closing must
            # actually restore reachability, not just remove the 'open'
            # class from #tpanel while something still visually blocks taps).
            def check_flight_controls_reachable(when):
                if panel_is_open():
                    return  # only meaningful while closed, per the ТЗ
                for selector, ctrl_label in _TOUCH_FLIGHT_CONTROLS:
                    loc = page.locator(selector)
                    if loc.count() == 0:
                        errors.append(f"[{when}] {ctrl_label} ({selector}) not found in DOM")
                        continue
                    box = _bbox_retry(page, loc, f"[{when}] {ctrl_label}", errors)
                    if not box:
                        continue
                    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
                    res = element_hits(selector, cx, cy)
                    if not res["hit"]:
                        errors.append(
                            f"[{when}] {ctrl_label} at ({cx:.0f},{cy:.0f}) is covered by "
                            f"{res['tag']}#{res['id']}.{res['cls']!r} instead of receiving the tap "
                            f"(reason={res.get('reason')})")

            start_dismissed = tap_locator(page.locator("#startbtn"), "#startbtn (dismiss start screen)")
            page.wait_for_timeout(300)

            # --- mobile bootstrap: the coarse-pointer branch actually took ---
            is_touch_body = page.evaluate("() => document.body.classList.contains('touch')")
            if not is_touch_body:
                errors.append(
                    "document.body missing class 'touch' — js/main.js's isTouch "
                    "detection did not fire for a has_touch+is_mobile context")

            # NOTE on method: Locator.is_visible() on #touchui itself is the
            # wrong check (its own box collapses to zero height because every
            # direct child is position:fixed) — same reasoning as the
            # original single-viewport --touch. Check computed style + a
            # real fixed child's own bounding box instead.
            touchui = page.locator("#touchui")
            if touchui.count() == 0:
                errors.append("#touchui not found in DOM")
            else:
                display = page.evaluate(
                    "() => { const e = document.getElementById('touchui'); "
                    "return e ? getComputedStyle(e).display : null; }")
                if display == "none" or display is None:
                    errors.append(
                        f"#touchui computed display is {display!r}, expected != 'none' "
                        "(CSS: body.touch #touchui should be display:block)")
                joy_box = _bbox_retry(page, page.locator("#joy"), "#joy", errors)
                if joy_box and (joy_box["width"] <= 0 or joy_box["height"] <= 0):
                    errors.append(f"#joy has a zero-size bounding box: {joy_box}")

            if start_dismissed:
                check_flight_controls_reachable("panel closed, before opening it")

            panel_btn = page.locator('[data-tap="panel"]')
            if panel_btn.count() == 0:
                errors.append('[data-tap="panel"] (the ☰ menu button) not found in DOM')

            tpanel_present = page.locator("#tpanel").count() > 0
            if not tpanel_present:
                errors.append('#tpanel (the panel drawer) not found in DOM — aborting the panel sweep')

            # The whole panel sweep is meaningless if the start screen never
            # actually went away — already recorded as an error above, just
            # skip further taps rather than pile on confusing secondary
            # failures.
            if start_dismissed and panel_btn.count() > 0 and tpanel_present:
                open_panel()

                # Wiring probe — BEFORE any tap flips state, or it is
                # meaningless (see _TOUCH_PANEL_INITIALLY_ON docstring above).
                for name, sim_key in _TOUCH_PANEL_INITIALLY_ON.items():
                    if page.locator(f'[data-tap="{name}"]').count() == 0:
                        continue  # already reported as missing by the sweep below
                    has_on = page.evaluate(
                        "(n) => { const e = document.querySelector(`[data-tap=\"${n}\"]`); "
                        "return !!e && e.classList.contains('on'); }", name)
                    if not has_on:
                        warnings.append(
                            f"panel button '{name}' has no 'on' highlight although "
                            f"sim.{sim_key} defaults to true at load — TouchControls "
                            "may have been constructed without its `sim` argument "
                            "(js/main.js), leaving _updatePanelState() a silent "
                            "no-op. Not fatal (cosmetic), flagged for dev-lead.")

                # --- item 2: every one of the 10 buttons is REACHABLE, not
                # just present — bbox exists, is >=44x44 CSS px, sits fully
                # inside the viewport, and a tap at its own centre actually
                # hits it (or a descendant of it) rather than something else
                # covering it. This is the direct regression test for "the
                # bottom REL row is clipped by max-height:44vh in landscape
                # while touch-action is suppressed" — it must FAIL on the
                # pre-fix code in the 844x390 viewport and PASS once the CSS
                # is corrected.
                for name in _TOUCH_PANEL_NAMES:
                    open_panel()
                    btn = page.locator(f'[data-tap="{name}"]')
                    if btn.count() == 0:
                        errors.append(f'[data-tap="{name}"] not found in #tpanel')
                        continue

                    box = _bbox_retry(page, btn, f'[data-tap="{name}"]', errors)
                    if box:
                        if box["width"] < _MIN_TAP_PX or box["height"] < _MIN_TAP_PX:
                            errors.append(
                                f'[data-tap="{name}"] too small to tap reliably: '
                                f'{box["width"]:.1f}x{box["height"]:.1f}px '
                                f'(< {_MIN_TAP_PX}px minimum) at viewport {vw}x{vh}')

                        if (box["x"] < -0.5 or box["y"] < -0.5
                                or box["x"] + box["width"] > vw + 0.5
                                or box["y"] + box["height"] > vh + 0.5):
                            errors.append(
                                f'[data-tap="{name}"] box {box} extends outside the '
                                f'{vw}x{vh} viewport')

                        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
                        res = element_hits(f'[data-tap="{name}"]', cx, cy)
                        if not res["hit"]:
                            errors.append(
                                f'[data-tap="{name}"] at ({cx:.0f},{cy:.0f}) is covered by '
                                f"{res['tag']}#{res['id']}.{res['cls']!r} — a real tap there "
                                "would not reach this button (reason="
                                f"{res.get('reason')})")

                    if not tap_locator(btn, f'[data-tap="{name}"]'):
                        continue
                    page.wait_for_timeout(200)
                    if name in _TOUCH_PANEL_ACTION_CLOSERS and panel_is_open():
                        errors.append(
                            f"tapping action button '{name}' should close #tpanel "
                            "(PANEL_ACTIONS kind:'action'), but it is still open")

                # --- item 4: tapping outside the panel sheet closes it ---
                # Deliberately NOT tied to a backdrop element's id (the ТЗ
                # explicitly warns not to): probe all four viewport corners
                # via elementFromPoint and use the first one that is
                # confirmed NOT inside #tpanel itself, so the test's own
                # premise (this point is backdrop, not sheet) is verified
                # rather than assumed.
                open_panel()
                if panel_is_open():
                    backdrop_point = None
                    for (bx, by) in ((5, 5), (vw - 5, 5), (5, vh - 5), (vw - 5, vh - 5)):
                        is_outside_sheet = page.evaluate(
                            "([x, y]) => { const e = document.elementFromPoint(x, y); "
                            "const sheet = document.getElementById('tpanel'); "
                            "return !!e && !!sheet && !(e === sheet || sheet.contains(e)); }",
                            [bx, by])
                        if is_outside_sheet:
                            backdrop_point = (bx, by)
                            break
                    if backdrop_point is None:
                        errors.append(
                            "could not find a point outside #tpanel in any of the 4 "
                            f"viewport corners at {vw}x{vh} — cannot test tap-outside-"
                            "to-close (the sheet may cover the entire viewport here)")
                    else:
                        bx, by = backdrop_point
                        page.touchscreen.tap(bx, by)
                        page.wait_for_timeout(250)
                        if panel_is_open():
                            errors.append(
                                f"tapping outside the panel sheet at ({bx},{by}) "
                                "did not close #tpanel")
                        else:
                            check_flight_controls_reachable(
                                "panel closed, after tap-outside-to-close")

            page.wait_for_timeout(300)
            has_canvas = page.evaluate(
                "() => { const c=document.querySelector('canvas'); return !!c && c.width>0 && c.height>0; }")
            if not has_canvas:
                errors.append("no sized <canvas> found after the sweep (WebGL context likely died)")
    except Exception as ex:
        errors.append(f"unexpected exception during {label} sweep: {ex!r}")
    finally:
        context.close()

    # Drain the starvation warnings _bbox_retry collected for THIS viewport
    # (module-level list, because _bbox_retry has no per-viewport handle) so
    # they are printed under the right viewport label and the list does not
    # leak into the next one.
    while _BBOX_STARVATION_WARNINGS:
        warnings.append(_BBOX_STARVATION_WARNINGS.pop(0))

    return errors, warnings


def run_touch():
    from playwright.sync_api import sync_playwright

    port = free_port()
    httpd = serve(port)
    url = f"http://127.0.0.1:{port}/index.html"

    all_errors = []    # (viewport_label, message)
    all_warnings = []  # (viewport_label, message)

    try:
        # ONE browser process for all three viewports (see module comment) —
        # only the BrowserContext (and thus viewport/has_touch/is_mobile) is
        # per-viewport.
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            for vp in _TOUCH_VIEWPORTS:
                errs, warns = _run_touch_viewport(browser, url, vp)
                all_errors.extend((vp["label"], e) for e in errs)
                all_warnings.extend((vp["label"], w) for w in warns)
            browser.close()
    finally:
        httpd.shutdown()

    if all_warnings:
        print("== touch smoke warnings (non-fatal) ==")
        for vp_label, w in all_warnings:
            print(f"  ! [{vp_label}] {w}")

    if all_errors:
        print("TOUCH SMOKE: FAIL")
        by_viewport = {}
        for vp_label, e in all_errors:
            by_viewport.setdefault(vp_label, []).append(e)
        for vp_label, errs in by_viewport.items():
            print(f"  -- viewport: {vp_label} --")
            for e in errs:
                print(f"     - {e}")
        sys.exit(1)

    print("TOUCH SMOKE: PASS (all viewports: "
          + ", ".join(v["label"] for v in _TOUCH_VIEWPORTS) + ")")


def main():
    from playwright.sync_api import sync_playwright

    argv = sys.argv[1:]
    if "--mirror" in argv:
        out_dir = "/tmp"
        if "--out" in argv:
            i = argv.index("--out")
            if i + 1 < len(argv):
                out_dir = argv[i + 1]
        run_mirror(out_dir)
        return

    if "--touch" in argv:
        run_touch()
        return

    extra_keys = sys.argv[1:]  # e.g. ["v", "t", "j"]
    port = free_port()
    httpd = serve(port)
    url = f"http://127.0.0.1:{port}/index.html"
    errors = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}")
                    if m.type in ("error",) else None)
            page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
            page.on("requestfailed", lambda r: errors.append(
                f"requestfailed: {r.url} {r.failure}"))
            page.goto(url, wait_until="load", timeout=30000)
            # let WebGL init + a few animation frames run
            page.wait_for_timeout(2500)
            # dismiss start screen if present (Enter), then exercise handlers
            body = page.locator("body")
            body.click()
            page.wait_for_timeout(300)
            for key in ["Enter", "p", "p", "k", "Tab", "o", "c", "c"] + extra_keys:
                try:
                    page.keyboard.press(key)
                except Exception as ex:
                    errors.append(f"keypress {key} raised: {ex}")
                page.wait_for_timeout(200)
            page.wait_for_timeout(800)
            # sanity: a canvas exists and has size
            has_canvas = page.evaluate(
                "() => { const c=document.querySelector('canvas'); return !!c && c.width>0 && c.height>0; }")
            if not has_canvas:
                errors.append("no sized <canvas> found (WebGL init likely failed)")

            # Short-viewport regression check (item 3b): on a very short
            # viewport (390x600 — a small/older phone in landscape) the start
            # screen must stay reachable via scroll, not run off-page. Fresh
            # page + Launch NOT clicked, so #startscreen (and its <details>,
            # closed by default) is what's on screen.
            short_page = browser.new_page(viewport={"width": 390, "height": 600})
            short_page.goto(url, wait_until="load", timeout=30000)
            short_page.wait_for_timeout(1500)
            btn = short_page.locator("#startbtn")
            try:
                btn.scroll_into_view_if_needed(timeout=5000)
            except Exception as ex:
                errors.append(f"short-viewport: #startbtn scroll_into_view_if_needed raised: {ex}")
            if not btn.is_visible():
                errors.append("short-viewport: #startbtn not visible after scroll_into_view_if_needed")
            else:
                box = btn.bounding_box()
                if not box or box["y"] < 0 or (box["y"] + box["height"]) > 600:
                    errors.append(f"short-viewport: #startbtn out of [0,600] bounds after scroll: {box}")
            short_page.close()

            browser.close()
    finally:
        httpd.shutdown()

    if errors:
        print("SMOKE: FAIL")
        for e in errors:
            print("  -", e)
        sys.exit(1)
    print("SMOKE: PASS")


if __name__ == "__main__":
    main()
