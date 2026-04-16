const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readProjectFile(fileName) {
  return fs.readFileSync(path.join(__dirname, "..", fileName), "utf8");
}

test("react ui storage write guard: should reject on chrome runtime write error", () => {
  const source = readProjectFile("react-ui/src/storage.ts");

  assert.match(source, /function getChromeRuntimeError\(fallbackMessage: string\): Error \| null/);
  assert.match(
    source,
    /chrome\.storage\.local\.set\(payload,\s*\(\)\s*=>\s*\{[\s\S]*const runtimeError = getChromeRuntimeError\('chrome\.storage\.local\.set failed'\);[\s\S]*reject\(runtimeError\);/
  );
});
