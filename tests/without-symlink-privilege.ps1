#Requires -Version 7.2
# Usage: without-symlink-privilege.ps1 -- <file> [args...]
# Removes SeCreateSymbolicLinkPrivilege from this process's token, then runs the
# command as a child (which inherits the token) and exits with its code.
# Windows only; used to prove the installer's Developer Mode stop.
# No param block: dash-prefixed words after the command (-NoProfile, -File) must
# reach $args untouched instead of binding to parameters.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $IsWindows) { [Console]::Error.WriteLine('error: Windows only'); exit 2 }

$words = @($args | ForEach-Object { [string]$_ })
if ($words.Count -gt 0 -and $words[0] -eq '--') { $words = @($words | Select-Object -Skip 1) }
if ($words.Count -eq 0) { [Console]::Error.WriteLine('usage: without-symlink-privilege.ps1 -- <file> [args...]'); exit 2 }

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class FlowTokenPrivilege
{
    const uint TOKEN_ADJUST_PRIVILEGES = 0x20;
    const uint TOKEN_QUERY = 0x8;
    const uint SE_PRIVILEGE_REMOVED = 0x4;
    const int ERROR_NOT_ALL_ASSIGNED = 1300;

    [StructLayout(LayoutKind.Sequential)]
    struct LUID { public uint LowPart; public int HighPart; }

    [StructLayout(LayoutKind.Sequential)]
    struct LUID_AND_ATTRIBUTES { public LUID Luid; public uint Attributes; }

    [StructLayout(LayoutKind.Sequential)]
    struct TOKEN_PRIVILEGES { public uint PrivilegeCount; public LUID_AND_ATTRIBUTES Privileges; }

    [DllImport("kernel32.dll")]
    static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool LookupPrivilegeValue(string systemName, string name, out LUID luid);

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool AdjustTokenPrivileges(IntPtr token, bool disableAll, ref TOKEN_PRIVILEGES newState, uint bufferLength, IntPtr previousState, IntPtr returnLength);

    public static void Remove(string privilege)
    {
        IntPtr token;
        if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, out token))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            LUID luid;
            if (!LookupPrivilegeValue(null, privilege, out luid))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            TOKEN_PRIVILEGES state = new TOKEN_PRIVILEGES();
            state.PrivilegeCount = 1;
            state.Privileges.Luid = luid;
            state.Privileges.Attributes = SE_PRIVILEGE_REMOVED;
            if (!AdjustTokenPrivileges(token, false, ref state, 0, IntPtr.Zero, IntPtr.Zero))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            // AdjustTokenPrivileges also returns true on partial success. When removing,
            // ERROR_NOT_ALL_ASSIGNED means the token did not hold the privilege: already absent.
            int error = Marshal.GetLastWin32Error();
            if (error != 0 && error != ERROR_NOT_ALL_ASSIGNED)
                throw new Win32Exception(error);
        }
        finally
        {
            CloseHandle(token);
        }
    }
}
'@

[FlowTokenPrivilege]::Remove('SeCreateSymbolicLinkPrivilege')
[Console]::Error.WriteLine('dropped: SeCreateSymbolicLinkPrivilege')
& $words[0] @($words | Select-Object -Skip 1)
exit $LASTEXITCODE
