const test = require('node:test');
const assert = require('node:assert/strict');

const previousDocument = global.document;
const previousChrome = global.chrome;
const previousSubtitleParser = global.SubtitleParser;
const previousReactOverlayModule = global.ReactOverlayModule;
const previousOverlayPanelModule = global.OverlayPanelModule;

global.document = {
  readyState: 'loading',
  addEventListener() {},
  querySelector() {
    return null;
  },
  body: {},
};

global.chrome = {
  runtime: {
    getURL() {
      return 'data:text/javascript,export%20function%20mountOverlayPanel(){}';
    },
  },
  storage: {
    local: {
      get(_defaults, callback) {
        callback({});
      },
    },
    onChanged: {
      addListener() {},
    },
  },
};

global.SubtitleParser = {
  isBilibiliHost(hostname) {
    return hostname === 'www.bilibili.com';
  },
};

const contentScriptPath = require.resolve('../contentScript.js');
delete require.cache[contentScriptPath];
const contentScript = require('../contentScript.js');

test('contentScript subtitle navigation: should normalize only supported actions', () => {
  assert.equal(contentScript.normalizeSubtitleNavigationAction(' previous '), 'previous');
  assert.equal(contentScript.normalizeSubtitleNavigationAction('REPLAY'), 'replay');
  assert.equal(contentScript.normalizeSubtitleNavigationAction('next'), 'next');
  assert.equal(contentScript.normalizeSubtitleNavigationAction('jump'), '');
});

test('contentScript subtitle navigation: should resolve indices for active subtitle and gaps', () => {
  const timeline = [
    { from: 0, to: 1, content: '第一句' },
    { from: 2, to: 3, content: '第二句' },
    { from: 4, to: 5, content: '第三句' },
  ];

  assert.deepEqual(contentScript.findSubtitleNavigationIndices(timeline, 2.4), {
    currentIndex: 1,
    previousIndex: 0,
    replayIndex: 1,
    nextIndex: 2,
  });
  assert.deepEqual(contentScript.findSubtitleNavigationIndices(timeline, 3.4), {
    currentIndex: -1,
    previousIndex: 1,
    replayIndex: 1,
    nextIndex: 2,
  });
});

test('contentScript subtitle navigation: should build popup-friendly snapshot', () => {
  const snapshot = contentScript.buildSubtitleNavigationSnapshot(
    [
      { from: 0, to: 1.5, content: '第一句' },
      { from: 2.2, to: 3.7, content: '第二句' },
    ],
    2.5
  );

  assert.equal(snapshot.supported, true);
  assert.equal(snapshot.progressLabel, '2 / 2');
  assert.equal(snapshot.headline, '当前字幕');
  assert.match(snapshot.description, /00:02\.2 - 00:03\.7/);
  assert.equal(snapshot.currentText, '第二句');
  assert.equal(snapshot.canGoPrevious, true);
  assert.equal(snapshot.canReplay, true);
  assert.equal(snapshot.canGoNext, false);
});

test.after(() => {
  global.document = previousDocument;
  global.chrome = previousChrome;
  global.SubtitleParser = previousSubtitleParser;
  global.ReactOverlayModule = previousReactOverlayModule;
  global.OverlayPanelModule = previousOverlayPanelModule;
  delete require.cache[contentScriptPath];
});
