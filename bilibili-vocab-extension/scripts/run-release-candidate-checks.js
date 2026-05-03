const { spawnSync } = require('node:child_process');

const RELEASE_CHECK_SCRIPT_NAMES = [
  'lint',
  'typecheck',
  'test',
  'test:ui',
  'optimize:continuous',
  'build:extension',
  'test:extension-smoke',
  'test:zip-smoke',
];

function getPnpmCommand(platform = process.platform) {
  return platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
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

function createReleaseCheckSteps(options = {}) {
  const pnpm = options.pnpmCommand || getPnpmCommand(options.platform);
  return RELEASE_CHECK_SCRIPT_NAMES.map((scriptName) => ({
    id: scriptName,
    title: scriptName,
    command: pnpm,
    args: ['run', scriptName],
  }));
}

function runReleaseChecks(options = {}) {
  const runner = options.runner || spawnSync;
  const steps = options.steps || createReleaseCheckSteps(options);

  for (const step of steps) {
    console.log(`[release-check] ${step.title}: running`);
    const spawnSpec = createSpawnSpec(step.command, step.args, options);
    const result = runner(spawnSpec.command, spawnSpec.args, {
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      stdio: options.stdio || 'inherit',
      shell: spawnSpec.shell,
    });

    if (!result || result.status !== 0) {
      const status = result && Number.isInteger(result.status) ? result.status : 1;
      throw new Error(`[release-check] ${step.title} failed with exit code ${status}`);
    }

    console.log(`[release-check] ${step.title}: PASS`);
  }

  return steps.map((step) => step.id);
}

function runCli() {
  try {
    const completed = runReleaseChecks();
    console.log(`[release-check] overall: PASS (${completed.length} steps)`);
  } catch (error) {
    console.error(error && error.message ? error.message : error);
    process.exit(1);
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  RELEASE_CHECK_SCRIPT_NAMES,
  getPnpmCommand,
  createSpawnSpec,
  createReleaseCheckSteps,
  runReleaseChecks,
};
