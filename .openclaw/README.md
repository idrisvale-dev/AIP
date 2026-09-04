# AIP for OpenClaw

This directory contains the AIP (AIP) configuration for the OpenClaw harness.

## What is installed

- `rules/aip/` — shared coding rules and guidelines
- `skills/aip/` — reusable skills
- `commands/` — slash commands
- `AGENTS.md` — agent instructions

## Manual install

```bash
bash ./install.sh --target openclaw --profile minimal
```

## Notes

- OpenClaw config files (`openclaw.json`, `config.toml`, `.env`, etc.) are **not** touched by AIP install.
- Use `npx aip-universal doctor --target openclaw` to check install health.
