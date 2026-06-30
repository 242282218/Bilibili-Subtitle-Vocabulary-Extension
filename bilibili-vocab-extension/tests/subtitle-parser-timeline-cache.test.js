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
            subtitles: [{ lan: 'zh-Hans', subtitle_url: 'https://aisubtitle.hdslb.com/old.json' }],
          },
        },
      });
    }
    if (requestUrl === 'https://aisubtitle.hdslb.com/old.json') {
      return createJsonResponse({
        body: [{ from: 0.5, to: 1.4, content: '旧视频第一句' }],
      });
    }
    if (requestUrl.includes('cid=202')) {
      return createJsonResponse({
        data: {
          subtitle: {
            subtitles: [{ lan: 'zh-Hans', subtitle_url: 'https://aisubtitle.hdslb.com/new.json' }],
          },
        },
      });
    }
    if (requestUrl === 'https://aisubtitle.hdslb.com/new.json') {
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
            subtitles: [
              { lan: 'zh-Hans', subtitle_url: 'https://aisubtitle.hdslb.com/retry.json' },
            ],
          },
        },
      });
    }
    if (String(url) === 'https://aisubtitle.hdslb.com/retry.json') {
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

test('subtitleParser timeline cache: should resolve cid from Bilibili URL fallback', async () => {
  global.location = {
    hostname: 'www.bilibili.com',
    href: 'https://www.bilibili.com/video/BV1urlFallback?p=2',
  };
  global.document = {
    querySelector() {
      return null;
    },
  };
  global.__INITIAL_STATE__ = {};

  const fetchCalls = [];
  global.fetch = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), credentials: options.credentials });
    const requestUrl = String(url);
    if (requestUrl.includes('/x/web-interface/view') && requestUrl.includes('BV1urlFallback')) {
      return createJsonResponse({
        data: {
          bvid: 'BV1urlFallback',
          aid: 707,
          pages: [
            { page: 1, cid: 7071 },
            { page: 2, cid: 7072 },
          ],
        },
      });
    }
    if (requestUrl.includes('/x/player/v2') && requestUrl.includes('cid=7072')) {
      return createJsonResponse({
        data: {
          subtitle: {
            subtitles: [
              { lan: 'zh-Hans', subtitle_url: '//aisubtitle.hdslb.com/url-fallback.json' },
            ],
          },
        },
      });
    }
    if (requestUrl === 'https://aisubtitle.hdslb.com/url-fallback.json') {
      return createJsonResponse({
        body: [{ from: 5, to: 6, content: 'URL fallback 字幕' }],
      });
    }
    throw new Error(`Unexpected fetch: ${requestUrl}`);
  };

  const subtitleParser = loadSubtitleParser();

  const timeline = await subtitleParser.loadSubtitleTimeline();

  assert.deepEqual(timeline, [{ from: 5, to: 6, content: 'URL fallback 字幕' }]);
  assert.equal(fetchCalls.length, 3);
  assert.equal(fetchCalls[0].credentials, 'include');
  assert.equal(fetchCalls[1].credentials, 'include');
  assert.equal(fetchCalls[2].credentials, 'omit');
});

test('subtitleParser timeline cache: should skip subtitle fetch for disallowed subtitle URL', async () => {
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
      bvid: 'BV1blocked',
      cid: 808,
    },
  };

  const fetchCalls = [];
  global.fetch = async (url) => {
    fetchCalls.push(String(url));
    if (String(url).includes('cid=808')) {
      return createJsonResponse({
        data: {
          subtitle: {
            subtitles: [{ lan: 'zh-Hans', subtitle_url: 'https://example.com/blocked.json' }],
          },
        },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const subtitleParser = loadSubtitleParser();

  assert.deepEqual(await subtitleParser.loadSubtitleTimeline(), []);
  assert.equal(fetchCalls.length, 1);
});

test.after(() => {
  global.fetch = previousFetch;
  global.document = previousDocument;
  global.location = previousLocation;
  global.__INITIAL_STATE__ = previousInitialState;
  delete require.cache[subtitleParserPath];
});
