#Requires -Version 7.2
# PowerShell counterpart of tests/opencode-install.test.sh; scenarios keep its numbers.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ROOT = Split-Path -Parent $PSScriptRoot
$PORT = Join-Path $ROOT 'opencode'
$FLOW = Join-Path $PORT 'bin/flow-opencode.ps1'
$PWSH = (Get-Process -Id $PID).Path
$LINKED = 'AGENTS.md', 'skills', 'agents', 'profiles'
$FIVE = $LINKED + 'opencode.json'
$PathCompare = $IsWindows ? [StringComparison]::OrdinalIgnoreCase : [StringComparison]::Ordinal
$TMP = (New-Item -ItemType Directory -Path (Join-Path ([IO.Path]::GetTempPath()) "flow-opencode-test-$([guid]::NewGuid().ToString('N'))")).FullName

function fail([string]$msg) { throw "FAIL: $msg" }

function Norm([string]$p) {
    [IO.Path]::GetFullPath($p).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
}
function Same([string]$a, [string]$b) { [string]::Equals((Norm $a), (Norm $b), $PathCompare) }

function Is-Link([string]$p) {
    (Get-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue)?.LinkType -eq 'SymbolicLink'
}
function Final([string]$p) {
    try { return [IO.File]::ResolveLinkTarget($p, $true)?.FullName } catch { return $null }
}
function RawTarget([string]$p) { (Get-Item -LiteralPath $p -Force).LinkTarget }

# -Dir makes a directory link for a target that does not exist (a dangling
# directory-shaped target needs the directory flavour on Windows).
function New-FixtureLink([string]$target, [string]$link, [switch]$Dir) {
    if ($Dir -or (Test-Path -LiteralPath $target -PathType Container)) {
        [void][IO.Directory]::CreateSymbolicLink($link, $target)
    } else {
        [void][IO.File]::CreateSymbolicLink($link, $target)
    }
}
function Remove-LinkObject([string]$p) {
    if ((Get-Item -LiteralPath $p -Force).PSIsContainer) { [IO.Directory]::Delete($p) } else { [IO.File]::Delete($p) }
}
# Links under $dir, without descending into them.
function Get-LinkPaths([string]$dir) {
    foreach ($entry in [IO.Directory]::EnumerateFileSystemEntries($dir)) {
        if ($null -ne [IO.FileInfo]::new($entry).LinkTarget) { $entry }
        elseif ([IO.Directory]::Exists($entry)) { Get-LinkPaths $entry }
    }
}

# Runs a launcher as a child whose environment is built from scratch.
function Invoke-Flow([string]$HomePath, [string[]]$PathDirs, [string[]]$Cmd, [hashtable]$ExtraEnv = @{}, [string]$Launcher = $FLOW) {
    if (-not (Test-Path -LiteralPath $Launcher -PathType Leaf)) { fail "launcher not found: $Launcher" }
    $psi = [System.Diagnostics.ProcessStartInfo]::new($PWSH)
    foreach ($a in @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Launcher) + $Cmd) { $psi.ArgumentList.Add($a) }
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.Environment.Clear()
    $psi.Environment['HOME'] = $HomePath
    $psi.Environment['USERPROFILE'] = $HomePath
    $tail = $IsWindows ? (Join-Path $env:SystemRoot 'System32') : '/usr/bin:/bin'
    $psi.Environment['PATH'] = (@($PathDirs) + $tail) -join [IO.Path]::PathSeparator
    foreach ($name in 'SystemRoot', 'windir', 'TEMP', 'TMP', 'TMPDIR', 'PATHEXT', 'ComSpec', 'USERNAME', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)') {
        $value = [Environment]::GetEnvironmentVariable($name)
        if ($value) { $psi.Environment[$name] = $value }
    }
    foreach ($key in $ExtraEnv.Keys) { $psi.Environment[$key] = [string]$ExtraEnv[$key] }
    $proc = [System.Diagnostics.Process]::Start($psi)
    $stdout = $proc.StandardOutput.ReadToEndAsync()
    $stderr = $proc.StandardError.ReadToEndAsync()
    $proc.WaitForExit()
    @{ Out = $stdout.Result + $stderr.Result; Code = $proc.ExitCode }
}

function New-Stub([string]$dir, [string]$name, [string]$psBody) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    [IO.File]::WriteAllText((Join-Path $dir "$name.ps1"), $psBody)
}

# A POSIX sh stub that a process can launch directly (Linux only).
function New-ShStub([string]$dir, [string]$name, [string]$body) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $path = Join-Path $dir $name
    [IO.File]::WriteAllText($path, "#!/bin/sh`n$body`n")
    [IO.File]::SetUnixFileMode($path, [IO.UnixFileMode]'UserRead, UserWrite, UserExecute')
}

function New-ScratchHome([string]$name) {
    (New-Item -ItemType Directory -Path (Join-Path $TMP $name)).FullName
}

function Cfg([string]$h) { Join-Path $h '.config' 'opencode' }
function Lines([string]$text) { @($text -split "\r?\n" | Where-Object { $_ -ne '' }) }
function Count-Lines([string]$text, [string]$pattern) { @(Lines $text | Where-Object { $_ -match $pattern }).Count }

# Entries of a directory as `name -> target` lines, in name order.
function Get-LinkTargets([string]$dir) {
    foreach ($e in [IO.Directory]::GetFileSystemEntries($dir) | Sort-Object { [IO.Path]::GetFileName($_) }) {
        $t = (Get-Item -LiteralPath $e -Force).LinkTarget
        "$([IO.Path]::GetFileName($e)) -> $($t ?? '(not a link)')"
    }
}

