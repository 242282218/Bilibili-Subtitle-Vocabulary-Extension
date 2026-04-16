const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readOptionsSource() {
  return fs.readFileSync(path.join(__dirname, "..", "options.js"), "utf8");
}

test("options import/reset contract: should define helper functions referenced by import/reset flows", () => {
  const source = readOptionsSource();

  assert.match(source, /async function saveSettingsToStorage\(settings\)/);
  assert.match(source, /async function loadSettingsFromStorage\(\)/);
  assert.match(source, /function refreshUI\(\)/);
  assert.match(source, /await saveSettingsToStorage\(normalized\);/);
  assert.match(source, /await loadSettingsFromStorage\(\);/);
  assert.match(source, /refreshUI\(\);/);
  assert.match(source, /await saveSettingsToStorage\(defaultSettings\);/);
});
