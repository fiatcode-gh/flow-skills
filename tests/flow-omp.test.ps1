#Requires -Version 7.2
# PowerShell counterpart of tests/install.test.sh; scenarios keep its order.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ROOT = Split-Path -Parent $PSScriptRoot
$OMP = Join-Path $ROOT 'omp'
$FLOW = Join-Path $OMP 'bin/flow-omp.ps1'
$PWSH = (Get-Process -Id $PID).Path
$LINKED = 'AGENTS.md', 'TITLE_SYSTEM.md', 'agents', 'rules', 'skills', 'extensions', 'lib'
$PROFILES = 'openai-codex', 'anthropic', 'commandcode'
$PathCompare = $IsWindows ? [StringComparison]::OrdinalIgnoreCase : [StringComparison]::Ordinal
$TMP = (New-Item -ItemType Directory -Path (Join-Path ([IO.Path]::GetTempPath()) "flow-omp-test-$([guid]::NewGuid().ToString('N'))")).FullName

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

function New-OmpStub([string]$dir, [string]$body) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    [IO.File]::WriteAllText((Join-Path $dir 'omp.ps1'), $body)
}

function New-ScratchHome([string]$name) {
    (New-Item -ItemType Directory -Path (Join-Path $TMP $name)).FullName
}

$rc = 0
try {
    # install.test.sh 9-27: a divergent profile config is refused while everything else links.
    $h = New-ScratchHome 'home'
    $agentDir = Join-Path $h '.omp/agent'
    $ccAgent = Join-Path $h '.omp/profiles/commandcode/agent'
    New-Item -ItemType Directory -Force -Path $agentDir, $ccAgent | Out-Null
    Set-Content -LiteralPath (Join-Path $agentDir 'AGENTS.md') -Value 'default sentinel'
    Set-Content -LiteralPath (Join-Path $ccAgent 'config.yml') -Value 'modelRoles:', '  default: sentinel/model'
    $divergentBefore = [IO.File]::ReadAllBytes((Join-Path $ccAgent 'config.yml'))
    $r = Invoke-Flow $h @() @('install')
    if ($r.Code -eq 0) { fail 'installer accepted a divergent profile config' }
    if (-not [Linq.Enumerable]::SequenceEqual($divergentBefore, [IO.File]::ReadAllBytes((Join-Path $ccAgent 'config.yml')))) { fail 'divergent config changed' }
    if (Is-Link (Join-Path $ccAgent 'config.yml')) { fail 'divergent config became a link' }
    foreach ($p in 'openai-codex', 'anthropic') {
        $c = Join-Path $h ".omp/profiles/$p/agent/config.yml"
        if (-not (Is-Link $c)) { fail "$p config.yml is not a link" }
    }
    if ((Get-Content -LiteralPath (Join-Path $agentDir 'AGENTS.md') -Raw) -notmatch 'default sentinel') { fail 'default profile sentinel changed' }

    # install.test.sh 29-42: an identical copy relinks, repeat installs are idempotent, verify passes.
    Copy-Item -LiteralPath (Join-Path $OMP 'profiles/commandcode/config.yml') -Destination (Join-Path $ccAgent 'config.yml') -Force
    foreach ($i in 1, 2) {
        $r = Invoke-Flow $h @() @('install')
        if ($r.Code -ne 0) { fail "install run $i failed: $($r.Out)" }
    }
    foreach ($p in $PROFILES) {
        foreach ($name in $LINKED + 'config.yml') {
            $link = Join-Path $h ".omp/profiles/$p/agent/$name"
            if (-not (Is-Link $link)) { fail "$link is not a link" }
            $expected = $name -eq 'config.yml' ? (Join-Path $OMP "profiles/$p/config.yml") : (Join-Path $OMP $name)
            if (-not (Same (Final $link) $expected)) { fail "$link does not point at $expected" }
        }
        if (-not [Linq.Enumerable]::SequenceEqual([IO.File]::ReadAllBytes((Join-Path $OMP "profiles/$p/config.yml")), [IO.File]::ReadAllBytes((Join-Path $h ".omp/profiles/$p/agent/config.yml")))) { fail "$p config.yml differs from its template" }
    }
    if (-not (Same (Final (Join-Path $h '.omp/agent/keybindings.yml')) (Join-Path $OMP 'keybindings.yml'))) { fail 'shared keybindings.yml not linked' }
    $r = Invoke-Flow $h @() @('verify')
    if ($r.Code -ne 0) { fail "verify failed: $($r.Out)" }

    # install.test.sh 44-46: doctor names the repository version on its first line.
    $r = Invoke-Flow $h @() @('doctor')
    $version = (Get-Content -LiteralPath (Join-Path $ROOT 'VERSION') -First 1).Trim()
    $first = ($r.Out -split "\r?\n")[0]
    if ($first -ne "flow-skills $version") { fail "omp doctor first line is not the version: $($r.Out)" }

    # install.test.sh 48-56: PI_CONFIG_DIR is honoured in fallback mode; PI_CODING_AGENT_DIR is not.
    $hc = New-ScratchHome 'home-cfg'
    $r = Invoke-Flow $hc @() @('install') @{ PI_CONFIG_DIR = '.custom'; PI_CODING_AGENT_DIR = (Join-Path $hc 'ignored') }
    if ($r.Code -ne 0) { fail "install with PI_CONFIG_DIR failed: $($r.Out)" }
    foreach ($p in $PROFILES) {
        if (-not (Is-Link (Join-Path $hc ".custom/profiles/$p/agent/skills"))) { fail "$p skills not linked under .custom" }
    }
    if (Test-Path -LiteralPath (Join-Path $hc 'ignored/skills')) { fail 'PI_CODING_AGENT_DIR was used' }

    # install.test.sh 58-75: with omp available, profile roots come from `omp --profile ... config path`.
    $stubNative = @'
$global:LASTEXITCODE = 0
Write-Output ([IO.Path]::Combine($env:HOME, 'native', $args[1], 'agent'))
exit 0
'@
    $hn = New-ScratchHome 'home-native'
    New-OmpStub (Join-Path $hn 'bin') $stubNative
    $r = Invoke-Flow $hn @((Join-Path $hn 'bin')) @('install')
    if ($r.Code -ne 0) { fail "install through the omp stub failed: $($r.Out)" }
    foreach ($p in $PROFILES) {
        if (-not (Is-Link (Join-Path $hn "native/$p/agent/skills"))) { fail "$p skills not linked through the omp stub" }
    }

    # install.test.sh 77-85: a real managed-surface directory is refused.
    $h2 = New-ScratchHome 'home-realdir'
    $realSkills = Join-Path $h2 '.omp/profiles/commandcode/agent/skills'
    New-Item -ItemType Directory -Force -Path $realSkills | Out-Null
    $r = Invoke-Flow $h2 @() @('install')
    if ($r.Code -eq 0) { fail 'installer overwrote/accepted real profile skills directory' }
    if (Is-Link $realSkills) { fail 'real skills directory became a link' }
    if ($r.Out -notmatch 'exists and is not a symlink') { fail "refusal did not say the directory is not a symlink: $($r.Out)" }

    # install.test.sh 87-115: a symlink outside the repository is refused and left alone; one into it is relinked.
    $hl = New-ScratchHome 'link-home'
    $anAgent = Join-Path $hl '.omp/profiles/anthropic/agent'
    New-Item -ItemType Directory -Force -Path $anAgent, (Join-Path $hl 'elsewhere') | Out-Null
    $foreign = Join-Path $anAgent 'skills'
    $elsewhere = Join-Path $hl 'elsewhere'
    New-FixtureLink $elsewhere $foreign
    $r = Invoke-Flow $hl @() @('install')
    if ($r.Code -eq 0) { fail 'installer replaced a symlink that points outside the repository' }
    if ((RawTarget $foreign) -ne $elsewhere) { fail 'installer changed a foreign symlink' }
    if (-not $r.Out.Contains("$foreign is a symlink to $elsewhere")) { fail "refusal did not name the link and its target: $($r.Out)" }
    Remove-LinkObject $foreign
    New-FixtureLink (Join-Path $OMP 'rules') $foreign
    $r = Invoke-Flow $hl @() @('install')
    if ($r.Code -ne 0) { fail "installer refused a symlink into the repository: $($r.Out)" }
    if (-not (Same (Final $foreign) (Join-Path $OMP 'skills'))) { fail 'installer did not relink a symlink into the repository' }
    # A relative link that climbs out of the repository and a dangling link are refused the same way.
    foreach ($target in '../../../../../elsewhere', (Join-Path $hl 'missing-target')) {
        Remove-LinkObject $foreign
        New-FixtureLink $target $foreign   # dangling: file link, the installer must refuse either flavour
        $r = Invoke-Flow $hl @() @('install')
        if ($r.Code -eq 0) { fail "installer replaced a symlink to $target" }
        if ((RawTarget $foreign) -ne $target) { fail "installer changed the symlink to $target" }
    }

    # install.test.sh 117-155: an unresolvable profile, at any position, stops every command before anything links.
    $stubBad = @'
$global:LASTEXITCODE = 0
if ($args[1] -eq $env:STUB_BAD) {
    switch ($env:STUB_MODE) {
        'fail' { exit 1 }
        'empty' { exit 0 }
        'root' { Write-Output '/'; exit 0 }
        'slashes' { Write-Output '//'; exit 0 }
    }
}
Write-Output ([IO.Path]::Combine($env:HOME, 'native', $args[1], 'agent'))
exit 0
'@
    $badBin = Join-Path $TMP 'bad-bin'
    New-OmpStub $badBin $stubBad
    foreach ($mode in 'fail', 'empty', 'root', 'slashes') {
        foreach ($bad in $PROFILES) {
            foreach ($cmd in 'install', 'verify', 'doctor') {
                $hb = New-ScratchHome "home-$mode-$bad-$cmd"
                $r = Invoke-Flow $hb @($badBin) @($cmd) @{ STUB_MODE = $mode; STUB_BAD = $bad }
                if ($r.Code -eq 0) { fail "$cmd succeeded with unresolvable profile $bad ($mode)" }
                if ($r.Out -match 'linked') { fail "$cmd printed a link line with unresolvable profile $bad ($mode)" }
                if (-not $r.Out.Contains("'$bad'")) { fail "$cmd did not name unresolvable profile $bad ($mode): $($r.Out)" }
                if (@(Get-LinkPaths $hb).Count -ne 0) { fail "$cmd linked something with unresolvable profile $bad ($mode)" }
            }
        }
    }

    # install.test.sh 156-194: links into the previous checkout name (omp-stack) relink; other dangling links stay refused.
    $to = New-ScratchHome 'old-root'
    $new = Join-Path $to 'flow-skills'
    $old = Join-Path $to 'omp-stack'
    foreach ($d in 'bin', 'agents', 'rules', 'skills', 'extensions', 'lib') { New-Item -ItemType Directory -Force -Path (Join-Path $new "omp/$d") | Out-Null }
    Copy-Item -LiteralPath $FLOW -Destination (Join-Path $new 'omp/bin/flow-omp.ps1')
    $newFlow = Join-Path $new 'omp/bin/flow-omp.ps1'
    foreach ($name in 'AGENTS.md', 'TITLE_SYSTEM.md', 'keybindings.yml') { New-Item -ItemType File -Force -Path (Join-Path $new "omp/$name") | Out-Null }
    $ho = Join-Path $to 'home'
    foreach ($p in $PROFILES) {
        New-Item -ItemType Directory -Force -Path (Join-Path $new "omp/profiles/$p"), (Join-Path $ho ".omp/profiles/$p/agent") | Out-Null
        New-Item -ItemType File -Force -Path (Join-Path $new "omp/profiles/$p/config.yml") | Out-Null
    }
    New-Item -ItemType Directory -Force -Path (Join-Path $ho '.omp/agent'), (Join-Path $old 'agent/rules') | Out-Null
    $oa = Join-Path $ho '.omp/profiles/anthropic/agent'
    foreach ($name in $LINKED) {   # dangling except rules
        $isDir = $name -notin 'AGENTS.md', 'TITLE_SYSTEM.md'
        New-FixtureLink (Join-Path $old "agent/$name") (Join-Path $oa $name) -Dir:$isDir
    }
    New-FixtureLink (Join-Path $old 'profiles/anthropic/config.yml') (Join-Path $oa 'config.yml')
    New-FixtureLink (Join-Path $old 'agent/keybindings.yml') (Join-Path $ho '.omp/agent/keybindings.yml')
    $r = Invoke-Flow $ho @() @('install') @{} $newFlow
    if ($r.Code -ne 0) { fail "installer refused links into the previous checkout name: $($r.Out)" }
    foreach ($name in $LINKED) {
        if (-not (Same (Final (Join-Path $oa $name)) (Join-Path $new "omp/$name"))) { fail "$name not relinked from the previous checkout name" }
    }
    if (-not (Same (Final (Join-Path $oa 'config.yml')) (Join-Path $new 'omp/profiles/anthropic/config.yml'))) { fail 'config.yml not relinked from the previous checkout name' }
    if (-not (Same (Final (Join-Path $ho '.omp/agent/keybindings.yml')) (Join-Path $new 'omp/keybindings.yml'))) { fail 'keybindings.yml not relinked from the previous checkout name' }
    $r = Invoke-Flow $ho @() @('verify') @{} $newFlow
    if ($r.Code -ne 0) { fail "verify after the old-root relink failed: $($r.Out)" }
    # A dangling link anywhere else is still refused and left as it was.
    $h2b = Join-Path $to 'home2'
    $a2 = Join-Path $h2b '.omp/profiles/anthropic/agent'
    New-Item -ItemType Directory -Force -Path $a2 | Out-Null
    $danglingTarget = Join-Path $to 'elsewhere/skills'
    New-FixtureLink $danglingTarget (Join-Path $a2 'skills') -Dir
    $r = Invoke-Flow $h2b @() @('install') @{} $newFlow
    if ($r.Code -eq 0) { fail 'installer replaced a dangling link outside both checkout names' }
    if (-not $r.Out.Contains("outside $(Norm $new)")) { fail "refusal did not name the root: $($r.Out)" }
    if ((RawTarget (Join-Path $a2 'skills')) -ne $danglingTarget) { fail 'installer changed a foreign dangling link' }
    # A dangling link through a "/../" or "/./" segment, or ending in "/.." or "/.", under the previous name is refused too.
    foreach ($target in "$old/../elsewhere/skills", "$old/./elsewhere/skills", "$old/x/..", "$old/x/.") {
        $h3 = Join-Path $to 'home3'
        if (Test-Path -LiteralPath $h3) { foreach ($l in Get-LinkPaths $h3) { Remove-LinkObject $l }; Remove-Item -Recurse -Force -LiteralPath $h3 }
        $a3 = Join-Path $h3 '.omp/profiles/anthropic/agent'
        New-Item -ItemType Directory -Force -Path $a3 | Out-Null
        New-FixtureLink $target (Join-Path $a3 'skills') -Dir
        # Windows stores an absolute target normalized, dropping the dot segment; such a
        # link is a plain link under the previous name, which install may replace.
        $stored = RawTarget (Join-Path $a3 'skills')
        if ($stored -notmatch '[\\/]\.\.?([\\/]|$)') { Write-Output "skip: $target is stored as $stored (no dot segment left)"; continue }
        $r = Invoke-Flow $h3 @() @('install') @{} $newFlow
        if ($r.Code -eq 0) { fail "installer replaced a link to $target under the previous name" }
        if (-not $r.Out.Contains("outside $(Norm $new)")) { fail "refusal for $target did not name the root: $($r.Out)" }
        if ((RawTarget (Join-Path $a3 'skills')) -ne $stored) { fail "installer changed the link to $target" }
    }

    # install.test.sh 195-198: called through a symlinked launcher, the installer still finds the checkout.
    $binDir = Join-Path $to 'bin'
    New-Item -ItemType Directory -Force -Path $binDir | Out-Null
    New-FixtureLink $FLOW (Join-Path $binDir 'flow-omp.ps1')
    $hs = New-ScratchHome 'home-symlink'
    $r = Invoke-Flow $hs @() @('install') @{} (Join-Path $binDir 'flow-omp.ps1')
    if ($r.Code -ne 0) { fail "install through a symlinked launcher failed: $($r.Out)" }
    if (-not (Same (Final (Join-Path $hs '.omp/profiles/anthropic/agent/AGENTS.md')) (Join-Path $OMP 'AGENTS.md'))) { fail 'symlinked launcher linked the wrong checkout' }

    # Windows only (plan D14): the symlink-permission stop and the Developer Mode path, with the privilege removed from the token.
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
            if (-not (Is-Link (Join-Path $hd '.omp/profiles/anthropic/agent/skills'))) { fail 'Developer Mode install did not create a symlink' }
            Write-Output 'ok: Developer Mode link'

            Set-ItemProperty -Path $regPath -Name $valueName -Value 0 -Type DWord
            $hz = New-ScratchHome 'home-devmode-off'
            $r = Invoke-Flow $hz @() $viaHelper @{} $helper
            if ($r.Code -ne 1) { fail "install without Developer Mode exited $($r.Code), expected 1: $($r.Out)" }
            if (-not $r.Out.Contains('enable Windows Developer Mode')) { fail "stop message missing: $($r.Out)" }
            if (@(Get-ChildItem -Force -LiteralPath $hz).Count -ne 0) { fail 'install changed the home before stopping' }
            Write-Output 'ok: Developer Mode stop'
        } finally {
            if ($null -eq $prev) { Remove-ItemProperty -Path $regPath -Name $valueName -ErrorAction SilentlyContinue }
            else { Set-ItemProperty -Path $regPath -Name $valueName -Value $prev -Type DWord }
        }
    }

    Write-Output 'ok: PowerShell OMP installer safety/idempotence'
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    $rc = 1
} finally {
    foreach ($l in @(Get-LinkPaths $TMP)) { try { Remove-LinkObject $l } catch { } }
    Remove-Item -Recurse -Force -LiteralPath $TMP -ErrorAction SilentlyContinue
}
exit $rc
