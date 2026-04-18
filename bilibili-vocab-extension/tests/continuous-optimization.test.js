const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  createExecutionPlan,
  createSpawnSpec,
  parseCliArgs,
  runContinuousOptimization,
  selectOptimizationCandidates,
} = require('../scripts/run-continuous-optimization.js');

function createWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'continuous-optimization-'));
}

function createTestFiles(testsDir, names) {
  fs.mkdirSync(testsDir, { recursive: true });
  for (const name of names) {
    fs.writeFileSync(path.join(testsDir, name), '', 'utf8');
  }
}

function readPackageScripts() {
  const packageJsonPath = path.join(__dirname, '..', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  return packageJson.scripts || {};
}

function readWorkflow(fileName) {
  return fs.readFileSync(
    path.join(__dirname, '..', '..', '.github', 'workflows', fileName),
    'utf8'
  );
}

function collectDuplicateAssignments(shards) {
  const ownership = new Map();

  for (const shard of shards || []) {
    for (const testFile of shard.testFiles || []) {
      const assignedShards = ownership.get(testFile) || [];
      assignedShards.push(shard.name);
      ownership.set(testFile, assignedShards);
    }
  }

  return [...ownership.entries()]
    .filter(([, assignedShards]) => assignedShards.length > 1)
    .map(([testFile, assignedShards]) => ({
      testFile,
      assignedShards,
    }));
}

test('continuous optimization: parseCliArgs should support shard-only and report flags', () => {
  const parsed = parseCliArgs([
    '--shards-only',
    '--serial-shards',
    '--include-pack',
    '--json',
    '--report-dir',
    'custom-report',
  ]);

  assert.deepEqual(parsed, {
    includePack: true,
    parallelShards: false,
    runGates: false,
    reportDir: 'custom-report',
    json: true,
  });
});

test('continuous optimization: createSpawnSpec should use shell for windows cmd wrappers', () => {
  const spec = createSpawnSpec('pnpm.cmd', ['run', 'lint'], { platform: 'win32' });

  assert.deepEqual(spec, {
    command: 'pnpm.cmd run lint',
    args: [],
    shell: true,
  });
});

test('continuous optimization: createExecutionPlan should resolve gates and shard files', () => {
  const workspace = createWorkspace();
  const testsDir = path.join(workspace, 'tests');

  try {
    createTestFiles(testsDir, [
      'adaptive-tuning.test.js',
      'background.test.js',
      'experience-metrics.test.js',
      'learning-state.test.js',
      'settings-ui-state-machine.test.js',
      'shared-settings.test.js',
      'vocabulary.test.js',
      'contentScript-hit-tracking.test.js',
      'subtitleParser.test.js',
      'renderer.test.js',
      'segmenter.test.js',
      'translator.test.js',
      'tooltip.test.js',
      'contentScript-overlay-bridge.test.js',
      'react-ui-contract.test.js',
      'react-overlay-layout.test.js',
      'overlay-panel.test.js',
      'settings-layout.test.js',
      'test-ui-entry-contract.test.js',
      'build-entry-contract.test.js',
      'lint-entry-contract.test.js',
      'workflow-lockfile-contract.test.js',
      'continuous-optimization.test.js',
      'open-vocab-data.test.js',
      'scheduler.test.js',
      'danmaku.test.js',
      'standalone-init.test.js',
      'shared-settings-integration.test.js',
      'check-overlay-size.test.js',
      'refresh-overlay-size-baseline.test.js',
      'pack-extension.test.js',
      'test-coverage-entry-contract.test.js',
    ]);

    const plan = createExecutionPlan({
      projectRoot: workspace,
      testsDir,
      includePack: true,
      platform: 'win32',
    });

    assert.deepEqual(
      plan.gates.map((gate) => gate.name),
      ['lint', 'typecheck', 'build-extension', 'pack']
    );
    assert.equal(plan.gates[0].command, 'pnpm.cmd');
    assert.deepEqual(
      plan.shards.map((shard) => shard.name),
      ['runtime-state', 'subtitle-content', 'ui-overlay', 'build-contract-data']
    );
    assert.equal(plan.shards[0].testFileCount, 8);
    assert.ok(
      plan.shards[0].testFiles.includes(path.join('tests', 'settings-ui-state-machine.test.js'))
    );
    assert.ok(
      plan.shards[0].testFiles.includes(path.join('tests', 'shared-settings-integration.test.js'))
    );
    assert.equal(plan.shards[1].testFileCount, 6);
    assert.deepEqual(plan.shards[2].testFiles, [
      path.join('tests', 'contentScript-overlay-bridge.test.js'),
      path.join('tests', 'overlay-panel.test.js'),
      path.join('tests', 'react-overlay-layout.test.js'),
      path.join('tests', 'react-ui-contract.test.js'),
      path.join('tests', 'settings-layout.test.js'),
    ]);
    assert.ok(
      plan.shards[3].testFiles.includes(path.join('tests', 'continuous-optimization.test.js'))
    );
    assert.ok(
      plan.shards[3].testFiles.includes(path.join('tests', 'test-ui-entry-contract.test.js'))
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('continuous optimization: current shard plan should not duplicate test files across shards', () => {
  const plan = createExecutionPlan({
    projectRoot: path.join(__dirname, '..'),
    testsDir: path.join(__dirname),
  });

  assert.deepEqual(collectDuplicateAssignments(plan.shards), []);
});

test('continuous optimization: current shard plan should route runtime bridge and lightweight adapter direct tests', () => {
  const plan = createExecutionPlan({
    projectRoot: path.join(__dirname, '..'),
    testsDir: path.join(__dirname),
  });
  const runtimeState = plan.shards.find((shard) => shard.name === 'runtime-state');
  const subtitleContent = plan.shards.find((shard) => shard.name === 'subtitle-content');
  const uiOverlay = plan.shards.find((shard) => shard.name === 'ui-overlay');

  assert.ok(runtimeState);
  assert.ok(subtitleContent);
  assert.ok(uiOverlay);

  assert.deepEqual(
    runtimeState.testFiles.filter((file) =>
      ['config.test.js', 'runtime-messaging.test.js', 'utils.test.js'].includes(path.basename(file))
    ),
    [
      path.join('tests', 'config.test.js'),
      path.join('tests', 'runtime-messaging.test.js'),
      path.join('tests', 'utils.test.js'),
    ]
  );
  assert.deepEqual(
    subtitleContent.testFiles.filter(
      (file) => path.basename(file) === 'contentScript-subtitle-navigation.test.js'
    ),
    [path.join('tests', 'contentScript-subtitle-navigation.test.js')]
  );
  assert.deepEqual(
    uiOverlay.testFiles.filter((file) =>
      [
        'contentScript-overlay-bridge.test.js',
        'react-ui-runtime-messaging.test.js',
        'react-ui-study-preview.test.js',
        'react-ui-use-overlay-settings.test.js',
      ].includes(path.basename(file))
    ),
    [
      path.join('tests', 'contentScript-overlay-bridge.test.js'),
      path.join('tests', 'react-ui-runtime-messaging.test.js'),
      path.join('tests', 'react-ui-study-preview.test.js'),
      path.join('tests', 'react-ui-use-overlay-settings.test.js'),
    ]
  );
});

test('continuous optimization: selectOptimizationCandidates should prioritize failures', () => {
  const candidates = selectOptimizationCandidates({
    gates: [
      {
        name: 'lint',
        title: 'Lint',
        status: 'fail',
        commandLine: 'pnpm run lint',
      },
    ],
    shards: [
      {
        name: 'ui-overlay',
        title: 'Popup / options / React UI / overlay',
        status: 'fail',
        commandLine: 'node --test tests/react-ui-contract.test.js',
        testFiles: [path.join('tests', 'react-ui-contract.test.js')],
      },
    ],
  });

  assert.deepEqual(
    candidates.map((candidate) => candidate.id),
    ['gate-lint', 'shard-ui-overlay']
  );
});

test('continuous optimization: runContinuousOptimization should write reports and carry failures', async () => {
  const workspace = createWorkspace();
  const testsDir = path.join(workspace, 'tests');
  const reportDir = path.join(workspace, 'reports');

  try {
    createTestFiles(testsDir, [
      'adaptive-tuning.test.js',
      'background.test.js',
      'experience-metrics.test.js',
      'learning-state.test.js',
      'shared-settings.test.js',
      'vocabulary.test.js',
      'contentScript-hit-tracking.test.js',
      'subtitleParser.test.js',
      'renderer.test.js',
      'segmenter.test.js',
      'translator.test.js',
      'tooltip.test.js',
      'react-ui-contract.test.js',
      'react-overlay-layout.test.js',
      'overlay-panel.test.js',
      'settings-layout.test.js',
      'test-ui-entry-contract.test.js',
      'build-entry-contract.test.js',
      'lint-entry-contract.test.js',
      'workflow-lockfile-contract.test.js',
      'continuous-optimization.test.js',
      'open-vocab-data.test.js',
      'scheduler.test.js',
      'danmaku.test.js',
      'standalone-init.test.js',
      'check-overlay-size.test.js',
      'refresh-overlay-size-baseline.test.js',
      'pack-extension.test.js',
      'test-coverage-entry-contract.test.js',
    ]);

    const summary = await runContinuousOptimization({
      projectRoot: workspace,
      testsDir,
      reportDir,
      runId: 'RUN-001',
      executeCommand(command, args) {
        const joinedArgs = Array.isArray(args) ? args.join(' ') : '';
        const isUiShard = joinedArgs.includes('react-ui-contract.test.js');
        const isLintGate = joinedArgs === 'run lint';

        return Promise.resolve({
          status: isLintGate || isUiShard ? 1 : 0,
          durationMs: 25,
          stdout: `${command} ${joinedArgs}`.trim(),
          stderr: isUiShard ? 'ui shard failed' : '',
        });
      },
    });

    assert.equal(summary.overallStatus, 'fail');
    assert.equal(summary.gates.length, 3);
    assert.equal(summary.shards.length, 4);
    assert.deepEqual(
      summary.nextFocusCandidates.map((candidate) => candidate.id),
      ['gate-lint', 'shard-ui-overlay']
    );
    assert.equal(fs.existsSync(path.join(reportDir, 'latest.json')), true);
    assert.equal(fs.existsSync(path.join(reportDir, 'latest.md')), true);
    assert.equal(fs.existsSync(path.join(reportDir, 'RUN-001.json')), true);

    const latestReport = JSON.parse(fs.readFileSync(path.join(reportDir, 'latest.json'), 'utf8'));
    assert.equal(latestReport.runId, 'RUN-001');
    assert.equal(latestReport.overallStatus, 'fail');

    const markdown = fs.readFileSync(path.join(reportDir, 'latest.md'), 'utf8');
    assert.match(markdown, /Continuous Optimization Report/);
    assert.match(markdown, /修复 gate 失败：Lint/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('continuous optimization: runContinuousOptimization should keep legacy popup/options deferred and browser smoke out of shard coverage without overriding blind-spot priority', async () => {
  const workspace = createWorkspace();
  const testsDir = path.join(workspace, 'tests');
  const reportDir = path.join(workspace, 'reports');

  try {
    createTestFiles(testsDir, [
      'adaptive-tuning.test.js',
      'background.test.js',
      'experience-metrics.test.js',
      'learning-state.test.js',
      'shared-settings.test.js',
      'vocabulary.test.js',
      'contentScript-hit-tracking.test.js',
      'subtitleParser.test.js',
      'renderer.test.js',
      'segmenter.test.js',
      'translator.test.js',
      'tooltip.test.js',
      'react-ui-contract.test.js',
      'react-overlay-layout.test.js',
      'overlay-panel.test.js',
      'settings-layout.test.js',
      'test-ui-entry-contract.test.js',
      'build-entry-contract.test.js',
      'lint-entry-contract.test.js',
      'workflow-lockfile-contract.test.js',
      'continuous-optimization.test.js',
      'open-vocab-data.test.js',
      'scheduler.test.js',
      'danmaku.test.js',
      'standalone-init.test.js',
      'check-overlay-size.test.js',
      'refresh-overlay-size-baseline.test.js',
      'pack-extension.test.js',
      'test-coverage-entry-contract.test.js',
      'settings-ui-state-machine.test.js',
      'browser-extension-smoke.test.js',
      'popup.test.js',
    ]);

    const summary = await runContinuousOptimization({
      projectRoot: workspace,
      testsDir,
      reportDir,
      runId: 'RUN-UNASSIGNED',
      executeCommand() {
        return Promise.resolve({
          status: 0,
          durationMs: 25,
          stdout: '',
          stderr: '',
        });
      },
    });

    assert.equal(summary.overallStatus, 'pass');
    assert.deepEqual(summary.unassignedTests, []);
    assert.deepEqual(summary.outOfBandSmokeTests, ['browser-extension-smoke.test.js']);
    assert.deepEqual(summary.deferredLegacyTests, ['popup.test.js']);
    assert.equal(summary.nextFocusCandidates[0].id, 'extension-browser-smoke-lane');
    assert.equal(summary.nextFocusCandidates[1].id, 'runtime-bridge-coverage');
    assert.equal(summary.nextFocusCandidates[2].id, 'legacy-react-drift');
    assert.equal(summary.nextFocusCandidates[3].id, 'content-script-decomposition');

    const deferredCandidate = summary.nextFocusCandidates.at(-1);
    assert.equal(deferredCandidate.id, 'legacy-deferred-tests');
    assert.equal(deferredCandidate.title, '迁移或淘汰 legacy popup/options shell 测试');
    assert.deepEqual(deferredCandidate.files, ['popup.test.js']);
    assert.match(
      deferredCandidate.rationale,
      /dist\/popup\.html.*dist\/options\.html[\s\S]*legacy popup\/options 入口/
    );
    assert.match(deferredCandidate.rationale, /shared-settings-integration\.test\.js/);
    assert.match(deferredCandidate.rationale, /standalone-init\.test\.js/);

    const latestReport = JSON.parse(fs.readFileSync(path.join(reportDir, 'latest.json'), 'utf8'));
    assert.deepEqual(latestReport.unassignedTests, []);
    assert.deepEqual(latestReport.outOfBandSmokeTests, ['browser-extension-smoke.test.js']);
    assert.deepEqual(latestReport.deferredLegacyTests, ['popup.test.js']);

    const markdown = fs.readFileSync(path.join(reportDir, 'latest.md'), 'utf8');
    assert.match(markdown, /Out-of-Band Browser Smoke Tests/);
    assert.match(markdown, /browser-extension-smoke\.test\.js/);
    assert.match(markdown, /pnpm run test:extension-smoke/);
    assert.match(markdown, /Legacy Deferred Tests/);
    assert.match(markdown, /popup\.test\.js/);
    assert.match(
      markdown,
      /manifest \/ pack 真实交付入口是 `dist\/popup\.html` \/ `dist\/options\.html`[\s\S]*root `popup\.js` \/ `options\.js`/
    );
    assert.match(markdown, /shared-settings-integration\.test\.js/);
    assert.match(markdown, /standalone-init\.test\.js/);
    assert.match(markdown, /迁移可复用逻辑到 shared helper 或单独 legacy lane/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('continuous optimization contract: package should expose shard and cycle scripts', () => {
  const scripts = readPackageScripts();

  assert.equal(scripts['test:shards'], 'node scripts/run-continuous-optimization.js --shards-only');
  assert.equal(scripts['optimize:continuous'], 'node scripts/run-continuous-optimization.js');
});

test('continuous optimization contract: ci workflow should run test:ui in a dedicated job', () => {
  const workflow = readWorkflow('ci.yml');

  assert.match(workflow, /^  test-ui:\r?$/m);
  assert.match(workflow, /test-ui:[\s\S]*run: pnpm run test:ui/);
});

test('continuous optimization contract: ci workflow should run optimize:continuous in a dedicated job', () => {
  const workflow = readWorkflow('ci.yml');

  assert.match(workflow, /^  continuous-optimization:\r?$/m);
  assert.match(
    workflow,
    /continuous-optimization:[\s\S]*run: pnpm run optimize:continuous -- --serial-shards/
  );
});

test('continuous optimization contract: ci workflow should upload continuous optimization reports', () => {
  const workflow = readWorkflow('ci.yml');

  assert.match(
    workflow,
    /continuous-optimization:[\s\S]*uses: actions\/upload-artifact@v4[\s\S]*name: continuous-optimization-report/
  );
  assert.match(
    workflow,
    /continuous-optimization:[\s\S]*path: \$\{\{\s*env\.WORKDIR\s*\}\}\/test-results\/continuous-optimization/
  );
});
