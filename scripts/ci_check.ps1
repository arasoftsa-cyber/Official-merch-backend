$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$backendDir = Resolve-Path "$scriptDir\.."
Set-Location $backendDir

Write-Host "Running backend migrations..."
npx knex migrate:latest
if ($LASTEXITCODE -ne 0) {
  Write-Error "Database migrations failed."
  exit 1
}

Write-Host "Seeding UI smoke data..."
node -r dotenv/config scripts/seed_ui_smoke.js
if ($LASTEXITCODE -ne 0) {
  Write-Error "UI smoke seed failed."
  exit 1
}

Write-Host "Running backend smoke tests..."
cmd /c "set CI_SMOKE=1&& set SMOKE_SEED_ENABLED=1&& node -r dotenv/config tests/smoke_phase1_3.js"
if ($LASTEXITCODE -ne 0) {
  Write-Error "Backend smoke tests failed."
  exit 1
}

$frontendDir = Resolve-Path "$backendDir\..\Official-merch-frontend"
Set-Location $frontendDir
Write-Host "Looking for UI smoke script..."
$packageJson = Get-Content package.json -Raw | ConvertFrom-Json
$candidateScripts = @('ui:smoke', 'ui:test', 'test:ui', 'test:playwright', 'playwright:test', 'ui:playwright')
$scriptToRun = $candidateScripts | Where-Object { $packageJson.scripts.$_ } | Select-Object -First 1

if (-not $scriptToRun) {
  Write-Host "UI smoke script not configured; skipped."
  exit 0
}

Write-Host "Running UI smoke script '$scriptToRun'..."
npm run $scriptToRun
if ($LASTEXITCODE -ne 0) {
  Write-Error "UI smoke script '$scriptToRun' failed."
  exit 1
}

Write-Host "All checks passed."
exit 0
