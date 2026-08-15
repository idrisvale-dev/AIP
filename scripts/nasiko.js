#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  installNasiko,
  normalizePlatform,
  validateInstallDirectory,
} = require('./lib/nasiko-release');

function helpText() {
  return `
ECC Nasiko control-plane bridge

Usage:
  ecc nasiko status [--json]
  ecc nasiko install --version v0.1.0 --yes [--install-dir <absolute-path>] [--json]
  ecc nasiko install --version v0.1.0 --dry-run [--install-dir <absolute-path>] [--json]

The installer is opt-in, accepts only ECC-qualified pinned releases, downloads
content-addressed OCI artifacts from registry.nasiko.dev, verifies SHA-256
digests before extraction, and never executes fetched shell or PowerShell code.
`;
}

function parseInstallArguments(argumentsList) {
  let options = { dryRun: false, installDir: undefined, json: false, version: undefined, yes: false };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--version' || argument === '--install-dir') {
      const value = argumentsList[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}.`);
      options = {
        ...options,
        [argument === '--version' ? 'version' : 'installDir']: value,
      };
      index += 1;
    } else if (argument === '--yes' || argument === '-y') {
      options = { ...options, yes: true };
    } else if (argument === '--dry-run') {
      options = { ...options, dryRun: true };
    } else if (argument === '--json') {
      options = { ...options, json: true };
    } else {
      throw new Error(`Unknown Nasiko install argument: ${argument}`);
    }
  }
  if (!options.version) throw new Error('Nasiko install requires --version v0.1.0.');
  if (options.installDir) validateInstallDirectory(options.installDir);
  return options;
}

function defaultExecutablePath() {
  const normalized = normalizePlatform();
  if (normalized.os === 'windows') {
    return process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'nasiko', 'bin', normalized.binaryName)
      : null;
  }
  return path.join(os.homedir(), '.local', 'bin', normalized.binaryName);
}

function resolveExecutable() {
  const configured = process.env.ECC_NASIKO_CLI_EXECUTABLE;
  const candidate = configured || defaultExecutablePath();
  if (!candidate) return null;
  if (!path.isAbsolute(candidate)) {
    throw new Error('ECC_NASIKO_CLI_EXECUTABLE must be an absolute path.');
  }
  if (!fs.existsSync(candidate)) return null;
  const stats = fs.lstatSync(candidate);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error('Nasiko executable must be a regular file, not a symlink.');
  }
  return candidate;
}

function readStatus() {
  const executable = resolveExecutable();
  if (!executable) return { installed: false, version: null, executable: null };
  const result = spawnSync(executable, ['--version'], {
    encoding: 'utf8',
    shell: false,
    timeout: 10000,
  });
  if (result.status !== 0) {
    throw new Error('Nasiko executable failed its version check.');
  }
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const version = output.match(/\bv\d+\.\d+\.\d+\b/)?.[0] || null;
  if (!version) throw new Error('Nasiko executable returned an unrecognized version.');
  return { installed: true, version, executable };
}

async function main(argumentsList = process.argv.slice(2)) {
  const [command, ...rest] = argumentsList;
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(helpText());
    return 0;
  }
  if (command === 'status') {
    const unknown = rest.filter(argument => argument !== '--json');
    if (unknown.length > 0) throw new Error(`Unknown Nasiko status argument: ${unknown[0]}`);
    const status = readStatus();
    if (rest.includes('--json')) process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    else process.stdout.write(status.installed
      ? `Nasiko ${status.version} is installed at ${status.executable}.\n`
      : 'Nasiko is not installed in the ECC-qualified location.\n');
    return 0;
  }
  if (command === 'install') {
    const options = parseInstallArguments(rest);
    const result = await installNasiko(options);
    if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else if (result.dryRun) process.stdout.write(`Would install Nasiko ${result.version} to ${result.destination}.\n`);
    else process.stdout.write(`${result.reused ? 'Using existing' : 'Installed'} Nasiko ${result.version} at ${result.destination}.\n`);
    return 0;
  }
  throw new Error(`Unsupported Nasiko command: ${command}`);
}

if (require.main === module) {
  main().then(code => {
    process.exitCode = code;
  }).catch(error => {
    process.stderr.write(`Error: ${String(error?.message || error).replace(/[\r\n]+/g, ' ')}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main, parseInstallArguments, readStatus, resolveExecutable };
