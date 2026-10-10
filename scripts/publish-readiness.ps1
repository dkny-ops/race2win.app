param([switch]$AuthorizedPush, [switch]$VercelPushBehaviorReviewed, [string]$ExpectedHead)
$ErrorActionPreference = 'Stop'
if (-not $AuthorizedPush -or -not $VercelPushBehaviorReviewed) { throw 'Requires future push authorization AND review of automatic Vercel deployments. Nothing published.' }
if ($ExpectedHead -notmatch '^[0-9a-f]{40}$') { throw 'Specify the exact reviewed commit as ExpectedHead' }
$taskRepo = 'C:\Users\crist\Documents\Codex\race2win-readiness-20261010'
$taskBranch = 'fix/production-readiness-20261010'
Set-Location -LiteralPath $taskRepo
if ((git rev-parse --show-toplevel).Replace('/','\') -ne $taskRepo) { throw 'Unexpected checkout' }
if ((git branch --show-current) -ne $taskBranch) { throw 'Unexpected branch' }
if ((git remote get-url origin) -ne 'https://github.com/dkny-ops/race2win.app.git') { throw 'Unexpected remote' }
if ((git rev-parse HEAD) -ne $ExpectedHead) { throw 'HEAD changed. Re-review before publishing.' }
$taskChanges = @(git status --porcelain)
if ($LASTEXITCODE -ne 0 -or $taskChanges.Count -ne 0) { throw 'Uncommitted changes; review first' }
git merge-base --is-ancestor e170955298847d4d56ff7f5d615627d6a9cb2cd2 HEAD
if ($LASTEXITCODE -ne 0) { throw 'Unexpected ancestry' }
$taskRemoteMain = @(git ls-remote --heads origin refs/heads/main)
if ($LASTEXITCODE -ne 0 -or $taskRemoteMain.Count -ne 1 -or -not $taskRemoteMain[0].StartsWith('54418b612dae37a83b804beddb0d68643eae12da')) { throw 'Remote main changed or unavailable. Re-review in isolation.' }
$taskRemoteBranch = @(git ls-remote --heads origin "refs/heads/$taskBranch")
if ($LASTEXITCODE -ne 0 -or $taskRemoteBranch.Count -ne 0) { throw 'Remote branch exists or unavailable; do not overwrite' }
git push --set-upstream origin $taskBranch
if ($LASTEXITCODE -ne 0) { throw 'Push failed' }
Write-Output 'Branch published. No merge or Production migration executed; Vercel may follow its reviewed Git integration behavior.'
