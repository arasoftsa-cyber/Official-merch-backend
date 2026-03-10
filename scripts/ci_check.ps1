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

Write-Host "Running backend Jest test suite..."
npm.cmd run test:backend:ci
if ($LASTEXITCODE -ne 0) {
  Write-Error "Backend Jest test suite failed."
  exit 1
}

$frontendDir = Resolve-Path "$backendDir\..\Official-merch-frontend"
Set-Location $frontendDir
Write-Host "Resolving frontend Playwright script..."
$packageJson = Get-Content package.json -Raw | ConvertFrom-Json
$scriptToRun = 'ui:test'

if (-not $packageJson.scripts.$scriptToRun) {
  Write-Error "Required frontend script '$scriptToRun' is not configured in Official-merch-frontend/package.json."
  exit 1
}

Write-Host "Running frontend Playwright suite: npm.cmd run $scriptToRun"
npm.cmd run $scriptToRun
if ($LASTEXITCODE -ne 0) {
  Write-Error "Frontend Playwright suite '$scriptToRun' failed."
  exit 1
}

Write-Host "All checks passed."
exit 0
