$projectDir = Split-Path -Parent $PSCommandPath
Set-Location -LiteralPath $projectDir

Write-Host "Ballistica - запуск локального сервера..." -ForegroundColor Cyan
Write-Host "Сервер будет доступен по адресу: http://localhost:8000" -ForegroundColor Green

python server.py
