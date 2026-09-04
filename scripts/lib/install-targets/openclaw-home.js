const { createInstallTargetAdapter } = require('./helpers');

module.exports = createInstallTargetAdapter({
  id: 'openclaw-home',
  target: 'openclaw',
  kind: 'home',
  rootSegments: ['.openclaw'],
  installStatePathSegments: ['aip-install-state.json'],
  nativeRootRelativePath: '.openclaw',
});
