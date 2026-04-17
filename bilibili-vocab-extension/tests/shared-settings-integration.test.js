const test = require('node:test');
const assert = require('node:assert/strict');

const sharedSettings = require('../sharedSettings.js');
const options = require('../options.js');
const popup = require('../popup.js');
const background = require('../background.js');

test('shared settings integration: options should reuse shared defaults and helpers', () => {
  assert.deepEqual(options.getInitialOptionsSettings(), sharedSettings.DEFAULT_SETTINGS);
  assert.equal(options.getInitialOptionsSettings().webPageEnabled, true);
  assert.strictEqual(options.normalizeSettings, sharedSettings.normalizeSettings);
  assert.strictEqual(options.getHeroMetricMeta, sharedSettings.getHeroMetricMeta);
  assert.strictEqual(options.getLearningProfile, sharedSettings.getLearningProfile);
});

test('shared settings integration: popup should reuse shared defaults and helpers', () => {
  assert.deepEqual(popup.getInitialPopupSettings(), sharedSettings.DEFAULT_SETTINGS);
  assert.equal(popup.getInitialPopupSettings().webPageEnabled, true);
  assert.strictEqual(popup.getHeroMetricMeta, sharedSettings.getHeroMetricMeta);
  assert.strictEqual(popup.getLearningProfile, sharedSettings.getLearningProfile);
  assert.strictEqual(popup.normalizeReviewDanmakuSpeed, sharedSettings.normalizeReviewDanmakuSpeed);
});

test('shared settings integration: background should reuse shared speed normalization', () => {
  assert.strictEqual(
    background.normalizeReviewDanmakuSpeed,
    sharedSettings.normalizeReviewDanmakuSpeed
  );
});
