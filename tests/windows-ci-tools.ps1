#Requires -Version 7.2
# Real OMP and OpenCode checks for the Windows CI job. Installs into the real home, so it only runs on GitHub Actions.
if ($env:GITHUB_ACTIONS -ne 'true') {
    [Console]::Error.WriteLine('error: this script installs into the real home; it runs only on GitHub Actions')
    exit 2
}
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$version = (Get-Content VERSION -First 1)

function Fail([string]$msg) { Write-Output "FAIL: $msg"; exit 1 }
function Ok([string]$msg) { Write-Output "ok: $msg" }
function Normalize([string]$p) {
    [IO.Path]::GetFullPath($p).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
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

# 1. OMP profile directory.
& omp --version
$dir = (& omp --profile anthropic config path | Out-String).Trim()
if (-not [IO.Path]::IsPathRooted($dir) -or $dir -notmatch '(?i)[\\/]\.omp[\\/]profiles[\\/]anthropic[\\/]agent$') {
    Fail "omp profile dir is not the expected form: $dir"
}
Ok "omp profile dir $dir"

# 2. OMP launcher.
& omp/bin/flow-omp.ps1 install
if ($LASTEXITCODE -ne 0) { Fail 'flow-omp.ps1 install' }
& omp/bin/flow-omp.ps1 verify
if ($LASTEXITCODE -ne 0) { Fail 'flow-omp.ps1 verify' }
$doctor = @(& omp/bin/flow-omp.ps1 doctor 2>&1 | ForEach-Object { "$_" })
if ($doctor.Count -eq 0 -or $doctor[0] -ne "flow-skills $version") { Fail "flow-omp.ps1 doctor first line: $($doctor[0])" }
Ok 'flow-omp.ps1 install, verify, doctor'

# 3. The profile config reaches OMP.
$default = $null
$inRoles = $false
foreach ($line in Get-Content omp/profiles/anthropic/config.yml) {
    if ($line -match '^modelRoles:') { $inRoles = $true; continue }
    if ($inRoles -and $line -match '^\s+default:\s+(\S+)') { $default = $Matches[1]; break }
}
if (-not $default) { Fail 'no modelRoles default in omp/profiles/anthropic/config.yml' }
$cfg = (& omp --profile anthropic config list --scope global | Out-String)
if ($cfg -notmatch 'modelRoles =') { Fail "omp config list lacks 'modelRoles ='" }
if (-not $cfg.Contains("default: $default")) { Fail "omp config list lacks 'default: $default'" }
Ok 'omp config list shows the profile model roles'

# 4. Every skill resolves through the profile.
foreach ($d in Get-ChildItem omp/skills -Directory) {
    $name = $d.Name
    $out = @(& omp --profile anthropic read "skill://$name/SKILL.md" 2>&1 | ForEach-Object { "$_" })
    if ($LASTEXITCODE -ne 0) { Fail "omp read skill://$name/SKILL.md exited $LASTEXITCODE" }
    if ($out[0] -notmatch "profiles[\\/]anthropic[\\/]agent[\\/]skills[\\/]$([regex]::Escape($name))[\\/]SKILL\.md") {
        Fail "omp read skill://$name first line: $($out[0])"
    }
}
Ok 'omp reads every skill through the profile'

# 5. OpenCode launcher.
& opencode --version
& opencode/bin/flow-opencode.ps1 install
if ($LASTEXITCODE -ne 0) { Fail 'flow-opencode.ps1 install' }
& opencode/bin/flow-opencode.ps1 verify
if ($LASTEXITCODE -ne 0) { Fail 'flow-opencode.ps1 verify' }
Ok 'flow-opencode.ps1 install, verify'

# 6. OpenCode doctor.
$out = @(& opencode/bin/flow-opencode.ps1 doctor 2>&1 | ForEach-Object { "$_" })
$doctorExit = $LASTEXITCODE
$out | ForEach-Object { Write-Output $_ }
if ($doctorExit -ne 0) { Fail "flow-opencode.ps1 doctor exited $doctorExit" }
if ($out[0] -ne "flow-skills $version") { Fail "flow-opencode.ps1 doctor first line: $($out[0])" }
foreach ($f in Get-ChildItem opencode/agents -Filter *.md -File) {
    $a = $f.BaseName
    if ($out -notcontains "ok: agent $a is a subagent") { Fail "doctor lacks 'ok: agent $a is a subagent'" }
}
foreach ($d in Get-ChildItem opencode/skills) {
    if (-not ($out | Where-Object { $_.StartsWith("ok: skill $($d.Name) at ") })) { Fail "doctor lacks 'ok: skill $($d.Name) at '" }
}
if ($out | Where-Object { $_ -match 'FAIL:' }) { Fail 'doctor printed FAIL lines' }
Ok 'flow-opencode.ps1 doctor'

# 7. run sets the shell to Git Bash.
$bash = Resolve-GitBash
if (-not $bash) { Fail 'Git for Windows not found' }
$json = (& opencode/bin/flow-opencode.ps1 run claude-agent debug config | Out-String) | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { Fail "flow-opencode.ps1 run debug config exited $LASTEXITCODE" }
$shell = @($json)[-1].info.shell
if (-not $shell -or -not [string]::Equals((Normalize $shell), (Normalize $bash), [StringComparison]::OrdinalIgnoreCase)) {
    Fail "run shell is '$shell', expected '$bash'"
}
Ok 'run sets shell to Git Bash'

# 8. run lists every Flow agent.
$agents = (& opencode/bin/flow-opencode.ps1 run claude-agent debug agents | Out-String) | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { Fail "flow-opencode.ps1 run debug agents exited $LASTEXITCODE" }
$ids = @($agents | ForEach-Object { $_.id ?? $_.name })
foreach ($f in Get-ChildItem opencode/agents -Filter *.md -File) {
    if ($ids -notcontains $f.BaseName) { Fail "run claude-agent lacks agent $($f.BaseName)" }
}
Ok 'run claude-agent lists every Flow agent'

Write-Output 'ok: Windows tool checks'
