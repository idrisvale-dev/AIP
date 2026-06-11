'use strict';

const { loadPolicy } = require('./policy');
const { mergeIssueBody, normalizeBodyForComparison } = require('./parsing');
const { getIssue, listIssues, editIssue, commentIssue } = require('./gh-api');
const {
  assertIssueClaimable,
  buildIssueComment,
  buildIssueStateFromAction,
  desiredLabelsForState,
  getCoordinationState,
  summarizeStateForOutput,
  syncIssueLabels,
  verifyDependenciesClosed,
} = require('./state');
const { upsertCoordinationWorkItem } = require('./store');
const { extractIssueReferences, extractTasks } = require('./parsing');

// applyClaim performs a read (getIssue) → check (assertIssueClaimable) → write
// (editIssue) sequence that is NOT atomic. Two concurrent callers can both read
// an unclaimed issue, pass the check, and both succeed — resulting in a
// double-claim. Until a store.acquireLock(repo, issueNumber) API is available,
// callers should prevent races via external serialization (e.g. a GitHub
// branch-protection rule that allows only one actor at a time, or a
// serialized job queue).
function applyClaim(repo, issueNumber, options = {}, context = {}) {
  const policy = context.policy || loadPolicy(context.rootDir || process.cwd(), options.configPath);
  const store = context.store || null;
  const issue = getIssue(repo, issueNumber, options);
  const currentState = getCoordinationState(issue, policy);

  assertIssueClaimable(issue, currentState);

  const nextState = buildIssueStateFromAction(issue, currentState, 'claim', {
    owner: options.actor || options.owner || currentState.owner || issue.author?.login || null,
    branch: options.branch || currentState.branch || null,
    status: options.status || 'claimed',
    validation: options.validation || currentState.validation || 'pending',
    review: options.review || currentState.review || (policy.review.required ? 'requested' : 'not-requested'),
    projectState: options.projectState || 'in-progress',
  }, policy);

  const trackedIssue = {
    ...issue,
    labels: desiredLabelsForState(nextState, policy),
  };
  const body = mergeIssueBody(issue, nextState, policy);
  if (!options.dryRun) {
    editIssue(repo, issueNumber, {
      body,
      addLabels: trackedIssue.labels,
      removeLabels: [],
    }, options);
    commentIssue(repo, issueNumber, buildIssueComment('claimed', repo, issueNumber, nextState), options);
    upsertCoordinationWorkItem(store, repo, trackedIssue, nextState, 'claim', { ...context, policy });
  }

  return summarizeStateForOutput(repo, trackedIssue, nextState, 'claim', policy);
}

function applySync(repo, options = {}, context = {}) {
  const policy = context.policy || loadPolicy(context.rootDir || process.cwd(), options.configPath);
  const store = context.store || null;
  const issues = listIssues(repo, { ...options, state: options.state || 'all', limit: options.limit || 100 });
  const syncedAt = new Date().toISOString();
  const results = [];

  for (const issue of issues) {
    const currentState = getCoordinationState(issue, policy);
    const nextState = buildIssueStateFromAction(issue, currentState, 'sync', {
      status: currentState.status,
      validation: currentState.validation,
      review: currentState.review,
      projectState: currentState.project && currentState.project.state ? currentState.project.state : 'backlog',
    }, policy);

    const trackedIssue = {
      ...issue,
      labels: desiredLabelsForState(nextState, policy),
    };
    const body = mergeIssueBody(issue, nextState, policy);
    const labelPlan = syncIssueLabels(repo, issue, nextState, policy, options);

    if (!options.dryRun && (normalizeBodyForComparison(body) !== normalizeBodyForComparison(issue.body) || labelPlan.addLabels.length > 0 || labelPlan.removeLabels.length > 0)) {
      editIssue(repo, issue.number, {
        body,
        addLabels: labelPlan.addLabels,
        removeLabels: labelPlan.removeLabels,
      }, options);
    }

    const snapshot = upsertCoordinationWorkItem(store, repo, trackedIssue, nextState, 'sync', { ...context, policy });
    results.push({
      ...summarizeStateForOutput(repo, trackedIssue, nextState, 'sync', policy),
      syncedAt,
      labelPlan,
      snapshot: snapshot || null,
    });
  }

  return {
    repo,
    syncedAt,
    count: results.length,
    items: results,
  };
}

