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

test("react ui contract: manifest should not eagerly inject dist overlay bundle", () => {
  const manifest = readManifest();
  const firstContentScript = Array.isArray(manifest.content_scripts) ? manifest.content_scripts[0] : null;
  const scriptList = firstContentScript && Array.isArray(firstContentScript.js) ? firstContentScript.js : [];

  assert.equal(scriptList.includes("dist/overlay.js"), false);
  assert.notEqual(scriptList.indexOf("contentScript.js"), -1);
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

test("react ui contract: content stylesheet should stay self-contained", () => {
  const stylesheet = readProjectFile("styles.css");

  assert.doesNotMatch(stylesheet, /@import\s+url\(["']https?:\/\//i);
  assert.match(stylesheet, /--font-sans:\s*"Avenir Next"/);
  assert.match(stylesheet, /--font-display:\s*"Iowan Old Style"/);
  assert.match(stylesheet, /\.options-body\s*\{[\s\S]*font-family:\s*var\(--font-sans\)/);
  assert.match(stylesheet, /\.hub-title\s*\{[\s\S]*font-family:\s*var\(--font-display\)/);
});

test("react ui contract: content script should lazy-load dist overlay bundle", () => {
  const contentScript = readProjectFile("contentScript.js");

  assert.match(contentScript, /import\(chrome\.runtime\.getURL\("dist\/overlay\.js"\)\)/);
  assert.match(contentScript, /overlayModule\.mountOverlayPanel\(\)/);
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
