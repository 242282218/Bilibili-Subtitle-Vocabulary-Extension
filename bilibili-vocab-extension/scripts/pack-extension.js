const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const BUILD_VOCAB_DATASET_SCRIPT = path.join('scripts', 'build-vocab-dataset.js');
const DEFAULT_OUTPUT_NAME = 'extension.zip';
const DEFAULT_INCLUDE_GLOBS = [];
const FIXED_INCLUDE_PATHS = [
  'manifest.json',
  'background.js',
  'contentScript.js',
  'styles.css',
  'scripts',
  'dist',
  'data',
];
const WIN_ARCHIVE_SCRIPT_FILE = 'pack-extension.ps1';
const REQUIRED_ARCHIVE_ENTRIES = FIXED_INCLUDE_PATHS.slice();
const WINDOWS_PACK_MAX_RETRY = 2;

function listProjectRootFiles(rootDir) {
  return fs.readdirSync(rootDir, { withFileTypes: true }).map((entry) => entry.name);
}

function resolveGlobMatches(rootDir, patterns = DEFAULT_INCLUDE_GLOBS) {
  const rootNames = listProjectRootFiles(rootDir);
  const matches = [];

  for (const pattern of patterns) {
    if (!pattern.startsWith('*.')) {
      continue;
    }

    const ext = pattern.slice(1).toLowerCase();
    for (const name of rootNames) {
      if (!name.toLowerCase().endsWith(ext)) {
        continue;
      }
      if (!matches.includes(name)) {
        matches.push(name);
      }
    }
  }

  return matches;
}

function collectPackEntries(rootDir, options = {}) {
  const fixedPaths =
    options.fixedPaths || collectManifestPackEntries(rootDir, options.manifestFile);
  const requiredFixedPaths = options.requiredFixedPaths || fixedPaths;
  const globPatterns = options.globPatterns || DEFAULT_INCLUDE_GLOBS;
  const entries = [];

  for (const fixedPath of fixedPaths) {
    const absolute = path.resolve(rootDir, fixedPath);
    if (!fs.existsSync(absolute)) {
      if (requiredFixedPaths.includes(fixedPath)) {
        throw new Error(`Pack entry missing required path: ${fixedPath}`);
      }
      continue;
    }
    if (!entries.includes(fixedPath)) {
      entries.push(fixedPath);
    }
  }

  const globEntries = resolveGlobMatches(rootDir, globPatterns);
  for (const entry of globEntries) {
    if (!entries.includes(entry)) {
      entries.push(entry);
    }
  }

  return entries;
}

function normalizeOutputZipPath(rootDir, outputZip) {
  const outputName = outputZip || process.env.EXTENSION_ZIP_NAME || DEFAULT_OUTPUT_NAME;
  return path.resolve(rootDir, outputName);
}

function copyEntryToDirectory(rootDir, stagingRoot, entry) {
  const sourcePath = path.resolve(rootDir, entry);
  const targetPath = path.resolve(stagingRoot, entry);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.cpSync(sourcePath, targetPath, { recursive: true });
}

function shouldStagePublishData(rootDir, options = {}) {
  if (options.stagePublishData === false) {
    return false;
  }

  return (
    fs.existsSync(path.join(rootDir, 'sources')) &&
    fs.existsSync(path.join(rootDir, BUILD_VOCAB_DATASET_SCRIPT))
  );
}

