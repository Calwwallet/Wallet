# Next Action Commands (Coordinator Runbook)

This runbook is designed for the coordinator to execute immediately after all stream PRs are merged.

## 1) Sync and validate repository state

```bash
git checkout main
git pull origin main
git status --short
```

Expected: clean working tree before release actions.

## 2) Run release gate checks (same commands as CI)

### Backend service

```bash
cd agent-wallet-service
npm ci
npm test
cd ..
```

### Dashboard

```bash
cd agent-wallet-service-dashboard
npm ci
npm run build
cd ..
```

### Python SDK

```bash
cd agent-wallet-service-python
python -m pip install -e .
python -m pytest
cd ..
```

If any check fails, create a hotfix branch with the failure in the branch name:

```bash
git checkout -b fix/release-blocker-<short-description>
```

## 3) RC tag sequence

Create and push an RC tag once all gates pass.

```bash
git tag -a v0.2.0-rc1 -m "Release candidate v0.2.0-rc1"
git push origin v0.2.0-rc1
```

## 4) 24-hour soak monitoring checklist

Track these signals during soak:
- Error rate and crash loops
- Auth failures (401/403) trend
- Rate limit response trend (429)
- Wallet flow success rate (create/send/balance)
- Webhook delivery success

If severe regression appears:

```bash
# rollback example (replace with previous stable tag)
git checkout main
git revert <bad-commit-sha>
git push origin main
```

## 5) Stable release tag sequence

After successful soak and Go decision:

```bash
git tag -a v0.2.0 -m "Stable release v0.2.0"
git push origin v0.2.0
```

## 6) Agent dispatch commands for parallel follow-up work

Use these branch commands when new streams are required.

```bash
git checkout main && git pull origin main

git checkout -b codex/rc-smoke-matrix && git push -u origin codex/rc-smoke-matrix
git checkout main && git checkout -b codex/security-final-audit && git push -u origin codex/security-final-audit
git checkout main && git checkout -b codex/ops-readiness-bundle && git push -u origin codex/ops-readiness-bundle
git checkout main && git checkout -b codex/hybrid-oss-docs && git push -u origin codex/hybrid-oss-docs
git checkout main && git checkout -b codex/release-tag-and-notes && git push -u origin codex/release-tag-and-notes
```
