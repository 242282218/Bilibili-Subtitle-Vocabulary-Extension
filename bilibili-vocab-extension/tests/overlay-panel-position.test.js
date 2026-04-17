const test = require('node:test');
const assert = require('node:assert/strict');

const overlayPanel = require('../overlayPanel.js');

test('normalizeOverlaySettings: should sanitize overlay offsets', () => {
  const normalized = overlayPanel.normalizeOverlaySettings({
    overlayPanelOffsetRight: 4,
    overlayPanelOffsetBottom: 480,
  });

  assert.equal(normalized.overlayPanelOffsetRight, 12);
  assert.equal(normalized.overlayPanelOffsetBottom, 240);
});

test('normalizeOverlaySettings: should keep valid overlay offsets', () => {
  const normalized = overlayPanel.normalizeOverlaySettings({
    overlayPanelOffsetRight: 44,
    overlayPanelOffsetBottom: 132,
  });

  assert.equal(normalized.overlayPanelOffsetRight, 44);
  assert.equal(normalized.overlayPanelOffsetBottom, 132);
});
