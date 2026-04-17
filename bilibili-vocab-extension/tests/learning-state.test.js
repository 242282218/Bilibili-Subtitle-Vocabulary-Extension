const test = require('node:test');
const assert = require('node:assert/strict');

const learningState = require('../learningState.js');

test('migrateLegacyStat: should bootstrap learning fields from legacy hit stats', () => {
  const migrated = learningState.migrateLegacyStat({
    word: 'optimize',
    translation: '优化',
    level: 'CET4',
    hitCount: 5,
    lastSeen: 1700000000000,
  });

  assert.equal(migrated.word, 'optimize');
  assert.equal(migrated.translation, '优化');
  assert.equal(migrated.exposureCount, 5);
  assert.equal(migrated.seenCount, 5);
  assert.equal(migrated.status, 'seen');
  assert.equal(migrated.nextReviewBucket, 'today');
  assert.ok(migrated.masteryScore > 0);
});

test('recordExposure: should create a new review candidate on first hit', () => {
  const now = 1700000000000;
  const next = learningState.recordExposure(
    null,
    {
      word: 'strategy',
      translation: '策略',
      level: 'CET6',
      sourceLevels: ['CET6'],
    },
    now
  );

  assert.equal(next.status, 'unseen');
  assert.equal(next.seenCount, 1);
  assert.equal(next.exposureCount, 1);
  assert.equal(next.firstSeenAt, now);
  assert.equal(next.lastSeenAt, now);
  assert.equal(next.nextReviewBucket, 'today');
  assert.equal(next.intervalDays, 1);
  assert.equal(typeof next.easeFactor, 'number');
  assert.ok(next.nextReviewAt >= now);
  assert.deepEqual(next.sourceLevels, ['CET6']);
});

test('applyReviewFeedback: should promote stable words toward mastered', () => {
  let record = learningState.recordExposure(
    null,
    {
      word: 'candidate',
      translation: '候选人',
      level: 'KAOYAN',
      sourceLevels: ['KAOYAN'],
    },
    1700000000000
  );

  record = learningState.recordExposure(
    record,
    {
      word: 'candidate',
      translation: '候选人',
      level: 'KAOYAN',
      sourceLevels: ['KAOYAN'],
    },
    1700000001000
  );

  record = learningState.applyReviewFeedback(record, 'know', 1700000002000);
  record = learningState.applyReviewFeedback(record, 'know', 1700000003000);
  record = learningState.applyReviewFeedback(record, 'know', 1700000004000);

  assert.equal(record.reviewCount, 3);
  assert.equal(record.status, 'mastered');
  assert.equal(record.nextReviewBucket, 'later');
  assert.ok(record.intervalDays >= 3);
  assert.ok(record.nextReviewAt > 1700000004000);
  assert.ok(record.masteryScore >= 80);
});

test('applyLearningAction: should support save and skip transitions', () => {
  let record = learningState.recordExposure(
    null,
    {
      word: 'notion',
      translation: '概念',
      level: 'IELTS',
      sourceLevels: ['IELTS'],
    },
    1700000000000
  );

  record = learningState.applyLearningAction(record, 'save', 1700000001000);
  assert.equal(record.status, 'saved');
  assert.equal(record.saveCount, 1);
  assert.equal(record.nextReviewBucket, 'soon');

  record = learningState.applyLearningAction(record, 'skip', 1700000002000);
  assert.equal(record.status, 'skipped');
  assert.equal(record.nextReviewBucket, 'later');
});

test('syncReviewQueue: should keep unresolved words in queue and remove mastered words', () => {
  const queue = {};
  const learning = learningState.syncReviewQueue(
    queue,
    {
      word: 'outline',
      status: 'seen',
      nextReviewBucket: 'today',
      nextReviewAt: 1700000000000,
      intervalDays: 1,
      easeFactor: 2.3,
      sourceLevels: ['CET6'],
      lastSeenAt: 1700000000000,
    },
    1700000000000
  );

  assert.equal(learning.outline.dueBucket, 'today');
  assert.equal(learning.outline.intervalDays, 1);
  assert.equal(learning.outline.nextReviewAt, 1700000000000);

  const afterMastered = learningState.syncReviewQueue(
    learning,
    {
      word: 'outline',
      status: 'mastered',
      nextReviewBucket: 'later',
      sourceLevels: ['CET6'],
      lastSeenAt: 1700000001000,
    },
    1700000001000
  );

  assert.equal('outline' in afterMastered, false);
});

