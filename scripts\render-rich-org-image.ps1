param(
  [Parameter(Mandatory = $true)][string]$DataPath,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [ValidateSet('org', 'notes')][string]$Mode = 'org'
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Web.Extensions

function New-Color([int]$r, [int]$g, [int]$b, [int]$a = 255) {
  return [System.Drawing.Color]::FromArgb($a, $r, $g, $b)
}

function Draw-ShadowRect($graphics, $x, $y, $w, $h, $shadowColor) {
  $brush = New-Object System.Drawing.SolidBrush $shadowColor
  $graphics.FillRectangle($brush, $x + 6, $y + 8, $w, $h)
  $brush.Dispose()
}

function Draw-Card($graphics, $x, $y, $w, $h, $title, $subtitle, $meta1, $meta2, $badge, $stripeColor, $palette) {
  Draw-ShadowRect $graphics $x $y $w $h $palette.Shadow

  $fill = New-Object System.Drawing.SolidBrush $palette.Card
  $border = New-Object System.Drawing.Pen $palette.Border, 1.2
  $stripe = New-Object System.Drawing.SolidBrush $stripeColor
  $text = New-Object System.Drawing.SolidBrush $palette.TextStrong
  $muted = New-Object System.Drawing.SolidBrush $palette.TextMuted
  $badgeFill = New-Object System.Drawing.SolidBrush $palette.BadgeFill
  $badgeText = New-Object System.Drawing.SolidBrush $palette.BadgeText

  $titleFont = New-Object System.Drawing.Font('Microsoft YaHei', 16, [System.Drawing.FontStyle]::Bold)
  $bodyFont = New-Object System.Drawing.Font('Microsoft YaHei', 11)
  $metaFont = New-Object System.Drawing.Font('Microsoft YaHei', 10, [System.Drawing.FontStyle]::Regular)
  $badgeFont = New-Object System.Drawing.Font('Microsoft YaHei', 9, [System.Drawing.FontStyle]::Bold)

  $graphics.FillRectangle($fill, $x, $y, $w, $h)
  $graphics.DrawRectangle($border, $x, $y, $w, $h)
  $graphics.FillRectangle($stripe, $x, $y, $w, 8)
  $graphics.DrawString($title, $titleFont, $text, [float]($x + 16), [float]($y + 18))
  $graphics.DrawString($subtitle, $bodyFont, $text, [float]($x + 16), [float]($y + 52))
  $graphics.DrawString($meta1, $metaFont, $muted, [float]($x + 16), [float]($y + 88))
  $graphics.DrawString($meta2, $metaFont, $muted, [float]($x + 16), [float]($y + 110))

  if ($badge) {
    $badgeWidth = [Math]::Max(70, ($badge.Length * 11) + 18)
    $graphics.FillRectangle($badgeFill, $x + $w - $badgeWidth - 16, $y + 16, $badgeWidth, 28)
    $graphics.DrawString($badge, $badgeFont, $badgeText, [float]($x + $w - $badgeWidth - 6), [float]($y + 21))
  }

  $badgeFont.Dispose()
  $metaFont.Dispose()
  $bodyFont.Dispose()
  $titleFont.Dispose()
  $badgeText.Dispose()
  $badgeFill.Dispose()
  $muted.Dispose()
  $text.Dispose()
  $stripe.Dispose()
  $border.Dispose()
  $fill.Dispose()
}

function Draw-Panel($graphics, $x, $y, $w, $h, $title, $lines, $palette, $accent) {
  Draw-ShadowRect $graphics $x $y $w $h $palette.Shadow

  $fill = New-Object System.Drawing.SolidBrush $palette.Card
  $border = New-Object System.Drawing.Pen $palette.Border, 1
  $titleBrush = New-Object System.Drawing.SolidBrush $palette.TextStrong
  $bodyBrush = New-Object System.Drawing.SolidBrush $palette.TextMuted
  $accentBrush = New-Object System.Drawing.SolidBrush $accent
  $titleFont = New-Object System.Drawing.Font('Microsoft YaHei', 14, [System.Drawing.FontStyle]::Bold)
  $bodyFont = New-Object System.Drawing.Font('Microsoft YaHei', 10)

  $graphics.FillRectangle($fill, $x, $y, $w, $h)
  $graphics.DrawRectangle($border, $x, $y, $w, $h)
  $graphics.FillRectangle($accentBrush, $x, $y, 6, $h)
  $graphics.DrawString($title, $titleFont, $titleBrush, [float]($x + 18), [float]($y + 14))

  $lineY = $y + 52
  foreach ($line in $lines) {
    $graphics.DrawString("- $line", $bodyFont, $bodyBrush, [float]($x + 18), [float]$lineY)
    $lineY += 24
    if ($lineY -gt ($y + $h - 24)) { break }
  }

  $bodyFont.Dispose()
  $titleFont.Dispose()
  $accentBrush.Dispose()
  $bodyBrush.Dispose()
  $titleBrush.Dispose()
  $border.Dispose()
  $fill.Dispose()
}

function Draw-Line($graphics, $x1, $y1, $x2, $y2, $color, [float]$width = 2.0) {
  $pen = New-Object System.Drawing.Pen $color, $width
  $graphics.DrawLine($pen, [float]$x1, [float]$y1, [float]$x2, [float]$y2)
  $pen.Dispose()
}

function Draw-Header($graphics, $title, $subtitle, $palette) {
  $titleBrush = New-Object System.Drawing.SolidBrush $palette.TextStrong
  $mutedBrush = New-Object System.Drawing.SolidBrush $palette.TextMuted
  $titleFont = New-Object System.Drawing.Font('Microsoft YaHei', 24, [System.Drawing.FontStyle]::Bold)
  $subFont = New-Object System.Drawing.Font('Microsoft YaHei', 12)
  $linePen = New-Object System.Drawing.Pen $palette.Border, 1

  $graphics.DrawString($title, $titleFont, $titleBrush, 72, 44)
  $graphics.DrawString($subtitle, $subFont, $mutedBrush, 74, 84)
  $graphics.DrawLine($linePen, 60, 122, 1860, 122)

  $linePen.Dispose()
  $subFont.Dispose()
  $titleFont.Dispose()
  $mutedBrush.Dispose()
  $titleBrush.Dispose()
}

$json = Get-Content -Raw -Encoding UTF8 -Path $DataPath
$data = [System.Web.Script.Serialization.JavaScriptSerializer]::new().DeserializeObject($json)
$people = @($data['people'])
$company = [string]$data['company']
$top = $people | Where-Object { $_['level'] -eq 'L0' } | Select-Object -First 1
$l1 = @($people | Where-Object { $_['level'] -eq 'L1' } | Select-Object -First 6)
$l2 = @($people | Where-Object { $_['level'] -eq 'L2' })
$l3 = @($people | Where-Object { $_['level'] -eq 'L3' })
$conflict = $data['knownConflict']

$bitmap = New-Object System.Drawing.Bitmap 1920, 1360
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

$palette = @{
  Background = (New-Color 245 248 252)
  Card       = (New-Color 255 255 255)
  Border     = (New-Color 204 216 232)
  Shadow     = (New-Color 226 234 244 150)
  TextStrong = (New-Color 24 36 55)
  TextMuted  = (New-Color 98 113 135)
  BadgeFill  = (New-Color 235 243 255)
  BadgeText  = (New-Color 35 93 180)
  Line       = (New-Color 129 153 183)
  Blue       = (New-Color 57 109 214)
  Green      = (New-Color 55 168 107)
  Orange     = (New-Color 232 149 53)
  Purple     = (New-Color 122 99 238)
  Red        = (New-Color 206 78 95)
}

$graphics.Clear($palette.Background)

if ($Mode -eq 'org') {
  Draw-Header $graphics 'Image A: org chart screenshot + callouts' "$company | simulated source screenshot before import" $palette

  $topX = 700
  $topY = 150
  $cardW = 320
  $cardH = 144
  Draw-Card $graphics $topX $topY $cardW $cardH `
    $top['department'] `
    ("Owner " + $top['name']) `
    $top['title'] `
    '8 L1 orgs | 3 tracked competitor interfaces' `
    'L0 / group owner' `
    $palette.Blue `
    $palette

  $l1Y = 390
  $l1StartX = 90
  $l1Gap = 290
  Draw-Line $graphics 860 294 860 350 $palette.Line 3
  Draw-Line $graphics 170 350 1550 350 $palette.Line 3

  for ($i = 0; $i -lt $l1.Count; $i++) {
    $leader = $l1[$i]
    $x = $l1StartX + ($i * $l1Gap)
    Draw-Line $graphics ($x + 115) 350 ($x + 115) 390 $palette.Line 3
    $teamChildren = @($l2 | Where-Object { $_['manager'] -eq $leader['name'] } | Select-Object -First 2)
    Draw-Card $graphics $x $l1Y 230 138 `
      $leader['department'] `
      ("Owner " + $leader['name']) `
      $leader['title'] `
      ("Owns " + (@($l2 | Where-Object { $_['manager'] -eq $leader['name'] }).Count) + " L2 teams") `
      $leader['level'] `
      $palette.Green `
      $palette

    if ($teamChildren.Count -gt 0) {
      Draw-Line $graphics ($x + 115) 528 ($x + 115) 570 $palette.Line 2
      Draw-Line $graphics ($x + 20) 570 ($x + 210) 570 $palette.Line 2
      for ($j = 0; $j -lt $teamChildren.Count; $j++) {
        $child = $teamChildren[$j]
        $childX = $x + ($j * 110)
        Draw-Line $graphics ($childX + 60) 570 ($childX + 60) 605 $palette.Line 2
        Draw-Card $graphics $childX 605 120 122 `
          $child['department'] `
          ("Lead " + $child['name']) `
          $child['title'] `
          'L2 owner card' `
          'L2' `
          $palette.Orange `
          $palette
      }
    }
  }

  $calloutA = @(
    'Q2 layoff note: rendering engine team reported about 18 percent reduction.',
    'Car ecosystem org added a new external VP; strategy shifted toward OEM partnerships.',
    'Two senior ICs in growth org are under leave-or-exit watch.'
  )
  Draw-Panel $graphics 1480 210 330 170 'Key callouts' $calloutA $palette $palette.Red

  $calloutB = @(
    'Conflict: ' + $conflict['subordinateName'] + ' may report to ' + $conflict['possibleManagers'][0] + ' / ' + $conflict['possibleManagers'][1] + '.',
    'Navigation product and routing algorithm teams use project-line dotted management.',
    'HRBP noted that L2 team HC wording differs from actual in-seat headcount.'
  )
  Draw-Panel $graphics 1480 410 330 200 'Need verification' $calloutB $palette $palette.Purple

  $calloutC = @(
    'Source style: stitched notes from people review meeting + candidate calls.',
    'Import expectation: image contains no structured text path, must go OCR or manual fill.',
    'Validation targets: owner name, org level, layoff note, dotted-line report note.'
  )
  Draw-Panel $graphics 1480 650 330 180 'Upload test target' $calloutC $palette $palette.Blue

  $footerBrush = New-Object System.Drawing.SolidBrush $palette.TextMuted
  $footerFont = New-Object System.Drawing.Font('Microsoft YaHei', 10)
  $graphics.DrawString('Virtual screenshot | Page 1/2 | used for upload parsing / OCR / manual fill verification', $footerFont, $footerBrush, 72, 1290)
  $footerFont.Dispose()
  $footerBrush.Dispose()
}
else {
  Draw-Header $graphics 'Image B: HR mapping call snippets + meeting notes' "$company | candidate call excerpts for image-import testing" $palette

  $sampleL3 = @($l3 | Select-Object -First 5)
  $cards = @()
  for ($i = 0; $i -lt $sampleL3.Count; $i++) {
    $person = $sampleL3[$i]
    $manager = $people | Where-Object { $_['name'] -eq $person['manager'] } | Select-Object -First 1
    $cards += @{
      title = $person['name'] + ' candidate call'
      lines = @(
        'Current dept: ' + $person['department'],
        'Resume title: ' + $person['title'],
        'Direct lead: ' + $manager['name'],
        'Team size: 12-18, recent HC control',
        'Note: project-based dotted-line collaboration, reporting line needs review'
      )
    }
  }

  $boxY = 170
  foreach ($card in $cards) {
    Draw-Panel $graphics 90 $boxY 820 180 $card.title $card.lines $palette $palette.Green
    $boxY += 208
  }

  $meetingLines = @(
    'Meeting note: rendering engine team reported about 18 percent reduction, owner unchanged.',
    'Meeting note: POI governance team plans to backfill one senior IC and one product role.',
    'Meeting note: talent team wants high-potential targets split into actionable buckets.',
    'Meeting note: ' + $conflict['subordinateName'] + ' has two reporting versions from calls.',
    'Meeting note: if OCR is poor, manually record owner, dept, leader and team size first.'
  )
  Draw-Panel $graphics 980 180 820 280 'Meeting-note screenshot' $meetingLines $palette $palette.Orange

  $scriptLines = @(
    'Prompt 1: are you hanging under the formal dept or a project pod right now?',
    'Prompt 2: who calibrates your performance and who decides headcount?',
    'Prompt 3: did the team see layoffs, parachute hires, merge or split this year?',
    'Prompt 4: for mapping, should we log the nominal boss or the real day-to-day manager?',
    'Prompt 5: which peer experts should we benchmark inside the same org?'
  )
  Draw-Panel $graphics 980 510 820 240 'HR prompt card' $scriptLines $palette $palette.Blue

  $dirtyLines = @(
    'Injected noise: synonym titles, fuzzy dept short names, dotted-line reports, recent loaned staff.',
    'Injected noise: screenshot only image, no structured text, should force OCR or manual fill path.',
    'Goal: verify review page separates high-confidence, conflict and manual-fill candidates.'
  )
  Draw-Panel $graphics 980 800 820 190 'Dirty-data design note' $dirtyLines $palette $palette.Purple

  $footerBrush = New-Object System.Drawing.SolidBrush $palette.TextMuted
  $footerFont = New-Object System.Drawing.Font('Microsoft YaHei', 10)
  $graphics.DrawString('Virtual screenshot | Page 2/2 | includes verbatim calls, meeting notes, HR prompts and conflict clues', $footerFont, $footerBrush, 72, 1290)
  $footerFont.Dispose()
  $footerBrush.Dispose()
}

$directory = Split-Path -Parent $OutputPath
if (-not (Test-Path -LiteralPath $directory)) {
  New-Item -ItemType Directory -Path $directory | Out-Null
}

$bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
