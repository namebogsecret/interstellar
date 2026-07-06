#!/usr/bin/env python3
"""Playwright smoke test for interstellar.

Starts its own static server on a free port, loads index.html in headless
Chromium, waits for WebGL init, and exercises the key handlers that our
changes touch (pause P, circularize K, target Tab, and any new toggles).
FAILS (exit 1) on any console error / page error / failed request.

Run:
  PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-arm64 \
    ~/.venv/playwright/bin/python tests/smoke_playwright.py [extra_keys...]

extra_keys: optional space-separated keys to press (e.g. "v t j") for new features.
"""
import http.server
import socketserver
import functools
import os
import socket
import sys
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):  # silence per-request access log
        pass


def serve(port):
    handler = functools.partial(QuietHandler, directory=ROOT)
    httpd = socketserver.TCPServer(("127.0.0.1", port), handler)
    httpd.allow_reuse_address = True
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd


def main():
    from playwright.sync_api import sync_playwright

    extra_keys = sys.argv[1:]  # e.g. ["v", "t", "j"]
    port = free_port()
    httpd = serve(port)
    url = f"http://127.0.0.1:{port}/index.html"
    errors = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}")
                    if m.type in ("error",) else None)
            page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
            page.on("requestfailed", lambda r: errors.append(
                f"requestfailed: {r.url} {r.failure}"))
            page.goto(url, wait_until="load", timeout=30000)
            # let WebGL init + a few animation frames run
            page.wait_for_timeout(2500)
            # dismiss start screen if present (Enter), then exercise handlers
            body = page.locator("body")
            body.click()
            page.wait_for_timeout(300)
            for key in ["Enter", "p", "p", "k", "Tab", "o", "c", "c"] + extra_keys:
                try:
                    page.keyboard.press(key)
                except Exception as ex:
                    errors.append(f"keypress {key} raised: {ex}")
                page.wait_for_timeout(200)
            page.wait_for_timeout(800)
            # sanity: a canvas exists and has size
            has_canvas = page.evaluate(
                "() => { const c=document.querySelector('canvas'); return !!c && c.width>0 && c.height>0; }")
            if not has_canvas:
                errors.append("no sized <canvas> found (WebGL init likely failed)")
            browser.close()
    finally:
        httpd.shutdown()

    if errors:
        print("SMOKE: FAIL")
        for e in errors:
            print("  -", e)
        sys.exit(1)
    print("SMOKE: PASS")


if __name__ == "__main__":
    main()
