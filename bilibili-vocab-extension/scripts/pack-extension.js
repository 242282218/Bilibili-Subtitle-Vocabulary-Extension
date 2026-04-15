const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const DEFAULT_OUTPUT_NAME = "extension.zip";
const DEFAULT_INCLUDE_GLOBS = ["*.js", "*.html"];
const FIXED_INCLUDE_PATHS = ["dist", "manifest.json", "data", "styles.css", "background.js", "contentScript.js"];
const WIN_ARCHIVE_SCRIPT_FILE = "pack-extension.ps1";
const REQUIRED_ARCHIVE_ENTRIES = ["dist", "manifest.json", "data"];

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

function normalizeArchivePathForCheck(entryPath) {
  return entryPath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
}

function parseZipEntryList(stdoutText) {
  const lines = String(stdoutText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const entries = [];
  for (const line of lines) {
    if (!line.startsWith("Archive: ") && !line.startsWith("Length ") && !line.startsWith("---------")) {
      const parts = line.split(/\s+/);
      if (parts.length >= 4) {
        entries.push(parts[parts.length - 1]);
      }
    }
  }

  return entries;
}

function parsePowerShellZipEntries(stdoutText) {
  return String(stdoutText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/\\/g, "/"));
}

function listArchiveEntries(outputZipPath, options = {}) {
  const runner = options.runner || spawnSync;
  const platform = options.platform || process.platform;

  if (platform === "win32") {
    const result = runner(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip=[System.IO.Compression.ZipFile]::OpenRead('${outputZipPath.replace(/'/g, "''")}'); $zip.Entries | ForEach-Object { $_.FullName }; $zip.Dispose()`
      ],
      {
        encoding: "utf8"
      }
    );

    if (result.status !== 0) {
      throw new Error(`Failed to inspect archive entries on Windows (exit code ${result.status}).`);
    }

    return parsePowerShellZipEntries(result.stdout);
  }

  const result = runner("unzip", ["-l", outputZipPath], { encoding: "utf8" });
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
  const inspectorRunner = options.inspectorRunner || runner;
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

    const archiveEntries = validateArchiveEntries(outputZipPath, {
      platform: options.platform,
      runner: inspectorRunner,
      requiredEntries: options.requiredEntries
    });

    return {
      rootDir,
      outputZipPath,
      entries,
      archiveEntries,
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
  REQUIRED_ARCHIVE_ENTRIES,
  collectPackEntries,
  normalizeOutputZipPath,
  normalizeArchivePathForCheck,
  parseZipEntryList,
  parsePowerShellZipEntries,
  listArchiveEntries,
  validateArchiveEntries,
  buildPosixZipCommand,
  buildWindowsArchiveScript,
  createZipCommand,
  runPack
};
