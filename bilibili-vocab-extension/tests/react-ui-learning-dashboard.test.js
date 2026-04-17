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
