const test = require('node:test');
const assert = require('node:assert/strict');

const overlayPanel = require('../overlayPanel.js');

test('buildLearningSnapshot: should expose queue counts and current review item', () => {
  const now = 1700000000000;
  const snapshot = overlayPanel.buildLearningSnapshot(
    {
      todayCount: 3,
      newCount: 2,
      masteredCount: 5,
    },
    [
      {
        word: 'retain',
        translation: '记住',
        level: 'CET6',
        status: 'seen',
        dueBucket: 'today',
        nextReviewAt: now + 2 * 60 * 60 * 1000,
      },
    ],
    0,
    now
  );

  assert.equal(snapshot.headline, '今日待复习 3');
  assert.equal(snapshot.newCount, '2');
  assert.equal(snapshot.masteredCount, '5');
  assert.match(snapshot.currentWord, /retain/);
  assert.match(snapshot.currentMeta, /今日优先/);
  assert.match(snapshot.currentMeta, /2 小时后/);
  assert.match(snapshot.currentMeta, /已遇见/);
  assert.equal(snapshot.empty, false);
});

test('buildLearningSnapshot: should provide empty-state copy when queue is empty', () => {
  const snapshot = overlayPanel.buildLearningSnapshot(
    {
      todayCount: 0,
      newCount: 0,
      masteredCount: 0,
    },
    []
  );

  assert.equal(snapshot.headline, '今日待复习 0');
  assert.equal(snapshot.currentWord, '当前没有待复习词');
  assert.match(snapshot.currentDescription, /继续观看带字幕的视频/);
  assert.equal(snapshot.empty, true);
});

test('buildLearningSnapshot: should skip malformed queue entries and keep first valid word', () => {
  const now = 1700000000000;
  const snapshot = overlayPanel.buildLearningSnapshot(
    {
      todayCount: 1,
      newCount: 1,
      masteredCount: 0,
    },
    [
      null,
      { word: '   ', translation: '空词' },
      'invalid',
      {
        word: ' retain ',
        translation: ' 记住 ',
        level: 'cet6',
        status: 'Learning',
        dueBucket: 'TODAY',
        nextReviewAt: now + 60 * 60 * 1000,
      },
    ],
    0,
    now
  );

  assert.equal(snapshot.empty, false);
  assert.equal(snapshot.currentWordKey, 'retain');
  assert.equal(snapshot.currentWord, 'retain · 记住');
  assert.match(snapshot.currentMeta, /CET6/);
  assert.match(snapshot.currentMeta, /今日优先/);
  assert.match(snapshot.currentMeta, /1 小时后/);
  assert.match(snapshot.currentMeta, /已遇见/);
});

test('buildLearningSnapshot: should fallback to empty state when queue has no valid word', () => {
  const snapshot = overlayPanel.buildLearningSnapshot(
    {
      todayCount: 2,
      newCount: 1,
      masteredCount: 0,
    },
    [{}, { word: '  ', translation: 'missing' }, { word: '', dueBucket: 'today' }]
  );

  assert.equal(snapshot.empty, true);
  assert.equal(snapshot.currentWordKey, '');
  assert.equal(snapshot.currentWord, '当前没有待复习词');
});
