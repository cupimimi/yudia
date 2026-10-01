# Build the Yudia website and publish it on the Raspberry Pi (container "yudia-web", port 8099).
#
#   .\scripts\deploy-web.ps1                  # default: pi@raspberrypi
#   .\scripts\deploy-web.ps1 -PiHost pi@192.168.1.50
#
# First time only: the yudia-web block must be in /docker/docker-compose.yml and /docker/yudia-web.conf must exist
# (both in the pi-docker/ folder of this project). You'll be asked for your Pi password (ssh / sudo).
param([string]$PiHost = 'pi@raspberrypi')
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host "[1/3] Building the website..." -ForegroundColor Cyan
npm run build:web
if ($LASTEXITCODE -ne 0) { throw "Build failed" }

Write-Host "[2/3] Copying to $PiHost..." -ForegroundColor Cyan
ssh $PiHost "rm -rf ~/yudia-web-upload && mkdir -p ~/yudia-web-upload"
scp -r dist-web/* "${PiHost}:~/yudia-web-upload/"
if ($LASTEXITCODE -ne 0) { throw "Copy failed" }

Write-Host "[3/3] Publishing..." -ForegroundColor Cyan
ssh -t $PiHost "sudo mkdir -p /docker/yudia-web && sudo rm -rf /docker/yudia-web/* && sudo cp -r ~/yudia-web-upload/* /docker/yudia-web/ && rm -rf ~/yudia-web-upload && cd /docker && docker compose up -d yudia-web"

$ip = ($PiHost -split '@')[-1]
Write-Host "`nDone - open http://${ip}:8099 on the home network." -ForegroundColor Green
