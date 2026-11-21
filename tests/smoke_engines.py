#!/usr/bin/env python3
"""Self-contained Playwright smoke for /engines.html (engine comparison).

Regression for the TDZ crash (noProp/na used before declaration -> blank page while
80k core checks stayed green): executes the real page on several routes and both languages.

Run:
  ~/.venv/playwright/bin/python tests/smoke_engines.py

Exit code 0 = PASS, 1 = FAIL. Prints `SMOKE ENGINES: PASS` / `SMOKE ENGINES: FAIL`.
"""
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


# widths of the time-chart bars, in engine order (ENGINES order), parsed from the DOM
BARS_JS = """() => [...document.querySelectorAll('#chartTime .crow')].map((r) => ({
  name: r.querySelector('.lbl span').textContent,
  w: parseFloat(r.querySelector('rect.bar').getAttribute('width')),
  lbl: r.querySelector('.lbl em').textContent }))"""


def main():
    from playwright.sync_api import sync_playwright
    port = free_port()
    httpd = serve(port)
    base = f"http://127.0.0.1:{port}/engines.html"
    fails = []

    def check(name, cond, detail=""):
        print(f"  [{'ok' if cond else 'FAIL'}] {name} {detail}")
        if not cond:
            fails.append(f"{name} {detail}")

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            for lang in ("en", "ru"):
                for route in ("alphacen", "mars", "pluto"):
                    label = f"{lang}/{route}"
                    ctx = browser.new_context()
                    page = ctx.new_page()
                    page.add_init_script(f"try {{ localStorage.setItem('iss_lang', '{lang}'); }} catch (e) {{}}")
                    errors = []
                    page.on("pageerror", lambda e: errors.append(str(e)))
                    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and not _is_beacon_noise(m.text) else None)
                    resp = page.goto(base, wait_until="load", timeout=45000)
                    check(f"{label}: HTTP 200", resp is not None and resp.status == 200)
                    page.select_option("#route", route)
                    page.wait_for_selector("#tableout tbody tr", timeout=15000)
                    errs = [e for e in errors if not _is_beacon_noise(e)]
                    check(f"{label}: no pageerror/console error", not errs, "; ".join(errs)[:200])
                    check(f"{label}: table has 7 rows", page.locator("#tableout tbody tr").count() == 7,
                          str(page.locator("#tableout tbody tr").count()))
                    text = page.inner_text("main") if page.locator("main").count() else page.inner_text("body")
                    check(f"{label}: no NaN/undefined in text", not re.search(r"NaN|undefined", text))
                    check(f"{label}: mass chart has 7 rows", page.locator("#chartMass .crow").count() == 7)
                    mass_w = page.evaluate("() => [...document.querySelectorAll('#chartMass rect.bar')].map((b) => parseFloat(b.getAttribute('width')))")
                    check(f"{label}: propellant bar present (chemical width > 0)", len(mass_w) == 7 and mass_w[0] > 0, str(mass_w[:1]))
                    bars = page.evaluate(BARS_JS)
                    laser = bars[-1]
                    if route == "alphacen":
                        check(f"{label}: laser time bar applicable", laser["w"] > 0, str(laser))
                    else:
                        check(f"{label}: n/a laser time bar width 0", laser["w"] == 0, str(laser))
                        check(f"{label}: n/a label kept", laser["lbl"].startswith("n/a" if lang == "en" else "н/п"), laser["lbl"])
                    ctx.close()
            browser.close()
    finally:
        httpd.shutdown()

    if fails:
        print("SMOKE ENGINES: FAIL")
        for f in fails:
            print("  -", f)
        return 1
    print("SMOKE ENGINES: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
