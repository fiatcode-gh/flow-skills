#Requires -Version 7.2
# Windows equivalent of flow-opencode: install | verify | doctor | run. See docs/WINDOWS.md.
# No param block: opencode flags such as -c or -m after `run <profile>` must reach
# $args untouched instead of binding to (or prefix-matching) script parameters.
$Command = $args.Count -gt 0 ? [string]$args[0] : ''
$Rest = @($args | Select-Object -Skip 1 | ForEach-Object { [string]$_ })

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Resolve a symlinked launcher (e.g. one on PATH) to its checkout.
$Self = Get-Item -LiteralPath $PSCommandPath -Force
if ($Self.LinkType) { $Self = [IO.File]::ResolveLinkTarget($PSCommandPath, $true) }
$HERE = $Self.DirectoryName
$ROOT = [IO.Path]::GetFullPath((Join-Path $HERE '..' '..'))
# Links into the checkout's previous name are repointed too (renamed from omp-stack on 2026-11-02).
$OLD_ROOT = Join-Path ([IO.Path]::GetDirectoryName($ROOT)) 'omp-stack'
$PORT = Join-Path $ROOT 'opencode'
$LINKED = 'AGENTS.md', 'skills', 'agents', 'profiles'
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

# OpenCode knows its own config directory; ask it when it is on PATH.
if (Get-Command opencode -ErrorAction SilentlyContinue) {
    $global:LASTEXITCODE = 0
    $CONFIG_ROOT = (& opencode debug paths config 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or -not (Test-Rooted $CONFIG_ROOT)) {
        Fail 'could not resolve the OpenCode config directory (opencode debug paths config)'
    }
} else {
    $CONFIG_ROOT = Join-Path ($env:XDG_CONFIG_HOME ? $env:XDG_CONFIG_HOME : (Join-Path $HomeDir '.config')) 'opencode'
}

# Stems of the profile files shipped with the port, space separated.
function Get-ProfileStems {
    $stems = @(Get-ChildItem -LiteralPath (Join-Path $PORT 'profiles') -Filter '*.json' -ErrorAction SilentlyContinue | Sort-Object Name | ForEach-Object BaseName)
    ($stems | ForEach-Object { "$_ " }) -join ''
}

function Get-LinkType([string]$p) {
    (Get-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue)?.LinkType
}

