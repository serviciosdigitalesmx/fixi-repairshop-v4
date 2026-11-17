param([string]$QaRoot = 'D:\QA\fixi-web-20261117', [switch]$Resume)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$runtime = Join-Path $QaRoot 'runtime'
if (-not ([IO.Path]::GetFullPath($QaRoot).StartsWith('D:\', [StringComparison]::OrdinalIgnoreCase))) { throw 'QA artifacts must stay on D:' }
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
$current = Join-Path $runtime 'current.json'
if (Test-Path -LiteralPath $current) {
  $previous = Get-Content -LiteralPath $current -Raw | ConvertFrom-Json
  foreach ($processId in @($previous.apiPid, $previous.vitePid)) {
    $owned = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
    if ($owned -and $owned.CommandLine.Contains($repo)) { Stop-Process -Id $processId -ErrorAction Stop }
  }
}
foreach ($port in @(15173,18170)) { if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw "QA port $port is occupied; no unrelated service was stopped." } }
$label = docker inspect fixi-web-qa-20261117-pg --format '{{index .Config.Labels "fixi.qa"}}'
if ($LASTEXITCODE -ne 0 -or $label -ne 'web-20261117') { throw 'Expected dedicated QA PostgreSQL container was not found.' }
$pgState = docker inspect fixi-web-qa-20261117-pg --format '{{.State.Running}}'
if ($pgState -ne 'true') {
  docker start fixi-web-qa-20261117-pg | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Dedicated QA PostgreSQL could not start.' }
}
docker exec fixi-web-qa-20261117-pg pg_isready -U postgres | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Dedicated QA PostgreSQL is not ready; retry once it is healthy.' }
$runId = 'run-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
$runRoot = Join-Path $runtime $runId
New-Item -ItemType Directory -Force -Path $runRoot | Out-Null
if ($Resume) {
  if (-not $previous -or $previous.database -notmatch '^fixi_web_qa_[0-9]+$') { throw 'No owned QA database is available to resume.' }
  $db = $previous.database
} else {
  $db = 'fixi_web_qa_' + (Get-Date -Format 'yyyyMMddHHmmss')
  docker exec fixi-web-qa-20261117-pg createdb -U postgres $db
  if ($LASTEXITCODE -ne 0) { throw 'Unable to create a new QA database. No existing database was modified.' }
  $tableCount = docker exec fixi-web-qa-20261117-pg psql -U postgres -d $db -Atc "select count(*) from information_schema.tables where table_schema='public'"
  if ($tableCount -ne '0') { throw 'Refusing to initialize a non-empty database.' }
}
$env:DOTNET_ROOT = 'D:\Tools\fixi-dotnet'
$env:DOTNET_CLI_HOME = Join-Path $runtime 'dotnet-home'
$env:NUGET_PACKAGES = Join-Path $QaRoot 'nuget'
$env:TEMP = Join-Path $QaRoot 'temp'
$env:TMP = $env:TEMP
$env:ASPNETCORE_ENVIRONMENT = 'Development'
$env:ASPNETCORE_URLS = 'http://127.0.0.1:18170'
$dbPassword = Get-Content -LiteralPath (Join-Path $runtime 'pg-password') -Raw
$env:ConnectionStrings__RepairShopDb = "Host=127.0.0.1;Port=15439;Database=$db;Username=postgres;Password=$dbPassword"
$env:Jwt__Key = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
$env:Jwt__AccessTokenMinutes = '1'
$env:Database__Init = if ($Resume) { 'None' } else { 'EnsureCreated' }
$env:Seed__Enabled = if ($Resume) { 'false' } else { 'true' }
$env:Seed__DemoData = 'true'
$env:Seed__ShopName = 'QA Web Desktop - datos descartables'
$env:App__FrontendBaseUrl = 'http://127.0.0.1:15173'
$env:App__PublicApiUrl = 'http://127.0.0.1:18170'
$env:Notifications__WhatsApp__Provider = 'None'
$env:Notifications__Email__Provider = 'None'
$env:Notifications__Sms__Provider = 'None'
$env:BackgroundJobs__Enabled = 'false'
$env:Jobs__Enabled = 'false'
$env:Billing__AllowSimulated = 'false'
$env:ExchangeRates__Provider = 'None'
$env:Ai__Provider = 'None'
$env:Storage__Local__RootPath = Join-Path $runRoot 'uploads'
$env:Cors__AllowedOrigins__0 = 'http://127.0.0.1:15173'
$apiDir = Join-Path $repo 'backend\src\RepairShop.Api\bin\Release\net8.0'
if (-not (Test-Path (Join-Path $apiDir 'RepairShop.Api.dll'))) { throw 'Build the real backend before starting QA.' }
$api = Start-Process -FilePath 'D:\Tools\fixi-dotnet\dotnet.exe' -ArgumentList (Join-Path $apiDir 'RepairShop.Api.dll') -WorkingDirectory $apiDir -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runRoot 'api.stdout.log') -RedirectStandardError (Join-Path $runRoot 'api.stderr.log')
$env:VITE_PROXY_TARGET = 'http://127.0.0.1:18170'
$env:VITE_API_BASE = '/api/v1'
$vite = Start-Process -FilePath (Get-Command node).Source -ArgumentList @((Join-Path $repo 'frontend\node_modules\vite\bin\vite.js'),'--host','127.0.0.1','--port','15173','--strictPort') -WorkingDirectory (Join-Path $repo 'frontend') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runRoot 'vite.stdout.log') -RedirectStandardError (Join-Path $runRoot 'vite.stderr.log')
$state = @{ runId=$runId; runRoot=$runRoot; database=$db; apiPid=$api.Id; vitePid=$vite.Id; frontend='http://127.0.0.1:15173'; api='http://127.0.0.1:18170'; head=(git -C $repo rev-parse HEAD); branch=(git -C $repo branch --show-current); databaseInit=$env:Database__Init; externalProviders='None; billing simulation disabled' }
$state | ConvertTo-Json | Set-Content -LiteralPath $current -Encoding utf8
$deadline = (Get-Date).AddSeconds(90)
foreach ($url in @('http://127.0.0.1:18170/healthz','http://127.0.0.1:15173/login')) {
  $ready = $false
  while ((Get-Date) -lt $deadline) {
    try { $r = Invoke-WebRequest $url -TimeoutSec 3; if ($r.StatusCode -eq 200) { $ready=$true; break } } catch { }
    if ($api.HasExited -or $vite.HasExited) { throw "QA service exited; inspect private runtime logs in $runRoot" }
    Start-Sleep -Milliseconds 300
  }
  if (-not $ready) { throw "QA readiness timeout: $url" }
}
$state | ConvertTo-Json