function buildPublishDataset(stagingRoot, rootDir, options = {}) {
  const datasetRunner = options.datasetRunner || spawnSync;
  const dataDir = path.join(stagingRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const result = datasetRunner(
    process.execPath,
    [BUILD_VOCAB_DATASET_SCRIPT, '--publish-safe', '--output-dir', dataDir],
    {
      cwd: rootDir,
      stdio: 'inherit',
    }
  );

  if (!result || result.status !== 0) {
    const status = result && Number.isInteger(result.status) ? result.status : 1;
    throw new Error(`Publish dataset build failed with exit code ${status}.`);
  }
}

function createPackStageRoot(rootDir, entries, options = {}) {
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-pack-root-'));
  const stagePublishData = shouldStagePublishData(rootDir, options);

  for (const entry of entries) {
    if (entry === 'data' && stagePublishData) {
      continue;
    }
    copyEntryToDirectory(rootDir, stagingRoot, entry);
  }

  if (entries.includes('data') && stagePublishData) {
    buildPublishDataset(stagingRoot, rootDir, options);
  } else if (entries.includes('data')) {
    copyEntryToDirectory(rootDir, stagingRoot, 'data');
  }

  return stagingRoot;
}

function normalizeArchivePathForCheck(entryPath) {
  return entryPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
}

function readManifest(rootDir, manifestFile = 'manifest.json') {
  const manifestPath = path.resolve(rootDir, manifestFile);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Pack entry missing required path: ${manifestFile}`);
  }

  const raw = fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

function collectManifestEntry(entries, rawPath) {
  const normalizedPath = normalizeArchivePathForCheck(String(rawPath || '').trim());
  if (!normalizedPath) {
    return;
  }

  const normalizedEntry =
    normalizedPath.includes('*') || normalizedPath.includes('/')
      ? normalizedPath.split('/')[0]
      : normalizedPath;
  if (normalizedEntry && !entries.includes(normalizedEntry)) {
    entries.push(normalizedEntry);
  }
}

function collectManifestPathValues(entries, value) {
  if (typeof value === 'string') {
    collectManifestEntry(entries, value);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectManifestPathValues(entries, item));
    return;
  }

  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectManifestPathValues(entries, item));
  }
}

function collectManifestPackEntries(rootDir, manifestFile = 'manifest.json') {
  const manifest = readManifest(rootDir, manifestFile);
  const entries = ['manifest.json'];

  collectManifestPathValues(entries, manifest.background && manifest.background.service_worker);

  const contentScripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
  contentScripts.forEach((script) => {
    collectManifestPathValues(entries, script && script.js);
    collectManifestPathValues(entries, script && script.css);
  });

  collectManifestPathValues(entries, manifest.options_page);
  collectManifestPathValues(entries, manifest.action && manifest.action.default_popup);
  collectManifestPathValues(entries, manifest.action && manifest.action.default_icon);
  collectManifestPathValues(entries, manifest.icons);

  const webAccessibleResources = Array.isArray(manifest.web_accessible_resources)
    ? manifest.web_accessible_resources
    : [];
  webAccessibleResources.forEach((item) => {
    collectManifestPathValues(entries, item && item.resources);
  });

  return entries;
}

function parseZipEntryList(stdoutText) {
  const lines = String(stdoutText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const entries = [];
  for (const line of lines) {
    if (
      !line.startsWith('Archive: ') &&
      !line.startsWith('Length ') &&
      !line.startsWith('---------')
    ) {
      const parts = line.split(/\s+/);
      if (parts.length >= 4) {
        entries.push(parts[parts.length - 1]);
      }
    }
  }

  return entries;
}

function parsePowerShellZipEntries(stdoutText) {
  return String(stdoutText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/\\/g, '/'));
}

function listArchiveEntries(outputZipPath, options = {}) {
  const runner = options.runner || spawnSync;
  const platform = options.platform || process.platform;

  if (platform === 'win32') {
    const result = runner(
      'powershell',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip=[System.IO.Compression.ZipFile]::OpenRead('${outputZipPath.replace(/'/g, "''")}'); $zip.Entries | ForEach-Object { $_.FullName }; $zip.Dispose()`,
      ],
      {
        encoding: 'utf8',
      }
    );

    if (result.status !== 0) {
      throw new Error(`Failed to inspect archive entries on Windows (exit code ${result.status}).`);
    }

    return parsePowerShellZipEntries(result.stdout);
  }

  const result = runner('unzip', ['-l', outputZipPath], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Failed to inspect archive entries (exit code ${result.status}).`);
  }

  return parseZipEntryList(result.stdout);
}

function validateArchiveEntries(outputZipPath, options = {}) {
  const requiredEntries = options.requiredEntries || REQUIRED_ARCHIVE_ENTRIES;
  const entries = listArchiveEntries(outputZipPath, options);
  const normalizedEntries = entries.map(normalizeArchivePathForCheck);

  for (const requiredEntry of requiredEntries) {
    const normalizedRequired = normalizeArchivePathForCheck(requiredEntry);
    const exactHit = normalizedEntries.includes(normalizedRequired);
    const nestedHit = normalizedEntries.some((entry) => entry.startsWith(`${normalizedRequired}/`));

    if (!exactHit && !nestedHit) {
      throw new Error(`Archive missing required entry: ${requiredEntry}`);
    }
  }

  return entries;
}

function buildPosixZipCommand(outputZipPath, entries) {
  return {
    command: 'zip',
    args: ['-r', outputZipPath, ...entries],
    options: { stdio: 'inherit' },
  };
}

function buildWindowsArchiveScript(outputZipPath, entries) {
  const escapedOutput = outputZipPath.replace(/'/g, "''");
  const escapedEntries = entries.map((entry) => `'${entry.replace(/'/g, "''")}'`).join(', ');

  return [
    "$ErrorActionPreference = 'Stop'",
    `Set-Location -LiteralPath '${process.cwd().replace(/'/g, "''")}'`,
    `if (Test-Path -LiteralPath '${escapedOutput}') { Remove-Item -LiteralPath '${escapedOutput}' -Force }`,
    `$entries = @(${escapedEntries})`,
    '$existing = @()',
    'foreach ($item in $entries) {',
    '  if (Test-Path -LiteralPath $item) { $existing += $item }',
    '}',
    "if ($existing.Count -eq 0) { throw 'No files matched for packaging.' }",
    `Compress-Archive -Path $existing -DestinationPath '${escapedOutput}' -Force`,
  ].join('\n');
}

function shouldRetryWindowsPack(result) {
  if (!result || result.status === 0) {
    return false;
  }
  const stderr = String(result.stderr || '');
  const stdout = String(result.stdout || '');
  const combined = `${stderr}\n${stdout}`.toLowerCase();
  return (
    combined.includes('because it is being used by another process') ||
    combined.includes('compressarchiveunauthorizedaccesserror')
  );
}

