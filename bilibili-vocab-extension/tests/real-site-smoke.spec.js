const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const {
  createTempRoot,
  ensureExtensionBuildExists,
  resolveBrowserExecutable,
} = require('./extension-smoke-helpers.js');

const PROJECT_ROOT = path.join(__dirname, '..');
const BILIBILI_SEARCH_QUERIES = parseSearchQueries(
  process.env.BILI_VOCAB_REAL_SITE_BILIBILI_QUERIES,
  ['TED', '纪录片', '英语演讲']
);
const YOUTUBE_SEARCH_QUERIES = parseSearchQueries(
  process.env.BILI_VOCAB_REAL_SITE_YOUTUBE_QUERIES,
  ['TED talk', 'Khan Academy', 'Google talk']
);
const MAX_CANDIDATES_PER_QUERY = parsePositiveInteger(
  process.env.BILI_VOCAB_REAL_SITE_MAX_CANDIDATES,
  4
);
const SEARCH_TIMEOUT_MS = parsePositiveInteger(
  process.env.BILI_VOCAB_REAL_SITE_SEARCH_TIMEOUT_MS,
  30000
);
const SITE_LOAD_TIMEOUT_MS = parsePositiveInteger(
  process.env.BILI_VOCAB_REAL_SITE_SITE_TIMEOUT_MS,
  45000
);
const PROBE_TIMEOUT_MS = parsePositiveInteger(
  process.env.BILI_VOCAB_REAL_SITE_PROBE_TIMEOUT_MS,
  30000
);
const PROBE_INTERVAL_MS = parsePositiveInteger(
  process.env.BILI_VOCAB_REAL_SITE_PROBE_INTERVAL_MS,
  1500
);
const BILIBILI_SEEK_POINTS_SECONDS = [8, 20, 45];

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseSearchQueries(rawValue, fallback) {
  const values = String(rawValue || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length > 0 ? values : fallback;
}

function normalizeUrl(value) {
  try {
    const target = new URL(String(value || ''));
    target.hash = '';
    if (target.hostname === 'www.bilibili.com') {
      target.search = '';
    }
    return target.toString();
  } catch {
    return String(value || '');
  }
}

function buildBilibiliSearchUrl(query) {
  return `https://search.bilibili.com/all?keyword=${encodeURIComponent(query)}`;
}

function buildYouTubeSearchUrl(query) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

async function resolveExtensionId(context) {
  let worker = context.serviceWorkers()[0] || null;
  if (!worker) {
    worker = await context.waitForEvent('serviceworker');
  }

  const match = /^chrome-extension:\/\/([^/]+)\//.exec(worker.url());
  assert.ok(match, `Expected extension service worker URL, got ${worker.url()}`);
  return match[1];
}

async function maybeAcceptYouTubeConsent(page) {
  const selectors = [
    'button:has-text("Accept all")',
    'button:has-text("I agree")',
    'button:has-text("全部接受")',
    'button:has-text("接受全部")',
    'button:has-text("我同意")',
  ];

  for (const selector of selectors) {
    const button = page.locator(selector).first();
    if ((await button.count()) === 0) {
      continue;
    }
    try {
      await button.click({ timeout: 5000 });
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
      return true;
    } catch {
      // Why: consent dialogs vary by region and button state; keep trying fallbacks.
    }
  }

  return false;
}

async function gotoSearchPage(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: SEARCH_TIMEOUT_MS });
  if (url.includes('youtube.com')) {
    await maybeAcceptYouTubeConsent(page);
  }
}

