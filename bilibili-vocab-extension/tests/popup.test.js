const test = require('node:test');
const assert = require('node:assert/strict');

const popup = require('../popup.js');

test('normalizeWordStat: should normalize missing fields', () => {
  const normalized = popup.normalizeWordStat({
    word: '  optimize ',
    meaning: '优化',
    hitCount: '3',
    lastSeen: '1700000000000',
  });

  assert.equal(normalized.word, 'optimize');
  assert.equal(normalized.translation, '优化');
  assert.equal(normalized.hitCount, 3);
  assert.equal(normalized.lastSeen, 1700000000000);
});

test('sortEncounteredWords: asc should sort by hitCount then lastSeen', () => {
  const list = [
    { word: 'b', hitCount: 2, lastSeen: 9 },
    { word: 'a', hitCount: 1, lastSeen: 10 },
    { word: 'c', hitCount: 2, lastSeen: 4 },
  ];

  const sorted = popup.sortEncounteredWords(list, 'asc');
  assert.deepEqual(
    sorted.map((item) => item.word),
    ['a', 'c', 'b']
  );
});

test('sortEncounteredWords: desc should sort by hitCount then lastSeen', () => {
  const list = [
    { word: 'b', hitCount: 2, lastSeen: 9 },
    { word: 'a', hitCount: 1, lastSeen: 10 },
    { word: 'c', hitCount: 2, lastSeen: 4 },
  ];

  const sorted = popup.sortEncounteredWords(list, 'desc');
  assert.deepEqual(
    sorted.map((item) => item.word),
    ['b', 'c', 'a']
  );
});

test('normalizeReviewDanmakuEnabled: should default to false', () => {
  assert.equal(popup.normalizeReviewDanmakuEnabled(undefined), false);
  assert.equal(popup.normalizeReviewDanmakuEnabled(false), false);
  assert.equal(popup.normalizeReviewDanmakuEnabled(true), true);
});

test('getReviewDanmakuButtonLabel: should reflect current trigger state', () => {
  assert.equal(popup.getReviewDanmakuButtonLabel(false), '启动复习弹幕');
  assert.equal(popup.getReviewDanmakuButtonLabel(true), '停止复习弹幕');
});

test('normalizeReviewDanmakuSpeed: should default to normal', () => {
  assert.equal(popup.normalizeReviewDanmakuSpeed(undefined), 'normal');
  assert.equal(popup.normalizeReviewDanmakuSpeed('fast'), 'fast');
  assert.equal(popup.normalizeReviewDanmakuSpeed('SLOW'), 'slow');
  assert.equal(popup.normalizeReviewDanmakuSpeed('unknown'), 'normal');
});

test('getReviewDanmakuSpeedLabel: should reflect preset labels', () => {
  assert.equal(popup.getReviewDanmakuSpeedLabel('slow'), '慢');
  assert.equal(popup.getReviewDanmakuSpeedLabel('normal'), '标准');
  assert.equal(popup.getReviewDanmakuSpeedLabel('fast'), '快');
});

test('getLearningProfile: should classify balanced strategy', () => {
  assert.deepEqual(
    popup.getLearningProfile({
      ratio: 0.2,
      maxReplaceCount: 2,
      enabled: true,
    }),
    {
      tone: 'balanced',
      label: '均衡输入',
      summary: '理解优先，保持稳定词汇曝光',
    }
  );
});

test('getLearningProfile: should classify intensive strategy when ratio is high', () => {
  assert.deepEqual(
    popup.getLearningProfile({
      ratio: 0.25,
      maxReplaceCount: 4,
      enabled: true,
    }),
    {
      tone: 'intensive',
      label: '强化曝光',
      summary: '适合熟悉内容后集中强化词汇刺激',
    }
  );
});

test('getLearningProfile: should classify gentle strategy when disabled', () => {
  assert.deepEqual(
    popup.getLearningProfile({
      ratio: 0.15,
      maxReplaceCount: 1,
      enabled: false,
    }),
    {
      tone: 'gentle',
      label: '轻量待机',
      summary: '当前未启用，可随时恢复温和输入',
    }
  );
});

test('getQuickReviewEmptyState: should guide users when there is nothing due', () => {
  assert.deepEqual(popup.getQuickReviewEmptyState(), {
    title: '当前没有待复习词',
    description: '继续看一段带字幕的视频，系统会把新命中的词汇自动加入复习池。',
  });
});

test('formatReviewCountText: should prefer today due count', () => {
  assert.equal(popup.formatReviewCountText({ todayCount: 5, newCount: 2 }), '今日待复习 5');
});

test('sortQuickReviewItems: should prioritize earlier nextReviewAt in same bucket', () => {
  const sorted = popup.sortQuickReviewItems([
    { word: 'beta', dueBucket: 'today', nextReviewAt: 1700000002000, updatedAt: 1700000003000 },
    { word: 'alpha', dueBucket: 'today', nextReviewAt: 1700000001000, updatedAt: 1700000004000 },
  ]);

  assert.deepEqual(
    sorted.map((item) => item.word),
    ['alpha', 'beta']
  );
});

test('sortQuickReviewItems: should prioritize today bucket before soon bucket', () => {
  const sorted = popup.sortQuickReviewItems([
    { word: 'soonWord', dueBucket: 'soon', nextReviewAt: 1700000001000, updatedAt: 1700000002000 },
    {
      word: 'todayWord',
      dueBucket: 'today',
      nextReviewAt: 1700000003000,
      updatedAt: 1700000004000,
    },
  ]);

  assert.deepEqual(
    sorted.map((item) => item.word),
    ['todayWord', 'soonWord']
  );
});

test('formatReviewDueText: should expose relative review timing', () => {
  const now = 1700000000000;
  assert.equal(popup.formatReviewDueText(now + 2 * 60 * 60 * 1000, now), '2 小时后');
  assert.equal(popup.formatReviewDueText(now - 1000, now), '现在复习');
});
