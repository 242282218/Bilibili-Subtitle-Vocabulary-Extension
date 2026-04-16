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

test("options layout: should provide dashboard style single-column shell", () => {
  const html = readProjectFile("options.html");

  assert.match(html, /class="options-body hub-page hub-page--options"/);
  assert.match(html, /hub-app-shell--single-column/);
  assert.doesNotMatch(html, /class="hub-sidebar"/);
  assert.match(html, /id="section-basics"/);
  assert.match(html, /id="section-review"/);
  assert.match(html, /id="settingsPreview"/);
  assert.match(html, /id="recommendationBadge"/);
  assert.match(html, /id="vocabularyMode"/);
  assert.match(html, /id="examPreference"/);
  assert.match(html, /id="exportAnkiButton"/);
});

test("popup layout: should assert the shipped react popup entry instead of legacy popup shell", () => {
  const manifest = readManifest();
  const popupHtml = readProjectFile("react-ui/popup.html");
  const popupSource = readProjectFile("react-ui/src/popup-main.tsx");

  assert.equal(manifest.action && manifest.action.default_popup, "dist/popup.html");
  assert.match(popupHtml, /id="root"/);
  assert.match(popupHtml, /src="\/src\/popup-main\.tsx"/);
  assert.match(popupSource, /学习策略快控台/);
  assert.match(popupSource, /当前配置档/);
  assert.match(popupSource, /启用自动调优/);
  assert.match(popupSource, /打开完整配置页/);
  assert.match(popupSource, /导出JSON/);
});

test("shared styles: should define dashboard shell and single-column options layout", () => {
  const stylesheet = readProjectFile("styles.css");

  assert.match(stylesheet, /\.hub-page\s*\{/);
  assert.match(stylesheet, /\.hub-app-shell--single-column\s*\{/);
  assert.match(stylesheet, /\.hub-panel\s*\{/);
  assert.match(stylesheet, /\.hub-topbar__metrics\s*\{/);
});
