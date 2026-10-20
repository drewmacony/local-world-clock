#!/bin/sh
cd "$(dirname "$0")"
echo "Starting World Clock on http://127.0.0.1:8765"
echo "Keep this Terminal window open while using the app."
python3 -m http.server 8765 --bind 127.0.0.1