$names = @(Get-ChildItem -LiteralPath (Join-Path $PORT 'skills') -Directory | Sort-Object Name | ForEach-Object Name)
$SKILL1 = $names[0]
$SKILL2 = $names[1]
$skillNames = $names
$agentNames = @(Get-ChildItem -LiteralPath (Join-Path $PORT 'agents') -Filter '*.md' | Sort-Object Name | ForEach-Object BaseName)

# Fixture JSON for the doctor stub, with the shapes of `opencode debug agents`, `api model.default` and `api skill.list`.
function Write-Json([string]$path, $value) {
    [IO.File]::WriteAllText($path, (ConvertTo-Json -InputObject $value -Depth 6 -Compress))
}
function Make-Fixtures([string]$out, [string]$skillsPrefix) {
    $asks = @(foreach ($r in 'git push*', 'gh pr create*') { [ordered]@{ action = 'shell'; resource = $r; effect = 'ask' } })
    function Agent-List($routes) {
        @(foreach ($a in @('build') + $agentNames) {
            $row = [ordered]@{ id = $a; mode = ($a -eq 'build' ? 'primary' : 'subagent'); permissions = $asks }
            if ($routes -and $routes.ContainsKey($a)) {
                $model = $routes[$a].model
                $p, $m = $model -split '/', 2
                $mm = [ordered]@{ providerID = $p; id = $m }
                if ($routes[$a].variant) { $mm['variant'] = $routes[$a].variant }
                $row['model'] = $mm
            }
            $row
        })
    }
    Write-Json (Join-Path $out 'agents-base.json') (Agent-List $null)
    foreach ($f in Get-ChildItem -LiteralPath (Join-Path $PORT 'profiles') -Filter '*.json') {
        $stem = $f.BaseName
        $prof = Get-Content -LiteralPath $f.FullName -Raw | ConvertFrom-Json -AsHashtable
        $routes = @{}
        foreach ($a in $prof['agent'].Keys) { $routes[$a] = @{ model = $prof['agent'][$a]['model']; variant = $prof['agent'][$a]['variant'] } }
        Write-Json (Join-Path $out "agents-$stem.json") (Agent-List $routes)
        $p, $m = $prof['model'] -split '/', 2
        Write-Json (Join-Path $out "model-$stem.json") ([ordered]@{ data = [ordered]@{ providerID = $p; modelID = $m } })
    }
    $rows = @([ordered]@{ id = 'opencode'; path = '/builtin' }) + @(foreach ($s in $skillNames) { [ordered]@{ id = $s; path = "$skillsPrefix/$s/SKILL.md" } })
    Write-Json (Join-Path $out 'skills.json') ([ordered]@{ data = $rows })
}

function Edit-Json([string]$path, [scriptblock]$edit) {
    $d = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json -AsHashtable -NoEnumerate
    $d = & $edit $d
    Write-Json $path $d
}