async function collectBilibiliCandidateUrls(searchPage, query) {
  await gotoSearchPage(searchPage, buildBilibiliSearchUrl(query));
  await searchPage.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('a[href]')).some((anchor) =>
        /^https:\/\/www\.bilibili\.com\/(video\/BV|bangumi\/play\/(ep|ss))/i.test(
          String(anchor.href || '')
        )
      ),
    undefined,
    { timeout: SEARCH_TIMEOUT_MS }
  );

  return searchPage.evaluate(
    ({ limit }) => {
      const seen = new Set();
      const candidates = [];
      Array.from(document.querySelectorAll('a[href]')).forEach((anchor) => {
        const href = String(anchor.href || '');
        if (!/^https:\/\/www\.bilibili\.com\/(video\/BV|bangumi\/play\/(ep|ss))/i.test(href)) {
          return;
        }
        const normalized = href.replace(/[?#].*$/, '').replace(/\/+$/, '');
        if (seen.has(normalized)) {
          return;
        }
        seen.add(normalized);
        candidates.push(`${normalized}/`);
      });
      return candidates.slice(0, limit);
    },
    { limit: MAX_CANDIDATES_PER_QUERY }
  );
}

async function collectYouTubeCandidateUrls(searchPage, query) {
  await gotoSearchPage(searchPage, buildYouTubeSearchUrl(query));
  await maybeAcceptYouTubeConsent(searchPage);
  await searchPage.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('a[href]')).some((anchor) =>
        /^\/watch\?v=/.test(String(anchor.getAttribute('href') || ''))
      ),
    undefined,
    { timeout: SEARCH_TIMEOUT_MS }
  );

  return searchPage.evaluate(
    ({ limit }) => {
      const seen = new Set();
      const candidates = [];
      Array.from(document.querySelectorAll('a[href]')).forEach((anchor) => {
        const href = String(anchor.getAttribute('href') || '');
        if (!/^\/watch\?v=/.test(href)) {
          return;
        }
        const absoluteUrl = new URL(href, 'https://www.youtube.com').toString();
        const normalized = absoluteUrl.replace(/&pp=.*$/, '');
        if (seen.has(normalized)) {
          return;
        }
        seen.add(normalized);
        candidates.push(normalized);
      });
      return candidates.slice(0, limit);
    },
    { limit: MAX_CANDIDATES_PER_QUERY }
  );
}

async function findTabIdByUrl(helperPage, targetUrl) {
  return helperPage.evaluate(
    async ({ url }) => {
      const normalize = (value) => {
        try {
          const target = new URL(String(value || ''));
          target.hash = '';
          if (target.hostname === 'www.bilibili.com') {
            target.search = '';
          }
          return target.toString();
        } catch {
          return String(value || '');
        }
      };
      const normalizedTarget = normalize(url);
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const matchedTab = tabs.find((tab) => normalize(tab.url) === normalizedTarget);
      if (!matchedTab || typeof matchedTab.id !== 'number') {
        throw new Error(`Unable to resolve target tab: ${normalizedTarget}`);
      }
      return matchedTab.id;
    },
    { url: normalizeUrl(targetUrl) }
  );
}

async function waitForOverlayInjection(page) {
  await page.waitForSelector('#bsv-react-overlay-root', {
    state: 'attached',
    timeout: SITE_LOAD_TIMEOUT_MS,
  });
}

async function probeBilibiliSubtitleState(helperPage, targetUrl) {
  const tabId = await findTabIdByUrl(helperPage, targetUrl);
  return helperPage.evaluate(
    ({ targetTabId }) =>
      new Promise((resolve, reject) => {
        chrome.scripting.executeScript(
          {
            target: { tabId: targetTabId },
            func: async () => {
              const response = {
                overlayAttached: Boolean(document.querySelector('#bsv-react-overlay-root')),
                videoCount: document.querySelectorAll('video').length,
                videoKey: '',
                timelineCount: 0,
                detectedSubtitleCount: 0,
                visibleSubtitleCount: document.querySelectorAll(
                  '.bpx-player-subtitle-wrap span, .bilibili-player-video-subtitle span'
                ).length,
              };

              if (!globalThis.SubtitleParser) {
                return response;
              }

              if (typeof globalThis.SubtitleParser.detectSubtitleElements === 'function') {
                response.detectedSubtitleCount =
                  globalThis.SubtitleParser.detectSubtitleElements().length;
              }

              if (
                typeof globalThis.SubtitleParser.getCurrentSubtitleTimelineCacheKey === 'function'
              ) {
                response.videoKey = String(
                  globalThis.SubtitleParser.getCurrentSubtitleTimelineCacheKey() || ''
                );
              }

              if (typeof globalThis.SubtitleParser.loadSubtitleTimeline === 'function') {
                const timeline = await globalThis.SubtitleParser.loadSubtitleTimeline().catch(
                  () => []
                );
                response.timelineCount = Array.isArray(timeline) ? timeline.length : 0;
              }

              return response;
            },
          },
          (results) => {
            const runtimeError = chrome.runtime && chrome.runtime.lastError;
            if (runtimeError) {
              reject(new Error(runtimeError.message || 'executeScript failed'));
              return;
            }
            resolve(Array.isArray(results) && results[0] ? results[0].result : null);
          }
        );
      }),
    { targetTabId: tabId }
  );
}

