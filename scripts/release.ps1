param([string]$Notes)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$config = Get-Content -Raw "src-tauri/tauri.conf.json" | ConvertFrom-Json
$v = [string]$config.version
$packageVersion = [string](Get-Content -Raw "package.json" | ConvertFrom-Json).version
$cargoText = Get-Content -Raw "src-tauri/Cargo.toml"
$cargoMatch = [regex]::Match($cargoText, '(?m)^version\s*=\s*"([^"]+)"')
if (-not $cargoMatch.Success) { throw "Could not read the version from src-tauri/Cargo.toml." }
$cargoVersion = $cargoMatch.Groups[1].Value
if ($packageVersion -ne $v -or $cargoVersion -ne $v) {
  throw "Version mismatch: tauri.conf.json=$v, package.json=$packageVersion, Cargo.toml=$cargoVersion."
}

$keyPath = Join-Path $env:USERPROFILE ".tauri\refill-tracker.key"
$passwordPath = "$keyPath.password"
if (-not (Test-Path -LiteralPath $keyPath -PathType Leaf)) {
  throw "Signing key is missing at $keyPath; restore it from backup - without it updates cannot be signed."
}
if (-not (Test-Path -LiteralPath $passwordPath -PathType Leaf)) {
  throw "Key password file is missing at $passwordPath; restore it from backup - the key cannot be decrypted without it."
}
# The password must be non-empty and passed via env var: Windows cannot represent
# an empty env var, and the tauri CLI hangs on a console prompt when the var is
# absent (verified 2026-07-18) - hence a passworded key + this sidecar file.
$keyPassword = (Get-Content -Raw -LiteralPath $passwordPath).Trim()
if ([string]::IsNullOrWhiteSpace($keyPassword)) {
  throw "Key password file at $passwordPath is empty; an empty password cannot pass through the environment on Windows and the build would hang."
}
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = $keyPath
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $keyPassword

pnpm tauri build
if ($LASTEXITCODE -ne 0) { throw "pnpm tauri build failed with exit code $LASTEXITCODE." }

$bundle = Join-Path $PWD "src-tauri\target\release\bundle\nsis"
$installer = Join-Path $bundle "Refill Tracker_${v}_x64-setup.exe"
$signature = "$installer.sig"
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw "Installer not found: $installer" }
if (-not (Test-Path -LiteralPath $signature -PathType Leaf)) { throw "Signature not found: $signature; signing env vars did not produce it." }

$stage = Join-Path ([IO.Path]::GetTempPath()) ("refill-tracker-release-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $stage | Out-Null
$setupAsset = Join-Path $stage "refill-tracker_${v}_x64-setup.exe"
$sigAsset = "$setupAsset.sig"
$latest = Join-Path $stage "latest.json"
Copy-Item -LiteralPath $installer -Destination $setupAsset
Copy-Item -LiteralPath $signature -Destination $sigAsset

if ([string]::IsNullOrEmpty($Notes)) { $Notes = "Refill Tracker $v" }
$signatureText = (Get-Content -Raw -LiteralPath $signature).Trim()
$release = [ordered]@{
  version = $v
  notes = $Notes
  pub_date = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = [ordered]@{
    "windows-x86_64" = [ordered]@{
      signature = $signatureText
      url = "https://github.com/Mario-Recondo/refill-tracker-releases/releases/download/v$v/refill-tracker_${v}_x64-setup.exe"
    }
  }
}
$json = $release | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText($latest, $json, (New-Object System.Text.UTF8Encoding($false)))

gh release create "v$v" --repo Mario-Recondo/refill-tracker-releases --title "Refill Tracker $v" --notes $Notes $setupAsset $sigAsset $latest
if ($LASTEXITCODE -ne 0) { throw "gh release create failed; if the tag already exists, bump the version or delete the release." }

Write-Host "Released Refill Tracker $v"
Write-Host "Asset URL: https://github.com/Mario-Recondo/refill-tracker-releases/releases/download/v$v/refill-tracker_${v}_x64-setup.exe"
Write-Host "Updater endpoint: https://github.com/Mario-Recondo/refill-tracker-releases/releases/latest/download/latest.json"
Write-Host "Installed apps will pick up the update on their next launch."