$rc = 0
try {
    # 1. Fresh install links exactly the five destinations.
    $h = New-ScratchHome 'h1'
    $r = Invoke-Flow $h @() @('install')
    if ($r.Code -ne 0) { fail "fresh install failed: $($r.Out)" }
    $cfg = Cfg $h
    foreach ($name in $FIVE) {
        if (-not (Is-Link (Join-Path $cfg $name))) { fail "$name is not a symlink" }
        if (-not (Same (Final (Join-Path $cfg $name)) (Join-Path $PORT $name))) { fail "$name does not point at the port" }
    }
    if ((Count-Lines $r.Out '^linked ') -ne 5) { fail "expected five linked lines, got: $($r.Out)" }
    if (-not $r.Out.Contains('opencode reload')) { fail 'missing the opencode reload hint' }
    if (@([IO.Directory]::GetFileSystemEntries($cfg)).Count -ne 5) { fail 'installer wrote something besides the five links' }

    # 2. Second install changes nothing: same entries, same link targets.
    $before = (Get-LinkTargets $cfg) -join "`n"
    $r = Invoke-Flow $h @() @('install')
    if ($r.Code -ne 0) { fail "second install failed: $($r.Out)" }
    if (((Get-LinkTargets $cfg) -join "`n") -ne $before) { fail 'second install changed the config root' }

    # 3. verify passes.
    $r = Invoke-Flow $h @() @('verify')
    if ($r.Code -ne 0) { fail "verify failed after install: $($r.Out)" }

    # 4. An identical real copy of opencode.json is relinked.
    Remove-LinkObject (Join-Path $cfg 'opencode.json')
    Copy-Item -LiteralPath (Join-Path $PORT 'opencode.json') -Destination (Join-Path $cfg 'opencode.json')
    $r = Invoke-Flow $h @() @('install')
    if ($r.Code -ne 0) { fail "install failed on an identical copy: $($r.Out)" }
    if (-not $r.Out.Contains('replaced identical copy')) { fail "missing 'replaced identical copy': $($r.Out)" }
    if (-not (Is-Link (Join-Path $cfg 'opencode.json'))) { fail 'identical copy was not relinked' }

    # 5. A divergent real copy is refused; everything else is still linked.
    $h5 = New-ScratchHome 'h5'
    $cfg5 = Cfg $h5
    New-Item -ItemType Directory -Force -Path $cfg5 | Out-Null
    [IO.File]::WriteAllText((Join-Path $cfg5 'opencode.json'), "{}`n")
    $divergentBefore = [IO.File]::ReadAllBytes((Join-Path $cfg5 'opencode.json'))
    $r = Invoke-Flow $h5 @() @('install')
    if ($r.Code -eq 0) { fail 'install accepted a divergent opencode.json' }
    if ($r.Out -notmatch 'WARN:.*differs from') { fail "missing the divergence WARN: $($r.Out)" }
    if (-not $r.Out.Contains('nothing was overwritten')) { fail "missing 'nothing was overwritten': $($r.Out)" }
    if (-not [Linq.Enumerable]::SequenceEqual($divergentBefore, [IO.File]::ReadAllBytes((Join-Path $cfg5 'opencode.json')))) { fail 'divergent opencode.json was modified' }
    if (Is-Link (Join-Path $cfg5 'opencode.json')) { fail 'divergent opencode.json became a symlink' }
    foreach ($name in $LINKED) {
        if (-not (Is-Link (Join-Path $cfg5 $name))) { fail "$name was not linked next to a divergent opencode.json" }
    }

    # 6. A real directory is refused before anything is linked.
    $h6 = New-ScratchHome 'h6'
    $cfg6 = Cfg $h6
    New-Item -ItemType Directory -Force -Path (Join-Path $cfg6 'skills') | Out-Null
    $r = Invoke-Flow $h6 @() @('install')
    if ($r.Code -eq 0) { fail 'install replaced a real skills directory' }
    if ($r.Out -notmatch 'skills.*move/merge it manually') { fail "missing the real-directory refusal: $($r.Out)" }
    if (Test-Path -LiteralPath (Join-Path $cfg6 'AGENTS.md')) { fail 'a link was made although skills was refused' }
    if (-not [IO.Directory]::Exists((Join-Path $cfg6 'skills')) -or (Is-Link (Join-Path $cfg6 'skills'))) { fail 'the real skills directory was touched' }

    # 7. A foreign symlink is refused; a symlink into the repository is relinked.
    $h7 = New-ScratchHome 'h7'
    $cfg7 = Cfg $h7
    New-Item -ItemType Directory -Force -Path $cfg7, (Join-Path $h7 'elsewhere') | Out-Null
    $elsewhere = Join-Path $h7 'elsewhere'
    New-FixtureLink $elsewhere (Join-Path $cfg7 'agents')
    $r = Invoke-Flow $h7 @() @('install')
    if ($r.Code -eq 0) { fail 'install replaced a foreign symlink' }
    if ((RawTarget (Join-Path $cfg7 'agents')) -ne $elsewhere) { fail 'installer changed a foreign symlink' }
    if (-not $r.Out.Contains('outside')) { fail "missing the foreign-symlink refusal: $($r.Out)" }
    Remove-LinkObject (Join-Path $cfg7 'agents')
    New-FixtureLink (Join-Path $ROOT 'omp/agents') (Join-Path $cfg7 'agents')
    $r = Invoke-Flow $h7 @() @('install')
    if ($r.Code -ne 0) { fail "install failed on a symlink into the repository: $($r.Out)" }
    if (-not (Same (Final (Join-Path $cfg7 'agents')) (Join-Path $PORT 'agents'))) { fail 'a symlink into the repository was not relinked' }
    # A working relative link with ".." that resolves into the repository is owned, like the sh installer's `readlink -f`
    # result. A directory link in the scratch root stands between the config and the repository, so the ".." holds on
    # every drive layout.
    $climb = Join-Path $TMP 'climb-agents'
    New-FixtureLink (Join-Path $ROOT 'omp/agents') $climb
    $relative = [IO.Path]::GetRelativePath($cfg7, $climb)
    if ($relative -notmatch '[\\/]\.\.[\\/]|^\.\.[\\/]') { fail "fixture is not a relative link with a dot segment: $relative" }
    Remove-LinkObject (Join-Path $cfg7 'agents')
    New-FixtureLink $relative (Join-Path $cfg7 'agents') -Dir
    if ((RawTarget (Join-Path $cfg7 'agents')) -ne $relative) { fail "fixture link target was rewritten: $(RawTarget (Join-Path $cfg7 'agents'))" }
    $r = Invoke-Flow $h7 @() @('install')
    if ($r.Code -ne 0) { fail "install refused a working relative link ($relative) that resolves into the repository: $($r.Out)" }
    if (-not (Same (Final (Join-Path $cfg7 'agents')) (Join-Path $PORT 'agents'))) { fail 'a working relative link with a dot segment was not relinked' }
    if ((RawTarget (Join-Path $cfg7 'agents')) -eq $relative) { fail 'install left the relative link in place' }
    Remove-LinkObject $climb

    # 7b. A foreign opencode.json symlink is refused before anything is linked.
    $h7b = New-ScratchHome 'h7b'
    $cfg7b = Cfg $h7b
    New-Item -ItemType Directory -Force -Path $cfg7b, (Join-Path $h7b 'elsewhere') | Out-Null
    $foreignJson = Join-Path $h7b 'elsewhere/opencode.json'
    New-Item -ItemType File -Path $foreignJson | Out-Null
    New-FixtureLink $foreignJson (Join-Path $cfg7b 'opencode.json')
    $r = Invoke-Flow $h7b @() @('install')
    if ($r.Code -eq 0) { fail 'install replaced a foreign opencode.json symlink' }
    if ((RawTarget (Join-Path $cfg7b 'opencode.json')) -ne $foreignJson) { fail 'installer changed a foreign opencode.json symlink' }
    if (-not $r.Out.Contains('outside')) { fail "missing the foreign opencode.json refusal: $($r.Out)" }
    if (@([IO.Directory]::GetFileSystemEntries($cfg7b)).Count -ne 1) { fail 'a link was made although opencode.json was refused' }

    # 8. Duplicate skills under ~/.claude and ~/.agents are reported, never deleted.
    $h8 = New-ScratchHome 'h8'
    $r = Invoke-Flow $h8 @() @('install')
    if ($r.Code -ne 0) { fail "install failed for the duplicate case: $($r.Out)" }
    $cfg8 = Cfg $h8
    $dup1 = Join-Path $h8 '.claude' 'skills' $SKILL1 'SKILL.md'
    $dup2 = Join-Path $h8 '.agents' 'skills' $SKILL2 'SKILL.md'
    foreach ($d in $dup1, $dup2) {
        New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($d)) | Out-Null
        New-Item -ItemType File -Path $d | Out-Null
    }
    foreach ($cmd in 'verify', 'install') {
        $r = Invoke-Flow $h8 @() @($cmd)
        if ($r.Code -eq 0) { fail "$cmd exited 0 with duplicate skills" }
        if ((Count-Lines $r.Out '^WARN: duplicate skill') -ne 2) { fail "${cmd}: expected two duplicate WARN lines: $($r.Out)" }
        if (-not $r.Out.Contains($dup1)) { fail "${cmd}: missing the .claude path: $($r.Out)" }
        if (-not $r.Out.Contains($dup2)) { fail "${cmd}: missing the .agents path: $($r.Out)" }
    }
    foreach ($name in $FIVE) {
        if (-not (Is-Link (Join-Path $cfg8 $name))) { fail "$name lost its link next to duplicates" }
    }
    if (-not ([IO.File]::Exists($dup1) -and [IO.File]::Exists($dup2))) { fail 'a duplicate was deleted' }
    Remove-Item -Recurse -Force -LiteralPath (Join-Path $h8 '.claude'), (Join-Path $h8 '.agents')
    $r = Invoke-Flow $h8 @() @('verify')
    if ($r.Code -ne 0) { fail "verify failed after the duplicates were removed: $($r.Out)" }

    # 9. XDG_CONFIG_HOME moves the config root.
    $h9 = New-ScratchHome 'h9'
    $r = Invoke-Flow $h9 @() @('install') @{ XDG_CONFIG_HOME = (Join-Path $h9 'xdg') }
    if ($r.Code -ne 0) { fail "XDG install failed: $($r.Out)" }
    foreach ($name in $FIVE) {
        if (-not (Is-Link (Join-Path $h9 'xdg' 'opencode' $name))) { fail "XDG: $name not linked" }
    }
    if (Test-Path -LiteralPath (Join-Path $h9 '.config')) { fail 'XDG install wrote under ~/.config' }

    # 9b. With opencode on PATH the config root is whatever `opencode debug paths config` prints.
    $h9b = New-ScratchHome 'h9b'
    $discovered = Join-Path $h9b 'discovered'
    New-Stub (Join-Path $h9b 'bin') 'opencode' @'
