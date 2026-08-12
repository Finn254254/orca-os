param(
    [Parameter(Mandatory = $true)][int]$ExpectedPid,
    [Parameter(Mandatory = $true)][string]$ExpectedOverlay
)

$ErrorActionPreference = 'Stop'
$process = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $ExpectedPid)
if ($null -eq $process) {
    exit 0
}
if ([IO.Path]::GetFileName($process.ExecutablePath) -ine 'qemu-system-x86_64.exe') {
    throw "PID $ExpectedPid is not qemu-system-x86_64.exe"
}
if ([string]::IsNullOrWhiteSpace($process.CommandLine) -or
    $process.CommandLine.IndexOf($ExpectedOverlay, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
    throw "PID $ExpectedPid does not reference the expected Orca overlay"
}
$taskkill = Join-Path $env:SystemRoot 'System32\taskkill.exe'
& $taskkill /PID $ExpectedPid /T /F | Out-Null
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
