const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const SOURCE_PATH = path.join(__dirname, '..', 'react-ui', 'src', 'subtitle-navigation.ts');

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createFallbackState() {
  return {
    supported: false,
    loading: false,
    total: 0,
    currentIndex: null,
    progressLabel: '未支持',
    headline: '当前标签页暂无字幕导航',
    description: '请先打开支持字幕的 Bilibili 视频页。',
    currentText: '还没有可直接跳转的字幕句段。',
    previousIndex: null,
    replayIndex: null,
    nextIndex: null,
  };
}

function loadSubtitleNavigationModule(options = {}) {
  const source = fs.readFileSync(SOURCE_PATH, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;

  const fallbackState = cloneJson(options.fallbackState || createFallbackState());
  const sharedApi = {
    buildSubtitleNavigationState() {
      return cloneJson(fallbackState);
    },
    findSubtitleIndexAtTime() {
      return -1;
    },
    isSubtitleTimelineHostSupported(hostname) {
      return String(hostname || '').endsWith('bilibili.com');
    },
    normalizeSubtitleTimeline(sourceValue) {
      return Array.isArray(sourceValue) ? cloneJson(sourceValue) : [];
    },
    resolveSubtitleNavigationTargets() {
      return {
        previousIndex: null,
        replayIndex: null,
        nextIndex: null,
      };
    },
    seekVideoToSubtitle() {
      return null;
    },
  };

  const moduleRef = { exports: {} };
  const sandbox = {
    module: moduleRef,
    exports: moduleRef.exports,
    console,
    SubtitleNavigationShared: sharedApi,
  };

  if (options.bridge) {
    sandbox.BiliVocabOverlaySubtitleNavigationBridge = options.bridge;
  }

  sandbox.globalThis = sandbox;

  vm.runInNewContext(transpiled, sandbox, { filename: 'subtitle-navigation.js' });
  return moduleRef.exports;
}

test('react ui subtitle navigation: should fallback when bridge read returns empty payload', () => {
  const fallbackState = createFallbackState();
  const subtitleNavigation = loadSubtitleNavigationModule({
    fallbackState,
    bridge: {
      read() {
        return undefined;
      },
    },
  });

  assert.deepEqual(cloneJson(subtitleNavigation.readOverlaySubtitleNavigationState()), {
    videoKey: '',
    state: fallbackState,
  });
});

test('react ui subtitle navigation: should normalize refreshed bridge payloads', async () => {
  const fallbackState = createFallbackState();
  const subtitleNavigation = loadSubtitleNavigationModule({
    fallbackState,
    bridge: {
      refresh() {
        return Promise.resolve({
          videoKey: 42,
          state: {
            supported: true,
            progressLabel: '2 / 3',
            currentText: '第二句',
            nextIndex: 2,
          },
        });
      },
    },
  });

  assert.deepEqual(cloneJson(await subtitleNavigation.refreshOverlaySubtitleNavigationState()), {
    videoKey: '42',
    state: {
      ...fallbackState,
      supported: true,
      progressLabel: '2 / 3',
      currentText: '第二句',
      nextIndex: 2,
    },
  });
});

test('react ui subtitle navigation: should normalize subscribed bridge updates before notifying listeners', () => {
  const fallbackState = createFallbackState();
  let pushUpdate = null;
  let unsubscribed = false;

  const subtitleNavigation = loadSubtitleNavigationModule({
    fallbackState,
    bridge: {
      subscribe(listener) {
        pushUpdate = listener;
        return () => {
          unsubscribed = true;
        };
      },
    },
  });

  const received = [];
  const unsubscribe = subtitleNavigation.subscribeOverlaySubtitleNavigationState((payload) => {
    received.push(cloneJson(payload));
  });

  assert.equal(typeof pushUpdate, 'function');
  pushUpdate({
    videoKey: null,
    state: {
      headline: '当前字幕',
      replayIndex: 1,
    },
  });

  assert.deepEqual(received, [
    {
      videoKey: '',
      state: {
        ...fallbackState,
        headline: '当前字幕',
        replayIndex: 1,
      },
    },
  ]);

  unsubscribe();
  assert.equal(unsubscribed, true);
});
