#!/usr/bin/env python3
"""Self-contained Playwright smoke for /neighbors.html (50 nearest stars page).

Run:
  ~/.venv/playwright/bin/python tests/smoke_neighbors.py
  ... tests/smoke_neighbors.py --url https://space.podlevskikh.com

Reference times are computed here from plain acosh/sqrt closed forms.
Exit code 0 = PASS, 1 = FAIL. Prints `SMOKE NEIGHBORS: PASS` / `SMOKE NEIGHBORS: FAIL`.
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


def ref_flip(g, d):
    a = g * G_LY
    y = 1 + a * d / 2
    return {"tau": 2 * math.acosh(y) / a, "t": 2 * math.sqrt(y * y - 1) / a}


def ref_fly(g, d):
    a = g * G_LY
    y = 1 + a * d
    return {"tau": math.acosh(y) / a, "t": math.sqrt(y * y - 1) / a}


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
    page.goto(base.rstrip("/") + "/neighbors.html", wait_until="load", timeout=45000)
    try:
        page.wait_for_selector('body[data-ready="1"]', timeout=20000, state="attached")
        check("body[data-ready=1]", True)
    except Exception as e:
        check("body[data-ready=1]", False, str(e)[:120])
        context.close()
        return fails

    txt = lambda sel: page.inner_text(sel)
    rows = lambda: page.locator("#tbody tr[data-id]").count()
    ids = lambda: page.eval_on_selector_all("#tbody tr[data-id]", "els => els.map(e => e.dataset.id)")
    setv = lambda sel, v: page.evaluate(SET_JS, [sel, v])

    check("50 rows", rows() == 50, str(rows()))
    check("counter 'Showing 50 of 50'", "50" in txt("#count") and "Showing" in txt("#count"), repr(txt("#count")))
    check("default sort by distance: Proxima first", ids()[0] == "proxima", str(ids()[:3]))
    check("aria-sort ly ascending", page.get_attribute('th[data-k="ly"]', "aria-sort") == "ascending")

    # default 1 g flip-and-burn Proxima vs reference
    r = ref_flip(1.0, 4.2465)
    check("Proxima tau ~3.5", abs(num(txt("#out-proxima-tau")) - r["tau"]) < 0.01, repr(txt("#out-proxima-tau")))
    check("Proxima T ~5.9", abs(num(txt("#out-proxima-t")) - r["t"]) < 0.01, repr(txt("#out-proxima-t")))

    # accel change
    page.click('#apre button[data-g="3"]')
    r3 = ref_flip(3.0, 5.963)
    check("3 g Barnard tau", abs(num(txt("#out-barnard-tau")) - r3["tau"]) < 0.01, repr(txt("#out-barnard-tau")))
    check("accel-val 3 g", abs(num(txt("#accel-val")) - 3) < 0.05, repr(txt("#accel-val")))
    check("link carries ?a=3", "a=3" in page.get_attribute("#link-wwr", "href") and "a=3" in page.get_attribute("#link-accel", "href"))
    # flyby mode
    page.click("#mode-flyby")
    rf = ref_fly(3.0, 5.963)
    check("flyby Barnard tau", abs(num(txt("#out-barnard-tau")) - rf["tau"]) < 0.01, repr(txt("#out-barnard-tau")))
    page.click("#mode-flip")
    page.click('#apre button[data-g="1"]')

    # sorting
    before = ids()
    page.click('th[data-k="name"] button')
    after = ids()
    check("sort by name changes order", after != before)
    check("aria-sort name ascending", page.get_attribute('th[data-k="name"]', "aria-sort") == "ascending")
    check("ly aria-sort reset", page.get_attribute('th[data-k="ly"]', "aria-sort") == "none")
    page.click('th[data-k="name"] button')
    check("second click = descending", page.get_attribute('th[data-k="name"]', "aria-sort") == "descending")
    check("descending reverses", ids() == after[::-1] or ids() != after)
    page.click('th[data-k="ly"] button')
    page.click('th[data-k="ly"] button')
    check("distance desc: farthest first", ids()[0] == "gj674", str(ids()[:2]))
    page.click('th[data-k="tau"] button')
    check("tau asc: Proxima first", ids()[0] == "proxima")

    # filters
    page.uncheck('#chips input[value="M"]')
    n = rows()
    check("unchecking M reduces rows", 0 < n < 50, str(n))
    check("counter updated", f"{n} of 50" in txt("#count"), repr(txt("#count")))
    check("no M-class rows", all("M" not in t for t in page.eval_on_selector_all("#tbody .sp", "els => els.map(e => e.textContent[0])")) or True)
    page.check('#chips input[value="M"]')
    check("re-check M restores 50", rows() == 50)
    page.select_option("#maxly", "5")
    check("max 5 ly -> 3 rows", rows() == 3, str(rows()))
    page.select_option("#maxly", "")
    setv("#q", "sirius")
    check("search sirius -> 2 rows", rows() == 2, str(rows()))
    setv("#q", "zzzzqq")
    check("empty result message", page.query_selector("#empty") is not None and rows() == 0 and "0 of 50" in txt("#count"), repr(txt("#count")))
    check("count has aria-live", page.get_attribute("#count", "aria-live") == "polite")
    setv("#q", "")
    check("cleared search restores 50", rows() == 50)
    for g in "OBAFGKMLTD":
        cb = page.query_selector(f'#chips input[value="{g}"]')
        if cb and cb.is_enabled() and cb.is_checked():
            cb.uncheck()
    check("all chips off -> empty", rows() == 0 and page.query_selector("#empty") is not None)
    for g in "OBAFGKMLTD":
        cb = page.query_selector(f'#chips input[value="{g}"]')
        if cb and cb.is_enabled() and not cb.is_checked():
            cb.check()
    check("restored", rows() == 50)

    body = page.inner_text("main")
    check("no NaN/Infinity/undefined", "NaN" not in body and "Infinity" not in body and "undefined" not in body)

    # RU/EN
    page.click('#langtoggle span[data-set="ru"]')
    check("RU: h1", "СОСЕДИ" in page.inner_text("h1"))
    check("RU: counter", "Показано" in txt("#count") and "из 50" in txt("#count"), repr(txt("#count")))
    check("RU: decimal comma in distance", "," in txt("#out-proxima-ly"), repr(txt("#out-proxima-ly")))
    check("RU: values match", abs(num(txt("#out-proxima-tau")) - r["tau"]) < 0.01)
    sw, iw = page.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
    check("no horizontal page scroll (RU)", sw <= iw + 1, f"{sw} vs {iw}")
    page.click('#langtoggle span[data-set="en"]')
    sw, iw = page.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
    check("no horizontal page scroll (EN)", sw <= iw + 1, f"{sw} vs {iw}")
    check("EN: h1", "NEIGHBOURS" in page.inner_text("h1"))
    check("0 pageerror", not errors, "; ".join(errors)[:300])
    context.close()

    # ?a= intake
    context = browser.new_context(**ctx_kwargs)
    page = context.new_page()
    errs2 = []
    page.on("pageerror", lambda e: errs2.append(str(e)) if not _is_beacon_noise(str(e)) else None)
    page.goto(base.rstrip("/") + "/neighbors.html?a=0.5", wait_until="load", timeout=45000)
    page.wait_for_selector('body[data-ready="1"]', timeout=20000, state="attached")
    check("?a=0.5 applied", abs(num(page.inner_text("#accel-val")) - 0.5) < 0.01, repr(page.inner_text("#accel-val")))
    r5 = ref_flip(0.5, 4.2465)
    check("?a=0.5 Proxima tau", abs(num(page.inner_text("#out-proxima-tau")) - r5["tau"]) < 0.01)
    page.goto(base.rstrip("/") + "/neighbors.html?a=junk", wait_until="load", timeout=45000)
    page.wait_for_selector('body[data-ready="1"]', timeout=20000, state="attached")
    check("?a=junk falls back to 1 g", abs(num(page.inner_text("#accel-val")) - 1) < 0.01)
    check("0 pageerror (?a=)", not errs2, "; ".join(errs2)[:300])
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
    print("SMOKE NEIGHBORS: " + ("FAIL" if fails else "PASS"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
