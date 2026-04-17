const test = require('node:test');
const assert = require('node:assert/strict');

const popup = require('../popup.js');
const options = require('../options.js');

test('getInitialPopupSettings: should fall back to defaults when storage is unavailable', () => {
  const initial = popup.getInitialPopupSettings();

  assert.equal(initial.enabled, true);
  assert.equal(initial.reviewDanmakuEnabled, false);
  assert.equal(initial.reviewDanmakuSpeed, 'normal');
  assert.equal(initial.webPageEnabled, true);
  assert.equal(initial.replaceRatio, 0.2);
  assert.equal(initial.maxReplaceCount, 2);
  assert.equal(initial.targetCefr, 'B2');
  assert.deepEqual(initial.activeLevels, ['CET4', 'CET6', 'KAOYAN', 'IELTS', 'TOEFL']);
});

test('getInitialOptionsSettings: should fall back to defaults when storage is unavailable', () => {
  const initial = options.getInitialOptionsSettings();

  assert.equal(initial.enabled, true);
  assert.equal(initial.reviewDanmakuSpeed, 'normal');
  assert.equal(initial.webPageEnabled, true);
  assert.equal(initial.replaceRatio, 0.2);
  assert.equal(initial.maxReplaceCount, 2);
  assert.equal(initial.targetCefr, 'B2');
  assert.deepEqual(initial.activeLevels, ['CET4', 'CET6', 'KAOYAN', 'IELTS', 'TOEFL']);
});
