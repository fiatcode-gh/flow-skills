#Requires -Version 7.2
# Windows equivalent of flow-omp: install | verify | doctor. See docs/WINDOWS.md.
[CmdletBinding()]
param([Parameter(Position = 0)][string]$Command)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# The real path of a file, directory or link, as `readlink -f` gives it, or $null when it cannot be found.
function Get-PhysicalPath([string]$p) {
    $readlink = @('/usr/bin/readlink', '/bin/readlink') | Where-Object { [IO.File]::Exists($_) } | Select-Object -First 1
    if (-not $readlink) { $readlink = 'readlink' }
    $global:LASTEXITCODE = 0
    try { $out = (& $readlink -f -- $p 2>$null | Out-String).Trim() } catch { return $null }
    if ($LASTEXITCODE -ne 0 -or -not $out) { return $null }
    $out
}

# Resolve a symlinked launcher (e.g. one on PATH) to its checkout.
$Self = Get-Item -LiteralPath $PSCommandPath -Force
if ($Self.LinkType) { $Self = [IO.File]::ResolveLinkTarget($PSCommandPath, $true) }
$HERE = $Self.DirectoryName
# Like sh (readlink -f), everything is derived from the real path of the checkout, so the ownership
# check and the links agree when the checkout is reached through a symlinked folder.
if (-not $IsWindows) {
    $physical = Get-PhysicalPath $PSCommandPath
    if ($physical) { $HERE = [IO.Path]::GetDirectoryName($physical) }
}
$OMP = [IO.Path]::GetFullPath((Join-Path $HERE '..'))
$ROOT = [IO.Path]::GetFullPath((Join-Path $HERE '..' '..'))
# Links into the checkout's previous name are repointed too (renamed from omp-stack on 2026-11-02).
$OLD_ROOT = Join-Path ([IO.Path]::GetDirectoryName($ROOT)) 'omp-stack'
$PROFILES = 'openai-codex', 'anthropic', 'commandcode'
$LINKED = 'AGENTS.md', 'TITLE_SYSTEM.md', 'agents', 'rules', 'skills', 'extensions', 'lib'
$PathCompare = $IsWindows ? [StringComparison]::OrdinalIgnoreCase : [StringComparison]::Ordinal

# Written to the console directly so step functions can print and still return their 0/1 status.
function Info([string]$msg) { [Console]::Out.WriteLine($msg) }
function Fail([string]$msg) { [Console]::Error.WriteLine("error: $msg"); exit 1 }

$HomeDir = $IsWindows ? $env:USERPROFILE : $env:HOME
if (-not $HomeDir) { Fail 'HOME is not set' }

function Normalize([string]$p) {
    [IO.Path]::GetFullPath($p).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
}

# A link destination must never be empty or the filesystem root.
function Test-Rooted([string]$p) {
    [IO.Path]::IsPathRooted($p) -and (Normalize $p) -ne (Normalize ([IO.Path]::GetPathRoot($p)))
}

function Get-ProfileDir([string]$profileName) {
    if (Get-Command omp -ErrorAction SilentlyContinue) {
        $global:LASTEXITCODE = 0
        $dir = (& omp --profile $profileName config path 2>$null | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) { Fail "could not resolve OMP profile '$profileName'" }
    } else {
        $dir = Join-Path $HomeDir ($env:PI_CONFIG_DIR ? $env:PI_CONFIG_DIR : '.omp') 'profiles' $profileName 'agent'
    }
    if (-not (Test-Rooted $dir)) { Fail "OMP profile '$profileName' resolved to unusable directory '$dir'" }
    $dir
}

# Resolves every profile before acting, so one unresolvable profile changes
# nothing. Then runs <preflight> once, <shared-step> <first-agent-dir> once and
# <profile-step> <profile> <agent-dir> per profile; returns 1 if any step did.
function Invoke-EachProfile([scriptblock]$sharedStep, [scriptblock]$profileStep, [scriptblock]$preflight = $null) {
    $dirs = [ordered]@{}
    foreach ($profileName in $PROFILES) { $dirs[$profileName] = Get-ProfileDir $profileName }
    if ($preflight) { & $preflight }
    $erc = 0
    $first = $dirs[$PROFILES[0]]
    if ((& $sharedStep $first) -eq 1) { $erc = 1 }
    foreach ($profileName in $PROFILES) {
        if ((& $profileStep $profileName $dirs[$profileName]) -eq 1) { $erc = 1 }
    }
    $erc
}