test('applyReviewFeedback: should update time-point schedule with ease factor', () => {
  const now = 1700000000000;
  let record = learningState.recordExposure(
    null,
    {
      word: 'context',
      translation: '语境',
      level: 'IELTS',
      sourceLevels: ['IELTS'],
    },
    now
  );

  const afterKnow = learningState.applyReviewFeedback(record, 'know', now + 1000);
  assert.ok(afterKnow.intervalDays >= 1);
  assert.ok(afterKnow.easeFactor >= 2.3);
  assert.ok(afterKnow.nextReviewAt > now + 1000);

  const afterDontKnow = learningState.applyReviewFeedback(afterKnow, 'dontKnow', now + 2000);
  assert.equal(afterDontKnow.intervalDays, 1);
  assert.ok(afterDontKnow.easeFactor <= afterKnow.easeFactor);
  assert.equal(afterDontKnow.nextReviewBucket, 'today');
});

test('applyReviewFeedback: should support dontKnow -> fuzzy -> know interval adjustments', () => {
  const now = 1700000000000;
  let record = learningState.recordExposure(
    null,
    {
      word: 'sequence',
      translation: '序列',
      level: 'CET6',
      sourceLevels: ['CET6'],
    },
    now
  );

  const afterDontKnow = learningState.applyReviewFeedback(record, 'dontKnow', now + 1000);
  const afterFuzzy = learningState.applyReviewFeedback(afterDontKnow, 'fuzzy', now + 2000);
  const afterKnow = learningState.applyReviewFeedback(afterFuzzy, 'know', now + 3000);

  assert.equal(afterDontKnow.nextReviewBucket, 'today');
  assert.equal(afterFuzzy.nextReviewBucket, 'today');
  assert.ok(afterKnow.intervalDays >= afterFuzzy.intervalDays);
  assert.ok(afterKnow.nextReviewAt > afterFuzzy.nextReviewAt);
  assert.ok(afterKnow.easeFactor >= afterFuzzy.easeFactor);
});

test('normalizeReviewQueue: should keep legacy items without nextReviewAt and derive due bucket', () => {
  const queue = learningState.normalizeReviewQueue({
    legacy: {
      word: 'legacy',
      intervalDays: 7,
      easeFactor: 2.2,
      updatedAt: 1700000000000,
    },
  });

  assert.equal(queue.legacy.word, 'legacy');
  assert.equal(queue.legacy.nextReviewAt, null);
  assert.equal(queue.legacy.intervalDays, 7);
  assert.equal(queue.legacy.dueBucket, 'later');
});

test('buildLearningSummary: should count due, new and mastered words', () => {
  const summary = learningState.buildLearningSummary(
    {
      alpha: {
        word: 'alpha',
        status: 'unseen',
        nextReviewBucket: 'today',
        lastSeenAt: 1700000000000,
      },
      beta: {
        word: 'beta',
        status: 'seen',
        nextReviewBucket: 'today',
        lastSeenAt: 1700000001000,
      },
      gamma: {
        word: 'gamma',
        status: 'mastered',
        nextReviewBucket: 'later',
        lastSeenAt: 1699999999000,
      },
    },
    {
      alpha: { word: 'alpha', dueBucket: 'today', updatedAt: 1700000000000 },
      beta: { word: 'beta', dueBucket: 'today', updatedAt: 1700000001000 },
    }
  );

  assert.equal(summary.todayCount, 2);
  assert.equal(summary.unseenCount, 1);
  assert.equal(summary.seenCount, 1);
  assert.equal(summary.masteredCount, 1);
  assert.deepEqual(
    summary.recentWords.map((item) => item.word),
    ['beta', 'alpha', 'gamma']
  );
});

test('label helpers: should expose consistent status and bucket labels', () => {
  assert.equal(learningState.getStatusLabel('saved'), '已收藏');
  assert.equal(learningState.getStatusLabel('seen'), '已遇见');
  assert.equal(learningState.getStatusLabel('unseen'), '未巩固');
  assert.equal(learningState.getStatusLabel('mastered'), '已掌握');
  assert.equal(learningState.getStatusLabel('skipped'), '已跳过');
  assert.equal(learningState.getStatusLabel('unknown'), '待判断');

  assert.equal(learningState.getReviewBucketLabel('today'), '今日优先');
  assert.equal(learningState.getReviewBucketLabel('soon'), '即将复习');
  assert.equal(learningState.getReviewBucketLabel('later'), '后续回顾');
  assert.equal(learningState.getReviewBucketLabel('unknown'), '今日优先');
});
