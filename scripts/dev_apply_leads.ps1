$backendDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location (Resolve-Path "$backendDir\..")

Write-Host "Starting backend migrations and Jest tests..."

Write-Host "Running database migrations..."
npx knex migrate:latest
if ($LASTEXITCODE -ne 0) {
  Write-Error "Database migrations failed."
  exit 1
}

Write-Host "Running backend Jest tests..."
npm.cmd run test:backend:ci
if ($LASTEXITCODE -ne 0) {
  Write-Error "Jest tests failed."
  exit 1
}

Write-Host "Backend migrations and Jest tests succeeded."
exit 0
