#Requires -Version 7.2
# Parses every PowerShell script in the fixed directory list; no execution.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$files = @(Get-ChildItem -LiteralPath (Join-Path $root 'omp/bin'), (Join-Path $root 'opencode/bin'), (Join-Path $root 'tests') -Filter *.ps1 -File)
$failed = $false
foreach ($file in $files) {
    $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$null, [ref]$errors)
    foreach ($e in $errors) {
        $failed = $true
        Write-Output "$($file.FullName):$($e.Extent.StartLineNumber):$($e.Extent.StartColumnNumber): $($e.Message)"
    }
}
if ($failed) { exit 1 }
Write-Output "ok: PowerShell syntax ($($files.Count) files)"
