const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readWorkflow(fileName) {
  return fs.readFileSync(path.join(__dirname, "..", "..", ".github", "workflows", fileName), "utf8");
}

function collectPnpmInstallCommands(workflowText) {
  const matches = workflowText.match(/run:\s*pnpm install[^\r\n]*/g);
  return Array.isArray(matches) ? matches : [];
}

test("workflow lockfile contract: ci workflow should freeze pnpm lockfile installs", () => {
  assert.equal(fs.existsSync(path.join(__dirname, "..", "pnpm-lock.yaml")), true);

  const workflow = readWorkflow("ci.yml");
  const installCommands = collectPnpmInstallCommands(workflow);

  assert.ok(installCommands.length >= 5);
  assert.doesNotMatch(workflow, /--no-frozen-lockfile/);
  assert.doesNotMatch(workflow, /cache-dependency-path:\s*\$\{\{\s*env\.WORKDIR\s*\}\}\/package\.json/);
  assert.match(workflow, /cache-dependency-path:\s*\$\{\{\s*env\.WORKDIR\s*\}\}\/pnpm-lock\.yaml/);
  for (const command of installCommands) {
    assert.match(command, /--frozen-lockfile/);
  }
});

test("workflow lockfile contract: baseline refresh workflow should freeze pnpm lockfile install", () => {
  const workflow = readWorkflow("overlay-baseline-refresh.yml");
  const installCommands = collectPnpmInstallCommands(workflow);

  assert.equal(installCommands.length, 1);
  assert.doesNotMatch(workflow, /--no-frozen-lockfile/);
  assert.doesNotMatch(workflow, /cache-dependency-path:\s*\$\{\{\s*env\.WORKDIR\s*\}\}\/package\.json/);
  assert.match(workflow, /cache-dependency-path:\s*\$\{\{\s*env\.WORKDIR\s*\}\}\/pnpm-lock\.yaml/);
  assert.match(installCommands[0], /--frozen-lockfile/);
});
