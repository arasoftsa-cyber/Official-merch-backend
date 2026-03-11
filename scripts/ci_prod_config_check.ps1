$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$backendDir = Resolve-Path "$scriptDir\.."
Set-Location $backendDir

Write-Host "Running backend production-config contract tests..."
npm.cmd run test:backend:prod-config
if ($LASTEXITCODE -ne 0) {
  Write-Error "Backend production-config contract tests failed."
  exit 1
}

$frontendDir = Resolve-Path "$backendDir\..\Official-merch-frontend"
Set-Location $frontendDir
Write-Host "Resolving frontend production-config script..."
$packageJson = Get-Content package.json -Raw | ConvertFrom-Json
$scriptToRun = 'ci:prod-config'

if (-not $packageJson.scripts.$scriptToRun) {
  Write-Error "Required frontend script '$scriptToRun' is not configured in Official-merch-frontend/package.json."
  exit 1
}

Write-Host "Running frontend production-config validation: npm.cmd run $scriptToRun"
npm.cmd run $scriptToRun
if ($LASTEXITCODE -ne 0) {
  Write-Error "Frontend production-config validation '$scriptToRun' failed."
  exit 1
}

Write-Host "Production-config checks passed."
exit 0
