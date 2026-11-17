#!/usr/bin/env python3
"""Self-contained Playwright smoke for /accel.html (flip-and-burn vs flyby page).

Run:
  PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-arm64 ~/.venv/playwright/bin/python tests/smoke_accel.py
  ... tests/smoke_accel.py --url https://space.podlevskikh.com

Values are compared with independent reference formulas (plain acosh/sinh) computed here.
Exit code 0 = PASS, 1 = FAIL. Prints `SMOKE ACCEL: PASS` / `SMOKE ACCEL: FAIL`.
"""
import argparse
import functools
import http.server
import math
import os
import re
import socket
import socketserver
import sys
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G_LY = 9.80665 * 365.25 * 86400 / 299792458  # 1 g in ly/yr^2
TARGETS = {"proxima": 4.2465, "barnard": 5.963}
IDS = ["accel", "accel-val", "tgt-proxima", "tgt-barnard", "chart", "tbody", "sel-name", "out-flip-t",
       "out-flip-tau", "out-fly-t", "out-fly-tau"]


def ref(g, d, kind):
    a = g * G_LY
    x = d / 2 if kind == "flip" else d
    gam = 1 + a * x
    n = 2 if kind == "flip" else 1
    return {"t": n * math.sqrt(gam * gam - 1) / a, "tau": n * math.acosh(gam) / a,
            "beta": math.sqrt(1 - 1 / gam / gam), "gamma": gam}


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
    return "stats.podlevskikh.com" in text


def num(text):
    m = re.search(r"-?\d[\d\s  ]*(?:[.,]\d+)?(?:e[+-]?\d+)?", text or "")
    if not m:
        return float("nan")
    s = re.sub(r"[\s  ]", "", m.group(0)).replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return float("nan")


SET_JS = """([sel, v]) => { const el = document.querySelector(sel);
  el.value = String(v);
  el.dispatchEvent(new Event('input', {bubbles: true}));
  el.dispatchEvent(new Event('change', {bubbles: true})); }"""
CANVAS_INK = """() => { const c = document.getElementById('chart'); const x = c.getContext('2d');
  const d = x.getImageData(0, 0, c.width, c.height).data; let n = 0;
  for (let i = 0; i < d.length; i += 4) { if (d[i+3] > 0 && d[i+1] > 150 && d[i] > 80) n++; } return n; }"""


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
    page.goto(base.rstrip("/") + "/accel.html", wait_until="load", timeout=45000)
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

    def slider_for(g):  # log scale 0.01..10 g
        return 1000 * math.log(g / 0.01) / math.log(1000)

    def check_table(g, tag):
        for tid, d in TARGETS.items():
            for kind in ("flip", "flyby"):
                r = ref(g, d, kind)
                for k, tol in (("t", 0.01), ("tau", 0.01), ("beta", 5e-5), ("gamma", 0.01)):
                    cell = txt(f"out-{tid}-{kind}-{k}")
                    v = num(cell)
                    ok = abs(v - r[k]) <= tol * max(1.0, abs(r[k])) if k != "beta" else abs(v - r[k]) <= tol
                    check(f"{tag} {tid} {kind} {k} ~{r[k]:.4f}", ok, repr(cell))

    # --- default 1 g, Proxima ---
    check("default accel shows 1 g", "1.00" in txt("accel-val") and "g" in txt("accel-val"), repr(txt("accel-val")))
    check_table(1.0, "1g")
    r = ref(1.0, 4.2465, "flip")
    check("big flip Earth time ~5.87 years", abs(num(txt("out-flip-t")) - r["t"]) < 0.01 and "years" in txt("out-flip-t"), repr(txt("out-flip-t")))
    check("big flip ship time ~3.54 years", abs(num(txt("out-flip-tau")) - r["tau"]) < 0.01, repr(txt("out-flip-tau")))
    check("chart has ink", page.evaluate(CANVAS_INK) > 200)

    # --- slider changes numbers, matches physics ---
    before = txt("out-flip-t")
    ink_before = page.evaluate(CANVAS_INK)
    setv("#accel", slider_for(0.1))
    check("slider changes flip Earth time", txt("out-flip-t") != before, f"{before!r} -> {txt('out-flip-t')!r}")
    check("accel-val ~0.10 g", abs(num(txt("accel-val")) - 0.1) < 0.005, repr(txt("accel-val")))
    check_table(0.1, "0.1g")
    check("chart still drawn", page.evaluate(CANVAS_INK) > 200)
    setv("#accel", 1000)
    check_table(10.0, "10g")
    setv("#accel", 0)
    check_table(0.01, "0.01g")

    # --- target tabs ---
    page.click("#tgt-barnard")
    check("Barnard tab pressed", page.get_attribute("#tgt-barnard", "aria-pressed") == "true" and page.get_attribute("#tgt-proxima", "aria-pressed") == "false")
    check("selected name Barnard", "Barnard" in txt("sel-name"), repr(txt("sel-name")))
    setv("#accel", slider_for(1.0))
    rb = ref(1.0, 5.963, "flip")
    check("big numbers follow Barnard", abs(num(txt("out-flip-t")) - rb["t"]) < 0.01, repr(txt("out-flip-t")))
    page.click("#tgt-proxima")
    check("selected name Proxima", "Proxima" in txt("sel-name"), repr(txt("sel-name")))
    check("big numbers follow Proxima", abs(num(txt("out-flip-t")) - r["t"]) < 0.01, repr(txt("out-flip-t")))

    # --- preset buttons ---
    page.click('#apre button[data-g="3"]')
    check("preset 3 g", abs(num(txt("accel-val")) - 3) < 0.05, repr(txt("accel-val")))
    check_table(3.0, "3g preset")

    # --- no NaN anywhere across the slider ---
    for s in (0, 1, 250, 500, 666.667, 900, 1000):
        setv("#accel", s)
        body = page.inner_text("main")
        check(f"no NaN/Infinity in DOM at slider {s}", "NaN" not in body and "Infinity" not in body and "undefined" not in body)

    # --- RU/EN ---
    setv("#accel", slider_for(1.0))
    page.click('#langtoggle span[data-set="ru"]')
    check("RU: html lang=ru", page.evaluate("document.documentElement.lang") == "ru")
    check("RU: h1 Russian", "РАЗГОН" in page.inner_text("h1"), repr(page.inner_text("h1")))
    ru = txt("out-flip-t")
    check("RU: decimal comma + 'года'/'лет'", "," in ru and ("года" in ru or "лет" in ru), repr(ru))
    check("RU: values still match physics", abs(num(ru) - r["t"]) < 0.01, repr(ru))
    page.click('#langtoggle span[data-set="en"]')
    check("EN: h1 English", "ACCELERATING" in page.inner_text("h1"))

    # --- layout ---
    page.click('#langtoggle span[data-set="ru"]')
    sw, iw = page.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
    check("no horizontal scroll (RU)", sw <= iw + 1, f"scrollWidth={sw} innerWidth={iw}")
    page.click('#langtoggle span[data-set="en"]')
    sw, iw = page.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
    check("no horizontal scroll", sw <= iw + 1, f"scrollWidth={sw} innerWidth={iw}")

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
            fails += run_viewport(browser, base, "desktop 1280x800", {"viewport": {"width": 1280, "height": 800}})
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
    print("SMOKE ACCEL: " + ("FAIL" if fails else "PASS"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
