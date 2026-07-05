@echo off
cd /d "%~dp0"
echo Ballistica - запуск локального сервера...
echo Сервер будет доступен по адресу: http://localhost:8000
python server.py
pause
