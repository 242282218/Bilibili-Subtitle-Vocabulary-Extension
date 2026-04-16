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

test("test coverage entry contract: should use node test coverage runner", () => {
  const scripts = readPackageScripts();
  const coverageScript = normalizeScript(scripts["test:coverage"]);

  assert.notEqual(coverageScript, "");
  assert.doesNotMatch(coverageScript, /\bvitest\b/);
  assert.match(coverageScript, /(?:^|\s)node\s+--test\b/);
  assert.match(coverageScript, /--experimental-test-coverage\b/);
});

test("test coverage entry contract: should target repository node test files", () => {
  const scripts = readPackageScripts();
  const coverageScript = normalizeScript(scripts["test:coverage"]);

  assert.match(coverageScript, /tests\/\*\.test\.js\b/);
});
