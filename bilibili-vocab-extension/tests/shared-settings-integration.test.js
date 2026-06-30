const test = require('node:test');
const assert = require('node:assert/strict');

const sharedSettings = require('../sharedSettings.js');
const overlayPanel = require('../overlayPanel.js');
const background = require('../background.js');

test('shared settings integration: overlayPanel should reuse shared defaults and helpers', () => {
  const sample = {
    enabled: false,
    webPageEnabled: false,
    reviewDanmakuEnabled: true,
    reviewDanmakuSpeed: 'fast',
    reviewDanmakuDensity: 'dense',
    vocabularyMode: 'full',
    examPreference: 'exam-first',
    activeLevels: ['cet4', 'unknown'],
    replaceRatio: 0,
    maxReplaceCount: 0,
    targetCefr: 'z9',
    bilingualMode: 'english-only',
    themeMode: 'dark',
    domainRules: {
      'Example.COM': { enabled: false },
    },
    overlayPanelHidden: true,
    overlayPanelCollapsed: true,
    overlayPanelWidth: 999,
    overlayPanelHeight: 12,
    overlayPanelOffsetRight: 1,
    overlayPanelOffsetBottom: 1,
  };

  const sharedNormalized = sharedSettings.normalizeSettings(sample);
  const overlayNormalized = overlayPanel.normalizeOverlaySettings(sample);

  assert.equal(overlayNormalized.enabled, sharedNormalized.enabled);
  assert.equal(overlayNormalized.webPageEnabled, sharedNormalized.webPageEnabled);
  assert.equal(overlayNormalized.reviewDanmakuEnabled, sharedNormalized.reviewDanmakuEnabled);
  assert.equal(overlayNormalized.reviewDanmakuSpeed, sharedNormalized.reviewDanmakuSpeed);
  assert.equal(overlayNormalized.reviewDanmakuDensity, sharedNormalized.reviewDanmakuDensity);
  assert.equal(overlayNormalized.vocabularyMode, sharedNormalized.vocabularyMode);
  assert.equal(overlayNormalized.examPreference, sharedNormalized.examPreference);
  assert.deepEqual(overlayNormalized.activeLevels, sharedNormalized.activeLevels);
  assert.equal(overlayNormalized.replaceRatio, sharedNormalized.replaceRatio);
  assert.equal(overlayNormalized.maxReplaceCount, sharedNormalized.maxReplaceCount);
  assert.equal(overlayNormalized.targetCefr, sharedNormalized.targetCefr);
  assert.equal(overlayNormalized.bilingualMode, sharedNormalized.bilingualMode);
  assert.equal(overlayNormalized.themeMode, sharedNormalized.themeMode);
  assert.deepEqual(overlayNormalized.domainRules, sharedNormalized.domainRules);
  assert.equal(overlayNormalized.overlayPanelHidden, true);
  assert.equal(overlayNormalized.overlayPanelCollapsed, true);
  assert.equal(overlayNormalized.overlayPanelWidth, 560);
  assert.equal(overlayNormalized.overlayPanelHeight, 360);
  assert.equal(overlayNormalized.overlayPanelOffsetRight, 12);
  assert.equal(overlayNormalized.overlayPanelOffsetBottom, 24);
});

test('shared settings integration: background should reuse shared speed normalization', () => {
  assert.strictEqual(
    background.normalizeReviewDanmakuSpeed,
    sharedSettings.normalizeReviewDanmakuSpeed
  );
});
