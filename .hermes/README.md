# AIP for Hermes

This directory contains the AIP (AIP) configuration for the Hermes harness.

## What is installed

- `rules/aip/` — shared coding rules and guidelines
- `skills/aip/` — reusable skills
- `commands/` — slash commands
- `AGENTS.md` — agent instructions

## Manual install

```bash
bash ./install.sh --target hermes --profile minimal
```

## Notes

- Hermes config files (`config.yaml`, `.env`, etc.) are **not** touched by AIP install.
- Use `npx aip-universal doctor --target hermes` to check install health.
