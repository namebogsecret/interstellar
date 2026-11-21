#!/usr/bin/env python3
"""Self-contained Playwright smoke for /dust.html (interstellar dust and the shield).

Run:
  ~/.venv/playwright/bin/python tests/smoke_dust.py
  ... tests/smoke_dust.py --url https://space.podlevskikh.com

Exit code 0 = PASS, 1 = FAIL. Prints `SMOKE DUST: PASS` / `SMOKE DUST: FAIL`.
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

OUT_IDS = ["#o-hmev", "#o-gj", "#o-gtnt", "#o-gamma", "#o-col", "#o-dust", "#o-hits", "#o-egas", "#o-edust", "#o-depth",
           "#o-thick", "#o-smass", "#o-share", "#o-extra"]


def ready(page):
    page.wait_for_selector('body[data-ready="1"]', timeout=20000, state="attached")


def run_viewport(browser, base, label, ctx_kwargs):
    fails = []

    def check(name, cond, detail=""):
        print(f"  [{'ok' if cond else 'FAIL'}] {label}: {name} {detail}")
        if not cond:
            fails.append(f"{label}: {name} {detail}")

    context = browser.new_context(**ctx_kwargs)
    page = context.new_page()
    page.add_init_script("try { localStorage.setItem('iss_lang', 'en'); } catch (e) {}")
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)) if not _is_beacon_noise(str(e)) else None)
    url = base.rstrip("/") + "/dust.html"
    resp = page.goto(url, wait_until="load", timeout=45000)
    check("HTTP 200", resp is not None and resp.status == 200, str(resp.status if resp else None))
    try:
        ready(page)
        check("body[data-ready=1]", True)
    except Exception as e:
        check("body[data-ready=1]", False, str(e)[:120])
        context.close()
        return fails

    txt = lambda sel: page.inner_text(sel)
    setv = lambda sel, v: page.evaluate(SET_JS, [sel, v])
    bad = lambda s: bool(re.search(r"NaN|Infinity|undefined|null", s))
    snap = lambda: [txt(i) if page.locator(i).count() else "" for i in OUT_IDS] + [txt("#verdict")]

    check("EN: h1", "INTERSTELLAR DUST" in txt("h1"))
    check("default: no NaN/Infinity/undefined", not bad(page.inner_text("main")))
    check("default: all outputs filled", all(page.locator(i).count() and txt(i).strip() for i in OUT_IDS))
    check("default: verdict names Proxima", "Proxima" in txt("#verdict"), txt("#verdict")[:80])
    check("star select has 50 options", page.locator("#star option").count() == 50)
    check("material select has 3 options", page.locator("#mat option").count() == 3)
    check("chart has 46 points", page.get_attribute("#chart", "data-points") == "46")

    # beta at both ends of the range: values present and different, reference energies visible
    setv("#beta", 0.05)
    lo = snap()
    check("beta=0.05: H energy ~1.18 MeV", re.search(r"1\.17\d MeV", txt("#o-hmev")) is not None, txt("#o-hmev"))
    check("beta=0.05: no NaN/Infinity", not bad(page.inner_text("main")))
    check("beta=0.05: chart marks beta", page.get_attribute("#chart", "data-beta") == "0.05")
    setv("#beta", 0.5)
    hi = snap()
    check("beta=0.5: H energy 145 MeV", "145" in txt("#o-hmev"), txt("#o-hmev"))
    check("beta=0.5: no NaN/Infinity", not bad(page.inner_text("main")))
    dep = [OUT_IDS.index(i) for i in ("#o-hmev", "#o-gj", "#o-gtnt", "#o-gamma", "#o-egas", "#o-edust", "#o-depth", "#o-thick", "#o-smass", "#o-extra")]
    check("beta change changes every beta-dependent output", all(lo[i] != hi[i] for i in dep))

    # other controls change the output
    for sel, v in (("#gr", 1000), ("#nh", 1000), ("#ar", 900), ("#pl", 100)):
        before = snap()
        setv(sel, v)
        check(f"slider {sel} changes output", before != snap())
        check(f"slider {sel}: no NaN/Infinity", not bad(page.inner_text("main")))
    before = snap(); page.select_option("#mat", "aluminium"); check("material changes output", before != snap())
    before = snap(); page.select_option("#star", index=49); check("star changes output", before != snap())
    before = snap(); page.uncheck("#sf"); check("margin toggle changes thickness", before != snap()); page.check("#sf")
    page.click("#nhp button:nth-child(3)")
    check("preset dense cloud sets n=10", "10 cm" in txt("#nhout"), txt("#nhout"))
    check("heavy flag shown for heavy shield", page.get_attribute("#o-heavy", "data-heavy") == "1")
    for sel in ("#gr", "#nh", "#ar", "#pl"):
        for v in (0, 1000):
            setv(sel, v)
            check(f"extreme {sel}={v}: no NaN/Infinity", not bad(page.inner_text("main")))

    # URL parameters are applied; invalid ones fall back to defaults
    page.goto(url + "?star=barnard&beta=0.3&payload=50&n=1&mat=beryllium", wait_until="load")
    ready(page)
    check("URL: star applied", page.input_value("#star") == "barnard" and "Barnard" in txt("#verdict"), txt("#verdict")[:60])
    check("URL: beta applied", txt("#betaout").startswith("0.300"), txt("#betaout"))
    check("URL: payload applied", txt("#plout") == "50.0 kg", txt("#plout"))
    check("URL: n applied", txt("#nhout").startswith("1 cm"), txt("#nhout"))
    check("URL: material applied", page.input_value("#mat") == "beryllium")
    href = page.get_attribute("#tomission", "href")
    check("link to mission.html carries star and payload", href == "mission.html?star=barnard&payload=50", href)
    page.goto(url + "?star=nope&beta=0.9&payload=-3&n=abc&mat=gold", wait_until="load")
    ready(page)
    check("URL invalid: defaults", page.input_value("#star") == "proxima" and txt("#betaout").startswith("0.200")
          and txt("#plout") == "1 000 kg" and page.input_value("#mat") == "graphite", txt("#betaout") + " " + txt("#plout"))
    page.goto(url + "?star=proxima&beta=0.05&clamped=below&bm=0.0001", wait_until="load")
    ready(page)
    check("URL clamped: note shown", "below this model" in txt("#clampnote"), txt("#clampnote")[:80])
    setv("#beta", 0.2)
    check("clamped note hidden once beta leaves the edge", txt("#clampnote").strip() == "", txt("#clampnote")[:80])
    for bad_q in ("clamped=below&bm=0.3", "clamped=above&bm=0.2", "clamped=above&bm=1.5", "clamped=below&bm=-1", "clamped=below&bm=abc"):
        page.goto(url + "?star=proxima&beta=0.05&" + bad_q, wait_until="load")
        ready(page)
        check(f"URL inconsistent {bad_q}: no note", txt("#clampnote").strip() == "", txt("#clampnote")[:80])
    page.goto(url + "?star=barnard&payload=50&engine=photon", wait_until="load")
    ready(page)
    href = page.get_attribute("#tomission", "href")
    check("link to mission.html carries engine from mission", href == "mission.html?star=barnard&engine=photon&payload=50", href)
    page.goto(base.rstrip("/") + "/" + href, wait_until="load")
    ready(page)
    check("mission applies star/engine/payload from dust link", page.input_value("#eng") == "photon"
          and "Barnard" in txt("#verdict") and txt("#plout") == "50.0 kg", txt("#plout"))
    for q, want in (("payload=1e9", "1.00·10^6 kg"), ("payload=0.001", "1.00 kg"), ("payload=junk", "1 000 kg")):
        page.goto(base.rstrip("/") + "/mission.html?" + q, wait_until="load")
        ready(page)
        check(f"mission ?{q} -> {want}", txt("#plout") == want, txt("#plout"))

    # mission.html -> dust.html link follows the plan
    page.goto(base.rstrip("/") + "/mission.html?star=barnard&engine=photon", wait_until="load")
    ready(page)
    href = page.get_attribute("#todust", "href") or ""
    check("mission: dust link has star+payload+beta", href.startswith("dust.html?star=barnard&engine=photon&beta=0.5") and "payload=1000" in href, href)
    check("mission: photon beta clamped above", "clamped=above" in href, href)
    page.select_option("#eng", "chemical")
    href2 = page.get_attribute("#todust", "href") or ""
    check("mission: dust link updates on recompute", href2 != href and "clamped=below" in href2, href2)
    check("mission: 'not modelled' links dust.html", page.locator('.note a[href="dust.html"]').count() >= 1)
    page.goto(url, wait_until="load")
    ready(page)

    # RU/EN
    page.click('#langtoggle span[data-set="ru"]')
    check("RU: h1", "МЕЖЗВЁЗДНАЯ ПЫЛЬ" in txt("h1"))
    check("RU: html lang", page.evaluate("document.documentElement.lang") == "ru")
    check("RU: verdict in Russian", "До звезды" in txt("#verdict"), txt("#verdict")[:60])
    check("RU: MeV in Russian", "МэВ" in txt("#o-hmev"), txt("#o-hmev"))
    check("RU: no NaN/Infinity", not bad(page.inner_text("main")))
    sw, iw = page.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
    check("no horizontal page scroll (RU)", sw <= iw + 1, f"{sw} vs {iw}")
    page.click('#langtoggle span[data-set="en"]')
    check("EN: h1 back", "INTERSTELLAR DUST" in txt("h1"))
    sw, iw = page.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
    check("no horizontal page scroll (EN)", sw <= iw + 1, f"{sw} vs {iw}")
    check("0 pageerror", not errors, "; ".join(errors)[:300])
    context.close()
    return fails


def check_links(browser, base):
    fails = []
    page = browser.new_page()
    for f in ("engines", "laser-sail", "accel", "neighbors", "twins", "comms", "where-we-reach", "mission"):
        page.goto(f"{base.rstrip('/')}/{f}.html", wait_until="load", timeout=45000)
        n = page.locator('a[href^="dust.html"]').count()
        print(f"  [{'ok' if n else 'FAIL'}] link to dust.html on {f}.html ({n})")
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
    print("SMOKE DUST: " + ("FAIL" if fails else "PASS"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