function applyValidate(repo, issueNumber, options = {}, context = {}, existingIssue = null) {
  const policy = context.policy || loadPolicy(context.rootDir || process.cwd(), options.configPath);
  const issue = existingIssue || getIssue(repo, issueNumber, options);
  const state = getCoordinationState(issue, policy);
  const dependencyNumbers = Array.isArray(state.dependencies) ? state.dependencies : [];
  const closedDependencies = verifyDependenciesClosed(repo, dependencyNumbers, options);
  const missingDependencies = dependencyNumbers.filter(number => !closedDependencies.includes(number));
  const validations = [];

  if (policy.validation.required && state.validation !== 'passed') {
    validations.push({ check: 'validation-status', ok: false, detail: `validation=${state.validation}` });
  } else {
    validations.push({ check: 'validation-status', ok: true, detail: state.validation });
  }

  if (missingDependencies.length > 0) {
    validations.push({ check: 'dependencies', ok: false, detail: missingDependencies.join(',') });
  } else {
    validations.push({ check: 'dependencies', ok: true, detail: 'closed' });
  }

  const ok = validations.every(entry => entry.ok);
  const nextState = buildIssueStateFromAction(issue, state, 'validate', {
    status: ok ? (state.status === 'blocked' ? 'blocked' : 'validated') : state.status,
    validation: ok ? 'passed' : 'failed',
    projectState: ok ? 'ready' : (state.project && state.project.state) || 'backlog',
  }, policy);
  const trackedIssue = {
    ...issue,
    labels: desiredLabelsForState(nextState, policy),
  };

  if (!options.dryRun) {
    const body = mergeIssueBody(issue, nextState, policy);
    editIssue(repo, issueNumber, {
      body,
      addLabels: trackedIssue.labels,
      removeLabels: [],
    }, options);
    upsertCoordinationWorkItem(context.store || null, repo, trackedIssue, nextState, 'validate', { ...context, policy });
  }

  return {
    ...summarizeStateForOutput(repo, trackedIssue, nextState, 'validate', policy),
    ok,
    validations,
    missingDependencies,
  };
}

function applyPublish(repo, issueNumber, options = {}, context = {}) {
  const policy = context.policy || loadPolicy(context.rootDir || process.cwd(), options.configPath);
  const issue = getIssue(repo, issueNumber, options);
  const state = getCoordinationState(issue, policy);
  const validation = applyValidate(repo, issueNumber, { ...options, dryRun: true }, context, issue);

  if (!validation.ok) {
    throw new Error(`Issue #${issueNumber} is not ready to publish: ${validation.validations.map(entry => `${entry.check}=${entry.ok}`).join(', ')}`);
  }

  const nextState = buildIssueStateFromAction(issue, state, 'publish', {
    status: 'published',
    validation: 'passed',
    review: state.review === 'changes-requested' ? state.review : 'approved',
    projectState: 'done',
  }, policy);
  const trackedIssue = {
    ...issue,
    labels: desiredLabelsForState(nextState, policy),
  };

  if (!options.dryRun) {
    const body = mergeIssueBody(issue, nextState, policy);
    editIssue(repo, issueNumber, {
      body,
      addLabels: trackedIssue.labels,
      removeLabels: [],
    }, options);
    commentIssue(repo, issueNumber, buildIssueComment('published', repo, issueNumber, nextState, {
      validation: 'passed',
    }), options);
    upsertCoordinationWorkItem(context.store || null, repo, trackedIssue, nextState, 'publish', { ...context, policy });
  }

  return summarizeStateForOutput(repo, trackedIssue, nextState, 'publish', policy);
}

function applyReview(repo, issueNumber, options = {}, context = {}) {
  const policy = context.policy || loadPolicy(context.rootDir || process.cwd(), options.configPath);
  const issue = getIssue(repo, issueNumber, options);
  const state = getCoordinationState(issue, policy);
  const reviewState = options.review || 'approved';
  const nextState = buildIssueStateFromAction(issue, state, 'review', {
    status: reviewState === 'approved' ? 'ready' : reviewState === 'requested' ? 'claimed' : 'blocked',
    review: reviewState,
    projectState: reviewState === 'approved' ? 'ready' : 'blocked',
  }, policy);
  const trackedIssue = {
    ...issue,
    labels: desiredLabelsForState(nextState, policy),
  };

  if (!options.dryRun) {
    const body = mergeIssueBody(issue, nextState, policy);
    editIssue(repo, issueNumber, {
      body,
      addLabels: trackedIssue.labels,
      removeLabels: [],
    }, options);
    commentIssue(repo, issueNumber, buildIssueComment('reviewed', repo, issueNumber, nextState, {
      review: reviewState,
    }), options);
    upsertCoordinationWorkItem(context.store || null, repo, trackedIssue, nextState, 'review', { ...context, policy });
  }

  return summarizeStateForOutput(repo, trackedIssue, nextState, 'review', policy);
}

