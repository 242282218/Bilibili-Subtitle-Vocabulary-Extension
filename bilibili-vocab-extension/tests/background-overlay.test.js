const test = require('node:test');
const assert = require('node:assert/strict');

const background = require('../background.js');

test('normalizeStoredSettings: should persist overlay panel defaults', () => {
  const normalized = background.normalizeStoredSettings({});

  assert.equal(normalized.overlayPanelHidden, false);
  assert.equal(normalized.overlayPanelCollapsed, false);
  assert.equal(normalized.overlayPanelWidth, 420);
  assert.equal(normalized.overlayPanelHeight, 640);
});

test('normalizeStoredSettings: should clamp overlay panel size and boolean flags', () => {
  const normalized = background.normalizeStoredSettings({
    overlayPanelHidden: 1,
    overlayPanelCollapsed: true,
    overlayPanelWidth: 1200,
    overlayPanelHeight: 200,
  });

  assert.equal(normalized.overlayPanelHidden, false);
  assert.equal(normalized.overlayPanelCollapsed, true);
  assert.equal(normalized.overlayPanelWidth, 560);
  assert.equal(normalized.overlayPanelHeight, 360);
});
