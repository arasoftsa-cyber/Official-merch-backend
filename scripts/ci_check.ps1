$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$backendDir = Resolve-Path "$scriptDir\.."
Set-Location $backendDir

Write-Host "Running aggregate CI lane..."
Write-Host "Stage: backend authoritative CI lane"
npm.cmd run ci:backend:local
if ($LASTEXITCODE -ne 0) {
  Write-Error "Aggregate CI lane failed during backend stage."
  exit 1
}

$frontendDir = Resolve-Path "$backendDir\..\Official-merch-frontend"
Set-Location $frontendDir
Write-Host "Stage: resolving frontend aggregate script"
$packageJson = Get-Content package.json -Raw | ConvertFrom-Json
$scriptToRun = 'ci:local'

if (-not $packageJson.scripts.$scriptToRun) {
  Write-Error "Aggregate CI lane failed because frontend script '$scriptToRun' is not configured in Official-merch-frontend/package.json."
  exit 1
}

Write-Host "Stage: frontend aggregate validation (npm.cmd run $scriptToRun)"
npm.cmd run $scriptToRun
if ($LASTEXITCODE -ne 0) {
  Write-Error "Aggregate CI lane failed during frontend stage."
  exit 1
}

Write-Host "Aggregate CI lane passed."
exit 0
