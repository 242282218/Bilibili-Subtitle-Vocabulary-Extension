const test = require('node:test');
const assert = require('node:assert/strict');

const overlayPanel = require('../overlayPanel.js');

test('getPresetSettings: should return gentle preset', () => {
  assert.deepEqual(overlayPanel.getPresetSettings('gentle'), {
    replaceRatio: 0.15,
    maxReplaceCount: 1,
    reviewDanmakuSpeed: 'slow',
  });
});

test('getPresetSettings: should return balanced preset', () => {
  assert.deepEqual(overlayPanel.getPresetSettings('balanced'), {
    replaceRatio: 0.2,
    maxReplaceCount: 2,
    reviewDanmakuSpeed: 'normal',
  });
});

test('getPresetSettings: should return intensive preset', () => {
  assert.deepEqual(overlayPanel.getPresetSettings('intensive'), {
    replaceRatio: 0.25,
    maxReplaceCount: 4,
    reviewDanmakuSpeed: 'fast',
  });
});

test('getPresetSettings: should fallback to balanced preset', () => {
  assert.deepEqual(overlayPanel.getPresetSettings('unknown'), {
    replaceRatio: 0.2,
    maxReplaceCount: 2,
    reviewDanmakuSpeed: 'normal',
  });
});
