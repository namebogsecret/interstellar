#!/usr/bin/env python3
"""Self-contained Playwright smoke for /comms.html (ship communications page).

Run (x86_64 server, no PLAYWRIGHT_HOST_PLATFORM_OVERRIDE needed):
  ~/.venv/playwright/bin/python tests/smoke_comms.py
  ~/.venv/playwright/bin/python tests/smoke_comms.py --url https://space.podlevskikh.com

Sliders are set through the DOM (input events); only observable outputs are asserted.
Exit code 0 = PASS, 1 = FAIL. Prints `SMOKE COMMS: PASS` / `SMOKE COMMS: FAIL`.
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
IDS = ["target", "dist", "beta", "dir", "carrier", "out-oneway", "out-round", "out-chase", "out-ping",
       "out-doppler", "out-shift", "out-ftx", "out-frx", "out-wl", "out-gamma", "out-dil", "out-kin", "out-rate"]


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
    page.goto(base.rstrip("/") + "/comms.html", wait_until="load", timeout=45000)
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

    # --- Proxima, beta=0, X-band: delay 4.2465 years one way, 8.49 round trip ---
    page.select_option("#target", "star-Proxima Centauri")
    setv("#beta", 0)
    page.select_option("#carrier", "X")
    page.select_option("#dir", "away")
    ow, rt = txt("out-oneway"), txt("out-round")
    check("Proxima one-way ~4.2465 years", abs(num(ow) - 4.2465) < 0.001 and "years" in ow, repr(ow))
    check("Proxima round trip ~8.49 years", abs(num(rt) - 8.493) < 0.01, repr(rt))
    check("beta=0: doppler 1.0000", abs(num(txt("out-doppler")) - 1) < 1e-9, repr(txt("out-doppler")))
    check("beta=0: X-band received 8.4 GHz", "8.4" in txt("out-frx") and "GHz" in txt("out-frx"), repr(txt("out-frx")))

    # --- sliders change the output ---
    e1 = txt("out-oneway")
    setv("#dist", 100)
    e2 = txt("out-oneway")
    check("distance slider changes one-way delay", e1 != e2, f"{e1!r} -> {e2!r}")
    check("target switches to Custom after slider", page.eval_on_selector("#target", "e => e.value") == "custom")
    d1 = txt("out-doppler")
    setv("#beta", 400)  # 1-beta = 1e-2 -> beta = 0.99
    d2 = txt("out-doppler")
    check("beta slider changes doppler", d1 != d2, f"{d1!r} -> {d2!r}")
    check("beta=0.99 receding: D ~0.0709 (red)", abs(num(d2) - 0.07088) < 2e-4 and "red" in txt("out-shift"), f"{d2!r} {txt('out-shift')!r}")
    check("beta=0.99: gamma ~7.09", abs(num(txt("out-gamma")) - 7.09) < 0.02, repr(txt("out-gamma")))
    page.select_option("#dir", "toward")
    d3 = txt("out-doppler")
    check("approaching beta=0.99: D ~14.1 (blue)", abs(num(d3) - 14.107) < 0.05 and "blue" in txt("out-shift"), f"{d3!r} {txt('out-shift')!r}")
    c1 = txt("out-frx")
    page.select_option("#carrier", "Ka")
    check("carrier changes received frequency", c1 != txt("out-frx"), f"{c1!r} -> {txt('out-frx')!r}")
    setv("#beta", 1000)
    for i in IDS[5:]:
        v = txt(i).strip()
        check(f"#{i} finite at max beta", bool(v) and "NaN" not in v and "Infinity" not in v, repr(v))

    # --- aria-valuetext on both sliders, updated on input ---
    av1 = page.get_attribute("#dist", "aria-valuetext")
    setv("#dist", 900)
    av2 = page.get_attribute("#dist", "aria-valuetext")
    check("dist aria-valuetext human-readable and updates", bool(av1) and bool(av2) and av1 != av2 and ("ly" in av2 or "AU" in av2 or "km" in av2), f"{av1!r} -> {av2!r}")
    setv("#beta", 400)
    bv = page.get_attribute("#beta", "aria-valuetext")
    check("beta aria-valuetext human-readable", bool(bv) and "0.99" in bv, repr(bv))

    # --- Custom distance sticks even when the distance equals a preset ---
    page.select_option("#target", "moon")
    setv("#dist", 0)  # slider floor == Moon distance exactly
    check("Custom stays selected when distance equals a preset", page.eval_on_selector("#target", "e => e.value") == "custom")
    page.select_option("#target", "moon")
    check("Moon preset selectable", page.eval_on_selector("#target", "e => e.value") == "moon")
    check("slider floor shows Moon (1.28 s)", "1.2" in txt("out-oneway") and txt("out-oneway").strip().endswith("s"), repr(txt("out-oneway")))
    setv("#beta", 0)

    # --- RU/EN toggle ---
    en_ow = txt("out-oneway")
    page.click('#langtoggle span[data-set="ru"]')
    ru_ow = txt("out-oneway")
    check("RU: html lang=ru", page.evaluate("document.documentElement.lang") == "ru")
    check("RU: units localised", ru_ow != en_ow and ("лет" in ru_ow or "сут" in ru_ow or "ч" in ru_ow or "мин" in ru_ow or "с" in ru_ow), f"{en_ow!r} -> {ru_ow!r}")
    check("RU: h1 visible Russian", "СВЯЗЬ" in page.inner_text("h1"), repr(page.inner_text("h1")))
    check("RU: GHz localised", "ГГц" in txt("out-frx") or "МГц" in txt("out-frx"), repr(txt("out-frx")))
    check("RU: band localised", "диапазон" in page.inner_text("#carrier"), repr(page.inner_text("#carrier"))[:80])
    page.select_option("#target", "star-Proxima Centauri")
    ru_y = txt("out-oneway")
    check("RU: fractional years -> 'года'", ru_y.endswith("года"), repr(ru_y))
    page.select_option("#target", "star-Sirius A/B")
    ru_y2 = txt("out-oneway")
    check("RU: fractional years (Sirius) -> 'года'", ru_y2.endswith("года") or ru_y2.endswith("лет"), repr(ru_y2))
    page.click('#langtoggle span[data-set="en"]')
    check("EN: h1 visible English", "COMMUNICATING" in page.inner_text("h1"), repr(page.inner_text("h1")))

    # --- layout: no horizontal scroll (matters on mobile) ---
    sw, iw = page.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
    check("no horizontal scroll", sw <= iw + 1, f"scrollWidth={sw} innerWidth={iw}")
    page.click('#langtoggle span[data-set="ru"]')
    sw, iw = page.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
    check("no horizontal scroll (RU)", sw <= iw + 1, f"scrollWidth={sw} innerWidth={iw}")

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
    print("SMOKE COMMS: " + ("FAIL" if fails else "PASS"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
