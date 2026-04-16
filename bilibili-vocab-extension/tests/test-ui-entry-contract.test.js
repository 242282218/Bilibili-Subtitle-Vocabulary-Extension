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

function hasUiTargetingArg(script) {
  return (
    /--project\s+ui\b/.test(script) ||
    /--config\s+\S*ui\S*/.test(script) ||
    /--include\s+\S*(ui|react-ui)\S*/.test(script) ||
    /tests\/\S*(ui|react-ui)\S*\.test\./.test(script) ||
    /\b(ui|react-ui)\b/.test(script)
  );
}

test("test ui entry contract: test:ui should not run vitest with root-wide scan", () => {
  const scripts = readPackageScripts();
  const testUiScript = normalizeScript(scripts["test:ui"]);

  assert.notEqual(testUiScript, "");
  assert.doesNotMatch(testUiScript, /(?:^|\s)vitest\s+run\s+--root\s+\.(?:\s|$)/);
});

test("test ui entry contract: test:ui should explicitly target ui-related scope", () => {
  const scripts = readPackageScripts();
  const testUiScript = normalizeScript(scripts["test:ui"]);

  assert.equal(hasUiTargetingArg(testUiScript), true);
});
