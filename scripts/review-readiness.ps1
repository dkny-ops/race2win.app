$ErrorActionPreference = 'Stop'
$taskRepo = 'C:\Users\crist\Documents\Codex\race2win-readiness-20261010'
Set-Location -LiteralPath $taskRepo
function Invoke-Checked([string]$Command, [string[]]$Arguments) {
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Command failed: $LASTEXITCODE" }
}
if ((git rev-parse --show-toplevel).Replace('/','\') -ne $taskRepo) { throw 'Unexpected checkout' }
if ((git branch --show-current) -ne 'fix/production-readiness-20261010') { throw 'Unexpected branch' }
if ((git remote get-url origin) -ne 'https://github.com/dkny-ops/race2win.app.git') { throw 'Unexpected remote' }
Invoke-Checked git @('status','--short')
Invoke-Checked git @('diff','--check','e170955298847d4d56ff7f5d615627d6a9cb2cd2')
Invoke-Checked git @('diff','--stat','e170955298847d4d56ff7f5d615627d6a9cb2cd2')
$taskManifest = Get-Content -LiteralPath 'supabase/verification/production-pending-manifest.json' -Raw | ConvertFrom-Json
if ($taskManifest.pending.Count -ne 15 -or $taskManifest.productionExecutionAuthorized) { throw 'Invalid migration manifest' }
foreach ($taskMigration in $taskManifest.pending) {
  $taskHash = (Get-FileHash -LiteralPath (Join-Path 'supabase/migrations' $taskMigration.file) -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($taskHash -ne $taskMigration.sha256) { throw "Migration changed: $($taskMigration.file)" }
}
# The local DB runner has no remote connection capability. Clear service env
# during build/tests so even negative HTTP checks cannot use a remote project.
$taskNames = @('NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVICE_ROLE_KEY','RTW_ABUSE_HMAC_KEY','TURNSTILE_ENFORCEMENT_ENABLED')
$taskSaved = @{}
try {
  foreach ($taskName in $taskNames) { $taskSaved[$taskName] = [Environment]::GetEnvironmentVariable($taskName,'Process'); [Environment]::SetEnvironmentVariable($taskName,$null,'Process') }
  Invoke-Checked npm.cmd @('test')
  Invoke-Checked npm.cmd @('run','test:db')
  Invoke-Checked npm.cmd @('run','lint')
  Invoke-Checked npm.cmd @('run','typecheck')
  Invoke-Checked npm.cmd @('run','build')
} finally {
  foreach ($taskName in $taskNames) { [Environment]::SetEnvironmentVariable($taskName,$taskSaved[$taskName],'Process') }
}
Write-Output 'Local review passed. No push, deploy or Production migration executed.'
