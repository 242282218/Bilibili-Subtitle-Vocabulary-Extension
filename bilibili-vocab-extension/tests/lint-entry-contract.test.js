const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readPackageScripts() {
  const packageJsonPath = path.join(__dirname, "..", "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  return packageJson.scripts || {};
}

function normalizeScript(script) {
  return String(script || "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseLintExtensions(lintScript) {
  const match = lintScript.match(/--ext\s+([^\s]+)/);
  if (!match) {
    return [];
  }
  return match[1]
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

test("lint entry contract: should run eslint from repository root", () => {
  const scripts = readPackageScripts();
  const lintScript = normalizeScript(scripts.lint);

  assert.notEqual(lintScript, "");
  assert.match(lintScript, /^eslint\s+\./);
  assert.match(lintScript, /--max-warnings\s+0/);
});

test("lint entry contract: should lint both javascript and typescript files", () => {
  const scripts = readPackageScripts();
  const lintScript = normalizeScript(scripts.lint);
  const extensions = parseLintExtensions(lintScript);

  const expectedExtensions = ["js", "cjs", "mjs", "ts", "tsx"];
  expectedExtensions.forEach((ext) => {
    assert.equal(extensions.includes(ext), true);
  });
});
