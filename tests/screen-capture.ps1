param(
  [string]$OutPath = "screen.png",
  [int]$X = -1, [int]$Y = -1, [int]$W = 0, [int]$H = 0,
  [int]$Scale = 1
)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
if ($X -lt 0) {
  $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $X = $b.Location.X; $Y = $b.Location.Y; $W = $b.Width; $H = $b.Height
}
$bmp = New-Object System.Drawing.Bitmap ($W * $Scale), ($H * $Scale)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$dest = New-Object System.Drawing.Rectangle 0, 0, ($W * $Scale), ($H * $Scale)
$srcRect = New-Object System.Drawing.Rectangle $X, $Y, $W, $H
$g.DrawImage(([System.Drawing.Image]::FromFile("E:/clipboard-translator-dev/tests/shots-icon/screen.png")), $dest, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()
$bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output ("saved {0} region={1},{2},{3},{4} scale={5}" -f $OutPath, $X, $Y, $W, $H, $Scale)