'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { collectUiTestFiles } = require('./run-ui-tests.js');

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TESTS_DIR = path.join(DEFAULT_PROJECT_ROOT, 'tests');
const DEFAULT_REPORT_DIR = path.join(
  DEFAULT_PROJECT_ROOT,
  'test-results',
  'continuous-optimization'
);
const DEFAULT_MAX_LOG_CHARS = 4000;

const STATIC_OPTIMIZATION_GAPS = [
  {
    id: 'browser-e2e-smoke',
    priority: 0,
    title: '补最小浏览器级 E2E 冒烟',
    rationale:
      '当前测试以 Node 契约和纯逻辑为主，仍缺 popup/options/overlay/content script 的真实扩展运行时回归。',
    files: [
      'react-ui/src/popup-main.tsx',
      'react-ui/src/options-main.tsx',
      'react-ui/src/overlay-entry.tsx',
      'contentScript.js',
    ],
    suggestedCommands: ['pnpm run test:ui', 'pnpm run build:extension'],
  },
  {
    id: 'runtime-bridge-coverage',
    priority: 1,
    title: '继续补通用工具与轻量适配层的直接测试',
    rationale: '当前直接测试缺口已明显缩小，剩余优先项应转向更高价值的浏览器级冒烟或复杂链路守卫。',
    files: [],
    suggestedCommands: ['node --test tests/*.test.js'],
  },
  {
    id: 'legacy-react-drift',
    priority: 2,
    title: '继续压低 React 与 legacy 双栈漂移风险',
    rationale:
      'manifest 已切到 React 入口，但根目录 legacy popup/options/overlay 仍存在，后续优化需要持续防止目标漂移。',
    files: ['manifest.json', 'popup.js', 'options.js', 'overlayPanel.js'],
    suggestedCommands: ['pnpm run test:ui', 'pnpm run build:extension'],
  },
  {
    id: 'content-script-decomposition',
    priority: 3,
    title: '围绕 contentScript.js 做定向拆分或补守卫测试',
    rationale:
      'contentScript.js 仍是最高复杂区，初始化、缓存、观察者、字幕导航和 overlay 桥接耦合较重。',
    files: ['contentScript.js', 'subtitleParser.js', 'subtitleNavigation.js'],
    suggestedCommands: ['node --test tests/contentScript-*.test.js tests/subtitle*.test.js'],
  },
];

const TEST_SHARD_DEFINITIONS = [
  {
    name: 'runtime-state',
    title: 'Runtime / state',
    patterns: [
      /^adaptive-tuning\.test\.js$/,
      /^background.*\.test\.js$/,
      /^config\.test\.js$/,
      /^experience-metrics\.test\.js$/,
      /^learning-.*\.test\.js$/,
      /^runtime-messaging\.test\.js$/,
      /^settings-ui-state-machine\.test\.js$/,
      /^shared-settings.*\.test\.js$/,
      /^utils\.test\.js$/,
      /^vocabulary.*\.test\.js$/,
    ],
  },
  {
    name: 'subtitle-content',
    title: 'Subtitle / parser / content',
    patterns: [
      /^contentScript-cache-compatibility\.test\.js$/,
      /^contentScript-hit-tracking\.test\.js$/,
      /^contentScript-subtitle-navigation\.test\.js$/,
      /^subtitle.*\.test\.js$/,
      /^renderer\.test\.js$/,
      /^segmenter\.test\.js$/,
      /^translator\.test\.js$/,
      /^tooltip\.test\.js$/,
    ],
  },
  {
    name: 'ui-overlay',
    title: 'Popup / options / React UI / overlay',
    collectTestFiles(targetTestsDir) {
      return collectUiTestFiles(targetTestsDir);
    },
  },
  {
    name: 'build-contract-data',
    title: 'Automation / contract / build / packaging / data',
    patterns: [
      /^build-entry-contract\.test\.js$/,
      /^lint-entry-contract\.test\.js$/,
      /^test-coverage-entry-contract\.test\.js$/,
      /^test-ui-entry-contract\.test\.js$/,
      /^workflow-lockfile-contract\.test\.js$/,
      /^check-overlay-size\.test\.js$/,
      /^refresh-overlay-size-baseline\.test\.js$/,
      /^pack-extension\.test\.js$/,
      /^open-vocab-data\.test\.js$/,
      /^scheduler\.test\.js$/,
      /^danmaku\.test\.js$/,
      /^standalone-init\.test\.js$/,
      /^continuous-optimization(?:-.*)?\.test\.js$/,
    ],
  },
];

