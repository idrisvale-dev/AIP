# OpenCode Runtime — AIP Integration

AIP is the **Agents Intelligence Platform**: the AIP harness (agents, skills,
commands, hooks, rules, memory, workflows) combined with the **OpenCode
runtime** — the open-source coding agent — into one repository.

```
AIP (this repo)
│
├── opencode/          Vendored OpenCode runtime source (MIT, upstream)
│
├── .opencode/         AIP's plugin for OpenCode
│   ├── commands/      AIP commands (.md)
│   ├── tools/         AIP tools (TypeScript)
│   ├── plugins/       AIP hooks plugin (TypeScript)
│   ├── prompts/       AIP agent prompts
│   └── instructions/  AIP instructions
│
├── agents/ skills/ commands/ hooks/ rules/   AIP harness (harness-wide)
└── scripts/           AIP tooling (incl. scripts/build-opencode.js)
```

## What is vendored

- **Source:** https://github.com/anomalyco/opencode (MIT License)
- **Vendored commit:** `d6855b6b47a8433462ac6aeeba882ccf734cb7f1` (branch `dev`)
- **Location:** `opencode/` — a single, complete copy of the upstream tree.
  No duplicate copies exist elsewhere in this repo.
- **License:** `opencode/LICENSE` (MIT, Copyright (c) 2025 opencode).
  See also `THIRD_PARTY_NOTICES.md`.

> The vendored `opencode/.opencode/` directory is the upstream project's own
> internal configuration. AIP's user-facing OpenCode configuration lives at
> the repository root in `.opencode/` — that is the canonical AIP layer and it
> is intentionally kept separate so it is never overwritten by upstream.

## Running OpenCode

**Option A — official binary (recommended for users).** The runtime is also
distributed as a prebuilt binary, independent of this vendored copy:

```bash
curl -fsSL https://opencode.ai/install | bash
# or: npm i -g opencode-ai@latest
```

**Option B — build the vendored source.** Requires **Bun** (`bun@1.3.14`),
per `opencode/package.json`:

```bash
cd opencode
bun install
bun run dev            # runs the CLI from packages/opencode/src/index.ts
```

Other vendored-runtime entry points:

```bash
cd opencode && bun run lint        # oxlint
cd opencode && bun run typecheck   # bun turbo typecheck
```

## Driving OpenCode with AIP

1. Build AIP's OpenCode plugin payload:

   ```bash
   npm install
   npm run build:opencode          # compiles .opencode/**/*.ts -> .opencode/dist
   ```

2. Install AIP for the OpenCode harness:

   ```bash
   ./install.sh --profile full --target opencode
   ```

3. Run OpenCode inside any project — AIP's commands, tools, hooks, and prompts
   load through the plugin (20+ OpenCode event types, per the AIP release
   notes).

## npm scripts added by this integration

| Script | What it does |
|---|---|
| `npm run opencode:dev` | `cd opencode && bun install && bun run dev` |
| `npm run opencode:lint` | `cd opencode && bun run lint` |
| `npm run opencode:typecheck` | `cd opencode && bun run typecheck` |

## Notes

- The npm `files` allowlist does **not** include `opencode/`, so publishing
  `aip-universal` stays lean while the full runtime remains available in git.
- `scripts/ci/check-unicode-safety.js` and
  `scripts/ci/scan-supply-chain-iocs.js` ignore `opencode/` — it is vendored
  third-party code, not AIP-authored content.