function applyDecompose(repo, issueNumber, options = {}, context = {}) {
  const policy = context.policy || loadPolicy(context.rootDir || process.cwd(), options.configPath);
  const issue = getIssue(repo, issueNumber, options);
  const state = getCoordinationState(issue, policy);
  const tasks = extractTasks(issue.body);
  const dependencies = extractIssueReferences(issue.body);
  const nextState = buildIssueStateFromAction(issue, state, 'decompose', {
    tasks,
    dependencies,
    status: tasks.some(task => !task.done) ? 'claimed' : state.status,
    projectState: tasks.some(task => !task.done) ? 'in-progress' : (state.project && state.project.state) || 'backlog',
  }, policy);

  const trackedIssue = {
    ...issue,
    labels: desiredLabelsForState(nextState, policy),
  };

  if (!options.dryRun) {
    const body = mergeIssueBody(issue, nextState, policy);
    editIssue(repo, issueNumber, {
      body,
      addLabels: trackedIssue.labels,
      removeLabels: [],
    }, options);
    commentIssue(repo, issueNumber, buildIssueComment('decomposed', repo, issueNumber, nextState, {
      taskCount: String(tasks.length),
      dependencyCount: String(dependencies.length),
    }), options);
    upsertCoordinationWorkItem(context.store || null, repo, trackedIssue, nextState, 'decompose', { ...context, policy });
  }

  return {
    ...summarizeStateForOutput(repo, trackedIssue, nextState, 'decompose', policy),
    tasks,
    dependencyCount: dependencies.length,
  };
}

function applyUnblock(repo, options = {}, context = {}) {
  const policy = context.policy || loadPolicy(context.rootDir || process.cwd(), options.configPath);
  const store = context.store || null;
  const issues = listIssues(repo, { ...options, state: 'all', limit: options.limit || 100 });
  const results = [];

  for (const issue of issues) {
    const state = getCoordinationState(issue, policy);
    if (state.status !== 'blocked') {
      continue;
    }

    const dependencyNumbers = Array.isArray(state.dependencies) ? state.dependencies : [];
    const closedDependencies = verifyDependenciesClosed(repo, dependencyNumbers, options, issues);
    if (dependencyNumbers.length > 0 && closedDependencies.length !== dependencyNumbers.length) {
      continue;
    }

    const nextState = buildIssueStateFromAction(issue, state, 'unblock', {
      status: 'ready',
      projectState: 'ready',
      validation: state.validation === 'failed' ? 'pending' : state.validation,
    }, policy);
    const trackedIssue = {
      ...issue,
      labels: desiredLabelsForState(nextState, policy),
    };

    if (!options.dryRun) {
      const body = mergeIssueBody(issue, nextState, policy);
      editIssue(repo, issue.number, {
        body,
        addLabels: trackedIssue.labels,
        removeLabels: [],
      }, options);
      commentIssue(repo, issue.number, buildIssueComment('unblocked', repo, issue.number, nextState, {
        dependencies: dependencyNumbers.length > 0 ? dependencyNumbers.join(',') : 'none',
      }), options);
      upsertCoordinationWorkItem(store, repo, trackedIssue, nextState, 'unblock', { ...context, policy });
    }

    results.push(summarizeStateForOutput(repo, trackedIssue, nextState, 'unblock', policy));
  }

  return {
    repo,
    count: results.length,
    items: results,
  };
}

function formatSummary(payload) {
  const lines = [
    `${payload.action || 'sync'} epic #${payload.issueNumber}: ${payload.issueTitle}`,
    `Repo: ${payload.repo}`,
    `Status: ${payload.status}`,
    `Owner: ${payload.owner || '(unassigned)'}`,
    `Branch: ${payload.branch || '(none)'}`,
    `Validation: ${payload.validation || 'pending'}`,
    `Review: ${payload.review || 'not-requested'}`,
  ];
  if (payload.tasks && payload.tasks.length > 0) {
    lines.push(`Tasks: ${payload.tasks.length}`);
  }
  if (payload.dependencies && payload.dependencies.length > 0) {
    lines.push(`Dependencies: ${payload.dependencies.join(', ')}`);
  }
  return `${lines.join('\n')}\n`;
}

function formatCollection(payload) {
  const lines = [
    `Repo: ${payload.repo}`,
    `Items: ${payload.count}`,
  ];
  for (const item of payload.items || []) {
    lines.push(`- #${item.issueNumber} ${item.status}: ${item.issueTitle}`);
  }
  return `${lines.join('\n')}\n`;
}

module.exports = {
  applyClaim,
  applyDecompose,
  applyPublish,
  applyReview,
  applySync,
  applyUnblock,
  applyValidate,
  formatCollection,
  formatSummary,
};
