const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const DEFAULT_OUTPUT_NAME = "extension.zip";
const DEFAULT_INCLUDE_GLOBS = ["*.js", "*.html"];
const FIXED_INCLUDE_PATHS = ["dist", "manifest.json", "data", "styles.css", "background.js", "contentScript.js"];
const WIN_ARCHIVE_SCRIPT_FILE = "pack-extension.ps1";

function listProjectRootFiles(rootDir) {
  return fs.readdirSync(rootDir, { withFileTypes: true }).map((entry) => entry.name);
}

function resolveGlobMatches(rootDir, patterns = DEFAULT_INCLUDE_GLOBS) {
  const rootNames = listProjectRootFiles(rootDir);
  const matches = [];

  for (const pattern of patterns) {
    if (!pattern.startsWith("*.")) {
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
  const fixedPaths = options.fixedPaths || FIXED_INCLUDE_PATHS;
  const globPatterns = options.globPatterns || DEFAULT_INCLUDE_GLOBS;
  const entries = [];

  for (const fixedPath of fixedPaths) {
    const absolute = path.resolve(rootDir, fixedPath);
    if (!fs.existsSync(absolute)) {
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

function buildPosixZipCommand(outputZipPath, entries) {
  return {
    command: "zip",
    args: ["-r", outputZipPath, ...entries],
    options: { stdio: "inherit" }
  };
}

function buildWindowsArchiveScript(outputZipPath, entries) {
  const escapedOutput = outputZipPath.replace(/'/g, "''");
  const escapedEntries = entries.map((entry) => `'${entry.replace(/'/g, "''")}'`).join(", ");

  return [
    "$ErrorActionPreference = 'Stop'",
    `Set-Location -LiteralPath '${process.cwd().replace(/'/g, "''")}'`,
    `if (Test-Path -LiteralPath '${escapedOutput}') { Remove-Item -LiteralPath '${escapedOutput}' -Force }`,
    `$entries = @(${escapedEntries})`,
    "$existing = @()",
    "foreach ($item in $entries) {",
    "  if (Test-Path -LiteralPath $item) { $existing += $item }",
    "}",
    "if ($existing.Count -eq 0) { throw 'No files matched for packaging.' }",
    `Compress-Archive -Path $existing -DestinationPath '${escapedOutput}' -Force`
  ].join("\n");
}

function buildWindowsZipCommand(outputZipPath, entries, tempDir) {
  const scriptPath = path.join(tempDir, WIN_ARCHIVE_SCRIPT_FILE);
  const script = buildWindowsArchiveScript(outputZipPath, entries);
  fs.writeFileSync(scriptPath, script, "utf8");

  return {
    command: "powershell",
    args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
    options: { stdio: "inherit" }
  };
}

function createZipCommand(rootDir, outputZipPath, entries, options = {}) {
  const platform = options.platform || process.platform;

  if (platform === "win32") {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ext-pack-"));
    const command = buildWindowsZipCommand(outputZipPath, entries, tempDir);
    return {
      ...command,
      cleanup: () => {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    };
  }

  return {
    ...buildPosixZipCommand(outputZipPath, entries),
    cleanup: null
  };
}

function runPack(options = {}) {
  const rootDir = path.resolve(options.rootDir || path.resolve(__dirname, ".."));
  const outputZipPath = normalizeOutputZipPath(rootDir, options.outputZip);
  const entries = collectPackEntries(rootDir, options);

  if (entries.length === 0) {
    throw new Error("No files matched for packaging.");
  }

  const runner = options.runner || spawnSync;
  const originalCwd = process.cwd();
  process.chdir(rootDir);

  let cleanup = null;
  try {
    if (fs.existsSync(outputZipPath)) {
      fs.rmSync(outputZipPath, { force: true });
    }

    const commandSpec = createZipCommand(rootDir, outputZipPath, entries, options);
    cleanup = commandSpec.cleanup;
    const result = runner(commandSpec.command, commandSpec.args, commandSpec.options);

    if (result.status !== 0) {
      throw new Error(`Pack command failed with exit code ${result.status}.`);
    }

    if (!fs.existsSync(outputZipPath)) {
      throw new Error(`Pack command finished but archive was not created: ${outputZipPath}`);
    }

    return {
      rootDir,
      outputZipPath,
      entries,
      command: commandSpec.command,
      args: commandSpec.args
    };
  } finally {
    process.chdir(originalCwd);
    if (typeof cleanup === "function") {
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
  collectPackEntries,
  normalizeOutputZipPath,
  buildPosixZipCommand,
  buildWindowsArchiveScript,
  createZipCommand,
  runPack
};