param([string]$Source, [string]$OutDir, [string]$SheetList)
$ErrorActionPreference = "Stop"
$Sheets = $SheetList.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ }
New-Item -ItemType Directory -Force $OutDir | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding($false)
$excel = New-Object -ComObject Excel.Application
try {
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.AutomationSecurity = 3   # msoAutomationSecurityForceDisable
  $wb = $excel.Workbooks.Open($Source, 0, $true)
  try {
    foreach ($name in $Sheets) {
      $values = $wb.Worksheets.Item($name).UsedRange.Value2
      $rows = $values.GetLength(0); $cols = $values.GetLength(1)
      $sb = New-Object System.Text.StringBuilder
      for ($r = 1; $r -le $rows; $r++) {
        $cells = New-Object string[] $cols
        for ($c = 1; $c -le $cols; $c++) {
          $v = $values[$r, $c]
          if ($null -eq $v) { $cells[$c - 1] = "" }
          elseif ($v -is [double]) { $cells[$c - 1] = $v.ToString("R", [Globalization.CultureInfo]::InvariantCulture) }
          else { $cells[$c - 1] = ([string]$v) -replace "[\t\r\n]+", " " }
        }
        [void]$sb.Append([string]::Join("`t", $cells)).Append("`n")
      }
      $target = Join-Path $OutDir ($name + ".tsv")
      [System.IO.File]::WriteAllText($target, $sb.ToString(), $utf8)
      "{0}: {1} rows x {2} cols" -f $name, $rows, $cols
    }
  } finally { $wb.Close($false) }
} finally {
  $excel.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
}
