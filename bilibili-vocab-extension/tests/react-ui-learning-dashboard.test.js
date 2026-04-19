const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const SOURCE_PATH = path.join(__dirname, '..', 'react-ui', 'src', 'learning-dashboard.ts');

function loadModule(now = 1700000000000) {
  const source = fs.readFileSync(SOURCE_PATH, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;

  class MockDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }

    static now() {
      return now;
    }
  }

  const moduleRef = { exports: {} };
  const sandbox = {
    module: moduleRef,
    exports: moduleRef.exports,
    require,
    Date: MockDate,
    console,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(transpiled, sandbox, { filename: 'learning-dashboard.js' });
  return moduleRef.exports;
}

test('react ui learning dashboard: buildQuickReviewCard should expose empty-state copy', () => {
  const dashboard = loadModule();
  const card = dashboard.buildQuickReviewCard([], 0, 1700000000000);

  assert.equal(card.empty, true);
  assert.equal(card.title, '当前没有待复习词');
  assert.match(card.meta, /优先回顾词/);
});

test('react ui learning dashboard: buildQuickReviewCard should prioritize today bucket and earlier due time', () => {
  const dashboard = loadModule();
  const now = 1700000000000;
  const card = dashboard.buildQuickReviewCard(
    [
      {
        word: 'beta',
        translation: '贝塔',
        level: 'CET4',
        status: 'seen',
        dueBucket: 'soon',
        nextReviewAt: now + 3 * 60 * 60 * 1000,
        intervalDays: 3,
        easeFactor: 2.3,
        updatedAt: now - 1000,
      },
      {
        word: 'alpha',
        translation: '阿尔法',
        level: 'CET6',
        status: 'saved',
        dueBucket: 'today',
        nextReviewAt: now + 60 * 60 * 1000,
        intervalDays: 1,
        easeFactor: 2.1,
        updatedAt: now - 2000,
      },
    ],
    0,
    now
  );

  assert.equal(card.empty, false);
  assert.equal(card.currentItem.word, 'alpha');
  assert.match(card.meta, /今日优先/);
  assert.match(card.meta, /1 小时后/);
  assert.match(card.meta, /已收藏/);
});

test('react ui learning dashboard: sortEncounteredWords should support descending ranking view', () => {
  const dashboard = loadModule();
  const sorted = dashboard.sortEncounteredWords(
    [
      { word: 'context', translation: '语境', hitCount: 3, lastSeen: 20, level: 'CET4' },
      { word: 'system', translation: '系统', hitCount: 5, lastSeen: 10, level: 'CET6' },
      { word: 'vocabulary', translation: '词汇', hitCount: 5, lastSeen: 30, level: 'IELTS' },
    ],
    'desc'
  );

  assert.deepEqual(
    sorted.map((item) => item.word),
    ['vocabulary', 'system', 'context']
  );
});

test('react ui learning dashboard: sortQuickReviewItems should ignore malformed entries and keep stable ordering', () => {
  const dashboard = loadModule();
  const sorted = dashboard.sortQuickReviewItems([
    null,
    undefined,
    'invalid',
    123,
    {
      word: 'laterWord',
      translation: '稍后',
      level: 'CET4',
      status: 'seen',
      dueBucket: 'later',
      nextReviewAt: 1700000005000,
      intervalDays: 3,
      easeFactor: 2.1,
      updatedAt: 1700000001000,
    },
    {
      word: 'todayWord',
      translation: '今天',
      level: 'CET6',
      status: 'saved',
      dueBucket: 'today',
      nextReviewAt: 1700000003000,
      intervalDays: 1,
      easeFactor: 2.3,
      updatedAt: 1700000002000,
    },
    {
      word: 'soonWord',
      translation: '即将',
      level: 'IELTS',
      status: 'learning',
      dueBucket: 'soon',
      nextReviewAt: 1700000004000,
      intervalDays: 2,
      easeFactor: 2.2,
      updatedAt: 1700000003000,
    },
  ]);

  assert.deepEqual(
    sorted.map((item) => item.word),
    ['todayWord', 'soonWord', 'laterWord']
  );
});

test('react ui learning dashboard: normalizeEncounteredWord should normalize missing fields', () => {
  const dashboard = loadModule();
  const normalized = dashboard.normalizeEncounteredWord({
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

test('react ui learning dashboard: sortEncounteredWords should support ascending ranking view', () => {
  const dashboard = loadModule();
  const sorted = dashboard.sortEncounteredWords(
    [
      { word: 'b', translation: '乙', hitCount: 2, lastSeen: 9, level: 'CET4' },
      { word: 'a', translation: '甲', hitCount: 1, lastSeen: 10, level: 'CET6' },
      { word: 'c', translation: '丙', hitCount: 2, lastSeen: 4, level: 'IELTS' },
    ],
    'asc'
  );

  assert.deepEqual(
    sorted.map((item) => item.word),
    ['a', 'c', 'b']
  );
});

test('react ui learning dashboard: quick-review helpers should expose shipped empty state and due text copy', () => {
  const dashboard = loadModule();
  const now = 1700000000000;
  const emptyState = JSON.parse(JSON.stringify(dashboard.getQuickReviewEmptyState()));

  assert.deepEqual(emptyState, {
    title: '当前没有待复习词',
    description: '继续看一段带字幕的视频，系统会把新命中的词汇自动加入复习池。',
    meta: '继续观看带字幕的视频后，这里会出现本轮优先回顾词。',
  });
  assert.equal(dashboard.formatReviewCountText({ todayCount: 5, newCount: 2 }), '今日待复习 5');
  assert.equal(dashboard.formatReviewDueText(now + 2 * 60 * 60 * 1000, now), '2 小时后');
  assert.equal(dashboard.formatReviewDueText(now - 1000, now), '现在复习');
});
