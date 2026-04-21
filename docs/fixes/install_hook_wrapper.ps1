# Install observe-wrapper.sh + rewrite settings.local.json to use it
# No Japanese literals - uses $PSScriptRoot instead
# argv-dup bug workaround: use `bash` (PATH-resolved) as first token and
# normalize wrapper path to forward slashes. See PR #1524.
$ErrorActionPreference = "Stop"

$SkillHooks   = "$env:USERPROFILE\.claude\skills\continuous-learning\hooks"
$WrapperSrc   = Join-Path $PSScriptRoot "observe-wrapper.sh"
$WrapperDst   = "$SkillHooks\observe-wrapper.sh"
$SettingsPath = "$env:USERPROFILE\.claude\settings.local.json"
# Use PATH-resolved `bash` to avoid Claude Code v2.1.116 argv-dup bug that
# double-passes the first token when the quoted path is a Windows .exe.
$BashExe      = "bash"

Write-Host "=== Install Hook Wrapper ===" -ForegroundColor Cyan
Write-Host "ScriptRoot: $PSScriptRoot"
Write-Host "WrapperSrc: $WrapperSrc"

if (-not (Test-Path $WrapperSrc)) {
    Write-Host "[ERROR] Source not found: $WrapperSrc" -ForegroundColor Red
    exit 1
}

# 1) Copy wrapper + LF normalization
Write-Host "[1/4] Copy wrapper to $WrapperDst" -ForegroundColor Yellow
$content = Get-Content -Raw -Path $WrapperSrc
$contentLf = $content -replace "`r`n","`n"
$utf8 = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($WrapperDst, $contentLf, $utf8)
Write-Host "  [OK] wrapper installed with LF endings" -ForegroundColor Green

# 2) Backup settings
Write-Host "[2/4] Backup settings.local.json" -ForegroundColor Yellow
$backup = "$SettingsPath.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item $SettingsPath $backup -Force
Write-Host "  [OK] $backup" -ForegroundColor Green

# 3) Rewrite command path in settings.local.json
Write-Host "[3/4] Rewrite hook command to wrapper" -ForegroundColor Yellow
$settings = Get-Content -Raw -Path $SettingsPath -Encoding UTF8 | ConvertFrom-Json -AsHashtable

# Normalize wrapper path to forward slashes so bash (MSYS/Git Bash) does not
# mangle backslashes; quoting keeps spaces safe.
$wrapperPath = $WrapperDst -replace '\\','/'
$preCmd  = $BashExe + ' "' + $wrapperPath + '" pre'
$postCmd = $BashExe + ' "' + $wrapperPath + '" post'

foreach ($entry in $settings.hooks.PreToolUse) {
    foreach ($h in $entry.hooks) {
        $h.command = $preCmd
    }
}
foreach ($entry in $settings.hooks.PostToolUse) {
    foreach ($h in $entry.hooks) {
        $h.command = $postCmd
    }
}

$json = $settings | ConvertTo-Json -Depth 20
# Normalize CRLF -> LF so hook parsers never see mixed line endings.
$jsonLf = $json -replace "`r`n","`n"
[System.IO.File]::WriteAllText($SettingsPath, $jsonLf, $utf8)
Write-Host "  [OK] command updated" -ForegroundColor Green
Write-Host "  PreToolUse  command: $preCmd"
Write-Host "  PostToolUse command: $postCmd"

# 4) Verify
Write-Host "[4/4] Verify" -ForegroundColor Yellow
Get-Content $SettingsPath | Select-String "command"

Write-Host ""
Write-Host "=== DONE ===" -ForegroundColor Green
Write-Host "Next: Launch Claude CLI and run any command to trigger observations.jsonl"
