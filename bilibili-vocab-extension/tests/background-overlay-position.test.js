const test = require('node:test');
const assert = require('node:assert/strict');

const background = require('../background.js');

test('normalizeStoredSettings: should persist overlay panel default position', () => {
  const normalized = background.normalizeStoredSettings({});

  assert.equal(normalized.overlayPanelOffsetRight, 24);
  assert.equal(normalized.overlayPanelOffsetBottom, 96);
});

test('normalizeStoredSettings: should clamp overlay panel offsets into viewport-safe range', () => {
  const normalized = background.normalizeStoredSettings({
    overlayPanelOffsetRight: -20,
    overlayPanelOffsetBottom: 999,
  });

  assert.equal(normalized.overlayPanelOffsetRight, 12);
  assert.equal(normalized.overlayPanelOffsetBottom, 240);
});
