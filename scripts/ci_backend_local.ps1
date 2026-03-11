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
npm.cmd run test:backend:local
if ($LASTEXITCODE -ne 0) {
  Write-Error "Backend Jest test suite failed."
  exit 1
}

Write-Host "Backend local checks passed."
exit 0