async function prepareBilibiliPlayback(page, seekTime) {
  await page.mouse.move(320, 240).catch(() => {});
  await page.waitForSelector('video', {
    state: 'attached',
    timeout: SITE_LOAD_TIMEOUT_MS,
  });
  await page
    .evaluate(
      async ({ nextSeekTime }) => {
        const video = document.querySelector('video');
        if (!video) {
          return false;
        }

        video.muted = true;
        try {
          if (Number.isFinite(nextSeekTime) && nextSeekTime > 0) {
            video.currentTime = nextSeekTime;
          }
        } catch {
          // Why: some streams reject early seeks until metadata catches up.
        }

        try {
          await video.play();
        } catch {
          // Why: autoplay can still be blocked, but we still want subtitle toggle attempts.
        }

        return true;
      },
      { nextSeekTime: seekTime }
    )
    .catch(() => false);

  const subtitleSelectors = [
    '.bpx-player-ctrl-subtitle',
    '.bpx-player-ctrl-btn[class*="subtitle"]',
    '.bilibili-player-video-btn-subtitle',
    '[class*="subtitle-switch"]',
    'button:has-text("字幕")',
  ];

  for (const selector of subtitleSelectors) {
    const button = page.locator(selector).first();
    if ((await button.count()) === 0) {
      continue;
    }
    await button.click({ timeout: 3000 }).catch(() => {});
  }
}

async function waitForBilibiliSubtitleSignal(helperPage, targetUrl, candidatePage) {
  const deadline = Date.now() + PROBE_TIMEOUT_MS;
  let lastProbe = null;
  let seekIndex = 0;
  while (Date.now() < deadline) {
    const seekTime = BILIBILI_SEEK_POINTS_SECONDS[seekIndex] || 0;
    seekIndex = (seekIndex + 1) % BILIBILI_SEEK_POINTS_SECONDS.length;
    await prepareBilibiliPlayback(candidatePage, seekTime);
    lastProbe = await probeBilibiliSubtitleState(helperPage, targetUrl);
    if (
      lastProbe &&
      lastProbe.overlayAttached === true &&
      lastProbe.videoCount > 0 &&
      (lastProbe.detectedSubtitleCount > 0 || lastProbe.visibleSubtitleCount > 0)
    ) {
      return lastProbe;
    }
    await helperPage.waitForTimeout(PROBE_INTERVAL_MS);
  }

  throw new Error(
    `Bilibili subtitle signal did not become available: ${JSON.stringify(lastProbe)}`
  );
}

