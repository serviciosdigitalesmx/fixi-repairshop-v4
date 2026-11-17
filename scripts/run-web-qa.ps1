param(
  [ValidateSet('All','Smoke','Integrity','Inventory','Baseline')][string]$Group = 'All',
  [string]$QaRoot = 'D:\QA\fixi-web-20261117',
  [switch]$ReuseServices
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
if (-not ([IO.Path]::GetFullPath($QaRoot).StartsWith('D:\', [StringComparison]::OrdinalIgnoreCase))) { throw 'Use a QA directory on D:' }
$env:DOTNET_ROOT = 'D:\Tools\fixi-dotnet'
$env:DOTNET_CLI_HOME = Join-Path $QaRoot 'runtime\dotnet-home'
$env:NUGET_PACKAGES = Join-Path $QaRoot 'nuget'
$env:npm_config_cache = Join-Path $QaRoot 'npm-cache'
$env:PLAYWRIGHT_BROWSERS_PATH = 'D:\Tools\PlaywrightBrowsers'
$env:TEMP = Join-Path $QaRoot 'temp'
$env:TMP = $env:TEMP
$env:DOTNET_GENERATE_ASPNET_CERTIFICATE = 'false'
foreach ($directory in @($env:TEMP,$env:NUGET_PACKAGES,$env:npm_config_cache)) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
if (-not (Test-Path (Join-Path $repo 'frontend\node_modules\@playwright\test'))) {
  Push-Location (Join-Path $repo 'frontend')
  try { npm ci --no-fund --no-audit; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' } } finally { Pop-Location }
}
if (-not (Test-Path 'D:\Tools\PlaywrightBrowsers\chromium-1243\chrome-win64\chrome.exe')) {
  Push-Location (Join-Path $repo 'frontend')
  try { npx playwright install chromium --no-shell; if ($LASTEXITCODE -ne 0) { throw 'Chromium installation failed' } } finally { Pop-Location }
}
$statePath = Join-Path $QaRoot 'runtime\current.json'
if (-not $ReuseServices) {
  if (Test-Path -LiteralPath $statePath) {
    $old = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    foreach ($processId in @($old.apiPid,$old.vitePid)) {
      $owned = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
      if ($owned -and $owned.CommandLine.Contains($repo)) { Stop-Process -Id $processId }
    }
  }
  & 'D:\Tools\fixi-dotnet\dotnet.exe' build (Join-Path $repo 'backend\src\RepairShop.Api\RepairShop.Api.csproj') -c Release --nologo -v minimal
  if ($LASTEXITCODE -ne 0) { throw 'Backend build failed' }
  & (Join-Path $PSScriptRoot 'start-web-qa.ps1') -QaRoot $QaRoot | Out-Host
}
$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
if ($state.frontend -ne 'http://127.0.0.1:15173' -or $state.api -ne 'http://127.0.0.1:18170' -or $state.database -notmatch '^fixi_web_qa_[0-9]+$') { throw 'Refusing a non-dedicated or non-local QA target.' }
if ($state.head -ne (git -C $repo rev-parse HEAD)) { throw 'QA services were built for another commit; restart without -ReuseServices.' }
$caseFiles = @('backoffice.spec.ts','commercial-invoices.spec.ts','order-lifecycle.spec.ts','pages.spec.ts','pos.spec.ts','signup.spec.ts','workshop.spec.ts')
$groups = switch ($Group) {
  'All' { @(@{name='smoke';files=@('desktop-smoke.spec.ts')},@{name='full';files=@($caseFiles + 'desktop-integrity.spec.ts' + 'desktop-inventory.spec.ts')}) }
  'Smoke' { @(@{name='smoke';files=@('desktop-smoke.spec.ts')}) }
  'Integrity' { @(@{name='integrity';files=@('desktop-integrity.spec.ts')}) }
  'Inventory' { @(@{name='inventory';files=@('desktop-inventory.spec.ts')}) }
  'Baseline' { @(@{name='baseline';files=$caseFiles}) }
}
$overall = 0
foreach ($stage in $groups) {
  $stageId = $stage.name + '-' + (Get-Date -Format 'HHmmss')
  $env:FIXI_QA_RUN = Join-Path $state.runRoot $stageId
  New-Item -ItemType Directory -Force -Path $env:FIXI_QA_RUN | Out-Null
  $state | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $env:FIXI_QA_RUN 'environment.json') -Encoding utf8
  Push-Location (Join-Path $repo 'frontend')
  try { npx playwright test --config playwright.desktop.config.ts @($stage.files) --headed; $stageCode=$LASTEXITCODE } finally { Pop-Location }
  $safe = Join-Path $QaRoot ('evidence\' + $state.runId + '\' + $stageId)
  python (Join-Path $PSScriptRoot 'sanitize-web-evidence.py') $env:FIXI_QA_RUN $safe
  if ($LASTEXITCODE -ne 0) { throw 'Evidence privacy verification failed; do not publish private runtime files.' }
  Write-Host "Sanitized evidence: $safe"
  if ($stageCode -ne 0) { $overall=1; if ($stage.name -eq 'smoke') { break } }
}
if ($overall -ne 0) { Write-Warning 'Inspect the report. The subscription checkout case is blocked when no real payment provider is configured; no simulated payment provider is enabled.' }
exit $overall
