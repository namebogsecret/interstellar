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
# context, confirms the coarse-pointer branch actually took (body.touch /
# #touchui), opens the ☰ drawer, and taps every js/render/touchPanel.js
# PANEL_ACTIONS button once — the phone-equivalent of pressing N/Shift+N/I/Z/
# V/T/J/U/B/C on a keyboard. FAILS on a missing button, an exception from a
# tap, or a pageerror/console error not attributable to the pre-existing
# external-beacon noise documented below (and in CLAUDE.md for the default
# scenario).
# ---------------------------------------------------------------------------

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


def run_touch():
    from playwright.sync_api import sync_playwright

    port = free_port()
    httpd = serve(port)
    url = f"http://127.0.0.1:{port}/index.html"
    errors = []
    warnings = []

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                viewport={"width": 390, "height": 844},
                has_touch=True,
                is_mobile=True,
            )
            page = context.new_page()
            # The browser's native "Failed to load resource: ... 400" message
            # does NOT put the URL in m.text (confirmed by a throwaway probe
            # while writing this test) — it puts it in m.location()['url']
            # instead (Chromium attributes the console line to the resource
            # that failed). Checking only m.text would silently let this
            # filter do nothing and the beacon noise would fail this mode on
            # every run anyway, defeating the whole point of filtering it.
            page.on("console", lambda m: (
                errors.append(f"console.{m.type}: {m.text}")
                if m.type == "error" and not _is_beacon_noise(m.text)
                and not _is_beacon_noise((m.location or {}).get("url", "")) else None))
            page.on("pageerror", lambda e: (
                None if _is_beacon_noise(str(e)) else errors.append(f"pageerror: {e}")))
            page.on("requestfailed", lambda r: (
                None if _is_beacon_noise(r.url) else errors.append(f"requestfailed: {r.url} {r.failure}")))

            page.goto(url, wait_until="load", timeout=30000)
            page.wait_for_function(
                "() => !!window.SIM && !!window.SIM.ship && !!window.SIM.sim",
                timeout=15000,
            )

            # Tap helper: dispatch through page.touchscreen (the low-level
            # touch-input API) at a locator's own bounding-box centre, rather
            # than Locator.tap()/.click(). Measured empirically while writing
            # this test: once the WebGL canvas (#view, full-bleed, its own
            # GPU-composited layer) is the thing sitting behind a button,
            # Playwright's Locator actionability pre-check ("does this point
            # hit the target, not something covering it") reports the CANVAS
            # intercepting pointer events and retries to a timeout — but a
            # plain in-page `document.elementFromPoint()` at the exact same
            # coordinates reliably names the BUTTON (checked 20 consecutive
            # samples 50ms apart: always the button, never a transient
            # mis-hit), and a raw `PointerEvent('pointerdown')` dispatched at
            # the button opens the panel every time. So the button really is
            # on top and really is wired correctly — this is a Playwright/
            # CDP hit-test quirk specific to compositor-layered canvases in
            # headless Chromium, not a bug in the page. `page.mouse.click()`
            # was tried too and does NOT trigger the pointerdown handler
            # (Chromium's low-level CDP mouse path does not reliably
            # synthesize a PointerEvent the way real input does);
            # `page.touchscreen.tap()` does, consistently. Using it here is
            # the honest fix: it still drives a real browser touch-input
            # pipeline end-to-end (not a JS-level dispatchEvent() shortcut),
            # it just skips Playwright's own confused pre-check.
            def tap_locator(locator, label):
                box = None
                try:
                    box = locator.bounding_box()
                except Exception as ex:
                    errors.append(f"{label}: bounding_box() raised: {ex}")
                if not box:
                    errors.append(f"{label}: not visible/attached (bounding_box() was None)")
                    return False
                cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
                try:
                    page.touchscreen.tap(cx, cy)
                except Exception as ex:
                    errors.append(f"{label}: touchscreen.tap raised: {ex}")
                    return False
                return True

            # Dismiss the start screen. The default (desktop) scenario's
            # click-body-then-press-Enter is a NO-OP in practice (there is no
            # window keydown('Enter') handler in js/main.js/onboarding.js —
            # verified by grep; that scenario gets away with it only because
            # its keyboard-only checks work whether or not #startscreen is
            # still covering the canvas). Tap the real dismiss control
            # instead — the same #startbtn the default scenario's OWN
            # short-viewport check already targets a few dozen lines below.
            start_dismissed = tap_locator(page.locator("#startbtn"), "#startbtn (dismiss start screen)")
            page.wait_for_timeout(300)

            # --- mobile bootstrap: the coarse-pointer branch actually took ---
            is_touch_body = page.evaluate("() => document.body.classList.contains('touch')")
            if not is_touch_body:
                errors.append(
                    "document.body missing class 'touch' — js/main.js's isTouch "
                    "detection did not fire for a has_touch+is_mobile context")

            # NOTE on method: Playwright's Locator.is_visible() on #touchui
            # ITSELF is the wrong check here and was dropped after it flagged
            # a false positive — #touchui's own box collapses to zero height
            # (every one of its direct children — #joy/#tbtns-r/#tbtns-b/
            # #tpanel — is `position: fixed`, i.e. taken out of normal flow,
            # so the wrapper <div> that contains only fixed children has
            # nothing left inside it to give it a height). That is how this
            # touch UI has always been laid out (pre-dates this wave), it is
            # not a real invisibility bug — the fixed children still render
            # at the viewport level regardless of their static parent's own
            # box. So check what the ТЗ actually cares about: (a) the CSS
            # rule that is supposed to reveal the touch UI really fired, via
            # computed style, and (b) a real on-screen control from it has a
            # nonzero, on-screen bounding box.
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
                joy_box = page.locator("#joy").bounding_box()
                if not joy_box or joy_box["width"] <= 0 or joy_box["height"] <= 0:
                    errors.append(
                        f"#touchui's #joy control has no on-screen bounding box ({joy_box!r}) "
                        "— the touch UI does not appear to actually be rendered")

            panel_btn = page.locator('[data-tap="panel"]')
            if panel_btn.count() == 0:
                errors.append('[data-tap="panel"] (the ☰ menu button) not found in DOM')

            tpanel_present = page.locator("#tpanel").count() > 0
            if not tpanel_present:
                errors.append('#tpanel (the panel drawer) not found in DOM — aborting the tap sweep')

            # The whole tap sweep is meaningless if the start screen never
            # actually went away (every tap would just keep hitting the
            # modal) — already recorded as an error above, just skip further
            # taps rather than pile on confusing secondary failures.
            if start_dismissed and panel_btn.count() > 0 and tpanel_present:
                def panel_is_open():
                    return page.evaluate(
                        "() => { const e = document.getElementById('tpanel'); "
                        "return !!e && e.classList.contains('open'); }")

                def open_panel():
                    if panel_is_open():
                        return
                    if not tap_locator(panel_btn, '[data-tap="panel"]'):
                        return
                    page.wait_for_timeout(200)
                    if not panel_is_open():
                        errors.append(
                            "#tpanel did not gain class 'open' after tapping "
                            '[data-tap="panel"]')

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

                for name in _TOUCH_PANEL_NAMES:
                    open_panel()
                    btn = page.locator(f'[data-tap="{name}"]')
                    if btn.count() == 0:
                        errors.append(f'[data-tap="{name}"] not found in #tpanel')
                        continue
                    if not tap_locator(btn, f'[data-tap="{name}"]'):
                        continue
                    page.wait_for_timeout(200)
                    if name in _TOUCH_PANEL_ACTION_CLOSERS and panel_is_open():
                        errors.append(
                            f"tapping action button '{name}' should close #tpanel "
                            "(PANEL_ACTIONS kind:'action'), but it is still open")

            page.wait_for_timeout(500)
            has_canvas = page.evaluate(
                "() => { const c=document.querySelector('canvas'); return !!c && c.width>0 && c.height>0; }")
            if not has_canvas:
                errors.append("no sized <canvas> found after the touch sweep (WebGL context likely died)")

            context.close()
            browser.close()
    finally:
        httpd.shutdown()

    if warnings:
        print("== touch smoke warnings (non-fatal) ==")
        for w in warnings:
            print("  !", w)

    if errors:
        print("TOUCH SMOKE: FAIL")
        for e in errors:
            print("  -", e)
        sys.exit(1)
    print("TOUCH SMOKE: PASS")


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
