$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$backendDir = Resolve-Path "$scriptDir\.."
Set-Location $backendDir

Write-Host "Running backend authoritative CI lane..."
Write-Host "Stage: backend migrations"
npx knex migrate:latest
if ($LASTEXITCODE -ne 0) {
  Write-Error "Backend authoritative CI lane failed during migrations."
  exit 1
}

Write-Host "Stage: backend smoke seed"
node -r dotenv/config scripts/seed_ui_smoke.js
if ($LASTEXITCODE -ne 0) {
  Write-Error "Backend authoritative CI lane failed during smoke seed."
  exit 1
}

Write-Host "Stage: backend Jest test suite"
npm.cmd run test:backend:local
if ($LASTEXITCODE -ne 0) {
  Write-Error "Backend authoritative CI lane failed during Jest tests."
  exit 1
}

Write-Host "Backend authoritative CI lane passed."
exit 0
