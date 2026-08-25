# ECC 2.2.0

ECC 2.2.0 makes the universal installer a first-class, cross-harness distribution path. It adds native Antigravity 2.0 support, repairs cumulative install ownership, aligns OpenCode with its canonical configuration directory, and strengthens the exact-artifact release gate.

## Installer and harness reliability

- Antigravity installs natively to `.agents/{rules,workflows,skills,agents}`. Do not manually rename a legacy `.agent` directory. Re-run ECC 2.2.0 so the installer can apply its ownership-aware migration rules.
- Repeated selective installs retain the complete managed ownership ledger. A later module install no longer causes previously installed ECC files to survive uninstall.
- OpenCode home installs use `~/.config/opencode`. Reinstall or repair discovers legacy `~/.opencode` ownership, migrates unchanged ECC-managed files, and preserves modified files for review. Bundled agent definitions inherit the user's selected model provider.
- Legacy Codex sync cleanup requires ownership evidence by default and preserves untracked or modified user files.
- Nasiko lifecycle locks recover only when their recorded owner is confirmed dead. Its pinned archive parser rejects malformed boundaries, and incomplete uninstall cleanup returns an error with retained-file guidance.
- `skill-comply` is included in both the install graph and npm archive. Python bytecode and pytest caches remain excluded.

## New capabilities

- Guided multi-harness setup and stronger doctor, repair, status, and uninstall flows.
- Native Antigravity 2.0 documentation for Bash and PowerShell.
- Expanded Itô, Nasiko, agent-evaluation, multi-model council, dev-team, living-docs, secure terminal, Pi, and TasteForge workflows.
- Improved Plan Canvas, memory vault, continuous learning, skill evolution, hook stability, session handling, and Discord delivery.

## Release assurance

- The release workflow requires the tagged commit to equal `origin/main` exactly.
- npm registry failures stop the release instead of being treated as an unpublished version.
- The exact packed archive is hashed once and exercised on Linux, macOS, and Windows before publication.
- The verified npm archive is published before the matching GitHub Release is created. A retry verifies byte-for-byte registry integrity.

## Upgrade

Install or update the published package, then run the same ECC install command you used previously:

```bash
npm install -g ecc-universal@2.2.0
ecc install --target antigravity --profile full
```

Use `ecc doctor --target <target>` after installation. For Antigravity, start a new conversation and verify workspace skills under Settings > Customizations.

## Scope audited

The pre-release audit covered the complete delta from `v2.1.0`: 108 commits, 530 changed files, 40,299 insertions, and 4,679 deletions before the final readiness patch.
