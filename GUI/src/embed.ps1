param(
    [string]$parentHwndStr,
    [string]$childExeName,
    [int]$x,
    [int]$y,
    [int]$w,
    [int]$h
)

$code = @"
using System;
using System.Runtime.InteropServices;
namespace WinApi {
    public class Win32 {
        [DllImport("user32.dll")] public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);
        [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
        [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
        [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    }
}
"@
Add-Type -TypeDefinition $code

try {
    $parentHwnd = [IntPtr]::new([long]$parentHwndStr)
} catch {
    Write-Output "Error: Invalid Parent HWND string: $parentHwndStr"
    exit
}

# Retry loop to find the process and its main window
$maxRetries = 20
$found = $false
$childHwnd = [IntPtr]::Zero

for ($i = 0; $i -lt $maxRetries; $i++) {
    $procs = Get-Process -Name $childExeName -ErrorAction SilentlyContinue
    if ($procs) {
        foreach ($p in $procs) {
            $p.Refresh()
            $h = $p.MainWindowHandle
            if ($h -ne [IntPtr]::Zero) {
                 # Basic check: title or visibility
                 if ([WinApi.Win32]::IsWindowVisible($h)) {
                    $childHwnd = $h
                    $found = $true
                    break
                 }
            }
        }
    }
    
    if ($found) { break }
    Start-Sleep -Milliseconds 1000
    Write-Output "Waiting for window... ($i)"
}

if (-not $found) {
    Write-Output "Error: Could not find visible main window for $childExeName after retries."
    exit
}

Write-Output "Target HWND: $childHwnd"

# Constants
$GWL_STYLE = -16
$WS_CAPTION = 0x00C00000
$WS_THICKFRAME = 0x00040000
$WS_CHILD = 0x40000000
$WS_VISIBLE = 0x10000000
$SW_SHOW = 5
$SWP_FRAMECHANGED = 0x0020
$SWP_NOZORDER = 0x0004
$SWP_SHOWWINDOW = 0x0040

# 1. Force Show first (in case it is minimized or hidden)
[WinApi.Win32]::ShowWindow($childHwnd, $SW_SHOW)

# 2. Modify Style
$currentStyle = [WinApi.Win32]::GetWindowLong($childHwnd, $GWL_STYLE)
# We keep existing bits but Remove Caption/Thickframe and Add Child/Visible
$newStyle = ($currentStyle -band (-bnot $WS_CAPTION) -band (-bnot $WS_THICKFRAME)) -bor $WS_CHILD -bor $WS_VISIBLE
[WinApi.Win32]::SetWindowLong($childHwnd, $GWL_STYLE, $newStyle)

# 3. Set Parent
[WinApi.Win32]::SetParent($childHwnd, $parentHwnd)

# 4. Move and Resize with SWP flags to force redraw and frame update
# HWND_TOP = 0
[WinApi.Win32]::SetWindowPos($childHwnd, [IntPtr]::Zero, $x, $y, $w, $h, $SWP_FRAMECHANGED -bor $SWP_SHOWWINDOW -bor $SWP_NOZORDER)

Write-Output "Success: Embedded HWND $childHwnd into $parentHwnd"
