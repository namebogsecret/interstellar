#!/usr/bin/env python3
"""Self-contained Playwright smoke for /mission.html (mission builder).

Run:
  ~/.venv/playwright/bin/python tests/smoke_mission.py
  ... tests/smoke_mission.py --url https://space.podlevskikh.com

Exit code 0 = PASS, 1 = FAIL. Prints `SMOKE MISSION: PASS` / `SMOKE MISSION: FAIL`.
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

OUT_IDS = ["#o-te", "#o-ts", "#o-dv", "#o-vmax", "#o-gamma", "#o-arr", "#o-power", "#o-energy", "#o-budget", "#o-loss", "#o-mass"]
ENGINES = ["chemical", "ion", "ntr", "fusion", "sail", "laser", "photon"]


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
    resp = page.goto(base.rstrip("/") + "/mission.html", wait_until="load", timeout=45000)
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
    bad = lambda s: bool(re.search(r"NaN|Infinity|undefined|null", s))

    def snap():
        out = []
        for i in OUT_IDS:
            out.append(txt(i) if page.locator(i).count() else "")
        return out + [txt("#verdict")]

    check("EN: h1", "BUILD A MISSION" in txt("h1"))
    check("default: no NaN/Infinity/undefined", not bad(page.inner_text("main")))
    check("default: summary filled", all(x.strip() for x in page.locator("#stats .stat b").all_inner_texts()) and page.locator("#stats .stat").count() >= 9)
    check("default: verdict names the star", "Proxima" in txt("#verdict"), txt("#verdict")[:80])
    n_stars = page.locator("#star option").count()
    check("star select has 50 options", n_stars == 50, str(n_stars))
    check("engine select has 7 options", page.locator("#eng option").count() == 7)

    # every engine renders a finite summary; sails cannot brake; photon/laser show their own controls
    prev = None
    for eng in ENGINES:
        page.select_option("#eng", eng)
        cur = snap()
        check(f"engine {eng}: no NaN/Infinity", not bad(page.inner_text("main")))
        check(f"engine {eng}: verdict present", "Reaches" in cur[-1], cur[-1][:80])
        check(f"engine {eng}: output differs from previous engine", cur != prev)
        prev = cur
        dis = page.is_disabled("#brake")
        check(f"engine {eng}: brake checkbox disabled iff sail", dis == (eng in ("sail", "laser")), str(dis))
        check(f"engine {eng}: accel control iff photon", page.is_visible("#ag") == (eng == "photon"))
        check(f"engine {eng}: laser controls iff laser", page.is_visible("#pw") == (eng == "laser") and page.is_visible("#ar") == (eng == "laser"))
    page.select_option("#eng", "sail")
    check("sail: cannot-brake explained", "Braking is impossible" in txt("#warn"), repr(txt("#warn"))[:80])

    # star change changes the answer
    page.select_option("#eng", "fusion")
    before = snap()
    page.select_option("#star", index=n_stars - 1)
    after = snap()
    check("star change changes output", before != after)
    check("farthest star: no NaN/Infinity", not bad(page.inner_text("main")))
    page.select_option("#star", index=0)

    # brake toggle changes the output and the flyby note appears
    before = snap()
    page.uncheck("#brake")
    after = snap()
    check("brake toggle changes output", before != after)
    check("flyby note shown", "Flyby" in txt("#warn"), repr(txt("#warn"))[:80])
    page.check("#brake")

    # sliders change output
    for sel, v in (("#pl", 900), ("#bd", 100)):
        before = snap()
        setv(sel, v)
        after = snap()
        check(f"slider {sel} changes output", before != after)
        check(f"slider {sel}: no NaN/Infinity", not bad(page.inner_text("main")))
    page.select_option("#eng", "photon")
    before = snap(); setv("#ag", 900); check("photon accel slider changes output", before != snap())
    page.select_option("#eng", "laser")
    before = snap(); setv("#pw", 900); check("laser power slider changes output", before != snap())
    before = snap(); setv("#ar", 800); check("laser area slider changes output", before != snap())
    # extremes
    for eng in ENGINES:
        page.select_option("#eng", eng)
        for pl, bd in ((0, 0), (1000, 0), (0, 1000), (1000, 1000)):
            setv("#pl", pl); setv("#bd", bd)
            check(f"extreme {eng} {pl}/{bd}: no NaN/Infinity", not bad(page.inner_text("main")))
    setv("#pl", 500)

    # over budget is flagged
    page.select_option("#eng", "photon"); setv("#bd", 0)
    check("over budget flagged", "over budget" in txt("#o-budget").lower() and "over budget" not in txt("#o-budget") or "Over budget" in txt("#warn"), txt("#o-budget"))

    # RU/EN
    page.click('#langtoggle span[data-set="ru"]')
    check("RU: h1", "СОБЕРИ МИССИЮ" in txt("h1"))
    check("RU: html lang", page.evaluate("document.documentElement.lang") == "ru")
    check("RU: verdict in Russian", "Долетит" in txt("#verdict"), txt("#verdict")[:60])
    check("RU: star names in Russian", "Проксима" in page.inner_text("#star option:first-child"))
    check("RU: no NaN/Infinity", not bad(page.inner_text("main")))
    check("RU: lang persisted", page.evaluate("localStorage.getItem('iss_lang')") == "ru")
    sw, iw = page.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
    check("no horizontal page scroll (RU)", sw <= iw + 1, f"{sw} vs {iw}")
    page.click('#langtoggle span[data-set="en"]')
    check("EN: h1 back", "BUILD A MISSION" in txt("h1"))
    sw, iw = page.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
    check("no horizontal page scroll (EN)", sw <= iw + 1, f"{sw} vs {iw}")
    page.reload(wait_until="load")
    page.wait_for_selector('body[data-ready="1"]', state="attached", timeout=20000)
    check("language restored after reload", page.evaluate("localStorage.getItem('iss_lang')") == "en")
    check("0 pageerror", not errors, "; ".join(errors)[:300])
    context.close()
    return fails


def check_links(browser, base):
    fails = []
    page = browser.new_page()
    for f in ("engines", "laser-sail", "accel", "neighbors", "twins", "where-we-reach"):
        page.goto(f"{base.rstrip('/')}/{f}.html", wait_until="load", timeout=45000)
        n = page.locator('a[href="mission.html"]').count()
        print(f"  [{'ok' if n else 'FAIL'}] link to mission.html on {f}.html ({n})")
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
    print("SMOKE MISSION: " + ("FAIL" if fails else "PASS"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
