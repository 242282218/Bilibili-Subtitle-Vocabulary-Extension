const test = require('node:test');
const assert = require('node:assert/strict');

const vocabularyPure = require('../vocabulary-pure.js');
const vocabulary = require('../vocabulary.js');

const previousChrome = global.chrome;

test.before(() => {
  global.chrome = {
    runtime: {
      lastError: null,
      sendMessage(_message, callback) {
        callback({ ok: true, payload: {} });
      },
    },
  };
});

test.after(() => {
  global.chrome = previousChrome;
});

test('findMatchesInText: should match alias terms', () => {
  vocabulary.__setEntriesForTest([
    {
      word: 'optimize',
      meaning: '\u4f18\u5316',
      aliases: ['\u6539\u8fdb'],
      level: 'CET4',
    },
  ]);

  const matches = vocabulary.findMatchesInText(
    '\u6211\u4eec\u9700\u8981\u6539\u8fdb\u5b57\u5e55\u7cfb\u7edf',
    ['CET4']
  );
  assert.equal(matches.length, 1);
  assert.equal(matches[0].chinese, '\u6539\u8fdb');
  assert.equal(matches[0].word, 'optimize');
});

test('findMatchesInText: should deduplicate repeated meaning terms', () => {
  vocabulary.__setEntriesForTest([
    {
      word: 'strategy',
      meaning: '\u7b56\u7565;\u65b9\u6cd5',
      aliases: ['\u7b56\u7565', '\u65b9\u6848'],
      level: 'CET6',
    },
  ]);

  const matches = vocabulary.findMatchesInText(
    '\u8fd9\u4e2a\u7b56\u7565\u65b9\u6848\u5f88\u6709\u6548',
    ['CET6']
  );
  const chineseTokens = matches.map((item) => item.chinese);
  assert.deepEqual(chineseTokens, ['\u7b56\u7565', '\u65b9\u6848']);
});

test('recordHit: should increment hitCount and update lastSeen', () => {
  vocabulary.__setEntriesForTest([
    {
      word: 'optimize',
      meaning: '\u4f18\u5316',
      aliases: ['\u6539\u8fdb'],
      level: 'CET4',
    },
  ]);

  const before = Date.now();
  const result = vocabulary.recordHit('optimize');

  assert.equal(result, true);

  const encountered = vocabulary.getEncounteredWords();
  assert.equal(encountered.length, 1);
  assert.equal(encountered[0].word, 'optimize');
  assert.equal(encountered[0].hitCount, 1);
  assert.ok(Number(encountered[0].lastSeen) >= before);
});

test('getEncounteredWords: should return only words with hitCount > 0', () => {
  vocabulary.__setEntriesForTest([
    { word: 'alpha', meaning: '\u963f\u5c14\u6cd5', level: 'CET4' },
    { word: 'beta', meaning: '\u8d1d\u5854', level: 'CET6' },
  ]);

  vocabulary.recordHit('beta');

  const encountered = vocabulary.getEncounteredWords();
  assert.deepEqual(
    encountered.map((item) => item.word),
    ['beta']
  );
});

test('getReviewQueue: should prioritize earlier nextReviewAt within same bucket', () => {
  vocabulary.__setEntriesForTest([
    { word: 'alpha', meaning: '\u963f\u5c14\u6cd5', level: 'CET4' },
    { word: 'beta', meaning: '\u8d1d\u5854', level: 'CET6' },
  ]);

  const originalNow = Date.now;
  let now = 1700000000000;
  Date.now = () => now;
  try {
    vocabulary.recordHit('alpha');
    now += 1000;
    vocabulary.recordHit('beta');
  } finally {
    Date.now = originalNow;
  }

  const queue = vocabulary.getReviewQueue(2);
  assert.deepEqual(
    queue.map((item) => item.word),
    ['alpha', 'beta']
  );
  assert.equal(typeof queue[0].nextReviewAt, 'number');
  assert.equal(typeof queue[0].intervalDays, 'number');
  assert.equal(typeof queue[0].easeFactor, 'number');
});

test('getReviewQueue: should prioritize today bucket before soon bucket', async () => {
  vocabulary.__setEntriesForTest([
    { word: 'alpha', meaning: '\u963f\u5c14\u6cd5', level: 'CET4' },
    { word: 'beta', meaning: '\u8d1d\u5854', level: 'CET6' },
  ]);

  const originalNow = Date.now;
  const now = 1700000000000;
  Date.now = () => now;
  try {
    vocabulary.recordHit('alpha');
    await vocabulary.applyLearningAction('alpha', 'dontKnow');

    vocabulary.recordHit('beta');
    await vocabulary.applyLearningAction('beta', 'know');
  } finally {
    Date.now = originalNow;
  }

  const queue = vocabulary.getReviewQueue(2);
  assert.equal(queue[0].word, 'alpha');
  assert.equal(queue[0].dueBucket, 'today');
  assert.equal(queue[1].word, 'beta');
  assert.equal(queue[1].dueBucket, 'soon');
});