$global:LASTEXITCODE = 0
if ($args[0] -eq 'debug' -and $args[1] -eq 'paths' -and $args[2] -eq 'config') {
    Write-Output (Join-Path $env:HOME 'discovered')
    exit 0
}
exit 1
'@
    $r = Invoke-Flow $h9b @((Join-Path $h9b 'bin')) @('install')
    if ($r.Code -ne 0) { fail "install through the opencode stub failed: $($r.Out)" }
    foreach ($name in $FIVE) {
        if (-not (Is-Link (Join-Path $discovered $name))) { fail "discovery: $name not linked under the discovered root" }
    }
    if (Test-Path -LiteralPath (Join-Path $h9b '.config')) { fail 'discovery install wrote under ~/.config' }

    # 10. run: profile, argument order, shell setting, error cases.
    $h10 = New-ScratchHome 'h10'
    $runBin = Join-Path $TMP 'runbin'
    $r = Invoke-Flow $h10 @() @('install')
    if ($r.Code -ne 0) { fail "install failed for the run case: $($r.Out)" }
    New-Stub $runBin 'opencode' @'
$global:LASTEXITCODE = 0
if ($args[0] -eq 'debug' -and $args[1] -eq 'paths' -and $args[2] -eq 'config') {
    Write-Output ([IO.Path]::Combine($env:HOME, '.config', 'opencode'))
    exit 0
}
[Console]::Out.WriteLine("OPENCODE_CONFIG=$env:OPENCODE_CONFIG")
[Console]::Out.WriteLine("OPENCODE_CONFIG_CONTENT=$env:OPENCODE_CONFIG_CONTENT")
foreach ($a in $args) { [Console]::Out.WriteLine($a) }
if ($env:STUB_EXIT) { exit [int]$env:STUB_EXIT }
exit 0
'@
    $fakeBash = Join-Path $TMP 'bash'
    New-Item -ItemType File -Path $fakeBash | Out-Null
    $r = Invoke-Flow $h10 @($runBin) @('run', 'claude-agent', 'run', 'hello') @{ OPENCODE_GIT_BASH_PATH = $fakeBash }
    if ($r.Code -ne 0) { fail "run failed: $($r.Out)" }
    $profilePath = Join-Path (Cfg $h10) 'profiles' 'claude-agent.json'
    $want = @("OPENCODE_CONFIG=$profilePath", ('OPENCODE_CONFIG_CONTENT={"shell":"' + $fakeBash.Replace('\', '\\') + '"}'), 'run', 'hello', '--standalone')
    if (((Lines $r.Out) -join "`n") -ne ($want -join "`n")) { fail "run output differs: $($r.Out)" }
    # opencode flags (-c, -m, --model) must reach opencode, not bind to launcher parameters.
    $r = Invoke-Flow $h10 @($runBin) @('run', 'claude-agent', '-c', '-Command', '--model', 'x') @{ OPENCODE_GIT_BASH_PATH = $fakeBash }
    if ($r.Code -ne 0) { fail "run with flags failed: $($r.Out)" }
    if (((Lines $r.Out | Select-Object -Skip 2) -join ' ') -ne '-c -Command --model x --standalone') { fail "run did not pass flags through: $($r.Out)" }
    $r = Invoke-Flow $h10 @($runBin) @('run', 'nope') @{ OPENCODE_GIT_BASH_PATH = $fakeBash }
    if ($r.Code -eq 0) { fail 'run accepted an unknown profile' }
    if ($r.Out -notmatch "unknown profile 'nope'.*claude-agent.*opencode") { fail "unknown-profile message wrong: $($r.Out)" }
    # profiles/ links into the port, so profiles/../opencode.json is the real base config:
    # only the name check keeps `../opencode` from reaching opencode. `.hidden` has no real
    # target to hit, so it only checks the message and that opencode never starts.
    foreach ($bad in '../opencode', '.hidden', 'a\b') {
        $r = Invoke-Flow $h10 @($runBin) @('run', $bad, 'run', 'hello') @{ OPENCODE_GIT_BASH_PATH = $fakeBash }
        if ($r.Code -eq 0) { fail "run accepted the profile name $bad" }
        if (-not $r.Out.Contains("unknown profile '$bad'")) { fail "run ${bad}: unknown-profile message wrong: $($r.Out)" }
        if ($r.Out.Contains('OPENCODE_CONFIG=')) { fail "run $bad started opencode: $($r.Out)" }
    }
    $r = Invoke-Flow $h10 @() @('run', 'claude-agent') @{ OPENCODE_GIT_BASH_PATH = $fakeBash }
    if ($r.Code -eq 0) { fail 'run worked without opencode on PATH' }
    if ($r.Out -notmatch 'opencode') { fail "missing-opencode message does not mention opencode: $($r.Out)" }
    $noGit = New-Item -ItemType Directory -Path (Join-Path $TMP 'no-git')
    $r = Invoke-Flow $h10 @($runBin) @('run', 'claude-agent') @{ ProgramFiles = $noGit.FullName; 'ProgramFiles(x86)' = $noGit.FullName; LOCALAPPDATA = $noGit.FullName }
    if ($r.Code -ne 1) { fail "run without Git Bash exited $($r.Code), expected 1: $($r.Out)" }
    if (-not $r.Out.Contains('Git for Windows not found')) { fail "missing the Git for Windows message: $($r.Out)" }
    if ($r.Out.Contains('OPENCODE_CONFIG=')) { fail "run without Git Bash started opencode: $($r.Out)" }

    # 10a. Run in a live session must give OPENCODE_CONFIG and OPENCODE_CONFIG_CONTENT back; `exit` in a script
    # called with & ends the script, so the lines after the call must still print.
    $inproc = Join-Path $TMP 'run-inproc.ps1'
    [IO.File]::WriteAllText($inproc, "`$env:OPENCODE_CONFIG='before'; Remove-Item Env:OPENCODE_CONFIG_CONTENT -ErrorAction SilentlyContinue; & '$FLOW' run claude-agent hello | Out-Null; [Console]::Out.WriteLine(""AFTER_CONFIG=`$env:OPENCODE_CONFIG""); [Console]::Out.WriteLine(""AFTER_CONTENT_SET=`$(Test-Path Env:OPENCODE_CONFIG_CONTENT)"")`n")
    $r = Invoke-Flow $h10 @($runBin) @() @{ OPENCODE_GIT_BASH_PATH = $fakeBash } $inproc
    if (-not $r.Out.Contains('AFTER_CONFIG=before')) { fail "in-process run left OPENCODE_CONFIG changed: $($r.Out)" }
    if (-not $r.Out.Contains('AFTER_CONTENT_SET=False')) { fail "in-process run left OPENCODE_CONFIG_CONTENT set: $($r.Out)" }

    # 10b. OpenCode's non-zero exit code is the exit code of run, as a child process and in a live session.
    $r = Invoke-Flow $h10 @($runBin) @('run', 'claude-agent', 'hello') @{ OPENCODE_GIT_BASH_PATH = $fakeBash; STUB_EXIT = 7 }
    if ($r.Code -ne 7) { fail "run exited $($r.Code), expected opencode's 7: $($r.Out)" }
    $inprocExit = Join-Path $TMP 'run-inproc-exit.ps1'
    [IO.File]::WriteAllText($inprocExit, "& '$FLOW' run claude-agent hello | Out-Null; [Console]::Out.WriteLine(""RUN_EXIT=`$LASTEXITCODE"")`n")
    $r = Invoke-Flow $h10 @($runBin) @() @{ OPENCODE_GIT_BASH_PATH = $fakeBash; STUB_EXIT = 7 } $inprocExit
    if (-not $r.Out.Contains('RUN_EXIT=7')) { fail "in-process run did not leave opencode's exit code 7 in `$LASTEXITCODE: $($r.Out)" }

    # 11. doctor against a stub opencode answering from fixtures (Linux only: needs a launchable opencode and sleep).
    if ($IsWindows) {
        Write-Output 'skip: doctor stub scenarios run on Linux pwsh; Windows uses the real tool in tests/windows-ci-tools.ps1'
    } else {
        $h11 = New-ScratchHome 'h11'
        $r = Invoke-Flow $h11 @() @('install')
        if ($r.Code -ne 0) { fail "install failed for the doctor case: $($r.Out)" }
        $docBin = Join-Path $TMP 'docbin'
        New-ShStub $docBin 'opencode' @'
b=base
[ -z "${OPENCODE_CONFIG:-}" ] || b=$(basename "$OPENCODE_CONFIG" .json)
[ -z "${OPENCODE_CONFIG:-}" ] || printf '%s\n' "$OPENCODE_CONFIG" >> "$FIXTURE_DIR/configs.log"
case $1 in
  debug)
    case $2 in
      paths) echo "$HOME/.config/opencode" ;;
      *) cat "$FIXTURE_DIR/agents-$b.json" ;;
    esac ;;
  api)
    case $2 in
      --standalone) cat "$FIXTURE_DIR/model-$b.json" ;;
      --server) cat "$FIXTURE_DIR/skills.json" ;;
    esac ;;
  serve)
    [ -e "$FIXTURE_DIR/noserve" ] || echo 'server listening on http://127.0.0.1:1'
    exec sleep 60 ;;
