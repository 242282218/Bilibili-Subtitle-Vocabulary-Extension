(function () {
  const DEFAULT_SETTINGS = {
    enabled: true,
    reviewDanmakuEnabled: false,
    reviewDanmakuSpeed: "normal",
    activeLevels: ["CET4", "CET6", "KAOYAN", "IELTS", "TOEFL"],
    replaceRatio: 0.2,
    maxReplaceCount: 2,
    targetCefr: "B2"
  };

  const PROCESS_DELAY_MS = 80;
  const TIMELINE_POLL_MS = 220;
  const TRANSLATION_CACHE_LIMIT = 120;

  let observer = null;
  let processTimer = null;
  let timelinePollTimer = null;
  let processing = false;
  let settings = { ...DEFAULT_SETTINGS };
  const translationCache = new Map();
  let boundVideo = null;
  const HIT_SIGNATURE_DATA_KEY = "biliVocabHitSignature";
  const RENDER_SIGNATURE_DATA_KEY = "biliVocabRenderSignature";

  function normalizeText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function normalizeReviewDanmakuSpeed(speed) {
    const normalized = String(speed || DEFAULT_SETTINGS.reviewDanmakuSpeed).trim().toLowerCase();
    return ["slow", "normal", "fast"].includes(normalized) ? normalized : DEFAULT_SETTINGS.reviewDanmakuSpeed;
  }

  function normalizeSettings(rawSettings) {
    const source = { ...DEFAULT_SETTINGS, ...(rawSettings || {}) };
    const activeLevels = Array.isArray(source.activeLevels)
      ? source.activeLevels.map((level) => String(level || "").trim().toUpperCase()).filter(Boolean)
      : DEFAULT_SETTINGS.activeLevels.slice();

    return {
      enabled: source.enabled !== false,
      reviewDanmakuEnabled: source.reviewDanmakuEnabled === true,
      reviewDanmakuSpeed: normalizeReviewDanmakuSpeed(source.reviewDanmakuSpeed),
      activeLevels: activeLevels.length ? Array.from(new Set(activeLevels)) : DEFAULT_SETTINGS.activeLevels.slice(),
      replaceRatio: Math.min(0.3, Math.max(0.1, Number(source.replaceRatio) || DEFAULT_SETTINGS.replaceRatio)),
      maxReplaceCount: Math.min(5, Math.max(1, Math.floor(Number(source.maxReplaceCount) || DEFAULT_SETTINGS.maxReplaceCount))),
      targetCefr: globalThis.SubtitleTranslator && typeof globalThis.SubtitleTranslator.normalizeTargetCefr === "function"
        ? globalThis.SubtitleTranslator.normalizeTargetCefr(source.targetCefr)
        : DEFAULT_SETTINGS.targetCefr
    };
  }

  function getSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(DEFAULT_SETTINGS, (stored) => {
        settings = normalizeSettings(stored);
        resolve(settings);
      });
    });
  }

  function clearTranslationCache() {
    translationCache.clear();
  }

  function createCacheKey(text, runtimeSettings) {
    const normalizedText = normalizeText(text);
    if (!normalizedText) {
      return "";
    }

    if (
      globalThis.SubtitleTranslator &&
      typeof globalThis.SubtitleTranslator.createSettingsFingerprint === "function"
    ) {
      const fingerprint = globalThis.SubtitleTranslator.createSettingsFingerprint(runtimeSettings);
      return `${normalizedText}::${fingerprint}`;
    }

    const normalized = normalizeSettings(runtimeSettings);
    const sortedLevels = normalized.activeLevels.slice().sort().join(",");
    return `${normalizedText}::${normalized.replaceRatio.toFixed(2)}|${normalized.maxReplaceCount}|${sortedLevels}`;
  }

  function createRenderSignature(text, runtimeSettings) {
    const normalizedText = normalizeText(text);
    if (!normalizedText) {
      return "";
    }

    const normalized = normalizeSettings(runtimeSettings);
    const mode = normalized.enabled ? "enabled" : "disabled";
    const cacheKey = createCacheKey(normalizedText, normalized);
    return `${mode}::${cacheKey}`;
  }

  function isRenderUpToDate(element, sourceText, runtimeSettings) {
    if (!element || !element.dataset) {
      return false;
    }

    const nextSignature = createRenderSignature(sourceText, runtimeSettings);
    if (!nextSignature) {
      return false;
    }

    return element.dataset[RENDER_SIGNATURE_DATA_KEY] === nextSignature;
  }

  function readFromCache(cacheKey) {
    if (!cacheKey || !translationCache.has(cacheKey)) {
      return null;
    }

    const cachedResult = translationCache.get(cacheKey);
    translationCache.delete(cacheKey);
    translationCache.set(cacheKey, cachedResult);
    return cachedResult;
  }

  function writeToCache(cacheKey, result) {
    if (!cacheKey || !result) {
      return;
    }

    if (translationCache.has(cacheKey)) {
      translationCache.delete(cacheKey);
    }

    translationCache.set(cacheKey, result);

    if (translationCache.size > TRANSLATION_CACHE_LIMIT) {
      const oldestKey = translationCache.keys().next().value;
      if (oldestKey) {
        translationCache.delete(oldestKey);
      }
    }
  }

  function scheduleProcess() {
    if (processTimer) {
      clearTimeout(processTimer);
    }

    processTimer = setTimeout(() => {
      processTimer = null;
      processAll().catch((error) => {
        console.error("[BiliVocab] Process failed:", error);
      });
    }, PROCESS_DELAY_MS);
  }

  async function applyTranslation(element, sourceTextOverride) {
    const currentText = normalizeText(sourceTextOverride || SubtitleParser.extractSubtitleText(element));
    if (!currentText) {
      return;
    }

    resetHitTrackingIfSourceChanged(element, currentText);
    const renderSignature = createRenderSignature(currentText, settings);
    if (isRenderUpToDate(element, currentText, settings)) {
      return;
    }

    if (!settings.enabled) {
      SubtitleRenderer.restoreSubtitleElement(element, currentText);
      if (element && element.dataset) {
        element.dataset[RENDER_SIGNATURE_DATA_KEY] = renderSignature;
      }
      return;
    }

    const cacheKey = createCacheKey(currentText, settings);
    let result = readFromCache(cacheKey);
    if (!result) {
      result = await SubtitleTranslator.processSubtitle(currentText, settings);
      writeToCache(cacheKey, result);
    }

    const rendered = SubtitleRenderer.renderSubtitleElement(element, result, currentText);
    if (rendered) {
      if (element && element.dataset) {
        element.dataset[RENDER_SIGNATURE_DATA_KEY] = renderSignature;
      }
      recordRenderedHits(element, result, currentText);
    }
  }

  function createHitTrackingSignature(result, sourceText) {
    if (!result || !Array.isArray(result.tokens)) {
      return "";
    }

    const words = result.tokens
      .filter((token) => token && token.type === "word")
      .map((token) => String(token.word || "").trim().toLowerCase())
      .filter(Boolean);

    if (words.length === 0) {
      return "";
    }

    return `${normalizeText(sourceText)}::${words.join("|")}`;
  }

  function resetHitTrackingIfSourceChanged(element, sourceText) {
    if (!element || !element.dataset) {
      return;
    }

    const previousOriginalText = normalizeText(element.dataset.biliVocabOriginalText || "");
    const nextOriginalText = normalizeText(sourceText);
    if (!previousOriginalText || !nextOriginalText || previousOriginalText === nextOriginalText) {
      return;
    }

    delete element.dataset[HIT_SIGNATURE_DATA_KEY];
  }

  function recordRenderedHits(element, result, sourceText) {
    if (
      !result ||
      !Array.isArray(result.tokens) ||
      !globalThis.VocabularyModule ||
      typeof globalThis.VocabularyModule.recordHit !== "function"
    ) {
      return;
    }

    const hitSignature = createHitTrackingSignature(result, sourceText);
    if (!hitSignature) {
      return;
    }

    if (element && element.dataset && element.dataset[HIT_SIGNATURE_DATA_KEY] === hitSignature) {
      return;
    }

    result.tokens.forEach((token) => {
      if (!token || token.type !== "word") {
        return;
      }

      const word = String(token.word || "").trim();
      if (!word) {
        return;
      }

      globalThis.VocabularyModule.recordHit(word);
    });

    if (element && element.dataset) {
      element.dataset[HIT_SIGNATURE_DATA_KEY] = hitSignature;
    }
  }

  function startReviewEngine() {
    if (!globalThis.SchedulerModule || typeof globalThis.SchedulerModule.startEngine !== "function") {
      return;
    }

    globalThis.SchedulerModule.startEngine();
  }

  function stopReviewEngine(clearExistingDanmaku) {
    if (globalThis.SchedulerModule) {
      if (typeof globalThis.SchedulerModule.stopEngine === "function") {
        globalThis.SchedulerModule.stopEngine();
      } else if (typeof globalThis.SchedulerModule.pauseEngine === "function") {
        globalThis.SchedulerModule.pauseEngine();
      }
    }

    if (
      clearExistingDanmaku &&
      globalThis.DanmakuModule &&
      typeof globalThis.DanmakuModule.clearDanmaku === "function"
    ) {
      globalThis.DanmakuModule.clearDanmaku();
    }
  }

  function pauseReviewEngine() {
    if (!globalThis.SchedulerModule || typeof globalThis.SchedulerModule.pauseEngine !== "function") {
      return;
    }

    globalThis.SchedulerModule.pauseEngine();
  }

  function syncDanmakuSettings() {
    if (!globalThis.DanmakuModule || typeof globalThis.DanmakuModule.setSpeedPreset !== "function") {
      return;
    }

    globalThis.DanmakuModule.setSpeedPreset(settings.reviewDanmakuSpeed);
  }

  function shouldRunReviewDanmaku(runtimeSettings, playbackState) {
    const nextSettings = runtimeSettings || {};
    const state = playbackState || {};

    return (
      nextSettings.reviewDanmakuEnabled === true &&
      state.hasVideo === true &&
      state.paused !== true &&
      state.ended !== true
    );
  }

  function getPlaybackState() {
    if (!(boundVideo instanceof HTMLVideoElement)) {
      return {
        hasVideo: false,
        paused: true,
        ended: true
      };
    }

    return {
      hasVideo: true,
      paused: Boolean(boundVideo.paused),
      ended: Boolean(boundVideo.ended)
    };
  }

  function onVideoPlay() {
    syncEngineWithPlayback();
  }

  function onVideoPauseOrEnd() {
    syncEngineWithPlayback();
  }

  function bindVideoPlaybackEvents() {
    const video = document.querySelector("video");
    if (!(video instanceof HTMLVideoElement)) {
      return;
    }

    if (boundVideo === video) {
      return;
    }

    if (boundVideo instanceof HTMLVideoElement) {
      boundVideo.removeEventListener("play", onVideoPlay);
      boundVideo.removeEventListener("pause", onVideoPauseOrEnd);
      boundVideo.removeEventListener("ended", onVideoPauseOrEnd);
    }

    boundVideo = video;
    boundVideo.addEventListener("play", onVideoPlay);
    boundVideo.addEventListener("pause", onVideoPauseOrEnd);
    boundVideo.addEventListener("ended", onVideoPauseOrEnd);
  }

  function syncEngineWithPlayback() {
    const playbackState = getPlaybackState();
    if (!settings.reviewDanmakuEnabled || !playbackState.hasVideo || playbackState.ended) {
      stopReviewEngine(true);
      return;
    }

    if (!shouldRunReviewDanmaku(settings, playbackState)) {
      pauseReviewEngine();
      return;
    }

    startReviewEngine();
  }

  function ensureRuntimeBindings() {
    bindVideoPlaybackEvents();

    if (globalThis.DanmakuModule && typeof globalThis.DanmakuModule.initDanmakuContainer === "function") {
      globalThis.DanmakuModule.initDanmakuContainer();
    }

    syncDanmakuSettings();
    syncEngineWithPlayback();
  }

  async function processSubtitles() {
    const subtitleItems = SubtitleParser.getCurrentSubtitleItems();
    if (subtitleItems.length === 0) {
      const fallbackText = normalizeText(SubtitleParser.getSubtitleFromTimelineAtCurrentTime());
      const fallbackElement = SubtitleParser.getPrimarySubtitleElement();
      if (fallbackElement && fallbackText) {
        await applyTranslation(fallbackElement, fallbackText);
      }
      return;
    }

    for (let i = 0; i < subtitleItems.length; i += 1) {
      await applyTranslation(subtitleItems[i].element);
    }
  }

  function invalidateRenderedSubtitles() {
    const subtitleItems = SubtitleParser.getCurrentSubtitleItems();
    subtitleItems.forEach((item) => {
      if (!(item.element instanceof HTMLElement)) {
        return;
      }
      delete item.element.dataset.biliVocabRenderedText;
      delete item.element.dataset[RENDER_SIGNATURE_DATA_KEY];
    });
  }

  async function processAll() {
    if (processing) {
      return;
    }

    processing = true;
    try {
      await processSubtitles();
    } finally {
      processing = false;
    }
  }

  function observeSubtitleChanges() {
    if (observer) {
      observer.disconnect();
    }

    observer = new MutationObserver(() => {
      ensureRuntimeBindings();
      scheduleProcess();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function startTimelinePolling() {
    if (timelinePollTimer) {
      clearInterval(timelinePollTimer);
    }

    timelinePollTimer = setInterval(() => {
      ensureRuntimeBindings();
      scheduleProcess();
    }, TIMELINE_POLL_MS);
  }

  function watchStorageChanges() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") {
        return;
      }

      const translationKeys = ["enabled", "activeLevels", "replaceRatio", "maxReplaceCount", "targetCefr"];
      const reviewDanmakuChanged = Boolean(changes.reviewDanmakuEnabled);
      const reviewDanmakuSpeedChanged = Boolean(changes.reviewDanmakuSpeed);
      const hasTranslationChange = translationKeys.some((key) => Boolean(changes[key]));
      if (!reviewDanmakuChanged && !reviewDanmakuSpeedChanged && !hasTranslationChange) {
        return;
      }

      const nextSettings = { ...settings };
      [...translationKeys, "reviewDanmakuEnabled", "reviewDanmakuSpeed"].forEach((key) => {
        if (!changes[key]) {
          return;
        }
        nextSettings[key] = changes[key].newValue;
      });

      settings = normalizeSettings(nextSettings);

      if (reviewDanmakuSpeedChanged) {
        syncDanmakuSettings();
      }

      if (reviewDanmakuChanged) {
        syncEngineWithPlayback();
      }

      if (hasTranslationChange) {
        clearTranslationCache();
        invalidateRenderedSubtitles();
        scheduleProcess();
      }
    });
  }

  async function init() {
    if (
      !globalThis.SubtitleParser ||
      !globalThis.SubtitleTranslator ||
      !globalThis.VocabularyModule ||
      !globalThis.SubtitleRenderer ||
      !globalThis.TooltipModule
    ) {
      console.error("[BiliVocab] Required modules are missing.");
      return;
    }

    await Promise.all([
      VocabularyModule.loadVocabulary(),
      SubtitleParser.loadSubtitleTimeline().catch(() => [])
    ]);
    await getSettings();
    clearTranslationCache();

    TooltipModule.init();
    ensureRuntimeBindings();
    watchStorageChanges();
    observeSubtitleChanges();
    startTimelinePolling();
    scheduleProcess();

    console.log("[BiliVocab] Running with settings:", settings);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      init().catch((error) => {
        console.error("[BiliVocab] Initialization failed:", error);
      });
    });
  } else {
    init().catch((error) => {
      console.error("[BiliVocab] Initialization failed:", error);
    });
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      createRenderSignature,
      createHitTrackingSignature,
      isRenderUpToDate,
      shouldRunReviewDanmaku,
      resetHitTrackingIfSourceChanged,
      recordRenderedHits
    };
  }
})();
