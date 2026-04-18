const test = require('node:test');
const assert = require('node:assert/strict');

const subtitleParserPath = require.resolve('../subtitleParser.js');
const previousFetch = global.fetch;
const previousDocument = global.document;
const previousLocation = global.location;
const previousInitialState = global.__INITIAL_STATE__;

function loadSubtitleParser() {
  delete require.cache[subtitleParserPath];
  return require('../subtitleParser.js');
}

function createJsonResponse(payload, ok = true) {
  return {
    ok,
    async json() {
      return payload;
    },
  };
}

test('subtitleParser timeline cache: should cache empty timeline for the same video key', async () => {
  global.location = {
    hostname: 'www.bilibili.com',
  };
  global.__INITIAL_STATE__ = {
    videoData: {
      bvid: 'BV1empty',
      cid: 101,
    },
  };
  global.document = {
    querySelector() {
      return null;
    },
  };

  const fetchCalls = [];
  global.fetch = async (url) => {
    fetchCalls.push(String(url));
    return createJsonResponse({
      data: {
        subtitle: {
          subtitles: [],
        },
      },
    });
  };

  const subtitleParser = loadSubtitleParser();

  assert.deepEqual(await subtitleParser.loadSubtitleTimeline(), []);
  assert.deepEqual(await subtitleParser.loadSubtitleTimeline(), []);
  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0], /BV1empty/);
});

test('subtitleParser timeline cache: should drop stale timeline after switching to another bilibili video', async () => {
  const currentVideo = { currentTime: 0.8 };
  global.location = {
    hostname: 'www.bilibili.com',
  };
  global.document = {
    querySelector(selector) {
      return selector === 'video' ? currentVideo : null;
    },
  };
  global.__INITIAL_STATE__ = {
    videoData: {
      bvid: 'BV1old',
      cid: 201,
    },
  };

  const fetchCalls = [];
  global.fetch = async (url) => {
    const requestUrl = String(url);
    fetchCalls.push(requestUrl);
    if (requestUrl.includes('cid=201')) {
      return createJsonResponse({
        data: {
          subtitle: {
            subtitles: [{ lan: 'zh-Hans', subtitle_url: 'https://example.com/old.json' }],
          },
        },
      });
    }
    if (requestUrl === 'https://example.com/old.json') {
      return createJsonResponse({
        body: [{ from: 0.5, to: 1.4, content: '旧视频第一句' }],
      });
    }
    if (requestUrl.includes('cid=202')) {
      return createJsonResponse({
        data: {
          subtitle: {
            subtitles: [{ lan: 'zh-Hans', subtitle_url: 'https://example.com/new.json' }],
          },
        },
      });
    }
    if (requestUrl === 'https://example.com/new.json') {
      return createJsonResponse({
        body: [{ from: 3.5, to: 4.8, content: '新视频第一句' }],
      });
    }

    throw new Error(`Unexpected fetch: ${requestUrl}`);
  };

  const subtitleParser = loadSubtitleParser();

  await subtitleParser.loadSubtitleTimeline();
  assert.equal(subtitleParser.getSubtitleFromTimelineAtCurrentTime(), '旧视频第一句');

  global.__INITIAL_STATE__ = {
    videoData: {
      bvid: 'BV1new',
      cid: 202,
    },
  };
  currentVideo.currentTime = 4.1;

  assert.equal(subtitleParser.getSubtitleFromTimelineAtCurrentTime(), '');

  const nextTimeline = await subtitleParser.loadSubtitleTimeline();
  assert.deepEqual(nextTimeline, [{ from: 3.5, to: 4.8, content: '新视频第一句' }]);
  assert.equal(subtitleParser.getSubtitleFromTimelineAtCurrentTime(), '新视频第一句');
  assert.equal(fetchCalls.length, 4);
});

test('subtitleParser timeline cache: should retry once identifiers become available', async () => {
  global.location = {
    hostname: 'www.bilibili.com',
  };
  global.document = {
    querySelector() {
      return null;
    },
  };
  global.__INITIAL_STATE__ = {
    videoData: {},
  };

  const fetchCalls = [];
  global.fetch = async (url) => {
    fetchCalls.push(String(url));
    if (String(url).includes('cid=303')) {
      return createJsonResponse({
        data: {
          subtitle: {
            subtitles: [{ lan: 'zh-Hans', subtitle_url: 'https://example.com/retry.json' }],
          },
        },
      });
    }
    if (String(url) === 'https://example.com/retry.json') {
      return createJsonResponse({
        body: [{ from: 1, to: 2, content: '延迟就绪字幕' }],
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const subtitleParser = loadSubtitleParser();

  assert.deepEqual(await subtitleParser.loadSubtitleTimeline(), []);
  assert.equal(fetchCalls.length, 0);

  global.__INITIAL_STATE__ = {
    videoData: {
      bvid: 'BV1retry',
      cid: 303,
    },
  };

  const timeline = await subtitleParser.loadSubtitleTimeline();
  assert.deepEqual(timeline, [{ from: 1, to: 2, content: '延迟就绪字幕' }]);
  assert.equal(fetchCalls.length, 2);
});

test('subtitleParser timeline cache: should expose the current video cache key helper', () => {
  global.location = {
    hostname: 'www.bilibili.com',
  };
  global.document = {
    querySelector() {
      return null;
    },
  };
  global.__INITIAL_STATE__ = {
    videoData: {
      bvid: 'BV1helper',
      cid: 404,
    },
  };

  const subtitleParser = loadSubtitleParser();
  assert.equal(subtitleParser.getCurrentSubtitleTimelineCacheKey(), 'BV1helper:cid:404');

  global.__INITIAL_STATE__ = {
    videoData: {},
  };
  assert.equal(subtitleParser.getCurrentSubtitleTimelineCacheKey(), '');
});

test.after(() => {
  global.fetch = previousFetch;
  global.document = previousDocument;
  global.location = previousLocation;
  global.__INITIAL_STATE__ = previousInitialState;
  delete require.cache[subtitleParserPath];
});