esac
'@
        # The test image may carry no git; the doctor only needs `git init -q <dir>` to make a directory.
        New-ShStub $docBin 'git' 'if [ "$1" = init ]; then mkdir -p "$3"; fi'
        $fx = (New-Item -ItemType Directory -Path (Join-Path $TMP 'fx')).FullName
        $skillsPrefix = (Join-Path (Cfg $h11) 'skills')
        Make-Fixtures $fx $skillsPrefix
        $docEnv = @{ FIXTURE_DIR = $fx; FLOW_OPENCODE_SERVE_WAIT = '2' }
        function Run-Doctor() { Invoke-Flow $h11 @($docBin) @('doctor') $docEnv }

        # A: everything good.
        $r = Run-Doctor
        if ($r.Code -ne 0) { fail "doctor failed on good fixtures: $($r.Out)" }
        $version = (Get-Content -LiteralPath (Join-Path $ROOT 'VERSION') -First 1).Trim()
        if ((Lines $r.Out)[0] -ne "flow-skills $version") { fail "doctor A: first line is not the version: $($r.Out)" }
        foreach ($s in $skillNames) {
            if (-not $r.Out.Contains("ok: skill $s at ")) { fail "doctor A: no ok line for skill ${s}: $($r.Out)" }
        }
        foreach ($a in $agentNames) {
            if (-not $r.Out.Contains("ok: agent $a is a subagent")) { fail "doctor A: no ok line for agent ${a}: $($r.Out)" }
        }
        if (-not $r.Out.Contains('ok: profile claude-agent: flow-planner ->')) { fail "doctor A: no flow-planner mapping line: $($r.Out)" }
        if (-not ($r.Out.Contains('ok: profile claude-agent: main model') -or $r.Out.Contains('SKIP: profile claude-agent: main model'))) { fail "doctor A: no main model line: $($r.Out)" }
        if ($r.Out.Contains('FAIL')) { fail "doctor A: unexpected FAIL: $($r.Out)" }
        # The profiles checked are the installed ones, not the repository copies.
        $logged = @(Get-Content -LiteralPath (Join-Path $fx 'configs.log'))
        if ($logged.Count -eq 0) { fail 'doctor A: the stub saw no OPENCODE_CONFIG' }
        $profilesDir = Join-Path (Cfg $h11) 'profiles'
        foreach ($c in $logged) {
            if (-not $c.StartsWith($profilesDir + [IO.Path]::DirectorySeparatorChar)) { fail "doctor A: profile checked from $c, not the config root" }
        }

        # B: a missing agent.
        Edit-Json (Join-Path $fx 'agents-base.json') { param($d) , @($d | Where-Object { $_['id'] -ne 'flow-planner' }) }
        $r = Run-Doctor
        if ($r.Code -eq 0) { fail 'doctor B exited 0 with a missing agent' }
        if (-not $r.Out.Contains('FAIL: agent flow-planner')) { fail "doctor B: missing the agent FAIL: $($r.Out)" }

        # G: a resolved effort that differs from the profile, and a profile that names build.
        Make-Fixtures $fx $skillsPrefix
        $r = Run-Doctor
        if ($r.Code -ne 0) { fail "doctor G: failed on good fixtures: $($r.Out)" }
        if (-not $r.Out.Contains('ok: profile claude-agent: build -> claude-agent/opus#medium')) { fail "doctor G: no build mapping line with its effort: $($r.Out)" }
        if (-not $r.Out.Contains('ok: profile claude-agent: flow-planner -> claude-agent/fable#high')) { fail "doctor G: no flow-planner line with its effort: $($r.Out)" }
        Edit-Json (Join-Path $fx 'agents-claude-agent.json') {
            param($d)
            foreach ($row in $d) { if ($row['id'] -eq 'flow-planner') { $row['model']['variant'] = 'low' } }
            , $d
        }
        $r = Run-Doctor
        if ($r.Code -eq 0) { fail 'doctor G exited 0 with a wrong effort' }
        if (-not $r.Out.Contains('FAIL: profile claude-agent: flow-planner resolved to claude-agent/fable#low, expected claude-agent/fable#high')) { fail "doctor G: missing the effort FAIL: $($r.Out)" }

        # C: a skill loaded from outside the config root.
        Make-Fixtures $fx $skillsPrefix
        $foreignSkills = Join-Path $h11 '.claude' 'skills'
        Edit-Json (Join-Path $fx 'skills.json') {
            param($d)
            foreach ($s in $d['data']) { if ($s['id'] -eq $SKILL1) { $s['path'] = "$foreignSkills/$SKILL1/SKILL.md" } }
            $d
        }
        $r = Run-Doctor
        if ($r.Code -eq 0) { fail 'doctor C exited 0 with a foreign skill path' }
        if (-not $r.Out.Contains("FAIL: skill $SKILL1 loaded from")) { fail "doctor C: missing the loaded-from FAIL: $($r.Out)" }

        # D: the server never announces itself.
        Make-Fixtures $fx $skillsPrefix
        New-Item -ItemType File -Path (Join-Path $fx 'noserve') | Out-Null
        $r = Run-Doctor
        if ($r.Code -eq 0) { fail 'doctor D exited 0 without a server' }
        if ($r.Out -notmatch 'FAIL:.*server') { fail "doctor D: missing the server FAIL: $($r.Out)" }
        Remove-Item -LiteralPath (Join-Path $fx 'noserve')

        # E: a checker that crashes (skill list with an unexpected shape) is a FAIL.
        Make-Fixtures $fx $skillsPrefix
        [IO.File]::WriteAllText((Join-Path $fx 'skills.json'), "{`"data`": {`"flow-tdd`": {`"id`": `"flow-tdd`"}}}`n")
        $r = Run-Doctor
        if ($r.Code -eq 0) { fail "doctor E exited 0 although a checker crashed: $($r.Out)" }
        if (-not $r.Out.Contains('FAIL: checker Check-Skills exited ')) { fail "doctor E: no 'checker Check-Skills exited' line: $($r.Out)" }
        # Case F (a checker that prints nothing) has no counterpart here: the checkers are in-process
        # functions, so there is no interpreter to stub; the empty-output rule lives in Invoke-Check.

        # In-process doctor leaves the caller's OPENCODE_CONFIG and OPENCODE_PASSWORD as they were.
        $dw = Join-Path $TMP 'doctor-inproc.ps1'
        [IO.File]::WriteAllText($dw, "`$env:OPENCODE_CONFIG='before-cfg'; `$env:OPENCODE_PASSWORD='before-pw'; & '$FLOW' doctor | Out-Null; [Console]::Out.WriteLine(""CFG=`$env:OPENCODE_CONFIG""); [Console]::Out.WriteLine(""PW=`$env:OPENCODE_PASSWORD"")`n")
        $r = Invoke-Flow $h11 @($docBin) @() $docEnv $dw
        if (-not $r.Out.Contains('CFG=before-cfg') -or -not $r.Out.Contains('PW=before-pw')) { fail "doctor in-process did not restore the caller's variables: $($r.Out)" }
    }

    # 11a. Links into the checkout's previous name (omp-stack) are relinked, dangling
    # or not; a link anywhere else is still refused and left as it was.
    $to = New-ScratchHome 'old-root'
    $new = Join-Path $to 'flow-skills'
    $old = Join-Path $to 'omp-stack'
    foreach ($d in 'bin', 'skills', 'agents', 'profiles') { New-Item -ItemType Directory -Force -Path (Join-Path $new "opencode/$d") | Out-Null }
    Copy-Item -LiteralPath $FLOW -Destination (Join-Path $new 'opencode/bin/flow-opencode.ps1')
    $newFlow = Join-Path $new 'opencode/bin/flow-opencode.ps1'
    foreach ($name in 'AGENTS.md', 'opencode.json') { New-Item -ItemType File -Force -Path (Join-Path $new "opencode/$name") | Out-Null }
    $ho = Join-Path $to 'home-old'
    $cfgo = Cfg $ho
    New-Item -ItemType Directory -Force -Path $cfgo | Out-Null
    foreach ($name in $FIVE) {   # all dangling
        $isDir = $name -notin 'AGENTS.md', 'opencode.json'
        New-FixtureLink (Join-Path $old "ports/opencode/$name") (Join-Path $cfgo $name) -Dir:$isDir
    }
    $r = Invoke-Flow $ho @() @('install') @{} $newFlow
    if ($r.Code -ne 0) { fail "installer refused links into the previous checkout name: $($r.Out)" }
    if ((Count-Lines $r.Out '^linked ') -ne 5) { fail "previous-name relink: expected five linked lines, got: $($r.Out)" }
    foreach ($name in $FIVE) {
        if (-not (Same (Final (Join-Path $cfgo $name)) (Join-Path $new "opencode/$name"))) { fail "$name not relinked from the previous checkout name" }
    }
    $r = Invoke-Flow $ho @() @('verify') @{} $newFlow
    if ($r.Code -ne 0) { fail "verify after previous-name relink failed: $($r.Out)" }
    # A dangling link anywhere else is still refused and left as it was.
    $he = Join-Path $to 'home-else'
    $cfge = Cfg $he
    New-Item -ItemType Directory -Force -Path $cfge | Out-Null
    $danglingTarget = Join-Path $to 'elsewhere/agents'
    New-FixtureLink $danglingTarget (Join-Path $cfge 'agents') -Dir
    $r = Invoke-Flow $he @() @('install') @{} $newFlow
    if ($r.Code -eq 0) { fail 'installer replaced a dangling link outside both checkout names' }
    if (-not $r.Out.Contains('outside')) { fail "refusal did not say outside: $($r.Out)" }
    if ((RawTarget (Join-Path $cfge 'agents')) -ne $danglingTarget) { fail 'installer changed a foreign dangling link' }
    # A dangling link through a "/../" or "/./" segment, or ending in "/.." or "/.", under the previous name is refused too.
    foreach ($target in "$old/../elsewhere/agents", "$old/./elsewhere/agents", "$old/x/..", "$old/x/.") {
        $hd = Join-Path $to 'home-dots'
        if (Test-Path -LiteralPath $hd) { foreach ($l in Get-LinkPaths $hd) { Remove-LinkObject $l }; Remove-Item -Recurse -Force -LiteralPath $hd }
        $cfgd = Cfg $hd
        New-Item -ItemType Directory -Force -Path $cfgd | Out-Null
        New-FixtureLink $target (Join-Path $cfgd 'agents') -Dir
        # Windows stores an absolute target normalized, dropping the dot segment; the stored
        # target then decides: outside both roots is refused like any foreign link, under the
        # previous name it is a plain link install may replace (Assert-Owned, D4).
        $stored = RawTarget (Join-Path $cfgd 'agents')
        if ($stored -notmatch '[\\/]\.\.?([\\/]|$)' -and (Norm $stored).StartsWith((Norm $old) + [IO.Path]::DirectorySeparatorChar, $PathCompare)) {
            $r = Invoke-Flow $hd @() @('install') @{} $newFlow
            if ($r.Code -ne 0) { fail "installer refused $target stored as $stored under the previous name: $($r.Out)" }
            if (-not (Same (Final (Join-Path $cfgd 'agents')) (Join-Path $new 'opencode/agents'))) { fail "$target stored as $stored was not relinked" }
            Write-Output "ok: $target is stored as $stored, under the previous name, relinked"
            continue
        }
        $r = Invoke-Flow $hd @() @('install') @{} $newFlow
        if ($r.Code -eq 0) { fail "installer replaced a link to $target under the previous name" }
        if (-not $r.Out.Contains('outside')) { fail "refusal for $target did not say outside: $($r.Out)" }
        if ((RawTarget (Join-Path $cfgd 'agents')) -ne $stored) { fail "installer changed the link to $target" }
    }

    # 12. Called through a symlinked launcher, the installer still finds the port.
    $binDir = Join-Path $to 'bin'
    New-Item -ItemType Directory -Force -Path $binDir | Out-Null
    New-FixtureLink $FLOW (Join-Path $binDir 'flow-opencode.ps1')
    $hs = New-ScratchHome 'h-symlink'
    $r = Invoke-Flow $hs @() @('install') @{} (Join-Path $binDir 'flow-opencode.ps1')
    if ($r.Code -ne 0) { fail "install through a symlinked launcher failed: $($r.Out)" }
    if (-not (Same (Final (Join-Path (Cfg $hs) 'AGENTS.md')) (Join-Path $PORT 'AGENTS.md'))) { fail 'symlinked launcher linked the wrong port' }

    # 13. Windows only (plan D14): the symlink-permission stop and the Developer Mode path, with the privilege removed from the token.
    $elevated = $false
    if ($IsWindows) {
        $elevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    }
    if (-not $elevated) {
        Write-Output 'skip: Developer Mode scenarios need an elevated shell'
    } else {
        $regPath = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock'
        $valueName = 'AllowDevelopmentWithoutDevLicense'
        $prev = (Get-ItemProperty -Path $regPath -ErrorAction SilentlyContinue)?.$valueName
        $helper = Join-Path $PSScriptRoot 'without-symlink-privilege.ps1'
        $viaHelper = @('--', $PWSH, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $FLOW, 'install')
        try {
            if (-not (Test-Path -Path $regPath)) { New-Item -Path $regPath -Force | Out-Null }
            Set-ItemProperty -Path $regPath -Name $valueName -Value 1 -Type DWord
            $hd = New-ScratchHome 'home-devmode-on'
            $r = Invoke-Flow $hd @() $viaHelper @{} $helper
            if ($r.Code -ne 0) { fail "install with Developer Mode on and the privilege dropped failed: $($r.Out)" }
            if (-not (Is-Link (Join-Path (Cfg $hd) 'skills'))) { fail 'Developer Mode install did not create a symlink' }
            Write-Output 'ok: Developer Mode link'

            Set-ItemProperty -Path $regPath -Name $valueName -Value 0 -Type DWord
            $hz = New-ScratchHome 'home-devmode-off'
            $r = Invoke-Flow $hz @() $viaHelper @{} $helper
            if ($r.Code -ne 1) { fail "install without Developer Mode exited $($r.Code), expected 1: $($r.Out)" }
            if (-not $r.Out.Contains('enable Windows Developer Mode')) { fail "stop message missing: $($r.Out)" }
            # pwsh itself caches startup data under the child's AppData; that is not the installer's doing.
            $left = @(Get-ChildItem -Force -Recurse -LiteralPath $hz | ForEach-Object FullName | Where-Object { $_.Substring($hz.Length) -notmatch '^[\\/]AppData([\\/]Local([\\/]Microsoft([\\/]PowerShell([\\/]StartupProfileData-[^\\/]+)?)?)?)?$' })
            if ($left.Count -ne 0) { fail "install changed the home before stopping: $($left -join ', ')" }
            Write-Output 'ok: Developer Mode stop'
        } finally {
            if ($null -eq $prev) { Remove-ItemProperty -Path $regPath -Name $valueName -ErrorAction SilentlyContinue }
            else { Set-ItemProperty -Path $regPath -Name $valueName -Value $prev -Type DWord }
        }
    }

    Write-Output 'ok: PowerShell OpenCode installer safety/idempotence'
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    $rc = 1
} finally {
    foreach ($l in @(Get-LinkPaths $TMP)) { try { Remove-LinkObject $l } catch { } }
    Remove-Item -Recurse -Force -LiteralPath $TMP -ErrorAction SilentlyContinue
}
exit $rc
