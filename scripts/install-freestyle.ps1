# Build Yudia and install it on the Samsung Freestyle (or any Tizen TV) in developer mode.
#
#   .\scripts\install-freestyle.ps1 -DeviceIp 192.168.1.60
#
# Needs: Tizen SDK (Tizen Studio or the "Baseline SDK" from the VS Code Tizen extension) + a Samsung
# certificate profile named "freestyle" (Certificate Manager → Samsung → TV). See the end of this file.
param(
  [Parameter(Mandatory = $true)][string]$DeviceIp,
  [string]$CertProfile = 'freestyle'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# ---- locate the Tizen tools ----
$candidates = @("C:\tizen-studio", "$env:USERPROFILE\tizen-studio", "$env:LOCALAPPDATA\tizen-studio")
$sdk = $candidates | Where-Object { Test-Path "$_\tools\ide\bin\tizen.bat" } | Select-Object -First 1
if (-not $sdk) {
  Write-Host "Tizen SDK not found. Install Tizen Studio (or the Baseline SDK from the Tizen extension) first." -ForegroundColor Red
  exit 1
}
$tizen = "$sdk\tools\ide\bin\tizen.bat"
$sdb = "$sdk\tools\sdb.exe"
Write-Host "Tizen SDK: $sdk"

# ---- 1. build ----
Write-Host "`n[1/4] Building Yudia..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "Build failed" }

# ---- 2. connect ----
Write-Host "`n[2/4] Connecting to $DeviceIp..." -ForegroundColor Cyan
& $sdb connect $DeviceIp | Out-Host
$device = (& $sdb devices) | Where-Object { $_ -match "^$([regex]::Escape($DeviceIp))" } | ForEach-Object { ($_ -split '\s+')[2] } | Select-Object -First 1
if (-not $device) {
  Write-Host "Device not connected. On the Freestyle: Apps -> 12345 -> Developer mode ON, Host PC IP = this PC, then restart it." -ForegroundColor Red
  exit 1
}
Write-Host "Connected: $device"

# ---- 3. package (signed with your Samsung certificate) ----
Write-Host "`n[3/4] Packaging dist\ with certificate profile '$CertProfile'..." -ForegroundColor Cyan
Remove-Item -ErrorAction SilentlyContinue "dist\*.wgt"
& $tizen package -t wgt -s $CertProfile -- "$root\dist" | Out-Host
$wgt = Get-ChildItem "dist\*.wgt" | Select-Object -First 1
if (-not $wgt) { throw "Packaging failed (is the certificate profile '$CertProfile' created and set active?)" }

# ---- 4. install + launch ----
Write-Host "`n[4/4] Installing $($wgt.Name) on $device..." -ForegroundColor Cyan
& $tizen install -n $wgt.Name -t $device -- "$root\dist" | Out-Host
& $tizen run -p YudiaTVApp.Yudia -t $device | Out-Host
Write-Host "`nDone - Yudia should now be open on the Freestyle." -ForegroundColor Green

<#
One-time setup
  1. Tizen SDK: Tizen extension sidebar -> "Install Tizen SDK" (Baseline SDK), or Tizen Studio from developer.tizen.org.
     Then Package Manager -> Extension SDK -> "Samsung Certificate Extension" + "TV Extensions".
  2. Freestyle: Apps -> type 1 2 3 4 5 (123 button for the on-screen keypad) -> Developer mode ON,
     Host PC IP = this PC (ipconfig), restart the Freestyle.
  3. Certificate: with the Freestyle connected (sdb connect IP), Certificate Manager -> + -> Samsung -> TV,
     profile name "freestyle", new author certificate, Samsung account login, distributor privilege "Public"
     (the device DUID is filled in automatically).
#>
