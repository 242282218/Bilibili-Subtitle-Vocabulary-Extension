const test = require('node:test');
const assert = require('node:assert/strict');

const popup = require('../popup.js');

test('sortQuickReviewItems: should ignore malformed entries and keep stable ordering', () => {
  const sorted = popup.sortQuickReviewItems([
    null,
    undefined,
    'invalid',
    123,
    {
      word: 'laterWord',
      dueBucket: 'later',
      nextReviewAt: 1700000005000,
      updatedAt: 1700000001000,
    },
    {
      word: 'todayWord',
      dueBucket: 'today',
      nextReviewAt: 1700000003000,
      updatedAt: 1700000002000,
    },
    { word: 'soonWord', dueBucket: 'soon', nextReviewAt: 1700000004000, updatedAt: 1700000003000 },
  ]);

  assert.deepEqual(
    sorted.map((item) => item.word),
    ['todayWord', 'soonWord', 'laterWord']
  );
});