function getPnpmCommand(platform = process.platform) {
  return platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function listTestFiles(targetTestsDir = DEFAULT_TESTS_DIR) {
  return fs
    .readdirSync(targetTestsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.test.js'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function collectMatchingTestFiles(targetTestsDir = DEFAULT_TESTS_DIR, patterns = []) {
  return listTestFiles(targetTestsDir)
    .filter((name) => patterns.some((pattern) => pattern.test(name)))
    .map((name) => path.join('tests', name));
}

function quoteCommandPart(value) {
  const text = String(value);
  return /\s/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text;
}

function formatCommand(command, args = []) {
  return [command, ...args].map(quoteCommandPart).join(' ');
}

function shouldSpawnWithShell(command, platform = process.platform) {
  return platform === 'win32' && /\.(cmd|bat)$/i.test(String(command || ''));
}

function createSpawnSpec(command, args = [], options = {}) {
  const useShell = shouldSpawnWithShell(command, options.platform);
  return {
    command: useShell ? formatCommand(command, args) : command,
    args: useShell ? [] : args,
    shell: useShell,
  };
}

function tailText(value, maxChars = DEFAULT_MAX_LOG_CHARS) {
  const text = String(value || '').trim();
  if (!text || text.length <= maxChars) {
    return text;
  }
  return `...${text.slice(-maxChars)}`;
}

function formatDurationMs(durationMs) {
  return `${(Number(durationMs || 0) / 1000).toFixed(2)}s`;
}

function createRunId(date = new Date()) {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

function getGateDefinitions(options = {}) {
  const pnpm = getPnpmCommand(options.platform);
  const gates = [
    {
      name: 'lint',
      title: 'Lint',
      command: pnpm,
      args: ['run', 'lint'],
    },
    {
      name: 'typecheck',
      title: 'Typecheck',
      command: pnpm,
      args: ['run', 'typecheck'],
    },
    {
      name: 'build-extension',
      title: 'Build Extension',
      command: pnpm,
      args: ['run', 'build:extension'],
    },
  ];

  if (options.includePack === true) {
    gates.push({
      name: 'pack',
      title: 'Pack Extension',
      command: pnpm,
      args: ['run', 'pack'],
    });
  }

  return gates;
}

function createExecutionPlan(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || DEFAULT_PROJECT_ROOT);
  const testsDir = path.resolve(options.testsDir || path.join(projectRoot, 'tests'));
  const gates = getGateDefinitions({
    platform: options.platform,
    includePack: options.includePack === true,
  }).map((gate) => ({
    ...gate,
    commandLine: formatCommand(gate.command, gate.args),
  }));

  const shards = TEST_SHARD_DEFINITIONS.map((definition) => {
    const testFiles = definition.collectTestFiles
      ? definition.collectTestFiles(testsDir)
      : collectMatchingTestFiles(testsDir, definition.patterns || []);

    if (!Array.isArray(testFiles) || testFiles.length === 0) {
      throw new Error(`Shard "${definition.name}" did not match any test files in ${testsDir}.`);
    }

    const command = process.execPath;
    const args = ['--test', ...testFiles];

    return {
      name: definition.name,
      title: definition.title,
      testFiles,
      testFileCount: testFiles.length,
      command,
      args,
      commandLine: formatCommand(command, args),
    };
  });

  return {
    projectRoot,
    testsDir,
    gates,
    shards,
  };
}

function summarizeCommandExecution(target, result, maxLogChars = DEFAULT_MAX_LOG_CHARS) {
  const statusCode = Number.isInteger(result && result.status) ? result.status : 1;
  return {
    name: target.name,
    title: target.title,
    status: statusCode === 0 ? 'pass' : 'fail',
    exitCode: statusCode,
    signal: result && result.signal ? result.signal : null,
    durationMs: Number(result && result.durationMs) || 0,
    command: target.command,
    args: Array.isArray(target.args) ? target.args.slice() : [],
    commandLine: target.commandLine || formatCommand(target.command, target.args),
    testFileCount: Number(target.testFileCount) || 0,
    testFiles: Array.isArray(target.testFiles) ? target.testFiles.slice() : [],
    stdoutTail: tailText(result && result.stdout, maxLogChars),
    stderrTail: tailText(result && result.stderr, maxLogChars),
  };
}

function selectOptimizationCandidates(summary) {
  const candidates = [];

  for (const gate of summary.gates || []) {
    if (gate.status !== 'fail') {
      continue;
    }
    candidates.push({
      id: `gate-${gate.name}`,
      priority: candidates.length,
      title: `修复 gate 失败：${gate.title}`,
      rationale: `当前 gate 失败会阻断后续持续优化，优先处理该门禁。命令：${gate.commandLine}`,
      files: [],
      suggestedCommands: [gate.commandLine],
    });
  }

  for (const shard of summary.shards || []) {
    if (shard.status !== 'fail') {
      continue;
    }
    candidates.push({
      id: `shard-${shard.name}`,
      priority: candidates.length,
      title: `收敛 shard 失败：${shard.title}`,
      rationale: `该测试分片失败，说明对应模块存在可复现回归。优先回放并定位该分片。`,
      files: shard.testFiles.slice(0, 6),
      suggestedCommands: [shard.commandLine],
    });
  }

  if (candidates.length > 0) {
    return candidates;
  }

  return STATIC_OPTIMIZATION_GAPS.map((item) => ({
    ...item,
    files: item.files.slice(),
    suggestedCommands: item.suggestedCommands.slice(),
  }));
}

function renderMarkdownReport(summary) {
  const lines = [
    '# Continuous Optimization Report',
    '',
    `- Run ID: \`${summary.runId}\``,
    `- Overall: **${summary.overallStatus.toUpperCase()}**`,
    `- Started At: \`${summary.startedAt}\``,
    `- Finished At: \`${summary.finishedAt}\``,
    `- Project Root: \`${summary.projectRoot}\``,
    `- Report Dir: \`${summary.reportDir}\``,
    `- Shards Parallel: \`${summary.parallelShards ? 'true' : 'false'}\``,
    '',
    '## Gates',
    '',
    '| Gate | Result | Duration |',
    '| --- | --- | ---: |',
  ];

  for (const gate of summary.gates) {
    lines.push(
      `| ${gate.title} | ${gate.status.toUpperCase()} | ${formatDurationMs(gate.durationMs)} |`
    );
  }

  lines.push(
    '',
    '## Shards',
    '',
    '| Shard | Result | Tests | Duration |',
    '| --- | --- | ---: | ---: |'
  );

  for (const shard of summary.shards) {
    lines.push(
      `| ${shard.title} | ${shard.status.toUpperCase()} | ${shard.testFileCount} | ${formatDurationMs(shard.durationMs)} |`
    );
  }

  lines.push('', '## Next Focus Candidates', '');

  for (const candidate of summary.nextFocusCandidates) {
    lines.push(`1. ${candidate.title}`);
    lines.push(`   - Why: ${candidate.rationale}`);
    if (candidate.files.length > 0) {
      lines.push(`   - Files: ${candidate.files.join(', ')}`);
    }
    if (candidate.suggestedCommands.length > 0) {
      lines.push(`   - Commands: ${candidate.suggestedCommands.join(' | ')}`);
    }
  }

  lines.push('', '## Known Blind Spots', '');

  for (const item of STATIC_OPTIMIZATION_GAPS) {
    lines.push(`- ${item.title}: ${item.rationale}`);
  }

  return `${lines.join('\n')}\n`;
}

function writeReports(reportDir, summary) {
  fs.mkdirSync(reportDir, { recursive: true });

  const latestJsonPath = path.join(reportDir, 'latest.json');
  const latestMarkdownPath = path.join(reportDir, 'latest.md');
  const historyJsonPath = path.join(reportDir, `${summary.runId}.json`);
  const historyMarkdownPath = path.join(reportDir, `${summary.runId}.md`);
  const jsonContent = `${JSON.stringify(summary, null, 2)}\n`;
  const markdownContent = renderMarkdownReport(summary);

  fs.writeFileSync(latestJsonPath, jsonContent, 'utf8');
  fs.writeFileSync(latestMarkdownPath, markdownContent, 'utf8');
  fs.writeFileSync(historyJsonPath, jsonContent, 'utf8');
  fs.writeFileSync(historyMarkdownPath, markdownContent, 'utf8');

  return {
    latestJsonPath,
    latestMarkdownPath,
    historyJsonPath,
    historyMarkdownPath,
  };
}

function runChildCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const spawnSpec = createSpawnSpec(command, args, options);
    const child = spawn(spawnSpec.command, spawnSpec.args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: spawnSpec.shell,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
    }

    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        status: 1,
        signal: null,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr: `${stderr}\n${error && error.message ? error.message : error}`.trim(),
      });
    });

    child.on('close', (status, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        status: typeof status === 'number' ? status : 1,
        signal: signal || null,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
      });
    });
  });
}

