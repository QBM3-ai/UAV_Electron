param(
    [string]$parentHwndStr,
    [string]$childExeName
)

$logPath = "$PSScriptRoot\debug_manager.log"
"[" + (Get-Date).ToString() + "] STARTING" | Out-File $logPath

$code = @"
using System;
using System.Runtime.InteropServices;
namespace WinApi {
    public class Win32 {
        [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
        
        // For 32-bit Stlye
        [DllImport("user32.dll", EntryPoint="SetWindowLong")] 
        public static extern int SetWindowLong32(IntPtr hWnd, int nIndex, int dwNewLong);
        
        [DllImport("user32.dll", EntryPoint="GetWindowLong")] 
        public static extern int GetWindowLong32(IntPtr hWnd, int nIndex);

        // For 64-bit Ptr (Owner/Parent) - EntryPoint might need to be specific on some systems
        // We try generic SetWindowLongPtr which works on modern 64-bit usually, or SetWindowLongPtrW
        [DllImport("user32.dll", EntryPoint="SetWindowLongPtr")]
        public static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    }
}
"@

try {
    Add-Type -TypeDefinition $code
    "Add-Type Success" | Out-File $logPath -Append
} catch {
    $_ | Out-String | Out-File $logPath -Append
    exit
}

# Wait for QGC Window
$maxRetries = 60
$childHwnd = [IntPtr]::Zero

"Looking for process: $childExeName" | Out-File $logPath -Append

for ($i = 0; $i -lt $maxRetries; $i++) {
    $procs = Get-Process -Name $childExeName -ErrorAction SilentlyContinue
    if ($procs) {
        foreach ($p in $procs) {
            try {
                $p.Refresh()
                $h = $p.MainWindowHandle
                # Basic check: handle valid and visible
                if ($h -ne [IntPtr]::Zero) {
                     # We assume first valid window is it. 
                     # QGC Splash screen might have a handle, but usually main window comes later?
                     # Lets just grab it.
                     $childHwnd = $h
                     "Found Handle: $h" | Out-File $logPath -Append
                     break
                }
            } catch {}
        }
    }
    if ($childHwnd -ne [IntPtr]::Zero) { break }
    Start-Sleep -Milliseconds 500
}

if ($childHwnd -eq [IntPtr]::Zero) {
    "ERROR: WindowNotFound after search" | Out-File $logPath -Append
    Write-Output "ERROR:WindowNotFound"
    exit
}

# Constants
$GWL_STYLE = -16
$GWLP_HWNDPARENT = -8
$WS_CAPTION = 0x00C00000
$WS_THICKFRAME = 0x00040000
$WS_POPUP = 0x80000000

try {
    # 1. Remove Borders (Style is 32-bit integer even on x64)
    $currentStyle = [WinApi.Win32]::GetWindowLong32($childHwnd, $GWL_STYLE)
    $newStyle = ($currentStyle -band (-bnot $WS_CAPTION) -band (-bnot $WS_THICKFRAME)) -bor $WS_POPUP
    [WinApi.Win32]::SetWindowLong32($childHwnd, $GWL_STYLE, $newStyle)
    "Style Updated" | Out-File $logPath -Append

    # 2. Set Owner (Soft Embedding)
    $parentHwnd = [IntPtr]::new([long]$parentHwndStr)
    
    # Try 64-bit call first
    try {
        [WinApi.Win32]::SetWindowLongPtr64($childHwnd, $GWLP_HWNDPARENT, $parentHwnd)
        "Owner Set (x64 path)" | Out-File $logPath -Append
    } catch {
        # Fallback to 32? No, if 64 fail, 32 likely wont work for ptr, but lets try SetWindowLong32 for parent
        try {
             [WinApi.Win32]::SetWindowLong32($childHwnd, $GWLP_HWNDPARENT, [int]$parentHwnd)
             "Owner Set (x32 path)" | Out-File $logPath -Append
        } catch {
             "Owner Set Failed: " + $_ | Out-File $logPath -Append
        }
    }

} catch {
    "Setup Error: " + $_ | Out-File $logPath -Append
}

Write-Output "READY"
"Sent READY" | Out-File $logPath -Append

# 3. Listen for coordinates
while ($true) {
    $line = [Console]::In.ReadLine()
    if ($line -eq $null) { break }
    
    # "Received: $line" | Out-File $logPath -Append # Verbose logging

    if ($line -eq "HIDE") {
        [WinApi.Win32]::ShowWindow($childHwnd, 0) # SW_HIDE
    } elseif ($line -eq "SHOW") {
        [WinApi.Win32]::ShowWindow($childHwnd, 5) # SW_SHOW
    } else {
        $parts = $line.Split(',')
        if ($parts.Length -eq 4) {
            $x = [int]$parts[0]
            $y = [int]$parts[1]
            $w = [int]$parts[2]
            $h = [int]$parts[3]
            [WinApi.Win32]::MoveWindow($childHwnd, $x, $y, $w, $h, $true)
        }
    }
}
