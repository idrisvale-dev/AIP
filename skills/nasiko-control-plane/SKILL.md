---
name: nasiko-control-plane
description: Use the experimental Nasiko CLI lifecycle bridge for pinned installation, read-only status, and qualified uninstall with explicit consent and telemetry and secrets boundaries.
---

# Nasiko CLI Lifecycle Bridge

Use this skill when a user explicitly asks AIP to install, inspect, or remove
the qualified Nasiko CLI. This skill does not operate a Nasiko control plane.

## Safety contract

- Begin with `aip nasiko status --json`. Status is read-only.
- Installation always requires explicit user consent and `--yes`.
- Install only an AIP-qualified pinned version, currently `v0.1.0`.
- Preview first with `aip nasiko install --version v0.1.0 --dry-run --json`.
- Install with `aip nasiko install --version v0.1.0 --yes --json` only after the
  user reviews the version, registry origin, digest, and destination.
- Remove only a still-qualified AIP-managed binary with
  `aip nasiko uninstall --version v0.1.0 --yes --json`. Preview removal with
  `--dry-run` first.
- The qualified source is `https://github.com/Nasiko-Labs/nasiko`, licensed
  under Apache-2.0; artifact and extracted-binary SHA-256 values are pinned.
- Never replace the qualified command with a downloaded shell or PowerShell
  bootstrap script.
- Never put secrets or credentials in command arguments, logs, skill output,
  install metadata, or AIP state.
- Nasiko telemetry and any sharing with Nasiko or Ito must be opt-in and
  separately disclosed. Installation is not telemetry consent.

## Lifecycle boundary

The initial AIP bridge supports qualified installation, read-only status, and
ownership-checked uninstall. Use the canonical Nasiko CLI directly for connection, authentication,
launch, deployment, or shutdown until those verbs have their own verified AIP
contracts. Do not guess CLI verbs.

Installing the CLI does not prove that a control-plane server is running, an
agent is governed, routing or ACLs work, observability is complete, telemetry
was enabled, or Ito compute is connected. Report each state separately.

## Failure behavior

- If the platform, architecture, version, manifest, digest, archive, binary, or
  destination fails validation, stop without executing the artifact.
- Do not fall back to `latest`.
- Do not search arbitrary `PATH` entries. Use AIP's qualified location or an
  explicit absolute `AIP_NASIKO_CLI_EXECUTABLE` for development verification.
- Do not treat a partial or ambiguous installation as success.
