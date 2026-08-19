/**
 * Contract tests for the curated TasteForge video skill.
 * No test contacts Fal, generates media, or mutates any provider account.
 */

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.join(__dirname, "..", "..");

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

const tests = [];
function test(name, fn) { tests.push([name, fn]); }

test("has valid discoverable frontmatter and trigger phrases", () => {
  const skill = read("skills/tasteforge-video/SKILL.md");
  assert.match(
    skill,
    /^---\nname: tasteforge-video\ndescription: [^\n]+\nmetadata:\n {2}origin: ECC\n---\n/
  );
  for (const trigger of [
    /interview .*video taste|video .*taste interview/i,
    /distill .*aesthetic .*structured/i,
    /validate a style pack/i,
    /apply a style pack to local footage/i,
    /export EDL\/FCPXML|export .*EDL.*FCPXML/i,
    /audit .*generated-media provenance|provenance audit/i,
  ]) assert.match(skill, trigger);
});

test("distinguishes local deterministic operations from provider generation", () => {
  const skill = read("skills/tasteforge-video/SKILL.md");
  assert.match(skill, /local, deterministic/i);
  assert.match(skill, /provider generation/i);
  assert.match(skill, /must fail closed/i);
  assert.match(skill, /explicit separately authorized execution/i);
  assert.match(skill, /ECC never calls Fal/i);
  assert.match(
    skill,
    /never\s+reads\s+any\s+API\s+key\s+or\s+other\s+credentials/i,
    "skill must state that no API key or credentials are read"
  );
});

test("never claims a Fal workflow is saved from a local reference", () => {
  const skill = read("skills/tasteforge-video/SKILL.md");
  assert.match(
    skill,
    /never (?:claim|means|treat)[^.]*provider-side workflow (?:is|was) saved/i
  );
  assert.match(skill, /reference[- ]only/i);
  assert.match(skill, /dry[- ]run|dry_run/i);
});

test("links to the canonical ito-video implementation instead of duplicating it", () => {
  const skill = read("skills/tasteforge-video/SKILL.md");
  assert.match(skill, /ito-video/i);
  assert.match(skill, /Ito-Markets\/ito-video/i);
  assert.match(skill, /python3 -m tasteforge/);
  assert.match(skill, /does not (?:vendor|duplicate|copy)/i);
});

test("describes the deterministic workflow surface faithfully", () => {
  const skill = read("skills/tasteforge-video/SKILL.md");
  for (const cmd of ["inspect", "validate", "interview", "distill", "apply", "export", "provenance"]) {
    assert.match(skill, new RegExp(`\\b${cmd}\\b`));
  }
  assert.match(skill, /schema/i);
  assert.match(skill, /cadence/i);
  assert.match(skill, /style pack/i);
});

test("defines the fail-closed file-driven multimodal contract", () => {
  const skill = read("skills/tasteforge-video/SKILL.md");
  assert.match(skill, /python3 -m tasteforge multimodal --config/);
  for (const phrase of [
    /Flash Ethereal/,
    /3D Cyber Glitch/,
    /Fluid Sketch/,
    /image.*video.*3D-asset/is,
    /seeded aperiodic/i,
    /subject anchor/i,
    /placement constraints/i,
    /provider_execution:\s*false/i,
    /path.*byte size.*SHA-256/is,
    /genre.*modality/is,
    /exact reference\/time provenance/i,
    /provider_calls:\s*0/i,
  ]) assert.match(skill, phrase);
  assert.match(skill, /missing.*manifest.*fail closed/is);
  assert.match(skill, /tamper.*fail closed/is);
});

test("ships through the opt-in media-generation install module and npm package", () => {
  const modules = readJson("manifests/install-modules.json").modules;
  const module = modules.find((candidate) => candidate.id === "media-generation");
  assert.ok(module, "media-generation install module is missing");
  assert.ok(
    module.paths.includes("skills/tasteforge-video"),
    "skills/tasteforge-video missing from media-generation paths"
  );
  assert.strictEqual(module.defaultInstall, false);
  const packed = readJson("package.json").files;
  assert.ok(
    packed.includes("skills/tasteforge-video/"),
    "skills/tasteforge-video/ missing from npm files"
  );
});

test("is discoverable in the source tree and in a simulated packed artifact", () => {
  const skillPath = path.join(REPO_ROOT, "skills", "tasteforge-video", "SKILL.md");
  assert.ok(fs.existsSync(skillPath), "SKILL.md missing in source tree");

  // Packed surface: npm includes the directory; the plugin manifest routes
  // ./skills/ wholesale; nothing ignores the directory.
  const npmignore = read(".npmignore");
  const ignoresSkill = npmignore
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .some((line) => {
      const normalized = line.replace(/\/+$/, "");
      return (
        normalized === "skills" ||
        normalized === "skills/tasteforge-video" ||
        normalized === "skills/tasteforge-video/SKILL.md"
      );
    });
  assert.ok(!ignoresSkill, ".npmignore must not exclude the skill");

  const claudePlugin = readJson(".claude-plugin/plugin.json");
  assert.ok(
    (claudePlugin.skills || []).includes("./skills/"),
    "claude plugin skills must route to the root skills/ directory"
  );

  // Simulated installed layout: the files entry must name the skill dir and
  // the SKILL.md must exist beneath it with non-empty content.
  const stat = fs.statSync(path.join(REPO_ROOT, "skills", "tasteforge-video"));
  assert.ok(stat.isDirectory(), "skill must be a directory");
  assert.ok(fs.readFileSync(skillPath, "utf8").trim().length > 200, "SKILL.md is empty-ish");
});

test("passes the curated skill validator", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, "scripts", "ci", "validate-skills.js")],
    { encoding: "utf8" }
  );
  assert.strictEqual(result.status, 0, `validate-skills failed:\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout + result.stderr, /skill director/i, "validator output unrecognized");
});

// Opt-in slow path: verifies the real npm tarball contents. Enabled with
// ECC_TEST_NPM_PACK=1 (release/CI verification); the default suite relies on
// the files-array assertions above.
test("ships inside the real npm tarball (opt-in)", () => {
  if (process.env.ECC_TEST_NPM_PACK !== "1") return;
  const result = spawnSync("npm", ["pack", "--dry-run"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.strictEqual(result.status, 0, `npm pack failed:\n${result.stderr}`);
  assert.match(
    result.stdout + result.stderr,
    /skills\/tasteforge-video\/SKILL\.md/,
    "SKILL.md missing from npm tarball contents"
  );
});

let failed = 0;
console.log("\n=== Testing TasteForge video skill ===\n");
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
  }
}
if (failed) process.exit(1);
console.log(`\n${tests.length - failed}/${tests.length} passed`);
