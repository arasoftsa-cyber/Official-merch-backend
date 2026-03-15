$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$backendDir = Resolve-Path "$scriptDir\.."
Set-Location $backendDir

Write-Host "Running aggregate production-config CI lane..."
Write-Host "Stage: backend production-config authoritative lane"
npm.cmd run ci:config:prod
if ($LASTEXITCODE -ne 0) {
  Write-Error "Aggregate production-config CI lane failed during backend stage."
  exit 1
}

$frontendDir = Resolve-Path "$backendDir\..\Official-merch-frontend"
Set-Location $frontendDir
Write-Host "Stage: resolving frontend production-config script"
$packageJson = Get-Content package.json -Raw | ConvertFrom-Json
$scriptToRun = 'ci:prod-config'

if (-not $packageJson.scripts.$scriptToRun) {
  Write-Error "Aggregate production-config CI lane failed because frontend script '$scriptToRun' is not configured in Official-merch-frontend/package.json."
  exit 1
}

Write-Host "Stage: frontend production-config validation (npm.cmd run $scriptToRun)"
npm.cmd run $scriptToRun
if ($LASTEXITCODE -ne 0) {
  Write-Error "Aggregate production-config CI lane failed during frontend stage."
  exit 1
}

Write-Host "Aggregate production-config CI lane passed."
exit 0
