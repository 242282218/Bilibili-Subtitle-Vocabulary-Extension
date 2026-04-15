const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  collectPackEntries,
  buildWindowsArchiveScript,
  parseZipEntryList,
  parsePowerShellZipEntries,
  validateArchiveEntries,
  createZipCommand,
  runPack
} = require("../scripts/pack-extension.js");

function createWorkspace() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pack-extension-"));
  fs.mkdirSync(path.join(workspace, "dist"), { recursive: true });
  fs.mkdirSync(path.join(workspace, "data"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "manifest.json"), "{}", "utf8");
  fs.writeFileSync(path.join(workspace, "styles.css"), "body{}", "utf8");
  fs.writeFileSync(path.join(workspace, "background.js"), "", "utf8");
  fs.writeFileSync(path.join(workspace, "contentScript.js"), "", "utf8");
  fs.writeFileSync(path.join(workspace, "options.html"), "<html></html>", "utf8");
  fs.writeFileSync(path.join(workspace, "popup.html"), "<html></html>", "utf8");
  fs.writeFileSync(path.join(workspace, "helper.js"), "", "utf8");
  fs.writeFileSync(path.join(workspace, "README.md"), "ignore", "utf8");
  return workspace;
}

test("pack extension: collectPackEntries should include fixed and glob matches without duplicates", () => {
  const workspace = createWorkspace();
  try {
    const entries = collectPackEntries(workspace);

    assert.deepEqual(entries, [
      "dist",
      "manifest.json",
      "data",
      "styles.css",
      "background.js",
      "contentScript.js",
      "helper.js",
      "options.html",
      "popup.html"
    ]);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("pack extension: createZipCommand should use zip on non-windows platform", () => {
  const workspace = createWorkspace();
  try {
    const outputZip = path.join(workspace, "extension.zip");
    const entries = ["dist", "manifest.json"];
    const command = createZipCommand(workspace, outputZip, entries, { platform: "linux" });

    assert.equal(command.command, "zip");
    assert.deepEqual(command.args, ["-r", outputZip, ...entries]);
    assert.equal(typeof command.cleanup, "object");
    assert.equal(command.cleanup, null);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("pack extension: createZipCommand should use powershell script on windows", () => {
  const workspace = createWorkspace();
  try {
    const outputZip = path.join(workspace, "extension.zip");
    const entries = ["dist", "manifest.json"];
    const command = createZipCommand(workspace, outputZip, entries, { platform: "win32" });

    assert.equal(command.command, "powershell");
    assert.equal(command.args[0], "-NoProfile");
    assert.equal(command.args[3], "-File");

    const scriptPath = command.args[4];
    const script = fs.readFileSync(scriptPath, "utf8");
    assert.match(script, /Compress-Archive/);
    assert.match(script, /manifest\.json/);

    assert.equal(typeof command.cleanup, "function");
    command.cleanup();
    assert.equal(fs.existsSync(path.dirname(scriptPath)), false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("pack extension: buildWindowsArchiveScript should escape single quotes", () => {
  const script = buildWindowsArchiveScript("C:/tmp/o'hare.zip", ["dist", "mani'fest.json"]);

  assert.match(script, /o''hare\.zip/);
  assert.match(script, /mani''fest\.json/);
});

test("pack extension: runPack should execute command and require archive output", () => {
  const workspace = createWorkspace();
  try {
    const outputZip = path.join(workspace, "extension.zip");
    const calls = [];
    const runner = (command, args, options) => {
      calls.push({ command, args, options });
      if (command === "zip") {
        fs.writeFileSync(outputZip, "zip", "utf8");
        return { status: 0 };
      }
      if (command === "unzip") {
        return {
          status: 0,
          stdout: `
Archive:  ${outputZip}
  Length      Date    Time    Name
---------  ---------- -----   ----
        0  2026-04-16 00:00   dist/
       34  2026-04-16 00:00   manifest.json
        0  2026-04-16 00:00   data/
---------                     -------
`
        };
      }
      throw new Error(`Unexpected command ${command}`);
    };

    const result = runPack({
      rootDir: workspace,
      platform: "linux",
      runner
    });

    assert.equal(calls.length, 2);
    assert.equal(calls[0].command, "zip");
    assert.equal(calls[1].command, "unzip");
    assert.match(result.outputZipPath, /extension\.zip$/);
    assert.equal(fs.existsSync(result.outputZipPath), true);
    assert.ok(result.entries.includes("manifest.json"));
    assert.ok(result.archiveEntries.includes("manifest.json"));
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("pack extension: runPack should fail when command exits non-zero", () => {
  const workspace = createWorkspace();
  try {
    assert.throws(
      () =>
        runPack({
          rootDir: workspace,
          platform: "linux",
          runner: (command) => {
            if (command === "zip") {
              return { status: 1 };
            }
            return { status: 0, stdout: "" };
          }
        }),
      /exit code 1/
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("pack extension: runPack should fail when no files matched", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pack-extension-empty-"));
  try {
    assert.throws(
      () =>
        runPack({
          rootDir: workspace,
          platform: "linux",
          fixedPaths: [],
          globPatterns: []
        }),
      /No files matched/
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("pack extension: parseZipEntryList should parse unzip output entries", () => {
  const entries = parseZipEntryList(`
Archive:  /tmp/extension.zip
  Length      Date    Time    Name
---------  ---------- -----   ----
        0  2026-04-16 00:00   dist/
      200  2026-04-16 00:00   dist/options.html
      123  2026-04-16 00:00   manifest.json
---------                     -------
`);

  assert.deepEqual(entries, ["dist/", "dist/options.html", "manifest.json"]);
});

test("pack extension: parsePowerShellZipEntries should normalize backslashes", () => {
  const entries = parsePowerShellZipEntries("dist\\options.html\r\nmanifest.json\r\n");
  assert.deepEqual(entries, ["dist/options.html", "manifest.json"]);
});

test("pack extension: validateArchiveEntries should reject missing required paths", () => {
  assert.throws(
    () =>
      validateArchiveEntries("C:/tmp/extension.zip", {
        platform: "linux",
        requiredEntries: ["dist", "manifest.json", "data"],
        runner: () => ({
          status: 0,
          stdout: `
Archive:  /tmp/extension.zip
  Length      Date    Time    Name
---------  ---------- -----   ----
        0  2026-04-16 00:00   dist/
      123  2026-04-16 00:00   manifest.json
---------                     -------
`
        })
      }),
    /Archive missing required entry: data/
  );
});

test("pack extension: validateArchiveEntries should accept nested required paths", () => {
  const entries = validateArchiveEntries("C:/tmp/extension.zip", {
    platform: "linux",
    requiredEntries: ["dist", "manifest.json", "data"],
    runner: () => ({
      status: 0,
      stdout: `
Archive:  /tmp/extension.zip
  Length      Date    Time    Name
---------  ---------- -----   ----
      123  2026-04-16 00:00   dist/options.html
      123  2026-04-16 00:00   manifest.json
      456  2026-04-16 00:00   data/cet4.json
---------                     -------
`
    })
  });

  assert.ok(entries.includes("data/cet4.json"));
});
