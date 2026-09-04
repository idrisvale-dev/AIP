# Antigravity Setup and Usage Guide

Google Antigravity 2.0 discovers workspace customizations from the project-local
`.agents/` directory. AIP's Antigravity target installs native rules, workflows,
skills, and custom agents into that directory.

Native Antigravity 2.0 installation requires AIP 2.2.0 or newer. AIP 2.1.0 uses
the legacy `.agent/` adapter and does not provide the native layout described
below.

## Quick start

Verify that 2.2.0 is readable from the registry, then run the pinned package
from the project you want to configure:

```bash
npm view aip-universal version
npx aip-universal@2.2.0 install --profile minimal --target antigravity
```

### Source checkout alternative

```bash
# Run every command below from the project you want to configure.
# Keep the AIP source checkout separate and use its absolute path.
AIP_ROOT="/absolute/path/to/AIP"

# Install the minimal profile
"$AIP_ROOT/install.sh" --profile minimal --target antigravity

# Compatibility syntax: common rules plus only these language packs
"$AIP_ROOT/install.sh" --target antigravity typescript python go
```

PowerShell uses the same project-root working-directory contract:

```powershell
$AipRoot = "C:\absolute\path\to\AIP"

& "$AipRoot\install.ps1" --profile minimal --target antigravity
& "$AipRoot\install.ps1" --target antigravity typescript python go
```

Start a new Antigravity conversation after installing so the agent receives the
updated skill inventory.

## Native install mapping

| AIP source | Antigravity destination | Purpose |
|---|---|---|
| `rules/` | `.agents/rules/` | Workspace rules, flattened with collision-safe names |
| `commands/` | `.agents/workflows/` | User-invoked slash workflows |
| `skills/<name>/` | `.agents/skills/<name>/` | Agent Skills with a required `SKILL.md` |
| `agents/<name>.md` | `.agents/agents/<name>.md` | Custom main agents and subagents |

AIP does not copy the repository's `.agents/` directory wholesale. That source
tree is Codex packaging and contains Codex-specific marketplace metadata. An
Antigravity plugin instead requires `.agents/plugins/<plugin-name>/plugin.json`.

Installed custom agent definitions are adapted to Antigravity's frontmatter:
Claude model tiers become `flash` or `pro`, and Claude tool names become their
Antigravity equivalents. Unsupported tool identifiers are never emitted because
Antigravity warns that invalid tool names can hang custom-agent execution.

## Expected project tree

```text
your-project/
└── .agents/
    ├── rules/
    │   ├── common-coding-style.md
    │   └── typescript-testing.md
    ├── workflows/
    │   └── plan.md
    ├── skills/
    │   └── coding-standards/
    │       └── SKILL.md
    ├── agents/
    │   └── code-reviewer.md
    └── aip-install-state.json
```

## Verify the installation

macOS and Linux:

```bash
node "$AIP_ROOT/scripts/list-installed.js" --target antigravity
node "$AIP_ROOT/scripts/doctor.js" --target antigravity
rg --files .agents/skills -g 'SKILL.md'
rg --files .agents/agents -g '*.md'
```

PowerShell:

```powershell
node "$AipRoot\scripts\list-installed.js" --target antigravity
node "$AipRoot\scripts\doctor.js" --target antigravity
Get-ChildItem .agents\skills -Recurse -Filter SKILL.md
Get-ChildItem .agents\agents -Recurse -Filter *.md
```

In Antigravity, open **Settings > Customizations**, confirm that workspace
skills appear, start a new conversation, and request one by its exact name.

## Existing `.agent/` installations

Antigravity still reads legacy `.agent/rules` and `.agent/skills`, but AIP now
uses the canonical `.agents/` layout. Do not rename `.agent` manually because
AIP install-state contains absolute managed paths.

Rerun the same AIP install command after updating. AIP writes and verifies the
new `.agents/aip-install-state.json` first, then removes only unchanged files
owned by the valid legacy state. Modified and unmanaged files remain in
`.agent/` and remain discoverable by doctor and uninstall until handled.

Preview lifecycle operations before applying them when desired:

macOS and Linux:

```bash
node "$AIP_ROOT/scripts/doctor.js" --target antigravity
node "$AIP_ROOT/scripts/repair.js" --target antigravity --dry-run
node "$AIP_ROOT/scripts/uninstall.js" --target antigravity --dry-run
```

PowerShell:

```powershell
node "$AipRoot\scripts\doctor.js" --target antigravity
node "$AipRoot\scripts\repair.js" --target antigravity --dry-run
node "$AipRoot\scripts\uninstall.js" --target antigravity --dry-run
```

## Troubleshooting

### Skills do not appear

- A valid skill must be `.agents/skills/<name>/SKILL.md`.
- `.agent/.agents/skills` is an obsolete nested layout from older AIP builds.
- Start a new conversation after changing skill files.

### Rules do not apply

- Confirm the files are directly under `.agents/rules/`.
- Run doctor and inspect any missing or drifted managed-file warning.

### Workflows do not appear

- Confirm the files are under `.agents/workflows/`.
- Invoke a workflow with `/<workflow-name>` after restarting Antigravity.

## Official Antigravity references

- [Skills](https://antigravity.google/docs/skills)
- [Rules and workflows](https://antigravity.google/docs/rules-workflows)
- [Custom agents and subagents](https://antigravity.google/docs/subagents)
- [Plugins](https://antigravity.google/docs/plugins)

See [CONTRIBUTING.md](../CONTRIBUTING.md) for AIP contribution guidance and
[SELECTIVE-INSTALL-ARCHITECTURE.md](SELECTIVE-INSTALL-ARCHITECTURE.md) for the
installer lifecycle contract.
