<#
.SYNOPSIS
  Download the four game files needed for a snapshot, for every version listed in versions.csv.

.DESCRIPTION
  Runs DepotDownloader once per row of versions.csv that has a manifest id and has not been
  downloaded yet. Only the files in ..\depot-filelist.txt are fetched (about 1.4 GB per version,
  not the ~90 GB full install). Each version lands in <OutRoot>\<version>\ and gets a .done marker.

  You must own the game; DepotDownloader logs in with your Steam account. Your password and
  Steam Guard confirmation go only to Steam. -remember-password lets DepotDownloader reuse
  the login for the following versions.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\download-builds.ps1 -Username mysteamlogin
  powershell -ExecutionPolicy Bypass -File .\download-builds.ps1 -Username mysteamlogin -Only 13.0,13.2
#>
param(
  [Parameter(Mandatory = $true)][string]$Username,
  [string]$DepotDownloader = "DepotDownloader.exe",
  [string]$OutRoot = (Join-Path $env:USERPROFILE "depot\sm2-builds"),
  [string]$Csv = (Join-Path $PSScriptRoot "versions.csv"),
  [string]$FileList = (Join-Path $PSScriptRoot "..\depot-filelist.txt"),
  [string[]]$Only = @()
)

$ErrorActionPreference = "Stop"
$AppId = 2183900
$DepotId = 2183901
$Needed = @(
  "client_pc\root\paks\client\default\default.pak",
  "client_pc\root\paks\client\default\default_other.pak",
  "client_pc\root\paks\client\resources.pak",
  "server_pc\root\paks\server\default\default_other.pak"
)

if (-not (Get-Command $DepotDownloader -ErrorAction SilentlyContinue) -and -not (Test-Path $DepotDownloader)) {
  throw "DepotDownloader not found: '$DepotDownloader'. Pass -DepotDownloader C:\path\to\DepotDownloader.exe"
}
if (-not (Test-Path $FileList)) { throw "File list not found: $FileList" }

$rows = Import-Csv $Csv | Where-Object { $_.manifest -and ($Only.Count -eq 0 -or $Only -contains $_.version) }
if ($rows.Count -eq 0) { Write-Host "No rows with a manifest id in $Csv (fill the 'manifest' column from SteamDB first)."; exit 0 }

$done = @(); $failed = @()
foreach ($r in $rows) {
  $dir = Join-Path $OutRoot $r.version
  $marker = Join-Path $dir ".done"
  if (Test-Path $marker) { Write-Host "[$($r.version)] already downloaded, skipping"; continue }

  Write-Host "[$($r.version)] manifest $($r.manifest) -> $dir"
  & $DepotDownloader -app $AppId -depot $DepotId -manifest $r.manifest -username $Username -remember-password -filelist $FileList -dir $dir
  if ($LASTEXITCODE -ne 0) { $failed += $r.version; Write-Warning "[$($r.version)] DepotDownloader exited with $LASTEXITCODE"; continue }

  $missing = $Needed | Where-Object { -not (Test-Path (Join-Path $dir $_)) }
  if ($missing) { $failed += $r.version; Write-Warning "[$($r.version)] missing after download: $($missing -join ', ')"; continue }

  "manifest=$($r.manifest)`ndownloaded=$(Get-Date -Format s)" | Set-Content $marker
  $done += $r.version
}

Write-Host ""
Write-Host "Downloaded: $($done -join ', ')"
if ($failed) { Write-Warning "Failed: $($failed -join ', ')" }
Write-Host "Next, in WSL (repo root):  tools/backfill/build-snapshots.sh `"$OutRoot`""
Write-Host "(WSL sees C:\ as /mnt/c, e.g. /mnt/c/Users/$env:USERNAME/depot/sm2-builds)"
