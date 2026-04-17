const test = require('node:test');
const assert = require('node:assert/strict');

const overlayPanel = require('../overlayPanel.js');

test('getAutoSaveStatusMessage: should describe enabled auto save', () => {
  assert.equal(overlayPanel.getAutoSaveStatusMessage(true), '已自动保存');
});

test('getAutoSaveStatusMessage: should describe disabled auto save', () => {
  assert.equal(overlayPanel.getAutoSaveStatusMessage(false), '等待保存');
});

test('getMockSubtitlePreview: should build preview sentence for balanced mode', () => {
  const preview = overlayPanel.getMockSubtitlePreview({
    enabled: true,
    replaceRatio: 0.2,
    maxReplaceCount: 2,
    targetCefr: 'B2',
  });

  assert.match(preview, /预览：/);
  assert.match(preview, /system|context|vocabulary/);
});
