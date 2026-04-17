const test = require('node:test');
const assert = require('node:assert/strict');

const popup = require('../popup.js');

test('collectActiveLevels: should fall back to default levels when DOM is unavailable', () => {
  assert.deepEqual(popup.collectActiveLevels(), ['CET4', 'CET6', 'KAOYAN', 'IELTS', 'TOEFL']);
});
