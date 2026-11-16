#!/usr/bin/env python3
"""Self-contained Playwright smoke for /twins.html (twin paradox page).

Run (x86_64 server, no PLAYWRIGHT_HOST_PLATFORM_OVERRIDE needed):
  ~/.venv/playwright/bin/python tests/smoke_twins.py
  ~/.venv/playwright/bin/python tests/smoke_twins.py --url https://space.podlevskikh.com

Beta is set robustly: the #beta slider may map nonlinearly onto beta, so we do NOT assume a mapping.
We binary-search the slider value (monotone assumption: higher slider => higher beta => higher gamma)
until #out-gamma is closest to gamma(0.99)=7.0888, relaxing step="any" first so the slider is not
quantised. Only the observable outputs (#out-gamma / #out-ship) are asserted, never the slider value.
Exit code 0 = PASS, 1 = FAIL. Prints `SMOKE TWINS: PASS` / `SMOKE TWINS: FAIL`.
"""
import argparse
import functools
import http.server
import os
import re
import socket
import socketserver
import sys
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IDS = ["mode", "beta", "years", "t", "out-gamma", "out-earth", "out-ship", "out-gap",
       "out-dist", "out-maxv", "out-x", "twins-chart"]
GAMMA_099 = 7.088812050083354
SHIP_099_T10 = 1.4106735979665894


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve(port):
    handler = functools.partial(QuietHandler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def _is_beacon_noise(text):
    # external analytics beacon (stats.podlevskikh.com) is unreachable from some hosts; unrelated to this page
    return "stats.podlevskikh.com" in text


def num(text):
    m = re.search(r"-?\d[\d\s  ]*(?:[.,]\d+)?", text or "")
    if not m:
        return float("nan")
    s = re.sub(r"[\s  ]", "", m.group(0)).replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return float("nan")


SET_JS = """([sel, v]) => { const el = document.querySelector(sel);
  if (el.tagName === 'INPUT') { el.step = 'any'; }
  el.value = String(v);
  el.dispatchEvent(new Event('input', {bubbles: true}));
  el.dispatchEvent(new Event('change', {bubbles: true})); }"""

CANVAS_JS = """() => { const c = document.querySelector('#twins-chart');
  const out = {w: c.width, h: c.height, opaque: 0, colors: 0, ctx: false};
  let ctx = null; try { ctx = c.getContext('2d'); } catch (e) {}
  if (!ctx) return out;
  out.ctx = true;
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const seen = new Set();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 200) { out.opaque++; if (seen.size < 64) seen.add((d[i] >> 4) + ',' + (d[i+1] >> 4) + ',' + (d[i+2] >> 4)); }
  }
  out.colors = seen.size; return out; }"""


def run_viewport(browser, base, label, ctx_kwargs):
    fails, notes = [], []

    def check(name, cond, detail=""):
        print(f"  [{'ok' if cond else 'FAIL'}] {label}: {name} {detail}")
        if not cond:
            fails.append(f"{label}: {name} {detail}")

    context = browser.new_context(**ctx_kwargs)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)) if not _is_beacon_noise(str(e)) else None)
    page.goto(base.rstrip("/") + "/twins.html", wait_until="load", timeout=45000)
    try:
        page.wait_for_selector('body[data-ready="1"]', timeout=20000, state="attached")
        check("body[data-ready=1]", True)
    except Exception as e:
        check("body[data-ready=1]", False, str(e)[:120])
        context.close()
        return fails

    missing = [i for i in IDS if page.query_selector("#" + i) is None]
    check("required elements present", not missing, f"missing={missing}")
    if missing:
        context.close()
        return fails

    txt = lambda i: page.inner_text("#" + i)
    setv = lambda sel, v: page.evaluate(SET_JS, [sel, v])

    page.select_option("#mode", "cruise")
    setv("#years", 10)
    setv("#t", 1000)

    # --- set beta ~ 0.99 by bisecting the slider on the observable #out-gamma ---
    lo = float(page.get_attribute("#beta", "min") or 0)
    hi = float(page.get_attribute("#beta", "max") or 1)
    for _ in range(40):
        mid = (lo + hi) / 2
        setv("#beta", mid)
        g = num(txt("out-gamma"))
        if g != g:  # NaN: slider top end may be beta>=1
            hi = mid
        elif g < GAMMA_099:
            lo = mid
        else:
            hi = mid
    best = min((lo, hi), key=lambda v: (setv("#beta", v), abs(num(txt("out-gamma")) - GAMMA_099))[1])
    setv("#beta", best)
    gamma, ship = num(txt("out-gamma")), num(txt("out-ship"))
    notes.append(f"{label}: beta slider value={best} (range {lo}..{hi}) -> gamma={gamma} ship={ship}")
    check("gamma ~ 7.09 (+-0.1)", abs(gamma - 7.09) <= 0.1, f"got {gamma}")
    check("ship ~ 1.41 (+-0.05) at T=10y", abs(ship - 1.41) <= 0.05, f"got {ship} ({txt('out-ship')!r})")

    # --- #t drives #out-earth ---
    e1 = txt("out-earth")
    setv("#t", 500)
    e2 = txt("out-earth")
    check("changing #t changes #out-earth", e1 != e2, f"{e1!r} -> {e2!r}")
    setv("#t", 1000)

    # --- mode switch changes ship readout ---
    ship_cruise = txt("out-ship")
    page.select_option("#mode", "accel")
    page.wait_for_timeout(150)
    ship_accel = txt("out-ship")
    check("mode=accel changes #out-ship", ship_cruise != ship_accel, f"{ship_cruise!r} -> {ship_accel!r}")
    for i in ("out-gamma", "out-earth", "out-gap", "out-dist", "out-maxv", "out-x"):
        v = txt(i).strip()
        check(f"#{i} non-empty in accel", bool(v) and "NaN" not in v, repr(v))

    # --- chart pixels ---
    px = page.evaluate(CANVAS_JS)
    if px["ctx"]:
        check("canvas has opaque pixels", px["opaque"] > 0, str(px))
        check("canvas has >=2 distinct colours", px["colors"] >= 2, str(px))
    else:
        notes.append(f"{label}: #twins-chart has no 2d context (webgl?) - pixel check skipped")

    # --- layout: no horizontal scroll (matters on mobile) ---
    sw, iw = page.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
    check("no horizontal scroll", sw <= iw + 1, f"scrollWidth={sw} innerWidth={iw}")

    check("0 pageerror", not errors, "; ".join(errors)[:300])
    for n in notes:
        print("  note:", n)
    context.close()
    return fails


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", help="base URL to test instead of the local static server")
    args = ap.parse_args()
    from playwright.sync_api import sync_playwright

    httpd = None
    base = args.url
    if not base:
        port = free_port()
        httpd = serve(port)
        base = f"http://127.0.0.1:{port}"
    fails = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            fails += run_viewport(browser, base, "desktop 1280x800",
                                  {"viewport": {"width": 1280, "height": 800}})
            fails += run_viewport(browser, base, "mobile 390x844",
                                  {"viewport": {"width": 390, "height": 844}, "is_mobile": True,
                                   "has_touch": True, "device_scale_factor": 2})
            browser.close()
    except Exception as e:
        fails.append(f"exception: {e!r}")
    finally:
        if httpd:
            httpd.shutdown()
    for f in fails:
        print("FAIL:", f)
    print("SMOKE TWINS: " + ("FAIL" if fails else "PASS"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
