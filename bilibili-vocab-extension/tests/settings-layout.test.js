const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readProjectFile(fileName) {
  return fs.readFileSync(path.join(__dirname, "..", fileName), "utf8");
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

test("popup layout: should provide compact dashboard style sections", () => {
  const html = readProjectFile("popup.html");

  assert.match(html, /class="hub-page hub-page--popup"/);
  assert.match(html, /class="hub-popup-topbar"/);
  assert.match(html, /class="hub-quick-grid"/);
  assert.match(html, /id="reviewCountToday"/);
  assert.match(html, /id="quickReviewButton"/);
  assert.match(html, /id="quickReviewWord"/);
  assert.match(html, /id="reviewActionKnow"/);
  assert.match(html, /id="reviewDanmakuButton"/);
  assert.match(html, /id="rankingList"/);
  assert.match(html, /id="openOptionsButton"/);
  assert.match(html, /id="vocabularyMode"/);
  assert.match(html, /id="examPreference"/);
});

test("shared styles: should define dashboard shell and single-column options layout", () => {
  const stylesheet = readProjectFile("styles.css");

  assert.match(stylesheet, /\.hub-page\s*\{/);
  assert.match(stylesheet, /\.hub-app-shell--single-column\s*\{/);
  assert.match(stylesheet, /\.hub-panel\s*\{/);
  assert.match(stylesheet, /\.hub-topbar__metrics\s*\{/);
});
