#!/usr/bin/env python3
"""Self-contained Playwright smoke for /relativistic-flight.html (hub page).

Run (x86_64 server, no PLAYWRIGHT_HOST_PLATFORM_OVERRIDE needed):
  ~/.venv/playwright/bin/python tests/smoke_relativistic_flight.py
  ~/.venv/playwright/bin/python tests/smoke_relativistic_flight.py --url https://space.podlevskikh.com

Asserts: 10 table rows, Proxima row (gamma ~3.19, ship ~3.6 yr, Earth ~5.9 yr at 1 g flip-and-burn),
RU/EN toggle changes headings, twins stats filled, chart has pixels, 3 hub links, no horizontal
scroll, 0 pageerror. Exit 0 = PASS. Prints `SMOKE RELATIVISTIC FLIGHT: PASS` / `FAIL`.
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
    fails = []

    def check(name, cond, detail=""):
        print(f"  [{'ok' if cond else 'FAIL'}] {label}: {name} {detail}")
        if not cond:
            fails.append(f"{label}: {name} {detail}")

    context = browser.new_context(**ctx_kwargs)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)) if not _is_beacon_noise(str(e)) else None)
    page.goto(base.rstrip("/") + "/relativistic-flight.html", wait_until="load", timeout=45000)
    try:
        page.wait_for_selector('body[data-ready="1"]', timeout=20000, state="attached")
        check("body[data-ready=1]", True)
    except Exception as e:
        check("body[data-ready=1]", False, str(e)[:120])
        context.close()
        return fails

    page.evaluate("localStorage.setItem('iss_lang','en')")
    page.reload(wait_until="load")
    page.wait_for_selector('body[data-ready="1"]', timeout=20000, state="attached")

    rows = page.query_selector_all("#summary-body tr")
    check("10 summary rows", len(rows) == 10, f"got {len(rows)}")
    cells = [c.inner_text() for c in rows[0].query_selector_all("td")] if rows else []
    check("row 0 is Proxima", bool(cells) and "Proxima" in cells[1], repr(cells))
    if len(cells) >= 6:
        ly, t, tau, g = (num(cells[i]) for i in (2, 3, 4, 5))
        check("Proxima distance 4.25", abs(ly - 4.25) <= 0.01, f"got {ly}")
        check("Proxima Earth time ~5.9", 5.8 <= t <= 6.1, f"got {t}")
        check("Proxima ship time ~3.6", 3.4 <= tau <= 3.8, f"got {tau}")
        check("Proxima peak gamma ~3.19", abs(g - 3.19) <= 0.03, f"got {g}")
    gammas = [num(r.query_selector_all("td")[5].inner_text()) for r in rows]
    check("peak gamma non-decreasing, finite", all(a == a for a in gammas) and gammas == sorted(gammas), str(gammas))

    for i in ("out-earth", "out-ship", "out-gap"):
        v = page.inner_text("#" + i).strip()
        check(f"#{i} filled", bool(v) and "NaN" not in v and "—" not in v, repr(v))
    ship = num(page.inner_text("#out-ship"))
    earth = num(page.inner_text("#out-earth"))
    check("round trip ship ~7.2 and Earth ~11.9", 6.8 <= ship <= 7.6 and 11.6 <= earth <= 12.2, f"{ship} / {earth}")

    h1_en = page.inner_text("h1")
    page.click('#langtoggle span[data-set="ru"]')
    h1_ru = page.inner_text("h1")
    check("RU toggle changes h1", h1_en != h1_ru and "РЕЛЯТИВИСТСКИЙ" in h1_ru, f"{h1_en!r} -> {h1_ru!r}")
    check("RU decimal comma in table", "," in page.inner_text("#summary-body tr:first-child td:nth-child(4)"))
    page.click('#langtoggle span[data-set="en"]')
    check("EN toggle restores h1", page.inner_text("h1") == h1_en)

    hrefs = [a.get_attribute("href") for a in page.query_selector_all(".hub a")]
    check("3 hub links", sorted(hrefs) == ["accel.html", "neighbors.html", "twins.html"], str(hrefs))
    check("JSON-LD present", page.query_selector('script[type="application/ld+json"]') is not None)

    px = page.evaluate(CANVAS_JS)
    if px["ctx"]:
        check("canvas has opaque pixels", px["opaque"] > 0, str(px))
        check("canvas has >=2 distinct colours", px["colors"] >= 2, str(px))

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
    print("SMOKE RELATIVISTIC FLIGHT: " + ("FAIL" if fails else "PASS"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
