# 定时把工作台快照推到 GitHub 私有仓库
$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
$log = Join-Path $root 'sync.log'
$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$node = 'D:\Program Files\nodejs\node.exe'
$git = 'git'

function Write-Log([string]$text) {
  Add-Content -LiteralPath $log -Value "$stamp $text" -Encoding utf8
  $lines = Get-Content -LiteralPath $log -Encoding utf8 -ErrorAction SilentlyContinue
  if ($lines -and $lines.Count -gt 400) {
    $lines | Select-Object -Last 300 | Set-Content -LiteralPath $log -Encoding utf8
  }
}

if (-not (Test-Path -LiteralPath $node)) { Write-Log 'ERROR node missing'; exit 1 }
if (-not (Test-Path -LiteralPath (Join-Path $root 'gen.mjs'))) { Write-Log 'ERROR gen.mjs missing'; exit 1 }

Push-Location $root
try {
  & $node (Join-Path $root 'gen.mjs') *> (Join-Path $root 'gen.out') 
  if ($LASTEXITCODE -ne 0) { Write-Log "ERROR gen exit $LASTEXITCODE"; exit 1 }

  $status = & $git status --porcelain 2>&1
  if (-not $status) { Write-Log 'no-change'; exit 0 }

  & $git add -A 2>&1 | Out-Null
  & $git commit -m "sync $(Get-Date -Format 'yyyy-MM-dd HH:mm')" 2>&1 | Out-Null
  & $git pull --rebase --autostash 2>&1 | Out-Null
  $push = (& $git push 2>&1 | Out-String).Trim()
  $push = $push -replace '\s+', ' '
  if ($push.Length -gt 200) { $push = $push.Substring(0, 200) }
  if ($push -eq '') { $push = '(no output)' }
  Write-Log ('pushed ' + $push)
} catch {
  Write-Log ('ERROR ' + $_.Exception.Message)
} finally {
  Pop-Location
}
