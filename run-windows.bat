@echo off
cd /d "%~dp0"
echo Starting World Clock on http://127.0.0.1:8765
echo Keep this window open while using the app.
py -m http.server 8765 --bind 127.0.0.1
pause
