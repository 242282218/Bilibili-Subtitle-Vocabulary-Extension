const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const previousDocument = global.document;
const previousChrome = global.chrome;
const previousLocation = global.location;
const previousSubtitleParser = global.SubtitleParser;
const previousReactOverlayModule = global.ReactOverlayModule;
const previousOverlayPanelModule = global.OverlayPanelModule;
let runtimeConnectListener = null;
let runtimeMessageListener = null;

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

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
    onConnect: {
      addListener(listener) {
        runtimeConnectListener = listener;
      },
    },
    onMessage: {
      addListener(listener) {
        runtimeMessageListener = listener;
      },
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
  getCurrentSubtitleTimelineCacheKey() {
    return '';
  },
};

const contentScriptPath = require.resolve('../contentScript.js');
delete require.cache[contentScriptPath];
const contentScript = require('../contentScript.js');

function dispatchRuntimeMessage(message) {
  return new Promise((resolve) => {
    const keepChannelOpen = runtimeMessageListener(message, {}, (response) => {
      resolve({
        keepChannelOpen,
        response: cloneValue(response),
      });
    });
  });
}

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

test('contentScript subtitle navigation: manifest should load shared runtime before contentScript', () => {
  const manifestPath = path.join(__dirname, '..', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
  const contentScripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
  const shippedEntry = contentScripts.find((entry) => Array.isArray(entry.js));
  assert.ok(shippedEntry, 'content_scripts entry should exist');

  const scriptList = shippedEntry.js;
  const runtimeIndex = scriptList.indexOf('subtitleNavigation.js');
  const contentScriptIndex = scriptList.indexOf('contentScript.js');

  assert.notEqual(runtimeIndex, -1);
  assert.notEqual(contentScriptIndex, -1);
  assert.ok(runtimeIndex < contentScriptIndex);
});

test('contentScript subtitle navigation: should stream initial snapshot over a connected port', async () => {
  const messages = [];
  global.location = {
    hostname: 'www.bilibili.com',
  };
  global.document.querySelector = (selector) => {
    if (selector === 'video') {
      return { currentTime: 2.5 };
    }
    return null;
  };
  global.SubtitleParser.loadSubtitleTimeline = async () => [
    { from: 0, to: 1.5, content: '第一句' },
    { from: 2.2, to: 3.7, content: '第二句' },
  ];

  const port = {
    name: 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_SUBSCRIBE',
    onDisconnect: {
      addListener() {},
    },
    postMessage(message) {
      messages.push(cloneValue(message));
    },
  };

  runtimeConnectListener(port);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_SUBSCRIBE');
  assert.equal(messages[0].payload.supported, true);
  assert.equal(messages[0].payload.progressLabel, '2 / 2');
  assert.equal(messages[0].payload.currentText, '第二句');
});

test('contentScript subtitle navigation: should expose overlay bridge payload without polling', async () => {
  const video = { currentTime: 2.5 };
  global.location = {
    hostname: 'www.bilibili.com',
  };
  global.document.querySelector = (selector) => {
    if (selector === 'video') {
      return video;
    }
    return null;
  };
  global.SubtitleParser.getCurrentSubtitleTimelineCacheKey = () => 'BV1xx411x7xN:cid:42';
  global.SubtitleParser.loadSubtitleTimeline = async () => [
    { from: 0, to: 1.5, content: '第一句' },
    { from: 2.2, to: 3.7, content: '第二句' },
  ];

  assert.ok(global.BiliVocabOverlaySubtitleNavigationBridge);

  const payload = await global.BiliVocabOverlaySubtitleNavigationBridge.refresh();

  assert.equal(payload.videoKey, 'BV1xx411x7xN:cid:42');
  assert.equal(payload.state.supported, true);
  assert.equal(payload.state.progressLabel, '2 / 2');
  assert.equal(payload.state.currentIndex, 1);

  let pushed = null;
  const unsubscribe = global.BiliVocabOverlaySubtitleNavigationBridge.subscribe((next) => {
    pushed = cloneValue(next);
  });
  unsubscribe();

  assert.equal(pushed.videoKey, 'BV1xx411x7xN:cid:42');
  assert.equal(pushed.state.nextIndex, null);
});

test('contentScript subtitle navigation: should answer runtime read requests with current snapshot', async () => {
  global.location = {
    hostname: 'www.bilibili.com',
  };
  global.document.querySelector = (selector) => {
    if (selector === 'video') {
      return { currentTime: 2.5 };
    }
    return null;
  };
  global.SubtitleParser.loadSubtitleTimeline = async () => [
    { from: 0, to: 1.5, content: '第一句' },
    { from: 2.2, to: 3.7, content: '第二句' },
  ];

  const result = await dispatchRuntimeMessage({
    type: 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_READ',
  });

  assert.equal(result.keepChannelOpen, true);
  assert.equal(result.response.ok, true);
  assert.equal(result.response.payload.supported, true);
  assert.equal(result.response.payload.progressLabel, '2 / 2');
  assert.equal(result.response.payload.currentText, '第二句');
});

test('contentScript subtitle navigation: should return pending snapshot when runtime read hits a timeline error', async () => {
  global.location = {
    hostname: 'www.bilibili.com',
  };
  global.document.querySelector = (selector) => {
    if (selector === 'video') {
      return { currentTime: 2.5 };
    }
    return null;
  };
  global.SubtitleParser.loadSubtitleTimeline = async () => {
    throw new Error('timeline exploded');
  };

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const result = await dispatchRuntimeMessage({
      type: 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_READ',
    });

    assert.equal(result.keepChannelOpen, true);
    assert.equal(result.response.ok, true);
    assert.equal(result.response.payload.supported, true);
    assert.equal(result.response.payload.progressLabel, '加载中');
    assert.equal(result.response.payload.headline, '正在加载字幕时间轴');
    assert.equal(result.response.payload.currentText, 'Bilibili 字幕轨道正在准备中。');
    assert.equal(result.response.payload.canGoPrevious, false);
    assert.equal(result.response.payload.canReplay, false);
    assert.equal(result.response.payload.canGoNext, false);
  } finally {
    console.error = originalConsoleError;
  }
});

