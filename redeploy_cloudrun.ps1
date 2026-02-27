# redeploy_cloudrun.ps1
# Reads .env, generates correct env-vars YAML, and does a fresh Cloud Run deploy.
# Usage: powershell -ExecutionPolicy Bypass -File redeploy_cloudrun.ps1

$region    = "europe-west8"
$service   = "mcbackendapp"
$projectId = "munawware-care"
$envFile   = Join-Path $PSScriptRoot ".env"
$yamlFile  = Join-Path $PSScriptRoot "_cloudrun_env.yaml"
$serviceUrl = "https://mcbackendapp-199324116788.europe-west8.run.app"

# ── Ensure gcloud is on the PATH ─────────────────────────────────────────────
$gcloudBin = "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin"
if (Test-Path "$gcloudBin\gcloud.cmd") {
    $env:PATH = "$gcloudBin;$env:PATH"
}
$gcloud = "gcloud"

# ── 1. Convert .env → YAML for --env-vars-file ─────────────────────────────
$yamlLines = @()

foreach ($line in (Get-Content $envFile)) {
    # Skip blank lines and comments
    if ($line -match '^\s*$' -or $line -match '^\s*#') { continue }

    if ($line -match '^([^=]+)=(.*)$') {
        $key   = $Matches[1].Trim()
        $value = $Matches[2].Trim()

        # PORT is reserved by Cloud Run — skip it entirely
        if ($key -eq 'PORT') { continue }
        # Override BASE_URL to point to the deployed Cloud Run URL
        if ($key -eq 'BASE_URL') { $value = $serviceUrl }

        # Escape single quotes inside value (YAML single-quoted string rule)
        $valueEscaped = $value -replace "'", "''"
        $yamlLines += "${key}: '${valueEscaped}'"
    }
}

$yamlLines | Set-Content $yamlFile -Encoding UTF8
Write-Host "`n[1/3] Generated env file: $yamlFile ($($yamlLines.Count) variables)"

# ── 2. Delete the existing service ──────────────────────────────────────────
Write-Host "`n[2/3] Deleting existing service '$service'..."
gcloud run services delete $service --region $region --project $projectId --quiet

# ── 3. Fresh deploy from source with all env vars ───────────────────────────
Write-Host "`n[3/3] Deploying '$service' from source..."
gcloud run deploy $service `
    --source . `
    --region $region `
    --project $projectId `
    --allow-unauthenticated `
    --timeout 3600 `
    --min-instances 1 `
    --max-instances 1 `
    --session-affinity `
    --env-vars-file $yamlFile

# ── Cleanup temp file ────────────────────────────────────────────────────────
Remove-Item $yamlFile -ErrorAction SilentlyContinue
Write-Host "`nDone. Service URL: $serviceUrl"
