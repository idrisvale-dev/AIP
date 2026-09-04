'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const runbook = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'docs', 'releases', '2.2.0', 'launch-runbook.md'),
  'utf8'
);

assert.match(runbook, /ByteCore.*only release operator/i);
assert.match(runbook, /npm view aip-universal dist-tags --json/);
assert.match(runbook, /aip-universal@2\.1\.0/);
assert.match(runbook, /git tag -s v2\.2\.0/);
assert.match(runbook, /git push origin refs\/tags\/v2\.2\.0/);
assert.match(runbook, /npm dist-tag add aip-universal@2\.1\.0 latest/);
assert.match(runbook, /staged.*registry.*latest/is);
assert.match(runbook, /do not unpublish/i);
assert.match(runbook, /rollback/i);

console.log('AIP 2.2 launch runbook: ok');