test('contentScript subtitle navigation: should navigate to next subtitle via runtime message', async () => {
  const video = { currentTime: 2.5 };
  global.location = {
    hostname: 'www.bilibili.com',
  };
  global.document.querySelector = (selector) => {
    if (selector === 'video') {
      return video;
    }
    return null;
  };
  global.SubtitleParser.loadSubtitleTimeline = async () => [
    { from: 0, to: 1.5, content: '第一句' },
    { from: 2.2, to: 3.7, content: '第二句' },
    { from: 4, to: 5, content: '第三句' },
  ];

  const result = await dispatchRuntimeMessage({
    type: 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_NAVIGATE',
    payload: {
      action: 'next',
    },
  });

  assert.equal(result.keepChannelOpen, true);
  assert.equal(result.response.ok, true);
  assert.equal(video.currentTime, 4.02);
  assert.equal(result.response.payload.progressLabel, '3 / 3');
  assert.equal(result.response.payload.currentText, '第三句');
  assert.equal(result.response.payload.canGoNext, false);
});

test('contentScript subtitle navigation: should return pending snapshot when navigate hits a timeline error', async () => {
  const video = { currentTime: 2.5 };
  global.location = {
    hostname: 'www.bilibili.com',
  };
  global.document.querySelector = (selector) => {
    if (selector === 'video') {
      return video;
    }
    return null;
  };
  global.SubtitleParser.loadSubtitleTimeline = async () => {
    throw new Error('timeline exploded');
  };

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const result = await dispatchRuntimeMessage({
      type: 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_NAVIGATE',
      payload: {
        action: 'next',
      },
    });

    assert.equal(result.keepChannelOpen, true);
    assert.equal(result.response.ok, true);
    assert.equal(video.currentTime, 2.5);
    assert.equal(result.response.payload.supported, true);
    assert.equal(result.response.payload.progressLabel, '加载中');
    assert.equal(result.response.payload.currentText, 'Bilibili 字幕轨道正在准备中。');
    assert.equal(result.response.payload.canGoPrevious, false);
    assert.equal(result.response.payload.canReplay, false);
    assert.equal(result.response.payload.canGoNext, false);
  } finally {
    console.error = originalConsoleError;
  }
});

test('contentScript subtitle navigation: should reject invalid runtime navigate actions', async () => {
  const result = await dispatchRuntimeMessage({
    type: 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_NAVIGATE',
    payload: {
      action: 'jump',
    },
  });

  assert.equal(result.keepChannelOpen, true);
  assert.equal(result.response.ok, false);
  assert.match(result.response.error, /Invalid subtitle navigation action/);
});

test.after(() => {
  global.document = previousDocument;
  global.chrome = previousChrome;
  global.location = previousLocation;
  global.SubtitleParser = previousSubtitleParser;
  global.ReactOverlayModule = previousReactOverlayModule;
  global.OverlayPanelModule = previousOverlayPanelModule;
  delete require.cache[contentScriptPath];
});
