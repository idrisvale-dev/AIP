# ECC 2.2 release-readiness TDD evidence

Date: 2026-08-24

## Scope

This pass covers the release blockers found in the delta from `v2.1.0`: cumulative selective-install ownership, native Antigravity packaging, canonical OpenCode installation and conservative legacy migration, provider-neutral OpenCode agents, `skill-comply` distribution, conservative legacy Codex uninstall, release-workflow safety, and guided-install filesystem boundaries.

## RED

Commit `6e66dfba` added release regressions before the repairs. All six focused commands exited nonzero on the `origin/main` baseline:

- A second selective install retained only the second module in install-state.
- OpenCode resolved to `~/.opencode` instead of `~/.config/opencode`.
- Managed preflight accepted a plan without an install-state path.
- `skill-comply` was absent from the npm archive.
- Release workflows lacked registry-error discrimination, an exact-main gate, reviewed notes, and npm-first publication ordering.
- The packed lifecycle did not exercise Antigravity or OpenCode.

Commit `528dbea0` added a security regression proving guided preflight accepted an identical copy source through a symbolic link. It failed before the no-follow snapshot repair.

Commit `a504b194` added a release regression after review proved both workflows reused the literal 2.2.0 notes path for later valid versions. Both workflow cases failed before the version-derived notes repair.

Commit `55a2d482` added five OpenCode upgrade regressions. Discovery, uninstall, canonical reinstall, repair migration, and no-follow symlink preservation all failed before the legacy managed-root repair.

Commit `7d9f70c5` changed both workflow contracts to require the repository's established lowercase `release-notes.md` convention. Both cases failed against the uppercase 2.2-only path before the filename repair.

Commit `01779a4a` added final-review regressions for OpenCode configuration overrides, retained content digests, failed non-Claude install checkpoints, and reviewed-only GitHub Release notes. All four areas failed before the corresponding repairs.

Commit `dac154ef` added an end-to-end OpenCode override regression covering discovery, doctor, and uninstall through the same explicit configuration root. It failed before environment-aware lifecycle routing.

The full suite then exposed three guided Kimi collision checks that rejected ECC's own new bridge checkpoint before reaching the protected destination. Commit `15815eca` advanced the expected fingerprint only for ECC-authored state writes while preserving every external state and destination collision check.

## GREEN

- Focused installer, lifecycle, packaging, release-workflow, manifest, OpenCode, Antigravity, and uninstall tests passed.
- Full repository suite: 3,975 passed, 0 failed.
- `npm audit --audit-level=low`: 0 vulnerabilities.
- Supply-chain IOC scan: 207 files inspected, no findings.
- Both release workflow YAML files parsed successfully.
- Both release workflows derive reviewed notes from the validated tag and fail clearly when that version's notes are absent.
- Release-note selection follows the lowercase filename convention shared by prior release directories.
- Exact packed archive lifecycle passed on macOS with Node 24.9.0 using SHA-256 `b657daa563f7cc4faa7ff8bd0c00ff8b329f2a7a3a095848dac4854a33f05ea3`.
- The packed lifecycle covered npm installation, public CLI setup, cumulative Cursor install, drift detection, repair, uninstall, user-file preservation, Antigravity install/doctor/uninstall, and OpenCode install/doctor/uninstall.

## Focused coverage

All three changed core modules exceeded the 80 percent line target:

| Module | Lines | Functions | Branches |
| --- | ---: | ---: | ---: |
| `scripts/lib/multi-harness-setup.js` | 89.01% | 83.87% | 74.30% |
| `scripts/lib/install/claude-skill-migration.js` | 95.20% | 100% | 88.78% |
| `scripts/lib/install-targets/opencode-home.js` | 86.66% | 100% | 78.94% |
| `scripts/lib/opencode-paths.js` | 100% | 100% | 91.66% |
| `scripts/lib/install/opencode-legacy-migration.js` | 82.24% | 100% | 68.29% |

Coverage commands used `c8 --check-coverage --lines 80` against the corresponding focused test files.

## Release boundary

No merge, release tag, GitHub Release, or npm publication was performed during this pass.