async function probeYouTubeCaptionTracks(page) {
  await maybeAcceptYouTubeConsent(page);
  await page.waitForFunction(
    () => {
      const response =
        globalThis.ytInitialPlayerResponse ||
        (globalThis.ytplayer &&
        globalThis.ytplayer.config &&
        globalThis.ytplayer.config.args &&
        globalThis.ytplayer.config.args.player_response
          ? globalThis.ytplayer.config.args.player_response
          : null);
      return Boolean(response);
    },
    undefined,
    { timeout: PROBE_TIMEOUT_MS }
  );

  return page.evaluate(() => {
    const rawResponse =
      globalThis.ytInitialPlayerResponse ||
      (globalThis.ytplayer &&
      globalThis.ytplayer.config &&
      globalThis.ytplayer.config.args &&
      typeof globalThis.ytplayer.config.args.player_response === 'string'
        ? JSON.parse(globalThis.ytplayer.config.args.player_response)
        : null);
    const tracks =
      rawResponse &&
      rawResponse.captions &&
      rawResponse.captions.playerCaptionsTracklistRenderer &&
      Array.isArray(rawResponse.captions.playerCaptionsTracklistRenderer.captionTracks)
        ? rawResponse.captions.playerCaptionsTracklistRenderer.captionTracks
        : [];
    return {
      captionTracksCount: tracks.length,
      videoTitle:
        (rawResponse && rawResponse.videoDetails && rawResponse.videoDetails.title) ||
        document.title,
    };
  });
}

async function enableYouTubeCaptions(page) {
  await page.waitForSelector('video', { state: 'attached', timeout: SITE_LOAD_TIMEOUT_MS });
  await page.evaluate(async () => {
    const video = document.querySelector('video');
    if (!video) {
      return false;
    }
    video.muted = true;
    try {
      await video.play();
    } catch {
      // Why: autoplay may still be blocked; the subtitle toggle can still succeed.
    }
    return true;
  });

  const captionsButton = page.locator('.ytp-subtitles-button').first();
  if ((await captionsButton.count()) > 0) {
    const pressed = await captionsButton.getAttribute('aria-pressed').catch(() => null);
    if (pressed !== 'true') {
      await captionsButton.click({ timeout: 10000 }).catch(() => {});
    }
  }
}

async function waitForYouTubeSubtitleElements(helperPage, targetUrl) {
  const tabId = await findTabIdByUrl(helperPage, targetUrl);
  const deadline = Date.now() + PROBE_TIMEOUT_MS;
  let lastProbe = null;

  while (Date.now() < deadline) {
    lastProbe = await helperPage.evaluate(
      ({ targetTabId }) =>
        new Promise((resolve, reject) => {
          chrome.scripting.executeScript(
            {
              target: { tabId: targetTabId },
              func: () => ({
                overlayAttached: Boolean(document.querySelector('#bsv-react-overlay-root')),
                detectedSubtitleCount:
                  globalThis.SubtitleParser &&
                  typeof globalThis.SubtitleParser.detectSubtitleElements === 'function'
                    ? globalThis.SubtitleParser.detectSubtitleElements().length
                    : 0,
                visibleCaptionCount: document.querySelectorAll('.ytp-caption-segment').length,
              }),
            },
            (results) => {
              const runtimeError = chrome.runtime && chrome.runtime.lastError;
              if (runtimeError) {
                reject(new Error(runtimeError.message || 'executeScript failed'));
                return;
              }
              resolve(Array.isArray(results) && results[0] ? results[0].result : null);
            }
          );
        }),
      { targetTabId: tabId }
    );

    if (
      lastProbe &&
      lastProbe.overlayAttached === true &&
      lastProbe.detectedSubtitleCount > 0 &&
      lastProbe.visibleCaptionCount > 0
    ) {
      return lastProbe;
    }

    await helperPage.waitForTimeout(PROBE_INTERVAL_MS);
  }

  throw new Error(`YouTube captions did not become visible: ${JSON.stringify(lastProbe)}`);
}

