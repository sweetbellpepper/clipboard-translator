param([string]$Pattern = '*译雀-test*')
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W {
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L,T,Rt,B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
}
"@
Add-Type -AssemblyName System.Windows.Forms
$ps = @(Get-Process | Where-Object { $_.ProcessName -like $Pattern })
"count=" + $ps.Count
$p = $ps | Select-Object -First 1
if ($p -and $p.MainWindowHandle -ne 0) {
  $r = New-Object W+R
  [W]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $ww = $r.Rt - $r.L; $wh = $r.B - $r.T
  $cx = ($r.L + $r.Rt) / 2; $cy = ($r.T + $r.B) / 2
  $scx = ($b.Left + $b.Right) / 2; $scy = ($b.Top + $b.Bottom) / 2
  "rect=$($r.L),$($r.T),$($r.Rt),$($r.B) size=${ww}x${wh}"
  "winCenter=$cx,$cy screenCenter=$scx,$scy dx=$($cx - $scx) dy=$($cy - $scy)"
} else { "no main window" }