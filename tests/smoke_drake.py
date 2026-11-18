#!/usr/bin/env python3
"""Self-contained Playwright smoke for /drake.html (Drake equation + Fermi paradox page).

Run (x86_64 server, no PLAYWRIGHT_HOST_PLATFORM_OVERRIDE needed):
  ~/.venv/playwright/bin/python tests/smoke_drake.py
  ~/.venv/playwright/bin/python tests/smoke_drake.py --url https://space.podlevskikh.com

Checks: page opens (body[data-ready=1]), a range slider changes the Monte-Carlo result, presets switch and
give the expected ordering, the histogram canvas is painted, RU toggle works, no horizontal scroll, no pageerror
or console error. Exit code 0 = PASS, 1 = FAIL. Prints `SMOKE DRAKE: PASS` / `SMOKE DRAKE: FAIL`.
"""
import argparse
import functools
import http.server
import os
import socket
import socketserver
import sys
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IDS = ["presets", "params", "resample", "out-median", "out-p68", "out-p95", "out-plt1", "out-dist",
       "out-silence", "drake-hist", "preset-sources", "min-L", "max-L", "min-fl", "max-fl"]


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
    return "stats.podlevskikh.com" in text or "Failed to load resource" in text


SET_JS = """([sel, v]) => { const el = document.querySelector(sel);
  el.value = String(v);
  el.dispatchEvent(new Event('input', {bubbles: true})); }"""

CANVAS_JS = """() => { const c = document.querySelector('#drake-hist');
  const ctx = c.getContext('2d'); const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const seen = new Set(); let opaque = 0;
  for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 200) { opaque++; if (seen.size < 64) seen.add((d[i] >> 4) + ',' + (d[i+1] >> 4) + ',' + (d[i+2] >> 4)); } }
  return {w: c.width, h: c.height, opaque, colors: seen.size}; }"""


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
    page.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" and not _is_beacon_noise(m.text) else None)
    page.goto(base.rstrip("/") + "/drake.html", wait_until="load", timeout=45000)
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
    nsliders = page.evaluate("document.querySelectorAll('#params input[type=range]').length")
    check("14 range sliders (min+max for 7 parameters)", nsliders == 14, str(nsliders))

    txt = lambda i: page.inner_text("#" + i)
    setv = lambda sel, v: page.evaluate(SET_JS, [sel, v])
    med = lambda: float(page.evaluate("document.body.dataset.median"))

    def click_preset(pid):
        page.click(f'#presets button[data-id="{pid}"]')
        page.wait_for_timeout(100)

    # --- presets: results differ, pessimist < optimist, active marker follows ---
    click_preset("pessimist")
    m_pess = med()
    check("pessimist button marked active", page.evaluate("document.querySelector('#presets button.on').dataset.id") == "pessimist")
    click_preset("optimist")
    m_opt = med()
    check("optimist median > pessimist median", m_opt > m_pess, f"{m_pess:.3g} -> {m_opt:.3g}")
    click_preset("drake1961")
    check("Drake 1961 preset gives a finite positive median", med() > 0, f"{med():.3g}")
    rows = page.evaluate("document.querySelectorAll('#preset-sources tbody tr').length")
    src = page.evaluate("document.querySelector('#preset-sources').textContent")
    check("sources table has 7 rows and cites Drake 1961", rows == 7 and "Drake" in src, f"rows={rows}")
    click_preset("sdo2018")
    check("SDO preset cites arXiv:1806.02404", "1806.02404" in page.inner_html("#preset-sources"))

    # --- a slider changes the result ---
    out0, med0 = txt("out-median"), med()
    setv("#min-L", page.evaluate("document.querySelector('#min-L').max"))
    out1, med1 = txt("out-median"), med()
    check("moving the L slider changes the median", out0 != out1 and med1 > med0, f"{out0!r} -> {out1!r}")
    check("preset deselected after manual edit", page.evaluate("document.querySelectorAll('#presets button.on').length") == 0)
    # min cannot exceed max
    check("min slider pushes max up (min<=max)", float(page.evaluate("document.querySelector('#max-L').value")) >= float(page.evaluate("document.querySelector('#min-L').value")) - 1e-9)

    # --- all outputs filled, no NaN ---
    for i in ("out-median", "out-p68", "out-p95", "out-plt1", "out-dist", "out-silence"):
        v = txt(i).strip()
        check(f"#{i} non-empty", bool(v) and "NaN" not in v, repr(v))

    # --- degenerate extremes: everything fixed to a huge N => P(N<1) = 0 %; tiny => 100 % ---
    click_preset("optimist")
    check("optimist P(N<1) is 0", txt("out-plt1").strip().startswith("0"), txt("out-plt1"))
    click_preset("pessimist")
    check("pessimist P(N<1) is 100 %", txt("out-plt1").strip().startswith("100"), txt("out-plt1"))

    # --- resample keeps the page alive and the seed label changes ---
    s0 = txt("seed-info")
    page.click("#resample")
    check("resample changes seed label", txt("seed-info") != s0, f"{s0!r} -> {txt('seed-info')!r}")

    # --- histogram pixels ---
    px = page.evaluate(CANVAS_JS)
    check("histogram has opaque pixels", px["opaque"] > 200, str(px))
    check("histogram has >=3 distinct colours", px["colors"] >= 3, str(px))

    # --- RU toggle ---
    page.click('#langtoggle span[data-set="ru"]')
    page.wait_for_timeout(100)
    check("RU: html lang=ru and Russian label rendered", page.evaluate("document.documentElement.lang") == "ru" and "Пессимист" in txt("presets"))
    page.click('#langtoggle span[data-set="en"]')

    # --- layout ---
    sw, iw = page.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
    check("no horizontal scroll", sw <= iw + 1, f"scrollWidth={sw} innerWidth={iw}")
    check("0 pageerror / console errors", not errors, "; ".join(errors)[:300])
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
    print("SMOKE DRAKE: " + ("FAIL" if fails else "PASS"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
