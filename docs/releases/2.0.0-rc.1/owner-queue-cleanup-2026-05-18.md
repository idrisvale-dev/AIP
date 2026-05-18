# Owner-Wide Queue Cleanup - 2026-05-18

This note records the live GitHub queue cleanup outside the five ECC release
repos tracked by `scripts/platform-audit.js`.

## Commands

```bash
gh search prs --owner affaan-m --state open --json repository,number,title,url,author,updatedAt --limit 100
gh search issues --owner affaan-m --state open --json repository,number,title,url,updatedAt --limit 100
```

## Result

- Owner-wide open PRs after cleanup: 9.
- Owner-wide open issues after cleanup: 5.
- Stale dependency-bot PRs closed: 24.
- Stale legacy payments/0EM roadmap issues closed: 72.
- Archived repos temporarily unarchived for stale dependency PR closure and
  restored to archived state:
  `affaan-m/stoictradingAI`, `affaan-m/dprc-autotrader-v2`,
  `affaan-m/polycule-secure`, and `affaan-m/pragmAItism_defAInce`.

## Remaining Open PRs

- `affaan-m/dprc-autotrader-v2#5`: feat: add dprc-autotrader-v2 ECC bundle
- `affaan-m/x-algorithm-score#2`: Add onboarding flow, history tracking, and dashboard analytics
- `affaan-m/dexploy#28`: feat: add dexploy skill
- `affaan-m/zenith#5`: feat: add zenith skill
- `affaan-m/zenith#4`: fix: unchecked race condition in websocket to webhook stream
- `affaan-m/affaan-m#1`: Update README.md
- `affaan-m/affaanmustafa.com#1`: Update name in Wrangler configuration file to match deployed Worker
- `affaan-m/0em-payments-dashboard#11`: Update name in Wrangler configuration file to match deployed Worker
- `affaan-m/0em-payments-dashboard#3`: Update name in Wrangler configuration file to match deployed Worker

## Remaining Open Issues

- `affaan-m/dprc-autotrader-v2#3`: MEEET STATE - On-Chain Economy for AI Agents
- `affaan-m/stoictradingAI#20`: Quick Q: your #1 friction in Solana bot execution?
- `affaan-m/dexploy#27`: Generate Skill from Repo Analysis
- `affaan-m/dexploy#25`: Progress on the deployments problem so far
- `affaan-m/telegram-mcp-ts#1`: review the updates and the workflow before connection with the frontend

## Disposition

The closed dependency PRs were stale generated version bumps and should be
regenerated from current bases if still needed. The closed legacy payments/0EM
issues were old planning items superseded by the ECC Tools native-payments,
hosted analysis, billing-readback, and Linear/project roadmap lanes.