function Get-LinkTarget([string]$dst) {
    $item = Get-Item -LiteralPath $dst -Force
    $raw = $item.LinkTarget
    try { $final = [IO.File]::ResolveLinkTarget($dst, $true).FullName } catch { $final = $null }
    if (-not $final) { $final = [IO.Path]::GetFullPath($raw, (Split-Path $dst -Parent)) }
    @{ Raw = $raw; Final = $final }
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

# Refuses a missing source, a foreign symlink and a real file or directory.
function Assert-Owned([string]$src, [string]$dst) {
    if (-not (Test-Path -LiteralPath $src)) { Fail "missing source $src" }
    $exists = [IO.File]::Exists($dst) -or [IO.Directory]::Exists($dst) -or [bool](Get-LinkType $dst)
    if (-not $exists) { return }
    if (Get-LinkType $dst) {
        $t = Get-LinkTarget $dst
        $shown = $t.Final ?? $t.Raw
        if ((Test-DotSegments $t.Raw) -or -not ((Test-UnderOrEqual $t.Final $ROOT) -or (Test-UnderOrEqual $t.Final $OLD_ROOT))) {
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

# Replaces only a missing destination or a symlink into this repository or its previous name.
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
        if ($err.HResult -eq -2147024574 -or $err -is [UnauthorizedAccessException]) {
            Fail 'cannot create symlinks: enable Windows Developer Mode (Settings > System > For developers) or run this from an elevated PowerShell; nothing was changed'
        }
        Fail "symlink probe failed: $($err.Message)"
    } finally {
        if (Get-LinkType $probe) { [IO.File]::Delete($probe) }
    }
}

function Link-Config {
    $cfg = Join-Path $CONFIG_ROOT 'opencode.json'
    $template = Join-Path $PORT 'opencode.json'
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

function Final-Target([string]$dst) {
    try { [IO.File]::ResolveLinkTarget($dst, $true)?.FullName } catch { $null }
}

function Verify-Link([string]$src, [string]$dst) {
    if (Get-LinkType $dst) {
        $final = Final-Target $dst
        if ($final -and [string]::Equals($final, (Normalize $src), $PathCompare)) {
            Info "ok: $dst"
            return 0
        }
        Info "FAIL: $dst -> $($final ?? 'dangling'), expected $(Normalize $src)"
        return 1
    }
    Info "FAIL: $dst is not a symlink"
    return 1
}

# OpenCode also scans ~/.claude/skills and ~/.agents/skills. A skill of the
# same name there is a second source; report it, never delete it.
function Report-Duplicates {
    $drc = 0
    foreach ($dir in Get-ChildItem -LiteralPath (Join-Path $PORT 'skills') -Directory -ErrorAction SilentlyContinue) {
        $name = $dir.Name
        foreach ($other in (Join-Path $HomeDir '.claude' 'skills' $name 'SKILL.md'), (Join-Path $HomeDir '.agents' 'skills' $name 'SKILL.md')) {
            if ([IO.File]::Exists($other) -or [bool](Get-LinkType $other)) {
                Info "WARN: duplicate skill $name at $other; OpenCode scans that directory too, so remove or move it"
                $drc = 1
            }
        }
    }
    return $drc
}

function Install {
    $rc = 0
    # The permission probe comes before the first filesystem change so a stop leaves nothing behind.
    Test-SymlinkPermission
    try { New-Item -ItemType Directory -Force -Path $CONFIG_ROOT | Out-Null } catch { Fail "could not create $CONFIG_ROOT" }
    # Check every destination first so one refusal changes nothing. A real
    # opencode.json is Link-Config's call (relink or WARN); a symlink is checked here.
    foreach ($name in $LINKED) { Assert-Owned (Join-Path $PORT $name) (Join-Path $CONFIG_ROOT $name) }
    if (Get-LinkType (Join-Path $CONFIG_ROOT 'opencode.json')) {
        Assert-Owned (Join-Path $PORT 'opencode.json') (Join-Path $CONFIG_ROOT 'opencode.json')
    }
    foreach ($name in $LINKED) { Link-Owned (Join-Path $PORT $name) (Join-Path $CONFIG_ROOT $name) }
    if ((Link-Config) -eq 1) { $rc = 1 }
    if ((Report-Duplicates) -eq 1) { $rc = 1 }
    Info "run 'opencode reload' so the background service picks up the config"
    if ($rc -ne 0) { Info 'nothing was overwritten' }
    return $rc
}

function Verify {
    $rc = 0
    foreach ($name in $LINKED + 'opencode.json') {
        if ((Verify-Link (Join-Path $PORT $name) (Join-Path $CONFIG_ROOT $name)) -eq 1) { $rc = 1 }
    }
    if ((Report-Duplicates) -eq 1) { $rc = 1 }
    return $rc
}

function Usage {
    [Console]::Error.WriteLine("usage: $(Split-Path $PSCommandPath -Leaf) {install|verify|doctor|run <profile> [opencode args]}")
    exit 2
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

function Run([string[]]$runArgs) {
    if ($runArgs.Count -lt 1) { Usage }
    $profileName = $runArgs[0]
    $ocArgs = @($runArgs | Select-Object -Skip 1)
    # A backslash is a path separator on Windows; refuse it on every OS.
    if ($profileName -eq '' -or $profileName.Contains('/') -or $profileName.Contains('\') -or $profileName.StartsWith('.')) {
        Fail "unknown profile '$profileName'; profiles: $(Get-ProfileStems)"
    }
    $p = Join-Path $CONFIG_ROOT 'profiles' "$profileName.json"
    if (-not [IO.File]::Exists($p)) { Fail "unknown profile '$profileName'; profiles: $(Get-ProfileStems)" }
    if (-not (Get-Command opencode -ErrorAction SilentlyContinue)) { Fail 'opencode not found on PATH' }
    $bash = Resolve-GitBash
    if (-not $bash) { Fail 'Git for Windows not found; install it from https://git-scm.com/download/win (Flow runs agent commands in Git Bash)' }
    $env:OPENCODE_CONFIG = $p
    $env:OPENCODE_CONFIG_CONTENT = (@{ shell = $bash } | ConvertTo-Json -Compress)
    $global:LASTEXITCODE = 0
    & opencode @ocArgs --standalone
    exit $LASTEXITCODE
}

# --- doctor ----------------------------------------------------------------

$script:drc = 0
# Prints a check report and records whether it holds a FAIL line.
function Report([string]$text) {
    if ($text) { Info $text }
    if ($text -match 'FAIL: ') { $script:drc = 1 }
}

# Runs a checker and reports its output. A throw or empty output is a FAIL:
# a crashed checker must not read as a pass.
function Invoke-Check([string]$name, [scriptblock]$checker, [object[]]$checkArgs) {
    try {
        $out = @(& $checker @checkArgs) -join "`n"
    } catch {
        Report "FAIL: checker $name exited 1"
        return
    }
    Report $out
    if ($out -eq '') { Report "FAIL: checker $name printed nothing" }
}

function Read-JsonFile([string]$path) {
    Get-Content -LiteralPath $path -Raw | ConvertFrom-Json -AsHashtable -NoEnumerate
}

# Reads the `debug agents` JSON in $file. Mode `base`: every agent is a subagent
# and the build agent asks for pushes and PR creation. Mode `profile`: every
# agent (and build, when the profile names it) resolved to the profile's model
# and effort, and the base asks still apply.
function Check-Agents([string]$file, [string]$mode, [string[]]$agents, [string]$pfile, [string]$label) {
    try {
        $rows = @{}
        foreach ($r in (Read-JsonFile $file)) { $rows[$r['id']] = $r }
    } catch {
        "FAIL: ${label}could not read the agent list: $($_.Exception.Message)"
        return
    }
    $build = @()
    if ($rows.ContainsKey('build') -and $rows['build'].ContainsKey('permissions')) { $build = @($rows['build']['permissions']) }
    if ($mode -eq 'base') {
        foreach ($a in $agents) {
            if ($rows.ContainsKey($a) -and $rows[$a]['mode'] -eq 'subagent') { "ok: agent $a is a subagent" }
            else { "FAIL: agent $a missing or not a subagent" }
        }
    } else {
        $want = (Read-JsonFile $pfile)['agent']
        foreach ($a in @($agents) + @(if ($want.ContainsKey('build')) { 'build' })) {
            $m = $rows.ContainsKey($a) ? $rows[$a]['model'] : $null
            $got = 'None/None'
            if ($m) { $got = "$($m['providerID'])/$($m['id'])" + ($m['variant'] ? "#$($m['variant'])" : '') }
            $entry = $want.ContainsKey($a) ? $want[$a] : @{}
            $exp = $entry['model']
            if ($entry['variant']) { $exp += '#' + $entry['variant'] }
            if ($got -eq $exp) { "ok: ${label}$a -> $got" }
            else { "FAIL: ${label}$a resolved to $got, expected $($exp ?? 'None')" }
        }
    }
    foreach ($res in 'git push*', 'gh pr create*') {
        $asks = @($build | Where-Object { $_.Count -eq 3 -and $_['action'] -eq 'shell' -and $_['resource'] -eq $res -and $_['effect'] -eq 'ask' })
        if ($asks.Count -gt 0) {
            if ($mode -eq 'base') { "ok: ${label}base config asks for $res" } else { "ok: ${label}base asks still apply ($res)" }
        } else {
            "FAIL: ${label}build agent has no ask for $res"
        }
    }
}

function Check-MainModel([string]$file, [string]$pfile, [string]$stem, [int]$rc) {
    $label = "profile $stem`: main model"
    $want = (Read-JsonFile $pfile)['model']
    try {
        if ($rc -ne 0) { throw "opencode api exited $rc" }
        $data = (Read-JsonFile $file)['data']
        if ($null -eq $data['providerID'] -or $null -eq $data['modelID']) { throw 'model.default has no providerID or modelID' }
        $got = "$($data['providerID'])/$($data['modelID'])"
    } catch {
        "FAIL: $label unavailable: $($_.Exception.Message)"
        return
    }
    if ($got -eq $want) { "ok: $label $got" }
    elseif ($data['providerID'] -ne $stem) { "SKIP: $label (provider $stem not available)" }
    else { "FAIL: $label resolved to $got, expected $want" }
}

function Test-UnderPrefix([string]$path, [string[]]$prefixes) {
    $candidates = $IsWindows ? @($path, $path.Replace('/', '\')) : @($path)
    foreach ($c in $candidates) {
        $p = Normalize $c
        foreach ($prefix in $prefixes) {
            if ($p.StartsWith((Normalize $prefix) + [IO.Path]::DirectorySeparatorChar, $PathCompare)) { return $true }
        }
    }
    return $false
}

function Check-Skills([string]$file, [string[]]$skills, [string[]]$prefixes) {
    try {
        $d = Read-JsonFile $file
        if (-not $d.ContainsKey('data')) { throw "no 'data' key" }
        $rows = $d['data']
    } catch {
        "FAIL: skill list unreadable: $($_.Exception.Message)"
        return
    }
    if ($rows -isnot [array]) { throw 'skill list data is not an array' }
    foreach ($s in $skills) {
        $found = @($rows | Where-Object { $_['id'] -eq $s })
        if ($found.Count -eq 0) {
            "FAIL: skill $s missing"
        } elseif ($found.Count -gt 1) {
            "FAIL: skill $s listed $($found.Count) times"
        } else {
            $path = [string]$found[0]['path']
            if (-not $path -or -not (Test-UnderPrefix $path $prefixes)) { "FAIL: skill $s loaded from $path, expected $($prefixes[0])" }
            else { "ok: skill $s at $path" }
        }
    }
}

# Runs opencode with stdout saved to $outFile and stderr to $errFile; returns its exit code.
function Invoke-Opencode([string[]]$ocArgs, [string]$outFile, [string]$errFile) {
    $global:LASTEXITCODE = 0
    $text = & opencode @ocArgs 2>$errFile | Out-String
    $code = $LASTEXITCODE
    [IO.File]::WriteAllText($outFile, $text)
    return $code
}

# Appends whatever the serve process has printed so far to the log; never blocks.
function Read-ServeOutput {
    foreach ($stream in 'out', 'err') {
        $task = $script:serveTasks[$stream]
        while ($task -and $task.IsCompleted) {
            $line = $task.Result
            if ($null -eq $line) { $task = $null; break }
            [IO.File]::AppendAllText($script:serveLog, "$line`n")
            $reader = $stream -eq 'out' ? $script:serveProc.StandardOutput : $script:serveProc.StandardError
            $task = $reader.ReadLineAsync()
        }
        $script:serveTasks[$stream] = $task
    }
}

function Doctor {
    try { $version = Get-Content -LiteralPath (Join-Path $ROOT 'VERSION') -First 1 } catch { Fail "cannot read $(Join-Path $ROOT 'VERSION')" }
    Info "flow-skills $version"
    $oc = Get-Command opencode -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $oc) { Fail 'doctor needs opencode on PATH' }
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail 'doctor needs git on PATH' }
    Remove-Item Env:OPENCODE_CONFIG -ErrorAction SilentlyContinue
    try { $tmp = (New-Item -ItemType Directory -Path (Join-Path ([IO.Path]::GetTempPath()) "flow-opencode-doctor-$([guid]::NewGuid().ToString('N'))")).FullName } catch { Fail 'could not create a temporary directory' }
    $script:serveProc = $null
    $script:serveTasks = @{ out = $null; err = $null }
    $script:serveLog = Join-Path $tmp 'serve.log'
    Push-Location -LiteralPath $tmp
    try {
        $wd = Join-Path $tmp 'wd'
        New-Item -ItemType Directory -Path $wd | Out-Null
        & git init -q $wd | Out-Null
        if ($LASTEXITCODE -ne 0) { Fail 'could not create a scratch repository' }
        Set-Location -LiteralPath $wd

        $agents = @(Get-ChildItem -LiteralPath (Join-Path $PORT 'agents') -Filter '*.md' | Sort-Object Name | ForEach-Object BaseName)
        $skills = @(Get-ChildItem -LiteralPath (Join-Path $PORT 'skills') -Directory | Sort-Object Name | ForEach-Object Name)

        $agentsFile = Join-Path $tmp 'agents.json'
        $errFile = Join-Path $tmp 'agents.err'
        if ((Invoke-Opencode @('debug', 'agents', '--standalone') $agentsFile $errFile) -eq 0) {
            Invoke-Check 'Check-Agents' ${function:Check-Agents} @($agentsFile, 'base', $agents, '', '')
        } else {
            Report "FAIL: opencode debug agents failed: $((Get-Content -LiteralPath $errFile -Raw -ErrorAction SilentlyContinue)?.Trim())"
        }

        $profilesDir = Join-Path $CONFIG_ROOT 'profiles'
        $pfiles = @(Get-ChildItem -LiteralPath $profilesDir -Filter '*.json' -File -ErrorAction SilentlyContinue | Sort-Object Name)
        if ($pfiles.Count -eq 0) { Report "FAIL: no profiles found in $profilesDir" }
        foreach ($pf in $pfiles) {
            $stem = $pf.BaseName
            $env:OPENCODE_CONFIG = $pf.FullName
            try {
                $pagents = Join-Path $tmp 'pagents.json'
                $perr = Join-Path $tmp 'pagents.err'
                $agentsRc = Invoke-Opencode @('debug', 'agents', '--standalone') $pagents $perr
                $model = Join-Path $tmp 'model.json'
                $mrc = Invoke-Opencode @('api', '--standalone', 'model.default') $model (Join-Path $tmp 'model.err')
            } finally {
                Remove-Item Env:OPENCODE_CONFIG -ErrorAction SilentlyContinue
            }
            if ($agentsRc -eq 0) {
                Invoke-Check 'Check-Agents' ${function:Check-Agents} @($pagents, 'profile', $agents, $pf.FullName, "profile $stem`: ")
            } else {
                Report "FAIL: profile $stem`: opencode debug agents failed: $((Get-Content -LiteralPath $perr -Raw -ErrorAction SilentlyContinue)?.Trim())"
            }
            Invoke-Check 'Check-MainModel' ${function:Check-MainModel} @($model, $pf.FullName, $stem, $mrc)
        }

        $pw = [guid]::NewGuid().ToString('N')
        $psi = [System.Diagnostics.ProcessStartInfo]::new()
        # A .ps1 shim (npm installs one next to the .cmd) cannot be launched directly.
        if ($oc.Source -like '*.ps1') {
            $psi.FileName = (Get-Process -Id $PID).Path
            foreach ($a in '-NoProfile', '-File', $oc.Source) { $psi.ArgumentList.Add($a) }
        } else {
            $psi.FileName = $oc.Source
        }
        foreach ($a in 'serve', '--port', '0', '--hostname', '127.0.0.1') { $psi.ArgumentList.Add($a) }
        $psi.Environment['OPENCODE_SERVER_PASSWORD'] = $pw
        $psi.WorkingDirectory = $wd
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.UseShellExecute = $false
        $script:serveProc = [System.Diagnostics.Process]::Start($psi)
        $script:serveTasks['out'] = $script:serveProc.StandardOutput.ReadLineAsync()
        $script:serveTasks['err'] = $script:serveProc.StandardError.ReadLineAsync()

        $cap = [int]($env:FLOW_OPENCODE_SERVE_WAIT ? $env:FLOW_OPENCODE_SERVE_WAIT : 30)
        $line = $null
        for ($waited = 0; $waited -lt $cap; $waited++) {
            Read-ServeOutput
            $line = Get-Content -LiteralPath $script:serveLog -ErrorAction SilentlyContinue | Where-Object { $_ -match 'server listening on ' } | Select-Object -First 1
            if ($line) { break }
            Start-Sleep -Seconds 1
        }
        if (-not $line) {
            Report "FAIL: server did not report a listening URL within ${cap}s"
        } else {
            $marker = 'server listening on '
            $url = $line.Substring($line.IndexOf($marker) + $marker.Length).Trim()
            $skillsFile = Join-Path $tmp 'skills.json'
            $ready = $false
            $env:OPENCODE_PASSWORD = $pw
            for ($tries = 0; $tries -lt 20; $tries++) {
                [void](Invoke-Opencode @('api', '--server', $url, 'skill.list') $skillsFile (Join-Path $tmp 'skills.err'))
                if ((Get-Content -LiteralPath $skillsFile -Raw -ErrorAction SilentlyContinue) -match '"flow-tdd"') { $ready = $true; break }
                Read-ServeOutput
                Start-Sleep -Seconds 1
            }
            if (-not $ready) {
                Report 'FAIL: skill list not ready after 20 tries'
            } else {
                Invoke-Check 'Check-Skills' ${function:Check-Skills} @($skillsFile, $skills, @((Join-Path $CONFIG_ROOT 'skills'), (Join-Path $PORT 'skills')))
            }
        }
    } finally {
        if ($script:serveProc -and -not $script:serveProc.HasExited) {
            try { $script:serveProc.Kill($true) } catch { }
        }
        if ($script:serveProc) { [void]$script:serveProc.WaitForExit(5000) }
        Remove-Item Env:OPENCODE_PASSWORD -ErrorAction SilentlyContinue
        Remove-Item Env:OPENCODE_CONFIG -ErrorAction SilentlyContinue
        Pop-Location
        Remove-Item -Recurse -Force -LiteralPath $tmp -ErrorAction SilentlyContinue
    }
    return $script:drc
}

try {
    switch ($Command) {
        'install' { exit (Install) }
        'verify' { exit (Verify) }
        'doctor' { exit (Doctor) }
        'run' { Run $Rest }
        default { Usage }
    }
} catch {
    Fail $_.Exception.Message
}
