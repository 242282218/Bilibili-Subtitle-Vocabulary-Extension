const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readProjectFile(fileName) {
  return fs.readFileSync(path.join(__dirname, "..", fileName), "utf8");
}

function readManifest() {
  const raw = readProjectFile("manifest.json").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}

test("react ui contract: manifest should point options/popup to dist build", () => {
  const manifest = readManifest();
  assert.equal(manifest.options_page, "dist/options.html");
  assert.equal(manifest.action && manifest.action.default_popup, "dist/popup.html");
});

test("react ui contract: content script should load dist overlay bundle before contentScript", () => {
  const manifest = readManifest();
  const firstContentScript = Array.isArray(manifest.content_scripts) ? manifest.content_scripts[0] : null;
  const scriptList = firstContentScript && Array.isArray(firstContentScript.js) ? firstContentScript.js : [];

  const overlayIndex = scriptList.indexOf("dist/overlay.js");
  const contentScriptIndex = scriptList.indexOf("contentScript.js");

  assert.notEqual(overlayIndex, -1);
  assert.notEqual(contentScriptIndex, -1);
  assert.ok(overlayIndex < contentScriptIndex);
});

test("react ui contract: content script should load experience metrics before adaptive tuning", () => {
  const manifest = readManifest();
  const firstContentScript = Array.isArray(manifest.content_scripts) ? manifest.content_scripts[0] : null;
  const scriptList = firstContentScript && Array.isArray(firstContentScript.js) ? firstContentScript.js : [];

  const metricsIndex = scriptList.indexOf("experienceMetrics.js");
  const adaptiveIndex = scriptList.indexOf("adaptiveTuning.js");

  assert.notEqual(metricsIndex, -1);
  assert.notEqual(adaptiveIndex, -1);
  assert.ok(metricsIndex < adaptiveIndex);
});

test("react ui contract: react-ui html entries should exist for options and popup", () => {
  const optionsHtml = readProjectFile("react-ui/options.html");
  const popupHtml = readProjectFile("react-ui/popup.html");

  assert.match(optionsHtml, /id="root"/);
  assert.match(optionsHtml, /src="\/src\/options-main\.tsx"/);
  assert.match(popupHtml, /id="root"/);
  assert.match(popupHtml, /src="\/src\/popup-main\.tsx"/);
});

test("react ui contract: overlay entry should use lightweight overlay adapters", () => {
  const overlayEntry = readProjectFile("react-ui/src/overlay-entry.tsx");

  assert.doesNotMatch(overlayEntry, /from ['"]\.\/settings-bridge['"]/);
  assert.doesNotMatch(overlayEntry, /from ['"]\.\/storage['"]/);
  assert.doesNotMatch(overlayEntry, /from ['"]\.\/use-v3-settings['"]/);
  assert.match(overlayEntry, /from ['"]\.\/overlay-settings['"]/);
  assert.match(overlayEntry, /from ['"]\.\/overlay-storage['"]/);
  assert.match(overlayEntry, /from ['"]\.\/use-overlay-settings['"]/);
});