async function findWorkingBilibiliVideo(context, helperPage, searchPage) {
  const attemptedCandidates = [];

  for (const query of BILIBILI_SEARCH_QUERIES) {
    const candidateUrls = await collectBilibiliCandidateUrls(searchPage, query);
    for (const candidateUrl of candidateUrls) {
      const normalizedCandidateUrl = normalizeUrl(candidateUrl);
      const candidatePage = await context.newPage();
      try {
        attemptedCandidates.push(normalizedCandidateUrl);
        await candidatePage.goto(normalizedCandidateUrl, {
          waitUntil: 'domcontentloaded',
          timeout: SITE_LOAD_TIMEOUT_MS,
        });
        await candidatePage.waitForSelector('video', {
          state: 'attached',
          timeout: SITE_LOAD_TIMEOUT_MS,
        });
        await waitForOverlayInjection(candidatePage);
        const probe = await waitForBilibiliSubtitleSignal(
          helperPage,
          candidatePage.url(),
          candidatePage
        );
        return {
          url: normalizeUrl(candidatePage.url()),
          query,
          probe,
        };
      } catch {
        await candidatePage.close().catch(() => {});
        continue;
      }
    }
  }

  throw new Error(
    `No Bilibili candidate exposed a subtitle signal. Attempted: ${attemptedCandidates.join(', ')}`
  );
}

async function findWorkingYouTubeVideo(context, helperPage, searchPage) {
  const attemptedCandidates = [];

  for (const query of YOUTUBE_SEARCH_QUERIES) {
    const candidateUrls = await collectYouTubeCandidateUrls(searchPage, query);
    for (const candidateUrl of candidateUrls) {
      const candidatePage = await context.newPage();
      try {
        attemptedCandidates.push(candidateUrl);
        await candidatePage.goto(candidateUrl, {
          waitUntil: 'domcontentloaded',
          timeout: SITE_LOAD_TIMEOUT_MS,
        });
        await maybeAcceptYouTubeConsent(candidatePage);
        await waitForOverlayInjection(candidatePage);

        const captionProbe = await probeYouTubeCaptionTracks(candidatePage);
        if (!captionProbe || captionProbe.captionTracksCount <= 0) {
          await candidatePage.close().catch(() => {});
          continue;
        }

        await enableYouTubeCaptions(candidatePage);
        const subtitleProbe = await waitForYouTubeSubtitleElements(helperPage, candidatePage.url());
        return {
          url: normalizeUrl(candidatePage.url()),
          query,
          captionProbe,
          subtitleProbe,
        };
      } catch {
        await candidatePage.close().catch(() => {});
        continue;
      }
    }
  }

  throw new Error(
    `No YouTube candidate exposed captions. Attempted: ${attemptedCandidates.join(', ')}`
  );
}

test('real-site smoke: should validate bilibili subtitle timeline and youtube captions on live pages', async () => {
  ensureExtensionBuildExists(PROJECT_ROOT);

  const executablePath = resolveBrowserExecutable();
  const userDataDir = createTempRoot('bili-vocab-real-site-');
  let context = null;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      executablePath,
      headless: true,
      args: [`--disable-extensions-except=${PROJECT_ROOT}`, `--load-extension=${PROJECT_ROOT}`],
    });

    const extensionId = await resolveExtensionId(context);
    const helperPage = await context.newPage();
    await helperPage.goto(`chrome-extension://${extensionId}/dist/popup.html`);
    await helperPage.waitForLoadState('domcontentloaded');

    const bilibiliSearchPage = await context.newPage();
    const bilibiliResult = await findWorkingBilibiliVideo(context, helperPage, bilibiliSearchPage);
    assert.ok(
      bilibiliResult.probe.detectedSubtitleCount > 0 ||
        bilibiliResult.probe.visibleSubtitleCount > 0
    );

    const youtubeSearchPage = await context.newPage();
    const youtubeResult = await findWorkingYouTubeVideo(context, helperPage, youtubeSearchPage);
    assert.ok(youtubeResult.captionProbe.captionTracksCount > 0);
    assert.ok(youtubeResult.subtitleProbe.detectedSubtitleCount > 0);
    assert.ok(youtubeResult.subtitleProbe.visibleCaptionCount > 0);
  } finally {
    if (context) {
      await context.close();
    }
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
