const fs = require('fs');
const path = require('path');

const {
  createFlatRuleOperations,
  createInstallTargetAdapter,
  createManagedOperation,
  isForeignPlatformPath,
} = require('./helpers');

function toCursorRuleFileName(fileName, sourceRelativeFile) {
  if (path.basename(sourceRelativeFile).toLowerCase() === 'readme.md') {
    return null;
  }

  return fileName.endsWith('.md')
    ? `${fileName.slice(0, -3)}.mdc`
    : fileName;
}

module.exports = createInstallTargetAdapter({
  id: 'cursor-project',
  target: 'cursor',
  kind: 'project',
  rootSegments: ['.cursor'],
  installStatePathSegments: ['ecc-install-state.json'],
  nativeRootRelativePath: '.cursor',
  planOperations(input, adapter) {
    const modules = Array.isArray(input.modules)
      ? input.modules
      : (input.module ? [input.module] : []);
    const {
      repoRoot,
      projectRoot,
      homeDir,
    } = input;
    const planningInput = {
      repoRoot,
      projectRoot,
      homeDir,
    };
    const targetRoot = adapter.resolveRoot(planningInput);

    return modules.flatMap(module => {
      const paths = Array.isArray(module.paths) ? module.paths : [];
      return paths
        .filter(p => !isForeignPlatformPath(p, adapter.target))
        .flatMap(sourceRelativePath => {
          if (sourceRelativePath === 'rules') {
            return createFlatRuleOperations({
              moduleId: module.id,
              repoRoot,
              sourceRelativePath,
              destinationDir: path.join(targetRoot, 'rules'),
              destinationNameTransform: toCursorRuleFileName,
            });
          }

          if (sourceRelativePath === '.cursor') {
            const cursorRoot = path.join(repoRoot, '.cursor');
            if (!fs.existsSync(cursorRoot) || !fs.statSync(cursorRoot).isDirectory()) {
              return [];
            }

            const childOperations = fs.readdirSync(cursorRoot, { withFileTypes: true })
              .sort((left, right) => left.name.localeCompare(right.name))
              .filter(entry => entry.name !== 'rules')
              .map(entry => createManagedOperation({
                moduleId: module.id,
                sourceRelativePath: path.join('.cursor', entry.name),
                destinationPath: path.join(targetRoot, entry.name),
                strategy: 'preserve-relative-path',
              }));

            const ruleOperations = createFlatRuleOperations({
              moduleId: module.id,
              repoRoot,
              sourceRelativePath: '.cursor/rules',
              destinationDir: path.join(targetRoot, 'rules'),
              destinationNameTransform: toCursorRuleFileName,
            });

            return [...childOperations, ...ruleOperations];
          }

          return [adapter.createScaffoldOperation(module.id, sourceRelativePath, planningInput)];
        });
    });
  },
});
