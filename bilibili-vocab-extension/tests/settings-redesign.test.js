const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readProjectFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
}

test('options redesign: should use single-column layout and keep overview/save sections', () => {
  const html = readProjectFile('options.html');

  assert.match(html, /hub-app-shell--single-column/);
  assert.doesNotMatch(html, /<aside class="hub-sidebar">/);
  assert.match(html, /id="section-overview"/);
  assert.match(html, /id="section-save"/);
});

test('options redesign: should provide clickable scenario presets', () => {
  const html = readProjectFile('options.html');

  assert.match(html, /class="hub-scenario-card" data-preset="light" tabindex="0" role="button"/);
  assert.match(html, /class="hub-scenario-card" data-preset="balanced" tabindex="0" role="button"/);
  assert.match(
    html,
    /class="hub-scenario-card" data-preset="intensive" tabindex="0" role="button"/
  );
  assert.match(html, /class="hub-scenario-card__icon"/);
  assert.match(html, /class="hub-scenario-card__tag"/);
});

test('options redesign: should define scoped design tokens and animation hooks', () => {
  const stylesheet = readProjectFile('styles.css');

  assert.doesNotMatch(stylesheet, /(^|\n):root\s*\{/m);
  assert.match(
    stylesheet,
    /:is\(\.options-body,\s*\.popup-body\)\s*\{[\s\S]*--color-brand-from:\s*#2563eb;/
  );
  assert.match(
    stylesheet,
    /:is\(\.options-body,\s*\.popup-body\)\s*\{[\s\S]*--bg-base:\s*#f5f7fb;/
  );
  assert.match(
    stylesheet,
    /\.hub-app-shell--single-column\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/
  );
  assert.match(stylesheet, /@keyframes fadeInUp/);
  assert.match(stylesheet, /@keyframes brandPulse/);
  assert.match(
    stylesheet,
    /:is\(\.options-body,\s*\.popup-body\)\s+\.toast-message\.is-visible\s*\{[\s\S]*transform:\s*translateY\(0\) scale\(1\)/
  );
});

test('options redesign logic: should expose scene presets and recommendation renderer helpers', () => {
  const optionsModule = require('../options.js');

  assert.deepEqual(optionsModule.SCENE_PRESETS.light, {
    replaceRatio: 0.15,
    maxReplaceCount: 1,
    reviewDanmakuSpeed: 'slow',
  });
  assert.deepEqual(optionsModule.SCENE_PRESETS.balanced, {
    replaceRatio: 0.2,
    maxReplaceCount: 2,
    reviewDanmakuSpeed: 'normal',
  });
  assert.deepEqual(optionsModule.SCENE_PRESETS.intensive, {
    replaceRatio: 0.3,
    maxReplaceCount: 4,
    reviewDanmakuSpeed: 'fast',
  });
  assert.equal(optionsModule.getRecommendationColor('good'), 'good');
  assert.equal(optionsModule.getRecommendationColor('warn'), 'warn');
  assert.equal(optionsModule.getRecommendationColor('default'), 'default');

  const rendered = optionsModule.renderRecommendationList({
    ratio: 0.3,
    levelCount: 2,
    speed: 'fast',
    enabled: true,
    maxReplaceCount: 4,
  });

  assert.equal(rendered.badgeText, '推荐：冲刺曝光');
  assert.equal(rendered.items.length, 3);
  assert.deepEqual(
    rendered.items.map((item) => item.tone),
    ['warn', 'good', 'warn']
  );
});
