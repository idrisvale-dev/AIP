'use strict';

const provenance = require('./provenance');
const versioning = require('./versioning');
const tracker = require('./tracker');
const health = require('./health');

module.exports = {
  ...provenance,
  ...versioning,
  ...tracker,
  ...health,
  provenance,
  versioning,
  tracker,
  health,
};
