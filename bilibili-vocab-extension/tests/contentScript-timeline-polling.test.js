const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const previousDocument = global.document;
const previousChrome = global.chrome;
const previousLocation = global.location;
const previousRequestAnimationFrame = global.requestAnimationFrame;
const previousMutationObserver = global.MutationObserver;
const previousHTMLVideoElement = global.HTMLVideoElement;
const previousSetInterval = global.setInterval;
const previousClearInterval = global.clearInterval;
const previousSubtitleParser = global.SubtitleParser;
const previousSubtitleRenderer = global.SubtitleRenderer;
const previousSubtitleTranslator = global.SubtitleTranslator;
const previousVocabularyModule = global.VocabularyModule;
const previousTooltipModule = global.TooltipModule;
const previousSchedulerModule = global.SchedulerModule;
const previousDanmakuModule = global.DanmakuModule;

const contentScriptPath = require.resolve('../contentScript/index.js');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTimelineHarness() {
  const intervals = [];
  const observers = [];
  let domContentLoadedListener = null;
  let intervalReadyResolve;
  const intervalReady = new Promise((resolve) => {
    intervalReadyResolve = resolve;
  });

  global.HTMLVideoElement = class FakeHTMLVideoElement {
    constructor() {
      this.paused = false;
      this.ended = false;
    }

    addEventListener() {}

    removeEventListener() {}
  };
  const video = new global.HTMLVideoElement();

  class HarnessMutationObserver {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }

    observe() {}

    disconnect() {}
  }

  global.document = {
    readyState: 'loading',
    addEventListener(event, listener) {
      if (event === 'DOMContentLoaded') {
        domContentLoadedListener = listener;
      }
    },
    querySelector(selector) {
      if (selector === 'video') {
        return video;
      }
      if (selector === '.bpx-player-subtitle-wrap') {
        return null;
      }
      return null;
    },
    body: { nodeName: 'BODY' },
  };
  global.chrome = {
    storage: {
      local: {
        get(_defaults, callback) {
          callback({});
        },
        set() {},
      },
      onChanged: {
        addListener() {},
      },
    },
  };
  global.location = { hostname: 'www.bilibili.com' };
  global.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  global.MutationObserver = HarnessMutationObserver;
  global.setInterval = (callback, delay) => {
    const interval = { callback, delay };
    intervals.push(interval);
    if (intervalReadyResolve) {
      intervalReadyResolve();
      intervalReadyResolve = null;
    }
    return interval;
  };
  global.clearInterval = () => {};
  global.SubtitleParser = {
    getCurrentSubtitleItems() {
      return [];
    },
    async loadSubtitleTimeline() {
      return [];
    },
    getSubtitleFromTimelineAtCurrentTime() {
      return '';
    },
    getPrimarySubtitleElement() {
      return null;
    },
    extractSubtitleText() {
      return '';
    },
    getCurrentSubtitleTimelineCacheKey() {
      return '';
    },
  };
  global.SubtitleTranslator = {
    async processSubtitle() {
      return { mixedText: '', tokens: [] };
    },
    normalizeTargetCefr(value) {
      return value || 'B2';
    },
  };
  global.SubtitleRenderer = {
    renderSubtitleElement() {
      return true;
    },
    restoreSubtitleElement() {},
  };
  global.VocabularyModule = {
    async loadVocabulary() {},
    recordHit() {},
    refreshLearningStateFromStorage() {
      return Promise.resolve();
    },
  };
  global.TooltipModule = {
    init() {},
  };
  global.SchedulerModule = {
    startEngine() {},
    stopEngine() {},
    pauseEngine() {},
  };
  global.DanmakuModule = {
    clearDanmaku() {},
    setSpeedPreset() {},
    initDanmakuContainer() {},
  };

  delete require.cache[contentScriptPath];
  require('../contentScript/index.js');

  async function boot() {
    assert.equal(typeof domContentLoadedListener, 'function');
    domContentLoadedListener();
    await intervalReady;
    await wait(220);
  }

  function triggerMutation(times = 1) {
    for (let i = 0; i < times; i += 1) {
      const observer = observers[observers.length - 1];
      assert.ok(observer, 'expected mutation observer to exist');
      observer.callback();
    }
  }

  return {
    boot,
    intervals,
    triggerMutation,
  };
}

test('contentScript timeline polling: repeated triggers should keep one interval', async () => {
  const harness = createTimelineHarness();
  await harness.boot();

  assert.equal(harness.intervals.length, 1);

  harness.triggerMutation(5);
  await wait(20);
  assert.equal(harness.intervals.length, 1);

  harness.intervals[0].callback();
  await wait(220);
  assert.equal(harness.intervals.length, 1);
});

test('contentScript timeline polling: interval callback should not self-start polling', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'contentScript', 'dom-observer.js'),
    'utf8'
  );
  const intervalBlock = source.match(
    /timelinePollTimer\s*=\s*setInterval\(\s*function\s*\(\)\s*\{([\s\S]*?)\},\s*TIMELINE_POLL_MS\)/
  );

  assert.ok(intervalBlock, 'expected timeline polling interval block to exist');
  assert.doesNotMatch(intervalBlock[1], /\bstartTimelinePolling\s*\(/);
});

test.after(() => {
  delete require.cache[contentScriptPath];
  global.document = previousDocument;
  global.chrome = previousChrome;
  global.location = previousLocation;
  global.requestAnimationFrame = previousRequestAnimationFrame;
  global.MutationObserver = previousMutationObserver;
  global.HTMLVideoElement = previousHTMLVideoElement;
  global.setInterval = previousSetInterval;
  global.clearInterval = previousClearInterval;
  global.SubtitleParser = previousSubtitleParser;
  global.SubtitleRenderer = previousSubtitleRenderer;
  global.SubtitleTranslator = previousSubtitleTranslator;
  global.VocabularyModule = previousVocabularyModule;
  global.TooltipModule = previousTooltipModule;
  global.SchedulerModule = previousSchedulerModule;
  global.DanmakuModule = previousDanmakuModule;
});
