# Engineering Program Management Operating Model

**Role:** Technical Program Manager  
**Goal:** Coordinate parallel engineering streams and de-risk merges.

## 1) Tracking Board Configuration

Use **GitHub Projects** as the default tracking board (Notion/Trello are acceptable alternatives when required by partner teams).

### Required columns
1. **Backlog**
2. **In Progress**
3. **Review**
4. **Blocked**
5. **Merged**

### Card fields (required)
- Workstream
- Owner (single owner only)
- Linked issue
- Linked PR
- Risk level (Low / Medium / High)
- Target merge date
- Blockers

## 2) Ownership Matrix (Single-threaded ownership)

Each workstream must have exactly one directly responsible individual (DRI). No shared ownership.

| Workstream | Scope | Owner (DRI) | Backup Reviewer |
| --- | --- | --- | --- |
| Release Gates | CI checks, release checklist automation, deployment gates | `@release-dri` | `@platform-reviewer` |
| Runtime Correctness | Core wallet/runtime behavior and regressions | `@runtime-dri` | `@backend-reviewer` |
| Security | Auth hardening, secrets handling, threat mitigations | `@security-dri` | `@security-reviewer` |
| Validation & Rate Limits | Input/schema validation and abuse controls | `@validation-dri` | `@api-reviewer` |
| Metadata & Docs | Changelogs, docs, metadata consistency | `@docs-dri` | `@docs-reviewer` |

> Replace placeholder handles with actual assignees in the board before kickoff.

## 3) SLA Cadence

- **First PR SLA:** initial PR must be opened within **24 hours** of a workstream moving to *In Progress*.
- **Review turnaround SLA:** requested review must receive response within **4 hours** during team working hours.

### Escalation policy
- SLA miss once: notify DRI + reviewer in project thread.
- SLA miss twice in a week: escalate to TPM + Engineering Manager.
- Blocked > 8 working hours: move card to **Blocked** and post unblock plan.

## 4) Branch Naming Convention

Use lowercase kebab-case with `<type>/<stream-description>`:

- `feat/security-auth-hardening`
- `fix/wallet-route-regression`
- `chore/release-gates-ci-tuning`
- `docs/metadata-release-notes`

Allowed types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`.

## 5) PR Quality Gate Template (Required Fields)

Every PR description must include:

1. **Risk level**
2. **Test evidence**
3. **Rollback plan**
4. **Migration impact**

PRs missing any required field should be marked **changes requested** until complete.

## 6) Merge Sequence (Strict Order)

Merge in this exact order:

1. **Release gates**
2. **Runtime correctness**
3. **Security**
4. **Validation / rate limits**
5. **Metadata / docs**

No downstream merge starts until upstream stream is green or explicitly waived by TPM + EM.

## 7) Post-merge Release Checklist + Status Summary

After **each merge**, run the full release checklist and publish a status summary in the team channel.

### Release checklist (minimum)
- CI required checks all green
- Integration tests green
- Security checks/lint scans green
- Migrations reviewed/applied (if any)
- Rollback path verified
- Release notes updated

### Daily status update format

```md
## Daily Program Status — YYYY-MM-DD

### Overall Health
- Status: Green / Yellow / Red
- Risks: <top 1-3 risks>

### Stream Updates
- Release Gates — Owner: @... — Status: <Backlog/In Progress/Review/Blocked/Merged>
  - Progress: ...
  - PR: ...
  - SLA: first PR <met/missed>, review turnaround <met/missed>
  - Blockers: ...

- Runtime Correctness — Owner: @... — Status: ...
  - Progress: ...
  - PR: ...
  - SLA: ...
  - Blockers: ...

- Security — Owner: @... — Status: ...
  - Progress: ...
  - PR: ...
  - SLA: ...
  - Blockers: ...

- Validation/Rate Limits — Owner: @... — Status: ...
  - Progress: ...
  - PR: ...
  - SLA: ...
  - Blockers: ...

- Metadata/Docs — Owner: @... — Status: ...
  - Progress: ...
  - PR: ...
  - SLA: ...
  - Blockers: ...

### Merge Queue (in order)
1. Release gates: <ready/not ready>
2. Runtime correctness: <ready/not ready>
3. Security: <ready/not ready>
4. Validation/rate limits: <ready/not ready>
5. Metadata/docs: <ready/not ready>

### Actions Before Next Sync
- [ ] ...
- [ ] ...
```

## 8) Immediate Execution Runbook

For command-first execution (sync, gate checks, RC/stable tagging, and branch dispatch), use:

- `docs/NEXT_ACTION_COMMANDS.md`
