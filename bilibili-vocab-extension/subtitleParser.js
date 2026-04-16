(function (globalScope) {
  const SUBTITLE_SELECTORS = [
    // Bilibili
    ".bpx-player-subtitle-wrap .bpx-player-subtitle-panel-text",
    ".bpx-player-subtitle-wrap .bpx-player-subtitle-panel > span",
    ".bpx-player-subtitle-wrap span",
    ".bilibili-player-video-subtitle .bilibili-player-video-subtitle-item-text",
    ".bilibili-player-video-subtitle span",
    // YouTube
    ".ytp-caption-window-container .ytp-caption-segment",
    ".ytp-caption-window-container span.ytp-caption-segment",
    // 腾讯视频
    ".txp-subtitle .txp-subtitle-text",
    ".txp-subtitle-item span",
    ".txp-caption span",
    // 爱奇艺
    ".iqp-subtitle-content",
    ".iqp-subtitle-text span",
    ".iqiyi-player-subtitle span",
    // Netflix
    ".player-timedtext-text-container span",
    ".nf-player-caption span",
    // 优酷
    ".kui-subtitle-text",
    ".youku-player-subtitle span",
    ".yk-caption span"
  ];

  const GENERIC_TEXT_SELECTORS = [
    "article p",
    "main p",
    "main li",
    "main blockquote",
    "main h1",
    "main h2",
    "main h3",
    "[role='main'] p",
    "[role='main'] li",
    ".article p",
    ".article li",
    ".post-content p",
    ".post-content li",
    ".entry-content p",
    ".entry-content li",
    ".markdown p",
    ".markdown li"
  ];

  const PLAYER_CONTAINER_SELECTORS = [
    // Bilibili
    ".bpx-player-container",
    ".bpx-player-video-area",
    ".bilibili-player-video-wrap",
    "#bilibili-player",
    // YouTube
    "#movie_player",
    ".html5-video-player",
    "ytd-player",
    // 腾讯视频
    ".txp-player",
    ".txp-video-wrap",
    "#腾讯视频播放器",
    // 爱奇艺
    ".iqp-player",
    ".iqiyi-player-wrap",
    "#iqiyi-player",
    // Netflix
    ".nf-player-container",
    ".watch-video--player-view",
    // 优酷
    ".kui-player",
    ".youku-player-container",
    "#ykPlayer"
  ];

  const EXCLUDED_ANCESTOR_SELECTORS = [
    ".bpx-player-ctrl-wrap",
    ".bpx-player-ctrl-bottom",
    ".bpx-player-control-wrap",
    ".bpx-player-ctrl-setting",
    ".bpx-player-subtitle-setting",
    ".bpx-player-dialog-wrap",
    ".bpx-player-contextmenu",
    ".bpx-player-toast-wrap",
    ".ytp-settings-menu",
    ".ytp-popup",
    ".ytp-menuitem",
    ".ytp-tooltip",
    ".ytp-chrome-top",
    ".ytp-chrome-bottom",
    "nav",
    "header",
    "footer",
    "aside",
    "form",
    "pre",
    "code",
    "kbd",
    "samp",
    "script",
    "style",
    "noscript",
    "iframe",
    "svg",
    "canvas",
    "[contenteditable='true']",
    "[role='textbox']",
    "[role='button']",
    "[role='menu']",
    "button",
    "a",
    "input",
    "textarea",
    "select",
    "label"
  ];

  const HEURISTIC_SELECTORS = [
    // Bilibili
    ".bpx-player-subtitle-wrap [class*='subtitle']",
    ".bpx-player-subtitle-wrap span",
    ".bilibili-player-video-subtitle [class*='text']",
    ".bilibili-player-video-subtitle span",
    // YouTube
    ".ytp-caption-window-container .caption-window",
    ".ytp-caption-window-container .ytp-caption-segment",
    ".ytp-caption-window-container span.ytp-caption-segment",
    // 腾讯视频
    ".txp-subtitle [class*='subtitle']",
    ".txp-subtitle span",
    // 爱奇艺
    ".iqp-subtitle [class*='subtitle']",
    ".iqp-subtitle span",
    // Netflix
    ".player-timedtext [class*='text']",
    ".nf-player-caption span",
    // 优酷
    ".kui-subtitle [class*='subtitle']",
    ".kui-subtitle span"
  ];

  const PLAYER_API_ENDPOINT = "https://api.bilibili.com/x/player/v2";

  let subtitleTimeline = [];
  let subtitleTimelinePromise = null;

  const normalizeText = (globalThis.Utils && globalThis.Utils.normalizeText) || ((text) => String(text || "").replace(/\s+/g, " ").trim());

  function isHostOrSubdomain(hostname, domain) {
    const host = String(hostname || "").trim().toLowerCase().replace(/\.+$/, "");
    const normalizedDomain = String(domain || "").trim().toLowerCase().replace(/\.+$/, "");
    if (!host || !normalizedDomain) {
      return false;
    }

    return host === normalizedDomain || host.endsWith(`.${normalizedDomain}`);
  }

  function isBilibiliHost(hostname) {
    return isHostOrSubdomain(hostname, "bilibili.com");
  }

  function isYouTubeHost(hostname) {
    const host = String(hostname || "").toLowerCase();
    return host === "youtube.com" || host.endsWith(".youtube.com");
  }

  function isTencentHost(hostname) {
    return isHostOrSubdomain(hostname, "v.qq.com");
  }

  function isIqiyiHost(hostname) {
    return isHostOrSubdomain(hostname, "iqiyi.com");
  }

  function isNetflixHost(hostname) {
    return isHostOrSubdomain(hostname, "netflix.com");
  }

  function isYoukuHost(hostname) {
    return isHostOrSubdomain(hostname, "youku.com");
  }

  function isElementVisible(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function hasChineseText(text) {
    return /[\u4e00-\u9fff]/.test(String(text || ""));
  }

  function isRenderedWordElement(element) {
    return Boolean(
      element &&
        element.classList &&
        typeof element.classList.contains === "function" &&
        element.classList.contains("bili-vocab-word")
    );
  }

  function isInjectedSubtitleElement(element) {
    if (!element) {
      return false;
    }

    if (isRenderedWordElement(element)) {
      return true;
    }

    return Boolean(
      typeof element.closest === "function" &&
        element.closest(".bili-vocab-word")
    );
  }

  function extractOriginalTextFromRenderedNode(node) {
    if (!node) {
      return "";
    }

    if (node.nodeType === 3) {
      return String(node.textContent || "");
    }

    if (!(node instanceof HTMLElement)) {
      return String(node.textContent || "");
    }

    if (isRenderedWordElement(node)) {
      const originalSubtitle = normalizeText(node.dataset && node.dataset.originalSubtitle);
      if (originalSubtitle) {
        return originalSubtitle;
      }

      const sourceText = normalizeText(node.dataset && node.dataset.sourceText);
      return sourceText || String(node.textContent || "");
    }

    const childNodes = Array.isArray(node.childNodes) ? node.childNodes : Array.from(node.childNodes || []);
    if (childNodes.length === 0) {
      return String(node.textContent || "");
    }

    return childNodes.map((child) => extractOriginalTextFromRenderedNode(child)).join("");
  }

  function extractFullOriginalSubtitleFromRenderedNode(node) {
    if (!node || !(node instanceof HTMLElement)) {
      return "";
    }

    if (isRenderedWordElement(node)) {
      return normalizeText(node.dataset && node.dataset.originalSubtitle);
    }

    const childNodes = Array.isArray(node.childNodes) ? node.childNodes : Array.from(node.childNodes || []);
    for (let index = 0; index < childNodes.length; index += 1) {
      const candidate = extractFullOriginalSubtitleFromRenderedNode(childNodes[index]);
      if (candidate) {
        return candidate;
      }
    }

    return "";
  }

  function containsRenderedWordNode(node) {
    if (!node) {
      return false;
    }

    if (node instanceof HTMLElement && isRenderedWordElement(node)) {
      return true;
    }

    const childNodes = Array.isArray(node.childNodes) ? node.childNodes : Array.from(node.childNodes || []);
    return childNodes.some((child) => containsRenderedWordNode(child));
  }

  function extractSubtitleText(element) {
    if (!(element instanceof HTMLElement)) {
      return "";
    }

    const originalText = normalizeText(element.dataset && element.dataset.biliVocabOriginalText);
    if (originalText) {
      return originalText;
    }

    if (containsRenderedWordNode(element)) {
      const fullOriginalSubtitle = extractFullOriginalSubtitleFromRenderedNode(element);
      if (fullOriginalSubtitle) {
        return fullOriginalSubtitle;
      }

      const recoveredText = normalizeText(extractOriginalTextFromRenderedNode(element));
      if (recoveredText) {
        return recoveredText;
      }
    }

    return normalizeText(element.textContent);
  }

  function getPlayerRect() {
    const video = document.querySelector("video");
    if (video instanceof HTMLElement) {
      const rect = video.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return rect;
      }
    }

    for (let index = 0; index < PLAYER_CONTAINER_SELECTORS.length; index += 1) {
      const selector = PLAYER_CONTAINER_SELECTORS[index];
      const container = document.querySelector(selector);
      if (!(container instanceof HTMLElement)) {
        continue;
      }

      const rect = container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return rect;
      }
    }

    return null;
  }

  function isInExcludedContext(element) {
    return EXCLUDED_ANCESTOR_SELECTORS.some((selector) => element.closest(selector));
  }

  function isInSubtitleZone(element, playerRect) {
    if (!playerRect) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const playerCenterX = playerRect.left + playerRect.width / 2;

    const centerOffset = Math.abs(centerX - playerCenterX);
    const withinCenterBand = centerOffset <= playerRect.width * 0.32;
    const withinVerticalBand =
      centerY >= playerRect.top + playerRect.height * 0.45 &&
      centerY <= playerRect.top + playerRect.height * 0.98;
    const reasonableWidth = rect.width <= playerRect.width * 0.95;

    return withinCenterBand && withinVerticalBand && reasonableWidth;
  }

  function subtitleElementScore(element, playerRect) {
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const targetY = playerRect.top + playerRect.height * 0.82;
    const playerCenterX = playerRect.left + playerRect.width / 2;
    const xPenalty = Math.abs(centerX - playerCenterX) * 2;
    const yPenalty = Math.abs(centerY - targetY);
    return xPenalty + yPenalty;
  }

  function isLikelySubtitleElement(element, playerRect) {
    if (isInjectedSubtitleElement(element)) {
      return false;
    }

    if (!isElementVisible(element)) {
      return false;
    }
    if (isInExcludedContext(element)) {
      return false;
    }

    const text = extractSubtitleText(element);
    if (!text || text.length < 2 || text.length > 120 || !hasChineseText(text)) {
      return false;
    }

    if (element.childElementCount > 0 && text.length > 80) {
      return false;
    }

    return isInSubtitleZone(element, playerRect);
  }

  function addElementByContainment(candidate, collected) {
    if (!candidate || typeof candidate.contains !== "function" || !Array.isArray(collected)) {
      return false;
    }

    for (let index = collected.length - 1; index >= 0; index -= 1) {
      const existing = collected[index];
      if (!existing || typeof existing.contains !== "function") {
        continue;
      }

      if (candidate.contains(existing)) {
        return false;
      }

      if (existing.contains(candidate)) {
        collected.splice(index, 1);
      }
    }

    collected.push(candidate);
    return true;
  }

  function isPlainTextCandidate(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    if (isInjectedSubtitleElement(element)) {
      return false;
    }

    if (!isElementVisible(element) || isInExcludedContext(element)) {
      return false;
    }

    const tagName = String(element.tagName || "").toUpperCase();
    if (!["P", "LI", "BLOCKQUOTE", "H1", "H2", "H3"].includes(tagName)) {
      return false;
    }

    const text = normalizeText(element.textContent || "");
    if (!text || text.length < 12 || text.length > 280) {
      return false;
    }

    if (/^[\d\s\p{P}]+$/u.test(text)) {
      return false;
    }

    if (/https?:\/\//i.test(text) || /[@#]/.test(text)) {
      return false;
    }

    if (element.childElementCount > 12) {
      return false;
    }

    return true;
  }

  function detectGenericTextElements() {
    const seen = new Set();
    const elements = [];

    GENERIC_TEXT_SELECTORS.forEach((selector) => {
      document.querySelectorAll(selector).forEach((element) => {
        if (!(element instanceof HTMLElement)) {
          return;
        }
        if (seen.has(element)) {
          return;
        }
        if (!isPlainTextCandidate(element)) {
          return;
        }

        seen.add(element);
        addElementByContainment(element, elements);
      });
    });

    return elements;
  }

  function isVideoPage() {
    const hostname = globalScope.location && globalScope.location.hostname;
    if (isBilibiliHost(hostname) || isYouTubeHost(hostname)) {
      return true;
    }

    return Boolean(document.querySelector("video"));
  }

  function collectWithHeuristic(seen, playerRect) {
    const found = [];

    HEURISTIC_SELECTORS.forEach((selector) => {
      document.querySelectorAll(selector).forEach((element) => {
        if (!(element instanceof HTMLElement)) {
          return;
        }
        if (seen.has(element)) {
          return;
        }
        if (!isLikelySubtitleElement(element, playerRect)) {
          return;
        }

        seen.add(element);
        addElementByContainment(element, found);
      });
    });

    return found;
  }

  function detectSubtitleElements() {
    const playerRect = getPlayerRect();
    if (!playerRect) {
      return [];
    }

    const seen = new Set();
    const elements = [];

    SUBTITLE_SELECTORS.forEach((selector) => {
      document.querySelectorAll(selector).forEach((element) => {
        if (!(element instanceof HTMLElement)) {
          return;
        }
        if (seen.has(element)) {
          return;
        }
        if (!isLikelySubtitleElement(element, playerRect)) {
          return;
        }

        seen.add(element);
        addElementByContainment(element, elements);
      });
    });

    if (elements.length === 0) {
      collectWithHeuristic(seen, playerRect).forEach((element) => {
        addElementByContainment(element, elements);
      });
    }

    elements.sort((left, right) => {
      return subtitleElementScore(left, playerRect) - subtitleElementScore(right, playerRect);
    });

    return elements;
  }

  function getPrimarySubtitleElement() {
    return detectSubtitleElements()[0] || null;
  }

  function normalizeSubtitleUrl(rawUrl) {
    const url = String(rawUrl || "").trim();
    if (!url) {
      return "";
    }

    if (url.startsWith("//")) {
      return `https:${url}`;
    }

    return url;
  }

  function pickPreferredSubtitleTrack(subtitles) {
    if (!Array.isArray(subtitles) || subtitles.length === 0) {
      return null;
    }

    const priorities = ["zh-Hans", "zh-CN", "zh", "en-US", "en"];
    const sorted = subtitles
      .filter((item) => item && typeof item === "object")
      .slice()
      .sort((left, right) => {
        const leftLan = String(left.lan || "").trim();
        const rightLan = String(right.lan || "").trim();
        const leftPriority = priorities.indexOf(leftLan);
        const rightPriority = priorities.indexOf(rightLan);
        const normalizedLeft = leftPriority < 0 ? priorities.length + 1 : leftPriority;
        const normalizedRight = rightPriority < 0 ? priorities.length + 1 : rightPriority;
        return normalizedLeft - normalizedRight;
      });

    return sorted[0] || null;
  }

  function findSubtitleByTime(body, currentTime) {
    if (!Array.isArray(body) || body.length === 0) {
      return null;
    }

    const time = Number(currentTime);
    if (!Number.isFinite(time)) {
      return null;
    }

    for (let index = 0; index < body.length; index += 1) {
      const item = body[index];
      const from = Number(item && item.from);
      const to = Number(item && item.to);
      if (!Number.isFinite(from) || !Number.isFinite(to)) {
        continue;
      }
      if (time >= from && time <= to) {
        return item;
      }
    }

    return null;
  }

  function extractVideoIdentifiers() {
    const state = globalScope.__INITIAL_STATE__ || {};
    const videoData = state.videoData || {};

    let cid = Number(videoData.cid || state.cid || 0);
    if (!cid && Array.isArray(videoData.pages) && videoData.pages.length > 0) {
      const pageNumber = Number(state.p || 1);
      const matchedPage = videoData.pages.find((page) => Number(page.page) === pageNumber);
      cid = Number((matchedPage && matchedPage.cid) || videoData.pages[0].cid || 0);
    }

    const bvid = String(videoData.bvid || state.bvid || "").trim();
    const aid = Number(videoData.aid || state.aid || 0);

    return {
      aid: Number.isFinite(aid) && aid > 0 ? aid : 0,
      bvid,
      cid: Number.isFinite(cid) && cid > 0 ? cid : 0
    };
  }

  function buildPlayerApiUrl(identifiers) {
    const params = new URLSearchParams();
    if (identifiers.bvid) {
      params.set("bvid", identifiers.bvid);
    } else if (identifiers.aid) {
      params.set("aid", String(identifiers.aid));
    }
    params.set("cid", String(identifiers.cid));
    return `${PLAYER_API_ENDPOINT}?${params.toString()}`;
  }

  async function loadSubtitleTimeline() {
    if (!isBilibiliHost(globalScope.location && globalScope.location.hostname)) {
      return [];
    }

    if (subtitleTimeline.length > 0) {
      return subtitleTimeline;
    }

    if (subtitleTimelinePromise) {
      return subtitleTimelinePromise;
    }

    subtitleTimelinePromise = (async () => {
      const identifiers = extractVideoIdentifiers();
      if (!identifiers.cid || (!identifiers.bvid && !identifiers.aid)) {
        return [];
      }

      const response = await fetch(buildPlayerApiUrl(identifiers), { credentials: "include" });
      if (!response.ok) {
        return [];
      }

      const payload = await response.json();
      const subtitleInfo = payload && payload.data && payload.data.subtitle;
      const track = pickPreferredSubtitleTrack(subtitleInfo && subtitleInfo.subtitles);
      if (!track || !track.subtitle_url) {
        return [];
      }

      const subtitleResponse = await fetch(normalizeSubtitleUrl(track.subtitle_url), { credentials: "include" });
      if (!subtitleResponse.ok) {
        return [];
      }

      const subtitlePayload = await subtitleResponse.json();
      const body = Array.isArray(subtitlePayload && subtitlePayload.body) ? subtitlePayload.body : [];
      subtitleTimeline = body
        .map((item) => ({
          from: Number(item.from),
          to: Number(item.to),
          content: normalizeText(item.content)
        }))
        .filter((item) => Number.isFinite(item.from) && Number.isFinite(item.to) && Boolean(item.content))
        .sort((left, right) => left.from - right.from);

      return subtitleTimeline;
    })()
      .catch((error) => {
        if (globalThis.Utils && globalThis.Utils.logError) {
          globalThis.Utils.logError("Subtitle timeline load failed", error);
        } else {
          console.error("[BiliVocab] Subtitle timeline load failed:", error);
        }
        return [];
      })
      .finally(() => {
        subtitleTimelinePromise = null;
      });

    return subtitleTimelinePromise;
  }

  function getSubtitleFromTimelineAtCurrentTime() {
    if (!Array.isArray(subtitleTimeline) || subtitleTimeline.length === 0) {
      return "";
    }

    const video = document.querySelector("video");
    const currentTime = video ? Number(video.currentTime) : NaN;
    const matched = findSubtitleByTime(subtitleTimeline, currentTime);
    return matched ? normalizeText(matched.content) : "";
  }

  function getCurrentSubtitleItems() {
    if (isVideoPage()) {
      return detectSubtitleElements().map((element) => ({
        element,
        text: extractSubtitleText(element),
        mode: "subtitle"
      }));
    }

    return detectGenericTextElements().map((element) => ({
      element,
      text: extractSubtitleText(element),
      mode: "page"
    }));
  }

  const api = {
    SUBTITLE_SELECTORS,
    GENERIC_TEXT_SELECTORS,
    detectSubtitleElements,
    addElementByContainment,
    isInjectedSubtitleElement,
    extractSubtitleText,
    getCurrentSubtitleItems,
    getPrimarySubtitleElement,
    isBilibiliHost,
    isYouTubeHost,
    normalizeSubtitleUrl,
    pickPreferredSubtitleTrack,
    findSubtitleByTime,
    extractVideoIdentifiers,
    loadSubtitleTimeline,
    getSubtitleFromTimelineAtCurrentTime
  };

  globalScope.SubtitleParser = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
