@echo off
setlocal
cd /d "%~dp0"
echo Starting American Civil War Turning Point on http://127.0.0.1:8765/
echo Leave this window open. Press Ctrl+C to stop.
where py >nul 2>nul && goto :py
where python >nul 2>nul && goto :python
echo Python not found. Install Python 3 or open the hosted HTTPS link instead.
pause
exit /b 1
:py
start "" http://127.0.0.1:8765/
py -3 -m http.server 8765 --bind 127.0.0.1
goto :eof
:python
start "" http://127.0.0.1:8765/
python -m http.server 8765 --bind 127.0.0.1
goto :eof
