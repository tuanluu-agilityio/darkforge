# Quality gate skeleton. Replace each TODO with the project's real command.
# Prints the success marker as a whole line only when every step passed.
$fail = $false
function Invoke-Step($name, [scriptblock]$body) {
  Write-Output "== $name"
  $global:LASTEXITCODE = 0
  $failed = $false
  try {
    $ErrorActionPreference = 'Stop'
    & $body
  } catch {
    $failed = $true
  }
  if ($failed -or $global:LASTEXITCODE -ne 0) { Write-Output "CHECK FAILED: $name"; $script:fail = $true }
}
# TODO: build
Invoke-Step 'build' { $true | Out-Null }
# TODO: test
Invoke-Step 'test' { $true | Out-Null }
# TODO: lint
Invoke-Step 'lint' { $true | Out-Null }
if ($fail) { exit 1 }
Write-Output '{{successMarker}}'
