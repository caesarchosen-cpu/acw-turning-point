#!/bin/bash
cd "$(dirname "$0")"
PORT=8765
echo "Starting American Civil War Turning Point on http://127.0.0.1:$PORT/"
echo "Leave this window open. Ctrl+C to stop."
(sleep 1; open "http://127.0.0.1:$PORT/" 2>/dev/null || xdg-open "http://127.0.0.1:$PORT/" 2>/dev/null || true) &
python3 -m http.server "$PORT" --bind 127.0.0.1