async function runGateSequence(gates, context) {
  const results = [];

  for (const gate of gates) {
    console.log(`[continuous-optimization] gate ${gate.name}: running`);
    const execution = await context.executeCommand(gate.command, gate.args, {
      cwd: context.projectRoot,
    });
    const summary = summarizeCommandExecution(gate, execution, context.maxLogChars);
    console.log(
      `[continuous-optimization] gate ${gate.name}: ${summary.status.toUpperCase()} (${formatDurationMs(summary.durationMs)})`
    );
    results.push(summary);
  }

  return results;
}

async function runShardSequence(shards, context) {
  const executeShard = async (shard) => {
    console.log(`[continuous-optimization] shard ${shard.name}: running`);
    const execution = await context.executeCommand(shard.command, shard.args, {
      cwd: context.projectRoot,
    });
    const summary = summarizeCommandExecution(shard, execution, context.maxLogChars);
    console.log(
      `[continuous-optimization] shard ${shard.name}: ${summary.status.toUpperCase()} (${formatDurationMs(summary.durationMs)})`
    );
    return summary;
  };

  if (context.parallelShards === false) {
    const results = [];
    for (const shard of shards) {
      results.push(await executeShard(shard));
    }
    return results;
  }

  return Promise.all(shards.map((shard) => executeShard(shard)));
}

