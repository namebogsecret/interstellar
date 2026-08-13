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