# <config-root>\agent, derived from a profile agent dir.
function Get-SharedDir([string]$agentDir) {
    $configRoot = [IO.Path]::GetDirectoryName([IO.Path]::GetDirectoryName([IO.Path]::GetDirectoryName($agentDir)))
    if (-not (Test-Rooted $configRoot)) { Fail "cannot derive the shared agent directory from '$agentDir'" }
    Join-Path $configRoot 'agent'
}

function Get-LinkType([string]$p) {
    (Get-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue)?.LinkType
}

# True when the link leads to something that exists. The OS follows the link and decides, so a ".."
# behind a missing directory counts as dangling. It says nothing about where the link ends up.
# A directory cannot be opened as a file (access denied) but it exists; a missing target does not.
function Test-LinkResolves([string]$dst) {
    try { [IO.File]::OpenHandle($dst).Dispose(); $true }
    catch { ($_.Exception.InnerException ?? $_.Exception) -is [UnauthorizedAccessException] }
}

# Final is where the link really ends. On Windows .NET asks the OS for it. Elsewhere every resolving
# link is resolved by the OS, as the sh installer does, because .NET collapses ".." as text, which
# differs from the real path behind a symlinked directory; Final stays $null if that fails, and the
# caller refuses it. A link that does not resolve keeps .NET's text answer, which is only shown.
function Get-LinkTarget([string]$dst) {
    $item = Get-Item -LiteralPath $dst -Force
    $raw = $item.LinkTarget
    try { $final = [IO.File]::ResolveLinkTarget($dst, $true).FullName } catch { $final = $null }
    if (-not $final) { $final = [IO.Path]::GetFullPath($raw, (Split-Path $dst -Parent)) }
    $resolved = Test-LinkResolves $dst
    if ($resolved -and -not $IsWindows) { $final = Get-PhysicalPath $dst }
    @{ Raw = $raw; Final = $final; Resolved = $resolved }
}

# The exact set the sh case refuses: /../, /./, a trailing /.. or /. (either separator).
function Test-DotSegments([string]$raw) { $raw -match '[\\/]\.\.?([\\/]|$)' }

function Test-UnderOrEqual([string]$path, [string]$base) {
    $p = Normalize $path
    $b = Normalize $base
    [string]::Equals($p, $b, $PathCompare) -or $p.StartsWith($b + [IO.Path]::DirectorySeparatorChar, $PathCompare)
}

function Remove-LinkObject([string]$p) {
    if ((Get-Item -LiteralPath $p -Force).PSIsContainer) { [IO.Directory]::Delete($p) } else { [IO.File]::Delete($p) }
}

# Replaces only a missing destination or a symlink into this repository or its previous name.
# Like the sh rule, a dot segment in the raw target only refuses a link that does not resolve.
function Assert-Owned([string]$src, [string]$dst) {
    if (-not (Test-Path -LiteralPath $src)) { Fail "missing source $src" }
    $exists = [IO.File]::Exists($dst) -or [IO.Directory]::Exists($dst) -or [bool](Get-LinkType $dst)
    if (-not $exists) { return }
    if (Get-LinkType $dst) {
        $t = Get-LinkTarget $dst
        $shown = $t.Final ?? $t.Raw
        $outside = -not $t.Final -or -not ((Test-UnderOrEqual $t.Final $ROOT) -or (Test-UnderOrEqual $t.Final $OLD_ROOT))
        if ($outside -or (-not $t.Resolved -and (Test-DotSegments $t.Raw))) {
            Fail "$dst is a symlink to $shown, outside $ROOT; move or remove it manually"
        }
    } else {
        Fail "$dst exists and is not a symlink; move/merge it manually"
    }
}