function sleepSync(milliseconds) {
  const waitArray = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(waitArray, 0, 0, milliseconds);
}

function runPackCommandWithRetry(commandSpec, options = {}) {
  const runner = options.runner || spawnSync;
  const platform = options.platform || process.platform;
  const maxRetry = Number.isInteger(options.maxRetry) ? options.maxRetry : WINDOWS_PACK_MAX_RETRY;

  let lastResult = null;
  for (let attempt = 0; attempt <= maxRetry; attempt += 1) {
    const result = runner(commandSpec.command, commandSpec.args, commandSpec.options);
    lastResult = result;
    if (result.status === 0) {
      return result;
    }

    const canRetry = platform === 'win32' && shouldRetryWindowsPack(result) && attempt < maxRetry;
    if (!canRetry) {
      return result;
    }

    sleepSync(150 * (attempt + 1));
  }

  return lastResult || { status: 1 };
}

function buildWindowsZipCommand(outputZipPath, entries, tempDir) {
  const scriptPath = path.join(tempDir, WIN_ARCHIVE_SCRIPT_FILE);
  const script = buildWindowsArchiveScript(outputZipPath, entries);
  fs.writeFileSync(scriptPath, script, 'utf8');

  return {
    command: 'powershell',
    args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
    options: { stdio: 'inherit' },
  };
}

function createZipCommand(rootDir, outputZipPath, entries, options = {}) {
  const platform = options.platform || process.platform;

  if (platform === 'win32') {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-pack-'));
    const command = buildWindowsZipCommand(outputZipPath, entries, tempDir);
    return {
      ...command,
      cleanup: () => {
        fs.rmSync(tempDir, { recursive: true, force: true });
      },
    };
  }

  return {
    ...buildPosixZipCommand(outputZipPath, entries),
    cleanup: null,
  };
}

function runPack(options = {}) {
  const rootDir = path.resolve(options.rootDir || path.resolve(__dirname, '..'));
  const outputZipPath = normalizeOutputZipPath(rootDir, options.outputZip);
  const entries = collectPackEntries(rootDir, options);

  if (entries.length === 0) {
    throw new Error('No files matched for packaging.');
  }

  const runner = options.runner || spawnSync;
  const inspectorRunner = options.inspectorRunner || runner;
  const originalCwd = process.cwd();

  let cleanup = null;
  try {
    const packRoot = createPackStageRoot(rootDir, entries, options);
    cleanup = () => {
      fs.rmSync(packRoot, { recursive: true, force: true });
    };
    process.chdir(packRoot);

    if (fs.existsSync(outputZipPath)) {
      fs.rmSync(outputZipPath, { force: true });
    }

    const commandSpec = createZipCommand(packRoot, outputZipPath, entries, options);
    const commandCleanup = commandSpec.cleanup;
    cleanup = () => {
      if (typeof commandCleanup === 'function') {
        commandCleanup();
      }
      fs.rmSync(packRoot, { recursive: true, force: true });
    };
    const result = runPackCommandWithRetry(commandSpec, {
      runner,
      platform: options.platform,
      maxRetry: options.maxRetry,
    });

    if (result.status !== 0) {
      throw new Error(`Pack command failed with exit code ${result.status}.`);
    }

    if (!fs.existsSync(outputZipPath)) {
      throw new Error(`Pack command finished but archive was not created: ${outputZipPath}`);
    }

    const archiveEntries = validateArchiveEntries(outputZipPath, {
      platform: options.platform,
      runner: inspectorRunner,
      requiredEntries: options.requiredEntries || entries,
    });

    return {
      rootDir,
      packRoot,
      outputZipPath,
      entries,
      archiveEntries,
      command: commandSpec.command,
      args: commandSpec.args,
    };
  } finally {
    process.chdir(originalCwd);
    if (typeof cleanup === 'function') {
      cleanup();
    }
  }
}

function runCli() {
  try {
    const result = runPack();
    console.log(`[pack] Created ${result.outputZipPath}`);
  } catch (error) {
    console.error(`[pack] ${error && error.message ? error.message : error}`);
    process.exit(1);
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  DEFAULT_OUTPUT_NAME,
  DEFAULT_INCLUDE_GLOBS,
  FIXED_INCLUDE_PATHS,
  WIN_ARCHIVE_SCRIPT_FILE,
  REQUIRED_ARCHIVE_ENTRIES,
  WINDOWS_PACK_MAX_RETRY,
  collectPackEntries,
  normalizeOutputZipPath,
  normalizeArchivePathForCheck,
  parseZipEntryList,
  parsePowerShellZipEntries,
  listArchiveEntries,
  validateArchiveEntries,
  buildPosixZipCommand,
  buildWindowsArchiveScript,
  shouldRetryWindowsPack,
  runPackCommandWithRetry,
  createZipCommand,
  createPackStageRoot,
  runPack,
};
