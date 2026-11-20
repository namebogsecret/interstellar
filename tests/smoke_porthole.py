#!/usr/bin/env python3
"""Self-contained Playwright smoke for /porthole.html (view from the porthole).

Run (x86_64 server, no PLAYWRIGHT_HOST_PLATFORM_OVERRIDE needed):
  ~/.venv/playwright/bin/python tests/smoke_porthole.py
  ~/.venv/playwright/bin/python tests/smoke_porthole.py --url https://space.podlevskikh.com

Asserts only observable outputs: readouts (#out-beta, #out-gamma, #beta-val), the canvas signature
(data-sig, a hash of the projected star positions) and canvas pixels. Exit code 0 = PASS, 1 = FAIL.
Prints `SMOKE PORTHOLE: PASS` / `SMOKE PORTHOLE: FAIL`.
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
IDS = ["beta-slider", "beta-val", "target", "dir-fwd", "dir-back", "fov", "out-beta", "out-gamma",
       "out-n10", "sky", "tip-body"]


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
    m = re.search(r"-?\d[\d\s  ]*(?:[.,]\d+)?", text or "")
    if not m:
        return float("nan")
    s = re.sub(r"[\s  ]", "", m.group(0)).replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return float("nan")


SET_SLIDER = """(v) => { const el = document.querySelector('#beta-slider');
  el.value = String(v);
  el.dispatchEvent(new Event('input', {bubbles: true})); }"""

CANVAS_JS = """() => { const c = document.querySelector('#sky');
  const out = {w: c.width, h: c.height, bright: 0, colors: 0, ctx: false};
  const ctx = c.getContext('2d'); if (!ctx) return out; out.ctx = true;
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const seen = new Set();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] + d[i+1] + d[i+2] > 300) { out.bright++; if (seen.size < 64) seen.add((d[i] >> 5) + ',' + (d[i+1] >> 5) + ',' + (d[i+2] >> 5)); }
  }
  out.colors = seen.size; return out; }"""


def run_viewport(browser, base, label, ctx_kwargs):
    fails = []

    def check(name, cond, detail=""):
        print(f"  [{'ok' if cond else 'FAIL'}] {label}: {name} {detail}")
        if not cond:
            fails.append(f"{label}: {name} {detail}")

    context = browser.new_context(**ctx_kwargs)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)) if not _is_beacon_noise(str(e)) else None)
    page.goto(base.rstrip("/") + "/porthole.html", wait_until="load", timeout=45000)
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
    sig = lambda: page.get_attribute("#sky", "data-sig")

    check("target select has 50 options", page.eval_on_selector_all("#target option", "e => e.length") == 50)
    check("default target Proxima", "Proxima" in page.eval_on_selector("#target", "e => e.options[e.selectedIndex].textContent"))

    # --- beta = 0: gamma 1; slider moves stars ---
    page.evaluate(SET_SLIDER, 0)
    check("beta=0 -> gamma ~ 1", abs(num(txt("out-gamma")) - 1) < 1e-3, repr(txt("out-gamma")))
    s0 = sig()
    px0 = page.evaluate(CANVAS_JS)
    if px0["ctx"]:
        check("canvas has bright pixels", px0["bright"] > 0, str(px0))
        check("canvas has >=2 colour buckets", px0["colors"] >= 2, str(px0))
    page.evaluate(SET_SLIDER, 440)  # ~0.99
    s1 = sig()
    g = num(txt("out-gamma"))
    check("slider ~0.99 -> gamma ~ 7.09 (+-0.3)", abs(g - 7.09) < 0.3, repr(txt("out-gamma")))
    check("slider changes the star positions (data-sig)", s0 != s1, f"{s0} -> {s1}")
    page.evaluate(SET_SLIDER, 670)  # ~0.999
    g3 = num(txt("out-gamma"))
    check("slider ~0.999 -> gamma ~ 22 (+-2)", abs(g3 - 22.4) < 2, repr(txt("out-gamma")))
    n_hi = num(txt("out-n10"))
    page.evaluate(SET_SLIDER, 0)
    n_lo = num(txt("out-n10"))
    check("forward: more stars inside 10 deg at high beta", n_hi > n_lo, f"{n_lo} -> {n_hi}")

    # --- direction toggle ---
    page.evaluate(SET_SLIDER, 440)
    sf = sig()
    page.click("#dir-back")
    sb = sig()
    check("backward toggle changes the sky", sf != sb, f"{sf} -> {sb}")
    check("backward pressed state", "on" in (page.get_attribute("#dir-back", "class") or ""))
    page.click("#dir-fwd")

    # --- target select ---
    page.select_option("#target", "sirius-a")
    check("target change changes the sky", sig() != sf, "")
    rows = page.eval_on_selector_all("#tip-body tr", "e => e.length")
    check("tip table has rows", rows >= 2, f"rows={rows}")
    page.select_option("#target", "proxima")

    # --- language toggle ---
    page.click('#langtoggle span[data-set="ru"]')
    check("RU: <html lang=ru>", page.evaluate("document.documentElement.lang") == "ru")
    check("RU: heading visible", "ИЛЛЮМИНАТОР" in page.inner_text("h1"))
    page.click('#langtoggle span[data-set="en"]')

    # --- layout: no horizontal scroll (matters on mobile) ---
    sw, iw = page.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
    check("no horizontal scroll", sw <= iw + 1, f"scrollWidth={sw} innerWidth={iw}")
    cw = page.evaluate("document.querySelector('#sky').clientWidth")
    check("canvas fits viewport", 0 < cw <= iw, f"canvas={cw} viewport={iw}")

    check("0 pageerror", not errors, "; ".join(errors)[:300])
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
    print("SMOKE PORTHOLE: " + ("FAIL" if fails else "PASS"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
