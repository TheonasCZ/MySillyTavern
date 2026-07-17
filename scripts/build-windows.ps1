# Build MySillyTavern on Windows
# Prerequisites:
#   1. Install Node.js 22+ from https://nodejs.org
#   2. Install Rust from https://rustup.rs
#   3. Install Microsoft Visual C++ Build Tools (for Tauri)
#      https://visualstudio.microsoft.com/visual-cpp-build-tools/
#   4. Run this script from the project root

Write-Host "==> Installing npm dependencies..." -ForegroundColor Cyan
npm ci

Write-Host "`n==> Building Tauri (this takes ~5-10 min)..." -ForegroundColor Cyan
npm run tauri build

if ($LASTEXITCODE -ne 0) {
    Write-Host "`nBUILD FAILED" -ForegroundColor Red
    exit 1
}

Write-Host "`n==> Build complete! Outputs:" -ForegroundColor Green
$outDir = "src-tauri\target\release"

# Binary
if (Test-Path "$outDir\mysillytavern.exe") {
    Write-Host "  Binary: $outDir\mysillytavern.exe" -ForegroundColor White
}

# MSI installer
$msi = Get-ChildItem "$outDir\bundle\msi\*.msi" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($msi) { Write-Host "  MSI:    $($msi.FullName)" -ForegroundColor White }

# NSIS installer
$nsis = Get-ChildItem "$outDir\bundle\nsis\*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($nsis) { Write-Host "  NSIS:   $($nsis.FullName)" -ForegroundColor White }

Write-Host "`nSdilej slozku 'release' s prateli!" -ForegroundColor Yellow
