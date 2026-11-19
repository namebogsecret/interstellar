#!/usr/bin/env python3
"""Self-contained Playwright smoke for /laser-sail.html (laser sail to Proxima).

Run:
  PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-arm64 ~/.venv/playwright/bin/python tests/smoke_lasersail.py
  ... tests/smoke_lasersail.py --url https://space.podlevskikh.com

Exit code 0 = PASS, 1 = FAIL. Prints `SMOKE LASERSAIL: PASS` / `SMOKE LASERSAIL: FAIL`.
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


SET_JS = """([sel, v]) => { const el = document.querySelector(sel);
  el.value = String(v);
  el.dispatchEvent(new Event('input', {bubbles: true}));
  el.dispatchEvent(new Event('change', {bubbles: true})); }"""

OUT_IDS = ["#o-beta", "#o-gamma", "#o-te", "#o-ts", "#o-g0", "#o-gend", "#o-i", "#o-l", "#o-tb", "#o-mass"]


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
    resp = page.goto(base.rstrip("/") + "/laser-sail.html", wait_until="load", timeout=45000)
    check("HTTP 200", resp is not None and resp.status == 200, str(resp.status if resp else None))
    try:
        page.wait_for_selector('body[data-ready="1"]', timeout=20000, state="attached")
        check("body[data-ready=1]", True)
    except Exception as e:
        check("body[data-ready=1]", False, str(e)[:120])
        context.close()
        return fails

    txt = lambda sel: page.inner_text(sel)
    setv = lambda sel, v: page.evaluate(SET_JS, [sel, v])
    snap = lambda: [txt(i) for i in OUT_IDS]
    bad = lambda s: bool(re.search(r"NaN|Infinity|undefined|null", s))

    body = page.inner_text("main")
    check("default: no NaN/Infinity/undefined", not bad(body))
    d0 = snap()
    check("default: all outputs non-empty", all(x.strip() for x in d0), str(d0))
    check("default Starshot preset marked", "on" in (page.get_attribute('#pre button[data-id="starshot"]', "class") or ""))
    check("SVG charts drawn", page.locator("#chartBeta svg polyline").count() >= 1 and page.locator("#chartG svg polyline").count() >= 1)
    check("EN: h1", "LASER SAIL" in txt("h1"))

    # each slider changes the output
    for sel, v in (("#m", 600), ("#pw", 900), ("#ar", 700)):
        before = snap()
        setv(sel, v)
        after = snap()
        check(f"slider {sel} changes output", before != after)
        check(f"slider {sel}: no NaN/Infinity", not bad(page.inner_text("main")))
    # extremes
    for m, p, a in ((0, 0, 0), (1000, 0, 1000), (0, 1000, 1000), (1000, 1000, 0), (1000, 1000, 1000)):
        setv("#m", m); setv("#pw", p); setv("#ar", a)
        check(f"extreme sliders {m}/{p}/{a}: no NaN/Infinity", not bad(page.inner_text("main")))
    # presets
    for pid in ("starshot", "fast", "cubesat", "heavy"):
        page.click(f'#pre button[data-id="{pid}"]')
        check(f"preset {pid}: no NaN/Infinity", not bad(page.inner_text("main")))
    page.click('#pre button[data-id="fast"]')
    check("fast preset: relativistic note shown", "β > 0.1" in page.inner_text("#warn"), repr(page.inner_text("#warn"))[:80])
    page.click('#pre button[data-id="starshot"]')
    check("Starshot: heat warning shown (10 GW/m2 > 1 GW/m2)", "= 100 GW/m²" not in page.inner_text("#warn") and "= 10.0 GW/m²" in page.inner_text("#warn"))
    d_en = snap()

    # RU/EN
    page.click('#langtoggle span[data-set="ru"]')
    check("RU: h1", "ЛАЗЕРНЫЙ ПАРУС" in txt("h1"))
    check("RU: html lang", page.evaluate("document.documentElement.lang") == "ru")
    d_ru = snap()
    check("RU: outputs re-rendered", d_ru != d_en and "," in d_ru[0] + d_ru[1], str(d_ru[:2]))
    check("RU: no NaN/Infinity", not bad(page.inner_text("main")))
    check("RU: lang persisted", page.evaluate("localStorage.getItem('iss_lang')") == "ru")
    sw, iw = page.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
    check("no horizontal page scroll (RU)", sw <= iw + 1, f"{sw} vs {iw}")
    page.click('#langtoggle span[data-set="en"]')
    check("EN: h1 back", "LASER SAIL" in txt("h1"))
    sw, iw = page.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
    check("no horizontal page scroll (EN)", sw <= iw + 1, f"{sw} vs {iw}")
    # RU is restored from storage on reload
    page.reload(wait_until="load")
    page.wait_for_selector('body[data-ready="1"]', state="attached", timeout=20000)
    check("language restored after reload", page.evaluate("localStorage.getItem('iss_lang')") == "en")
    check("0 pageerror", not errors, "; ".join(errors)[:300])
    context.close()
    return fails


def check_links(browser, base):
    fails = []
    page = browser.new_page()
    for f in ("accel", "engines", "neighbors", "comms", "twins", "where-we-reach"):
        page.goto(f"{base.rstrip('/')}/{f}.html", wait_until="load", timeout=45000)
        n = page.locator('a[href="laser-sail.html"]').count()
        print(f"  [{'ok' if n else 'FAIL'}] link to laser-sail.html on {f}.html ({n})")
        if not n:
            fails.append(f"no link on {f}.html")
    page.close()
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
            fails += check_links(browser, base)
            browser.close()
    except Exception as e:
        fails.append(f"exception: {e!r}")
    finally:
        if httpd:
            httpd.shutdown()
    for f in fails:
        print("FAIL:", f)
    print("SMOKE LASERSAIL: " + ("FAIL" if fails else "PASS"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