async function runContinuousOptimization(options = {}) {
  const plan = createExecutionPlan(options);
  const reportDir = path.resolve(options.reportDir || DEFAULT_REPORT_DIR);
  const startedAt = new Date();
  const runId = options.runId || createRunId(startedAt);
  const executeCommand = options.executeCommand || runChildCommand;
  const runGates = options.runGates !== false;
  const parallelShards = options.parallelShards !== false;
  const maxLogChars =
    Number(options.maxLogChars) > 0 ? Number(options.maxLogChars) : DEFAULT_MAX_LOG_CHARS;

  const gateResults = runGates
    ? await runGateSequence(plan.gates, {
        executeCommand,
        maxLogChars,
        projectRoot: plan.projectRoot,
      })
    : [];

  const shardResults = await runShardSequence(plan.shards, {
    executeCommand,
    maxLogChars,
    parallelShards,
    projectRoot: plan.projectRoot,
  });

  const finishedAt = new Date();
  const overallStatus = [...gateResults, ...shardResults].every((item) => item.status === 'pass')
    ? 'pass'
    : 'fail';

  const summary = {
    runId,
    overallStatus,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    projectRoot: plan.projectRoot,
    testsDir: plan.testsDir,
    reportDir,
    runGates,
    parallelShards,
    gates: gateResults,
    shards: shardResults,
    knownBlindSpots: STATIC_OPTIMIZATION_GAPS.map((item) => ({
      id: item.id,
      title: item.title,
      rationale: item.rationale,
      files: item.files.slice(),
    })),
  };

  summary.nextFocusCandidates = selectOptimizationCandidates(summary);
  summary.reportFiles = writeReports(reportDir, summary);

  return summary;
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const parsed = {
    includePack: false,
    parallelShards: true,
    runGates: true,
    reportDir: null,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--include-pack') {
      parsed.includePack = true;
      continue;
    }

    if (arg === '--serial-shards') {
      parsed.parallelShards = false;
      continue;
    }

    if (arg === '--shards-only') {
      parsed.runGates = false;
      continue;
    }

    if (arg === '--json') {
      parsed.json = true;
      continue;
    }

    if (arg === '--report-dir') {
      parsed.reportDir = argv[index + 1] || null;
      index += 1;
      continue;
    }

    if (arg.startsWith('--report-dir=')) {
      parsed.reportDir = arg.slice('--report-dir='.length);
    }
  }

  return parsed;
}

async function runCli() {
  try {
    const options = parseCliArgs();
    const summary = await runContinuousOptimization(options);

    console.log(`[continuous-optimization] overall: ${summary.overallStatus.toUpperCase()}`);
    console.log(`[continuous-optimization] report: ${summary.reportFiles.latestMarkdownPath}`);

    if (options.json === true) {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    }

    process.exit(summary.overallStatus === 'pass' ? 0 : 1);
  } catch (error) {
    console.error(error && error.message ? error.message : error);
    process.exit(1);
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  DEFAULT_REPORT_DIR,
  STATIC_OPTIMIZATION_GAPS,
  TEST_SHARD_DEFINITIONS,
  collectMatchingTestFiles,
  createExecutionPlan,
  createSpawnSpec,
  createRunId,
  formatCommand,
  getGateDefinitions,
  getPnpmCommand,
  parseCliArgs,
  renderMarkdownReport,
  runChildCommand,
  shouldSpawnWithShell,
  runContinuousOptimization,
  selectOptimizationCandidates,
  summarizeCommandExecution,
  tailText,
  writeReports,
};
