const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const MODULE_PATH = path.join(__dirname, '..', 'react-ui', 'src', 'subtitle-navigation.ts');
const SHARED_MODULE_PATH = path.join(__dirname, '..', 'subtitleNavigation.js');

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadSubtitleNavigationModule() {
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const moduleRef = { exports: {} };
  const sharedApi = require(SHARED_MODULE_PATH);
  const sandbox = {
    module: moduleRef,
    exports: moduleRef.exports,
    require,
    console,
    SubtitleNavigationShared: sharedApi,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(transpiled, sandbox, { filename: 'subtitle-navigation.js' });
  return moduleRef.exports;
}

test('react overlay subtitle navigation: should sanitize and sort timeline items', () => {
  const subtitleNavigation = loadSubtitleNavigationModule();
  const normalized = subtitleNavigation.normalizeSubtitleTimeline([
    { from: 6, to: 7.5, content: ' 第三句 ' },
    null,
    { from: 1.2, to: 2.1, content: '第一句' },
    { from: 3.4, to: 3.3, content: '无效反向区间' },
    { from: 4.1, to: 5.3, content: '   ' },
    { from: '2.4', to: '3.0', content: ' 第二句 ' },
  ]);

  assert.deepEqual(cloneValue(normalized), [
    { from: 1.2, to: 2.1, content: '第一句' },
    { from: 2.4, to: 3, content: '第二句' },
    { from: 6, to: 7.5, content: '第三句' },
  ]);
});

test('react overlay subtitle navigation: should resolve previous, replay and next targets around gaps', () => {
  const subtitleNavigation = loadSubtitleNavigationModule();
  const timeline = [
    { from: 0, to: 1, content: '第一句' },
    { from: 2, to: 3, content: '第二句' },
    { from: 4, to: 5, content: '第三句' },
  ];

  assert.deepEqual(cloneValue(subtitleNavigation.resolveSubtitleNavigationTargets(timeline, 2.4)), {
    previousIndex: 0,
    replayIndex: 1,
    nextIndex: 2,
  });
  assert.deepEqual(cloneValue(subtitleNavigation.resolveSubtitleNavigationTargets(timeline, 3.5)), {
    previousIndex: 1,
    replayIndex: 1,
    nextIndex: 2,
  });
  assert.deepEqual(cloneValue(subtitleNavigation.resolveSubtitleNavigationTargets(timeline, -1)), {
    previousIndex: null,
    replayIndex: 0,
    nextIndex: 0,
  });
});

test('react overlay subtitle navigation: should build active progress state for bilibili timeline', () => {
  const subtitleNavigation = loadSubtitleNavigationModule();
  const state = subtitleNavigation.buildSubtitleNavigationState({
    hostname: 'www.bilibili.com',
    hasVideo: true,
    loading: false,
    currentTime: 2.5,
    timeline: [
      { from: 0, to: 1.4, content: '第一句' },
      { from: 2, to: 3.8, content: '第二句' },
      { from: 4, to: 5.2, content: '第三句' },
    ],
  });

  assert.equal(state.supported, true);
  assert.equal(state.currentIndex, 1);
  assert.equal(state.progressLabel, '2 / 3');
  assert.equal(state.headline, '当前字幕');
  assert.match(state.description, /00:02\.0 - 00:03\.8/);
  assert.equal(state.currentText, '第二句');
  assert.equal(state.previousIndex, 0);
  assert.equal(state.replayIndex, 1);
  assert.equal(state.nextIndex, 2);
});

test('react overlay subtitle navigation: should expose unsupported message outside bilibili host', () => {
  const subtitleNavigation = loadSubtitleNavigationModule();
  const state = subtitleNavigation.buildSubtitleNavigationState({
    hostname: 'www.youtube.com',
    hasVideo: true,
    loading: false,
    currentTime: 10,
    timeline: [{ from: 9, to: 12, content: 'ignored' }],
  });

  assert.equal(state.supported, false);
  assert.equal(state.progressLabel, '未支持');
  assert.match(state.currentText, /切到支持的视频页后即可使用句级字幕导航/);
});

test('react overlay subtitle navigation: should seek video to subtitle start with small offset', () => {
  const subtitleNavigation = loadSubtitleNavigationModule();
  const video = { currentTime: 0 };
  const timeline = [
    { from: 0.5, to: 1.4, content: '第一句' },
    { from: 2, to: 3.4, content: '第二句' },
  ];

  const nextTime = subtitleNavigation.seekVideoToSubtitle(video, timeline, 1);

  assert.equal(nextTime, 2.02);
  assert.equal(video.currentTime, 2.02);
  assert.equal(subtitleNavigation.seekVideoToSubtitle(video, timeline, 99), null);
});
