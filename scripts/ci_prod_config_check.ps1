$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$backendDir = Resolve-Path "$scriptDir\.."
Set-Location $backendDir

Write-Host "Running backend production-config authoritative lane..."
Write-Host "Stage: backend production env contract preflight"
npm.cmd run env:check:prod
if ($LASTEXITCODE -ne 0) {
  Write-Error "Backend production-config authoritative lane failed during env contract preflight."
  exit 1
}

Write-Host "Stage: backend production-config contract tests"
npm.cmd run test:backend:prod-config
if ($LASTEXITCODE -ne 0) {
  Write-Error "Backend production-config authoritative lane failed during contract tests."
  exit 1
}

Write-Host "Backend production-config authoritative lane passed."
exit 0
