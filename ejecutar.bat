@echo off
cd /d "%~dp0"

docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo Iniciando Docker Desktop...
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    :esperar_docker
    timeout /t 5 /nobreak >nul
    docker info >nul 2>&1
    if %errorlevel% neq 0 goto esperar_docker
)

echo Levantando FasterUp...
docker compose up -d

start "" "http://localhost:5173"