function New-Link([string]$src, [string]$dst) {
    try {
        if (Get-LinkType $dst) { Remove-LinkObject $dst }
        if (Test-Path -LiteralPath $src -PathType Container) {
            [void][IO.Directory]::CreateSymbolicLink($dst, $src)
        } else {
            [void][IO.File]::CreateSymbolicLink($dst, $src)
        }
    } catch {
        Fail "could not link $dst -> ${src}: $($_.Exception.Message)"
    }
    Info "linked $dst -> $src"
}

function Link-Owned([string]$src, [string]$dst) {
    Assert-Owned $src $dst
    New-Link $src $dst
}

# Windows only: stop before changing anything when this process may not create symlinks.
function Test-SymlinkPermission {
    if (-not $IsWindows) { return }
    $probe = Join-Path ([IO.Path]::GetTempPath()) "flow-symlink-probe-$([guid]::NewGuid().ToString('N'))"
    try {
        [void][IO.File]::CreateSymbolicLink($probe, $PSCommandPath)
    } catch {
        # PowerShell wraps .NET method errors; the Win32 error code is on the inner exception.
        $err = $_.Exception.GetBaseException()
        if ($err.HResult -eq -2147023582) {  # 0x80070522, ERROR_PRIVILEGE_NOT_HELD
            Fail 'cannot create symlinks: enable Windows Developer Mode (Settings > System > For developers) or run this from an elevated PowerShell; nothing was changed'
        }
        Fail "symlink probe failed: $($err.Message)"
    } finally {
        if (Get-LinkType $probe) { [IO.File]::Delete($probe) }
    }
}

function Link-Config([string]$profileName, [string]$dir) {
    $cfg = Join-Path $dir 'config.yml'
    $template = Join-Path $OMP 'profiles' $profileName 'config.yml'
    if ((Get-LinkType $cfg) -or -not [IO.File]::Exists($cfg)) {
        Link-Owned $template $cfg
        return 0
    }
    if ([Linq.Enumerable]::SequenceEqual([IO.File]::ReadAllBytes($cfg), [IO.File]::ReadAllBytes($template))) {
        [IO.File]::Delete($cfg)
        New-Link $template $cfg
        Info "replaced identical copy: $cfg -> $template"
        return 0
    }
    Info "WARN: $cfg differs from $template; left untouched (merge it, then rerun install)"
    return 1
}

function Install-Profile([string]$profileName, [string]$dir) {
    try { New-Item -ItemType Directory -Force -Path $dir | Out-Null } catch { Fail "could not create $dir" }
    foreach ($name in $LINKED) { Link-Owned (Join-Path $OMP $name) (Join-Path $dir $name) }
    $prc = Link-Config $profileName $dir
    Info "left $(Join-Path $dir 'mcp.json') untouched; optional example: $(Join-Path $OMP 'mcp.example.json')"
    return $prc
}

function Install-Shared([string]$firstDir) {
    $shared = Get-SharedDir $firstDir
    try { New-Item -ItemType Directory -Force -Path $shared | Out-Null } catch { Fail "could not create $shared" }
    Link-Owned (Join-Path $OMP 'keybindings.yml') (Join-Path $shared 'keybindings.yml')
    return 0
}

function Install {
    $rc = Invoke-EachProfile { Install-Shared $args[0] } { Install-Profile $args[0] $args[1] } { Test-SymlinkPermission }
    if ($rc -ne 0) { Info 'one or more profile configs diverge from their template; nothing was overwritten' }
    $rc
}

function Verify-Link([string]$src, [string]$dst) {
    $want = $IsWindows ? (Normalize $src) : ((Get-PhysicalPath $src) ?? (Normalize $src))
    if (Get-LinkType $dst) {
        $final = Final-Target $dst
        if ($final -and [string]::Equals($final, $want, $PathCompare)) {
            Info "ok: $dst"
            return 0
        }
        Info "FAIL: $dst -> $($final ?? 'dangling'), expected $want"
        return 1
    }
    Info "FAIL: $dst is not a symlink"
    return 1
}

function Final-Target([string]$dst) {
    if (-not $IsWindows) { return Get-PhysicalPath $dst }
    try { [IO.File]::ResolveLinkTarget($dst, $true)?.FullName } catch { $null }
}

