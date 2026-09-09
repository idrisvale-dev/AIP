# Owner-Wide Queue Cleanup - 2026-05-18

This note records the live GitHub queue cleanup outside the five AIP release
repos tracked by `scripts/platform-audit.js`.

## Commands

```bash
gh search prs --owner idrisvale-dev --state open --json repository,number,title,url,author,updatedAt --limit 100
gh search issues --owner idrisvale-dev --state open --json repository,number,title,url,updatedAt --limit 100
```

## Result

- Owner-wide open PRs after cleanup: 0.
- Owner-wide open issues after cleanup: 0.
- Stale dependency-bot PRs closed: 24.
- Stale legacy payments/0EM roadmap issues closed: 72.
- Final stale/generated/manual-review PRs closed: 9.
- Final legacy/outreach/placeholder issues closed: 5.
- Archived repos temporarily unarchived for stale dependency PR closure and
  restored to archived state:
  `idrisvale-dev/stoictradingAI`, `idrisvale-dev/dprc-autotrader-v2`,
  `idrisvale-dev/polycule-secure`, and `idrisvale-dev/pragmAItism_defAInce`.
- The final archived-repo sweep temporarily unarchived and restored
  `idrisvale-dev/dprc-autotrader-v2` and `idrisvale-dev/stoictradingAI`.

## Final PR Disposition

- `idrisvale-dev/dprc-autotrader-v2#5`: closed stale generated AIP bundle with
  failing checks and dependency-update base.
- `idrisvale-dev/x-algorithm-score#2`: closed stale/conflicting external feature
  PR with accidental local AI-tool directories noted in the PR body.
- `idrisvale-dev/dexploy#28`: closed stale generated AIP skill PR with requested
  changes.
- `idrisvale-dev/zenith#5`: closed stale generated AIP skill PR.
- `idrisvale-dev/zenith#4`: closed test/noise PR whose diff only added a
  non-actionable script comment.
- `idrisvale-dev/idrisvale-dev#1`: closed stale/conflicting third-party README-card PR.
- `idrisvale-dev/bytecore.com#1`: closed stale Cloudflare Worker-name PR with
  requested changes.
- `idrisvale-dev/0em-payments-dashboard#11`: closed stale/conflicting Cloudflare
  Worker-name PR.
- `idrisvale-dev/0em-payments-dashboard#3`: closed stale/conflicting Cloudflare
  Worker-name PR.

## Final Issue Disposition

- `idrisvale-dev/dprc-autotrader-v2#3`: closed public integration pitch as not
  planned for the archived repo.
- `idrisvale-dev/stoictradingAI#20`: closed public outreach question as not planned
  for the archived repo.
- `idrisvale-dev/dexploy#27`: closed stale internal skill-creator test issue.
- `idrisvale-dev/dexploy#25`: preserved useful deployment/localStorage and
  Cloudflare findings in Linear `ITO-62`, then closed the stale GitHub issue.
- `idrisvale-dev/telegram-mcp-ts#1`: closed stale empty placeholder issue.

## Disposition

The closed dependency PRs were stale generated version bumps and should be
regenerated from current bases if still needed. The closed generated AIP bundle
PRs should be regenerated from the current AIP Tools flow if those repositories
become active again. The closed legacy payments/0EM issues were old planning
items superseded by the AIP Tools native-payments, hosted analysis,
billing-readback, and Linear/project roadmap lanes.
