#!/usr/bin/env bash
# Launch the simulator. ES modules need an http origin (not file://), so we
# serve the folder with Python's built-in server and open Firefox.
set -e
cd "$(dirname "$0")"
PORT="${1:-8123}"
URL="http://127.0.0.1:${PORT}/index.html"

echo "Serving interstellar on ${URL}  (Ctrl-C to stop)"
# Open the browser shortly after the server starts.
( sleep 1; (firefox "$URL" >/dev/null 2>&1 &) || xdg-open "$URL" >/dev/null 2>&1 || true ) &
exec python3 -m http.server "$PORT"