function Verify-Profile([string]$profileName, [string]$dir) {
    $prc = 0
    Info "profile: $profileName ($dir)"
    foreach ($name in $LINKED) {
        if ((Verify-Link (Join-Path $OMP $name) (Join-Path $dir $name)) -eq 1) { $prc = 1 }
    }
    if ((Verify-Link (Join-Path $OMP 'profiles' $profileName 'config.yml') (Join-Path $dir 'config.yml')) -eq 1) { $prc = 1 }
    return $prc
}

function Verify-Shared([string]$firstDir) {
    Verify-Link (Join-Path $OMP 'keybindings.yml') (Join-Path (Get-SharedDir $firstDir) 'keybindings.yml')
}

function Verify {
    Invoke-EachProfile { Verify-Shared $args[0] } { Verify-Profile $args[0] $args[1] }
}

function Doctor-Profile([string]$profileName, [string]$dir) {
    $cfg = Join-Path $dir 'config.yml'
    if (-not [IO.File]::Exists($cfg)) { Fail "$cfg not found" }

    Info "profile: $profileName"
    Info "config: $cfg"
    if (Select-String -LiteralPath $cfg -Pattern 'ai-stack/.*/flow-skills\.ts|ai-stack/omp/extensions/flow-skills\.ts' -Quiet) {
        Info 'WARN: remove old ai-stack flow-skills.ts registration'
    } else {
        Info 'ok: no old flow-skills.ts registration'
    }
    if (Select-String -LiteralPath $cfg -Pattern 'ai-stack/shared/skills' -Quiet) {
        Info 'WARN: remove old skills.customDirectories entry pointing at ai-stack/shared/skills'
    } else {
        Info 'ok: no old ai-stack shared-skills registration'
    }
    if (Select-String -LiteralPath $cfg -Pattern 'ai-stack/omp/extensions/ai-memory\.ts' -Quiet) {
        Info 'WARN: explicit old ai-memory.ts path is redundant; native extensions/ auto-discovery owns it now'
    }

    foreach ($role in 'default', 'smol', 'tiny', 'vision', 'execute', 'task', 'plan', 'slow', 'review_aux', 'critical', 'commit') {
        if (Select-String -LiteralPath $cfg -Pattern "^\s+${role}:" -Quiet) { Info "ok: modelRoles.$role present" } else { Info "WARN: modelRoles.$role missing" }
    }

    if (Select-String -LiteralPath $cfg -Pattern '^\s+enableEffort:\s+false' -Quiet) { Info 'ok: task.enableEffort=false' } else { Info 'NOTE: recommend task.enableEffort=false' }
    if (Select-String -LiteralPath $cfg -Pattern '^\s+maxConcurrency:\s+4' -Quiet) { Info 'ok: task.maxConcurrency=4' } else { Info 'NOTE: recommend task.maxConcurrency=4' }
    if ((Select-String -LiteralPath $cfg -Pattern '^\s+enabled:\s+true' -Quiet) -and (Select-String -LiteralPath $cfg -Pattern '^isolation:' -Quiet)) {
        Info 'ok: task isolation appears enabled'
    } else {
        Info 'NOTE: recommend task.isolation.enabled=true with isolation.backend=auto'
    }

    $ompCmd = Get-Command omp -ErrorAction SilentlyContinue
    if ($ompCmd) {
        Info "omp: $($ompCmd.Source)"
        try { (& omp --profile $profileName config path 2>$null | Out-String).TrimEnd() | ForEach-Object { Info $_ } } catch { }
    } else {
        Info 'WARN: omp not found on PATH'
    }
    return 0
}

function Doctor {
    try { $version = Get-Content -LiteralPath (Join-Path $ROOT 'VERSION') -First 1 } catch { Fail "cannot read $(Join-Path $ROOT 'VERSION')" }
    Info "flow-skills $version"
    Invoke-EachProfile { 0 } { Doctor-Profile $args[0] $args[1] }
}

function Usage {
    [Console]::Error.WriteLine("usage: $(Split-Path $PSCommandPath -Leaf) {install|verify|doctor}")
    exit 2
}

try {
    switch ($Command) {
        'install' { exit (Install) }
        'verify' { exit (Verify) }
        'doctor' { exit (Doctor) }
        default { Usage }
    }
} catch {
    Fail $_.Exception.Message
}
