$backendDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location (Resolve-Path "$backendDir\..")

Write-Host "Starting backend migrations and smoke tests..."

Write-Host "Running database migrations..."
npx knex migrate:latest
if ($LASTEXITCODE -ne 0) {
  Write-Error "Database migrations failed."
  exit 1
}

Write-Host "Running backend smoke tests..."
node tests/smoke_phase1_3.js
if ($LASTEXITCODE -ne 0) {
  Write-Error "Smoke tests failed."
  exit 1
}

Write-Host "Backend migrations and smoke tests succeeded."
exit 0
