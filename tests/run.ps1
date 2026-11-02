#Requires -Version 7.2
# Windows test runner: the PowerShell tests, the validator and the shell tests that run under Git Bash.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$PWSH = (Get-Process -Id $PID).Path

function Step([string]$name, [scriptblock]$body) {
    $global:LASTEXITCODE = 0
    try { & $body } catch { Write-Output "FAIL: $name ($($_.Exception.Message))"; exit 1 }
    if ($LASTEXITCODE -ne 0) { Write-Output "FAIL: $name"; exit 1 }
}

# Git Bash only, never `bash` from PATH (on Windows that can be WSL's System32 bash.exe).
function Resolve-GitBash {
    $candidates = [System.Collections.Generic.List[string]]::new()
    if ($env:OPENCODE_GIT_BASH_PATH) { $candidates.Add($env:OPENCODE_GIT_BASH_PATH) }
    # Two levels above git.exe is the Git root for both Git\cmd\git.exe and Git\mingw64\bin\git.exe.
    $git = Get-Command git -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($git) {
        $gitRoot = [IO.Path]::GetDirectoryName([IO.Path]::GetDirectoryName($git.Source))
        if ($gitRoot) { $candidates.Add((Join-Path $gitRoot 'bin' 'bash.exe')) }
    }
    foreach ($base in $env:ProgramFiles, ${env:ProgramFiles(x86)}) {
        if ($base) { $candidates.Add((Join-Path $base 'Git' 'bin' 'bash.exe')) }
    }
    if ($env:LOCALAPPDATA) { $candidates.Add((Join-Path $env:LOCALAPPDATA 'Programs' 'Git' 'bin' 'bash.exe')) }
    foreach ($c in $candidates) { if ([IO.File]::Exists($c)) { return $c } }
    return $null
}

Step 'PowerShell syntax' { & $PWSH -NoProfile -File tests/ps-syntax.ps1 }

if ($IsWindows) {
    $bash = Resolve-GitBash
    if (-not $bash) { Write-Output 'FAIL: Git for Windows not found'; exit 1 }
    $gitUsrBin = Join-Path (Split-Path (Split-Path $bash -Parent) -Parent) 'usr\bin'
    $env:PATH = "$gitUsrBin$([IO.Path]::PathSeparator)$env:PATH"
    $env:PYTHONUTF8 = '1'
} else {
    $bash = 'sh'
}

Step 'validator' { uv run --with pyyaml python tests/validate.py }
Step 'flow-omp.test.ps1' { & $PWSH -NoProfile -File tests/flow-omp.test.ps1 }
Step 'flow-opencode.test.ps1' { & $PWSH -NoProfile -File tests/flow-opencode.test.ps1 }
Step 'approval-record.test.sh' { & $bash tests/approval-record.test.sh }
Step 'flow-exclude.test.sh' { & $bash tests/flow-exclude.test.sh }
Step 'session-start.test.sh' { & $bash tests/session-start.test.sh }

Write-Output 'ok: Windows suite'
