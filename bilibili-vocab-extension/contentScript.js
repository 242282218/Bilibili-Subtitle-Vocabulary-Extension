(function () {
  const DEFAULT_SETTINGS = {
    enabled: true,
    schemaVersion: 2,
    reviewDanmakuEnabled: false,
    reviewDanmakuSpeed: 'normal',
    webPageEnabled: true,
    domainRules: {},
    activeLevels: ['CET4', 'CET6', 'KAOYAN', 'IELTS', 'TOEFL'],
    replaceRatio: 0.2,
    maxReplaceCount: 2,
    targetCefr: 'B2',
  };
  const sharedSettings =
    globalThis.SharedSettings ||
    (typeof require === 'function' ? require('./sharedSettings.js') : null);
  const subtitleNavigation =
    globalThis.SubtitleNavigationShared ||
    (typeof require === 'function' ? require('./subtitleNavigation.js') : null);

  const PROCESS_DELAY_MS = 120;
  const TIMELINE_POLL_MS = 300;
  const TRANSLATION_CACHE_LIMIT = 200;
  const WEB_TEXT_PROCESS_INTERVAL = 1000; // 网页文本处理间隔
  const LEGACY_WEB_TEXT_PIPELINE_FLAG = '__BILI_VOCAB_ENABLE_LEGACY_WEB_TEXT_PIPELINE__';
  const VIDEO_SITE_HOSTS = [
    'bilibili.com',
    'youtube.com',
    'v.qq.com',
    'iqiyi.com',
    'netflix.com',
    'youku.com',
  ];
  const TRANSLATION_SETTINGS_KEYS =
    sharedSettings && Array.isArray(sharedSettings.SETTINGS_STORAGE_KEYS)
      ? sharedSettings.SETTINGS_STORAGE_KEYS.filter(
          (key) => key !== 'reviewDanmakuEnabled' && key !== 'reviewDanmakuSpeed'
        )
      : [
          'enabled',
          'activeLevels',
          'replaceRatio',
          'maxReplaceCount',
          'targetCefr',
          'vocabularyMode',
          'examPreference',
          'webPageEnabled',
          'domainRules',
          'schemaVersion',
        ];
  const RUNTIME_SETTINGS_KEYS = [
    ...TRANSLATION_SETTINGS_KEYS,
    'reviewDanmakuEnabled',
    'reviewDanmakuSpeed',
  ];
  const SETTINGS_STORAGE_KEY_V3 =
    sharedSettings && sharedSettings.SETTINGS_STORAGE_KEY_V3
      ? sharedSettings.SETTINGS_STORAGE_KEY_V3
      : 'bili_vocab_settings_v3';
  const ACTIVE_TAB_SUBTITLE_NAVIGATION_READ = 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_READ';
  const ACTIVE_TAB_SUBTITLE_NAVIGATION_NAVIGATE =
    'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_NAVIGATE';

  let observer = null;
  let observerTarget = null;
  let processTimer = null;
  let timelinePollTimer = null;
  let processing = false;
  let pendingProcess = false;
  let settings = { ...DEFAULT_SETTINGS };
  const LRUCacheCtor =
    globalThis.Utils && typeof globalThis.Utils.LRUCache === 'function'
      ? globalThis.Utils.LRUCache
      : class SimpleMapCache extends Map {
          constructor() {
            super();
          }
        };
  const translationCache = new LRUCacheCtor(TRANSLATION_CACHE_LIMIT);
  let boundVideo = null;
  let webTextProcessTimer = null;
  let webTextProcessing = false;
  let lastWebTextProcessAt = 0;
  let renderGeneration = 0;
  let overlayModuleCache = null;
  let overlayModulePromise = null;
  const HIT_SIGNATURE_DATA_KEY = 'biliVocabHitSignature';
  const RENDER_SIGNATURE_DATA_KEY = 'biliVocabRenderSignature';
  const LEARNING_WORD_STATS_STORAGE_KEY = globalThis.LearningState
    ? globalThis.LearningState.STORAGE_KEYS.WORD_STATS_V2
    : 'bili_vocab_word_stats_v2';
  const REVIEW_QUEUE_STORAGE_KEY = globalThis.LearningState
    ? globalThis.LearningState.STORAGE_KEYS.REVIEW_QUEUE
    : 'bili_vocab_review_queue_v1';
  const LEARNING_SUMMARY_STORAGE_KEY = globalThis.LearningState
    ? globalThis.LearningState.STORAGE_KEYS.LEARNING_SUMMARY
    : 'bili_vocab_learning_summary_v1';

  const normalizeText =
    (globalThis.Utils && globalThis.Utils.normalizeText) ||
    ((text) =>
      String(text || '')
        .replace(/\s+/g, ' ')
        .trim());
  const logError =
    (globalThis.Utils && globalThis.Utils.logError) ||
    ((context, error) => console.error(`[BiliVocab] ${context}:`, error));

  if (sharedSettings) {
    Object.assign(DEFAULT_SETTINGS, sharedSettings.DEFAULT_SETTINGS);
  }

  function normalizeReviewDanmakuSpeed(speed) {
    if (sharedSettings) {
      return sharedSettings.normalizeReviewDanmakuSpeed(speed);
    }

    const normalized = String(speed || DEFAULT_SETTINGS.reviewDanmakuSpeed)
      .trim()
      .toLowerCase();
    return ['slow', 'normal', 'fast'].includes(normalized)
      ? normalized
      : DEFAULT_SETTINGS.reviewDanmakuSpeed;
  }

  function hasMethod(obj, method) {
    return obj && typeof obj[method] === 'function';
  }

  function isVideoSiteHost(hostname) {
    const normalized = String(hostname || '').toLowerCase();
    return VIDEO_SITE_HOSTS.some((site) => normalized === site || normalized.endsWith(`.${site}`));
  }

  function shouldEnableTimelinePolling() {
    const doc = globalThis.document;
    return Boolean(doc && typeof doc.querySelector === 'function' && doc.querySelector('video'));
  }

  function shouldObserveDomMutations(runtimeSettings, hostname) {
    const currentHost =
      typeof hostname === 'string' ? hostname : globalThis.location && globalThis.location.hostname;

    if (isVideoSiteHost(currentHost) || shouldEnableTimelinePolling()) {
      return true;
    }

    return shouldRestoreWebItems(runtimeSettings) === false;
  }

  function shouldRetargetSubtitleObserver(currentTarget, subtitleContainer) {
    const doc = globalThis.document;
    if (!doc || currentTarget !== doc.body) {
      return false;
    }
    return Boolean(subtitleContainer && subtitleContainer !== doc.body);
  }

  function resolveSubtitleObserverTarget(runtimeSettings) {
    const subtitleContainer = document.querySelector('.bpx-player-subtitle-wrap');
    if (subtitleContainer) {
      return subtitleContainer;
    }
    return shouldObserveDomMutations(runtimeSettings) ? document.body : null;
  }

  function shouldRefreshSubtitleObserver(currentTarget, nextTarget) {
    return currentTarget !== nextTarget;
  }

  function runInAnimationFrame(task) {
    const scheduleFrame =
      typeof globalThis.requestAnimationFrame === 'function'
        ? globalThis.requestAnimationFrame.bind(globalThis)
        : (callback) => setTimeout(callback, 0);

    return new Promise((resolve) => {
      scheduleFrame(() => {
        Promise.resolve()
          .then(() => task())
          .catch((error) => {
            logError('Animation frame batch failed', error);
          })
          .finally(() => {
            resolve();
          });
      });
    });
  }

  function shouldRestoreWebItems(runtimeSettings) {
    const normalized = normalizeSettings(runtimeSettings);
    return normalized.webPageEnabled === false;
  }

  function shouldRunLegacyWebTextPipeline() {
    // Why: keep the legacy walker only as an explicit debug fallback.
    return globalThis[LEGACY_WEB_TEXT_PIPELINE_FLAG] === true;
  }

  function normalizeSettings(rawSettings) {
    if (sharedSettings) {
      return sharedSettings.normalizeSettings(rawSettings);
    }

    const source = { ...DEFAULT_SETTINGS, ...(rawSettings || {}) };
    const activeLevels = Array.isArray(source.activeLevels)
      ? source.activeLevels
          .map((level) =>
            String(level || '')
              .trim()
              .toUpperCase()
          )
          .filter(Boolean)
      : DEFAULT_SETTINGS.activeLevels.slice();

    return {
      enabled: source.enabled !== false,
      reviewDanmakuEnabled: source.reviewDanmakuEnabled === true,
      reviewDanmakuSpeed: normalizeReviewDanmakuSpeed(source.reviewDanmakuSpeed),
      activeLevels: activeLevels.length
        ? Array.from(new Set(activeLevels))
        : DEFAULT_SETTINGS.activeLevels.slice(),
      replaceRatio: Math.min(
        0.3,
        Math.max(0.1, Number(source.replaceRatio) || DEFAULT_SETTINGS.replaceRatio)
      ),
      maxReplaceCount: Math.min(
        5,
        Math.max(1, Math.floor(Number(source.maxReplaceCount) || DEFAULT_SETTINGS.maxReplaceCount))
      ),
      targetCefr: hasMethod(globalThis.SubtitleTranslator, 'normalizeTargetCefr')
        ? globalThis.SubtitleTranslator.normalizeTargetCefr(source.targetCefr)
        : DEFAULT_SETTINGS.targetCefr,
      webPageEnabled: source.webPageEnabled !== false,
      domainRules:
        source.domainRules && typeof source.domainRules === 'object' ? source.domainRules : {},
      schemaVersion: Number(source.schemaVersion) || 2,
    };
  }

  function buildRuntimeSettings(baseSettings, updates) {
    if (sharedSettings && typeof sharedSettings.buildSettingsPayload === 'function') {
      return sharedSettings.buildSettingsPayload(baseSettings, updates);
    }

    return normalizeSettings({
      ...(baseSettings || {}),
      ...(updates || {}),
    });
  }

  function isCurrentSiteEnabled(runtimeSettings) {
    if (sharedSettings && typeof sharedSettings.isDomainEnabled === 'function') {
      return sharedSettings.isDomainEnabled(
        globalThis.location && globalThis.location.hostname,
        runtimeSettings
      );
    }
    return true;
  }

  function restoreItemsToSourceText(items) {
    if (!Array.isArray(items)) {
      return;
    }

    items.forEach((item) => {
      if (!item || !(item.element instanceof HTMLElement)) {
        return;
      }

      const sourceText = normalizeText(
        item.text || SubtitleParser.extractSubtitleText(item.element)
      );
      SubtitleRenderer.restoreSubtitleElement(item.element, sourceText);
    });
  }

  function getSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(null, (stored) => {
        if (
          sharedSettings &&
          typeof sharedSettings.migrateToV3 === 'function' &&
          typeof sharedSettings.resolveEffectiveRuntime === 'function'
        ) {
          const nextV3 = sharedSettings.migrateToV3(stored);
          if (
            chrome.storage &&
            chrome.storage.local &&
            typeof chrome.storage.local.set === 'function'
          ) {
            chrome.storage.local.set({
              [SETTINGS_STORAGE_KEY_V3]: nextV3,
            });
          }
          settings = sharedSettings.resolveEffectiveRuntime(nextV3, {
            hostname: globalThis.location && globalThis.location.hostname,
          });
          resolve(settings);
          return;
        }

        settings = buildRuntimeSettings(DEFAULT_SETTINGS, stored);
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
      return '';
    }

    if (hasMethod(globalThis.SubtitleTranslator, 'createSettingsFingerprint')) {
      const fingerprint = globalThis.SubtitleTranslator.createSettingsFingerprint(runtimeSettings);
      return `${normalizedText}::${fingerprint}`;
    }

    const normalized = normalizeSettings(runtimeSettings);
    const sortedLevels = normalized.activeLevels.slice().sort().join(',');
    return `${normalizedText}::${normalized.replaceRatio.toFixed(2)}|${normalized.maxReplaceCount}|${sortedLevels}`;
  }

  function createRenderSignature(text, runtimeSettings) {
    const normalizedText = normalizeText(text);
    if (!normalizedText) {
      return '';
    }

    const normalized = normalizeSettings(runtimeSettings);
    const mode = normalized.enabled ? 'enabled' : 'disabled';
    const pageMode = normalized.webPageEnabled ? 'page-on' : 'page-off';
    const siteMode = isCurrentSiteEnabled(normalized) ? 'site-on' : 'site-off';
    const cacheKey = createCacheKey(normalizedText, normalized);
    return `${mode}::${pageMode}::${siteMode}::${cacheKey}`;
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
    return translationCache.get(cacheKey);
  }

  function writeToCache(cacheKey, result) {
    if (!cacheKey || !result) {
      return;
    }

    translationCache.set(cacheKey, result);
  }

  const scheduleProcess = (function () {
    const debouncedProcess =
      globalThis.Utils && globalThis.Utils.debounce
        ? globalThis.Utils.debounce(() => {
            processAll().catch((error) => logError('Process failed', error));
          }, PROCESS_DELAY_MS)
        : function () {
            if (processTimer) {
              clearTimeout(processTimer);
            }
            processTimer = setTimeout(() => {
              processTimer = null;
              processAll().catch((error) => logError('Process failed', error));
            }, PROCESS_DELAY_MS);
          };
    return debouncedProcess;
  })();

  async function applyTranslation(element, sourceTextOverride) {
    const currentText = normalizeText(
      sourceTextOverride || SubtitleParser.extractSubtitleText(element)
    );
    if (!currentText) {
      return;
    }

    const generationAtStart = renderGeneration;
    resetHitTrackingIfSourceChanged(element, currentText);
    const renderSignature = createRenderSignature(currentText, settings);
    if (isRenderUpToDate(element, currentText, settings)) {
      return;
    }

    if (!settings.enabled) {
      if (generationAtStart !== renderGeneration) {
        return;
      }
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

    if (generationAtStart !== renderGeneration) {
      return;
    }

    const rendered = SubtitleRenderer.renderSubtitleElement(element, result, currentText, settings);
    if (rendered) {
      if (element && element.dataset) {
        element.dataset[RENDER_SIGNATURE_DATA_KEY] = renderSignature;
      }
      recordRenderedHits(element, result, currentText);
    }
  }

  function createHitTrackingSignature(result, sourceText) {
    if (!result || !Array.isArray(result.tokens)) {
      return '';
    }

    const words = result.tokens
      .filter((token) => token && token.type === 'word')
      .map((token) =>
        String(token.word || '')
          .trim()
          .toLowerCase()
      )
      .filter(Boolean);

    if (words.length === 0) {
      return '';
    }

    return `${normalizeText(sourceText)}::${words.join('|')}`;
  }

  function resetHitTrackingIfSourceChanged(element, sourceText) {
    if (!element || !element.dataset) {
      return;
    }

    const previousOriginalText = normalizeText(element.dataset.biliVocabOriginalText || '');
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
      !hasMethod(globalThis.VocabularyModule, 'recordHit')
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
      if (!token || token.type !== 'word') {
        return;
      }

      const word = String(token.word || '').trim();
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
    if (hasMethod(globalThis.SchedulerModule, 'startEngine')) {
      globalThis.SchedulerModule.startEngine();
    }
  }

  function stopReviewEngine(clearExistingDanmaku) {
    if (globalThis.SchedulerModule) {
      if (hasMethod(globalThis.SchedulerModule, 'stopEngine')) {
        globalThis.SchedulerModule.stopEngine();
      } else if (hasMethod(globalThis.SchedulerModule, 'pauseEngine')) {
        globalThis.SchedulerModule.pauseEngine();
      }
    }

    if (clearExistingDanmaku && hasMethod(globalThis.DanmakuModule, 'clearDanmaku')) {
      globalThis.DanmakuModule.clearDanmaku();
    }
  }

  function pauseReviewEngine() {
    if (hasMethod(globalThis.SchedulerModule, 'pauseEngine')) {
      globalThis.SchedulerModule.pauseEngine();
    }
  }

  function syncDanmakuSettings() {
    if (hasMethod(globalThis.DanmakuModule, 'setSpeedPreset')) {
      globalThis.DanmakuModule.setSpeedPreset(settings.reviewDanmakuSpeed);
    }
  }

  function shouldRunReviewDanmaku(runtimeSettings = {}, playbackState = {}) {
    return (
      runtimeSettings.reviewDanmakuEnabled === true &&
      playbackState.hasVideo === true &&
      playbackState.paused !== true &&
      playbackState.ended !== true
    );
  }

  function getPlaybackState() {
    if (!(boundVideo instanceof HTMLVideoElement)) {
      return {
        hasVideo: false,
        paused: true,
        ended: true,
      };
    }

    return {
      hasVideo: true,
      paused: Boolean(boundVideo.paused),
      ended: Boolean(boundVideo.ended),
    };
  }

  function onVideoPlay() {
    syncEngineWithPlayback();
  }

  function onVideoPauseOrEnd() {
    syncEngineWithPlayback();
  }

  function unbindVideoPlaybackEvents(video) {
    if (!(video instanceof HTMLVideoElement)) {
      return;
    }
    video.removeEventListener('play', onVideoPlay);
    video.removeEventListener('pause', onVideoPauseOrEnd);
    video.removeEventListener('ended', onVideoPauseOrEnd);
  }

  function bindVideoPlaybackEvents() {
    const video = document.querySelector('video');
    if (!(video instanceof HTMLVideoElement)) {
      unbindVideoPlaybackEvents(boundVideo);
      boundVideo = null;
      return;
    }

    if (boundVideo === video) {
      return;
    }

    unbindVideoPlaybackEvents(boundVideo);

    boundVideo = video;
    boundVideo.addEventListener('play', onVideoPlay);
    boundVideo.addEventListener('pause', onVideoPauseOrEnd);
    boundVideo.addEventListener('ended', onVideoPauseOrEnd);
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

    if (hasMethod(globalThis.DanmakuModule, 'initDanmakuContainer')) {
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

    if (!isCurrentSiteEnabled(settings)) {
      restoreItemsToSourceText(subtitleItems);
      return;
    }

    const webItems = subtitleItems.filter((item) => item && item.mode === 'page');
    const subtitleModeItems = subtitleItems.filter((item) => !item || item.mode !== 'page');

    // 批量更新DOM，减少重排重绘
    await runInAnimationFrame(async () => {
      for (let i = 0; i < subtitleModeItems.length; i += 1) {
        await applyTranslation(subtitleModeItems[i].element);
      }

      if (shouldRestoreWebItems(settings)) {
        restoreItemsToSourceText(webItems);
        return;
      }

      for (let i = 0; i < webItems.length; i += 1) {
        await applyTranslation(webItems[i].element, webItems[i].text);
      }
    });
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
      pendingProcess = true;
      return;
    }

    processing = true;
    pendingProcess = false;
    try {
      await processSubtitles();
      if (shouldRunLegacyWebTextPipeline()) {
        await processWebPageText();
      }
    } finally {
      processing = false;
      if (pendingProcess) {
        pendingProcess = false;
        scheduleProcess();
      }
    }
  }

  // 全网页文本词汇替换功能（Toucan模式）
  async function processWebPageText() {
    if (!settings.webPageEnabled || !settings.enabled) {
      return;
    }

    const now = Date.now();
    if (webTextProcessing) {
      return;
    }

    const elapsed = now - lastWebTextProcessAt;
    if (elapsed < WEB_TEXT_PROCESS_INTERVAL) {
      if (!webTextProcessTimer) {
        webTextProcessTimer = setTimeout(() => {
          webTextProcessTimer = null;
          scheduleProcess();
        }, WEB_TEXT_PROCESS_INTERVAL - elapsed);
      }
      return;
    }

    webTextProcessing = true;
    lastWebTextProcessAt = now;
    try {
      // 只在视频站外的普通网页启用
      const hostname = window.location.hostname.toLowerCase();
      if (isVideoSiteHost(hostname)) {
        return;
      }

      // 选择所有正文文本节点
      const textNodes = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          // 过滤掉非正文内容
          if (
            !node.parentElement ||
            node.parentElement.tagName.match(
              /^(SCRIPT|STYLE|NOSCRIPT|IFRAME|BUTTON|A|INPUT|TEXTAREA|SELECT|LABEL|NAV|HEADER|FOOTER|ASIDE|PRE|CODE)$/
            )
          ) {
            return NodeFilter.FILTER_REJECT;
          }
          // 跳过已处理的内容
          if (node.parentElement.closest('.bili-vocab-word, .bili-vocab-tooltip')) {
            return NodeFilter.FILTER_REJECT;
          }
          // 只处理包含中文的文本
          const text = node.textContent.trim();
          if (text.length < 2 || !/[\u4e00-\u9fff]/.test(text)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      let node;
      while ((node = walker.nextNode())) {
        textNodes.push(node);
      }

      // 分批处理，避免阻塞页面
      const batchSize = 20;
      for (let i = 0; i < textNodes.length; i += batchSize) {
        const batch = textNodes.slice(i, i + batchSize);
        await Promise.all(batch.map((node) => processTextNode(node)));
        // 给浏览器喘息时间
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } finally {
      webTextProcessing = false;
    }
  }

  async function processTextNode(textNode) {
    try {
      const generationAtStart = renderGeneration;
      const text = textNode.textContent;
      if (!text || text.length < 2) return;

      const cacheKey = createCacheKey(`web:${text}`, settings);
      let result = translationCache.get(cacheKey);
      if (!result) {
        result = await SubtitleTranslator.processSubtitle(text, settings);
        translationCache.set(cacheKey, result);
      }

      if (generationAtStart !== renderGeneration) {
        return;
      }

      if (shouldReplaceWebTextNode(result, text) && textNode.parentNode) {
        const span = document.createElement('span');
        span.innerHTML = renderWebTextReplacementHtml(result, text, settings);
        textNode.parentNode.replaceChild(span, textNode);
      }
    } catch (e) {
      // 单个节点处理失败不影响整体
      logError('processTextNode', e);
    }
  }

  function shouldReplaceWebTextNode(result, sourceText) {
    if (!result || typeof result !== 'object') {
      return false;
    }

    const normalizedSource = normalizeText(sourceText);
    const normalizedMixedText = normalizeText(result.mixedText);
    if (normalizedMixedText) {
      return normalizedMixedText !== normalizedSource;
    }

    if (!Array.isArray(result.tokens)) {
      return false;
    }

    return result.tokens.some((token) => token && token.type === 'word');
  }

  function renderWebTextReplacementHtml(result, sourceText, runtimeSettings) {
    if (
      !globalThis.SubtitleRenderer ||
      typeof globalThis.SubtitleRenderer.renderToHtml !== 'function'
    ) {
      return '';
    }

    return globalThis.SubtitleRenderer.renderToHtml(result, sourceText, runtimeSettings);
  }

  function observeSubtitleChanges() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    observerTarget = null;

    const observeTarget = resolveSubtitleObserverTarget(settings);
    if (!observeTarget) {
      return;
    }
    observerTarget = observeTarget;

    observer = new MutationObserver(() => {
      ensureRuntimeBindings();
      startTimelinePolling();
      const latestTarget = resolveSubtitleObserverTarget(settings);
      if (shouldRefreshSubtitleObserver(observerTarget, latestTarget)) {
        // Why: keep observer target aligned with SPA DOM changes (body <-> subtitle container).
        observeSubtitleChanges();
      }
      scheduleProcess();
    });

    observer.observe(observeTarget, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  function startTimelinePolling() {
    const shouldPoll = shouldEnableTimelinePolling();

    if (!shouldPoll) {
      if (timelinePollTimer) {
        clearInterval(timelinePollTimer);
        timelinePollTimer = null;
      }
      return;
    }

    if (timelinePollTimer) {
      return;
    }

    timelinePollTimer = setInterval(() => {
      startTimelinePolling();
      const latestTarget = resolveSubtitleObserverTarget(settings);
      if (shouldRefreshSubtitleObserver(observerTarget, latestTarget)) {
        observeSubtitleChanges();
      }
      ensureRuntimeBindings();
      scheduleProcess();
    }, TIMELINE_POLL_MS);
  }

  function toMessageError(error, fallbackMessage) {
    if (!error) {
      return fallbackMessage;
    }
    const message = String(error.message || error).trim();
    return message || fallbackMessage;
  }

  function normalizeSubtitleNavigationAction(value) {
    const normalized = String(value || '')
      .trim()
      .toLowerCase();
    return ['previous', 'replay', 'next'].includes(normalized) ? normalized : '';
  }

  function getSubtitleNavigationHostname() {
    return String((globalThis.location && globalThis.location.hostname) || '');
  }

  function normalizeSubtitleNavigationTimeline(timeline) {
    if (subtitleNavigation && typeof subtitleNavigation.normalizeSubtitleTimeline === 'function') {
      return subtitleNavigation.normalizeSubtitleTimeline(timeline);
    }
    return [];
  }

  function buildSharedSubtitleNavigationState(options) {
    if (
      subtitleNavigation &&
      typeof subtitleNavigation.buildSubtitleNavigationState === 'function'
    ) {
      return subtitleNavigation.buildSubtitleNavigationState(options);
    }

    return {
      supported: false,
      loading: false,
      total: 0,
      currentIndex: null,
      progressLabel: '未支持',
      headline: '当前站点暂不支持句级跳转',
      description: '现阶段仅在 Bilibili 字幕时间轴上提供上一句、重播本句和下一句导航。',
      currentText: '切到支持的视频页后即可使用句级字幕导航。',
      previousIndex: null,
      replayIndex: null,
      nextIndex: null,
    };
  }

  function createSubtitleNavigationSnapshotFromState(state) {
    if (
      subtitleNavigation &&
      typeof subtitleNavigation.createActiveTabSubtitleNavigationSnapshot === 'function'
    ) {
      return subtitleNavigation.createActiveTabSubtitleNavigationSnapshot(state);
    }

    return {
      supported: state && state.supported === true,
      progressLabel: String((state && state.progressLabel) || '未支持'),
      headline: String((state && state.headline) || '当前标签页暂无字幕导航'),
      description: String((state && state.description) || '请先打开支持字幕的 Bilibili 视频页。'),
      currentText: String((state && state.currentText) || '还没有可直接跳转的字幕句段。'),
      canGoPrevious: Boolean(state && state.previousIndex != null),
      canReplay: Boolean(state && state.replayIndex != null),
      canGoNext: Boolean(state && state.nextIndex != null),
    };
  }

  function isSubtitleNavigationSupportedHost() {
    if (
      subtitleNavigation &&
      typeof subtitleNavigation.isSubtitleTimelineHostSupported === 'function'
    ) {
      return subtitleNavigation.isSubtitleTimelineHostSupported(getSubtitleNavigationHostname());
    }

    return Boolean(
      globalThis.SubtitleParser &&
      typeof globalThis.SubtitleParser.isBilibiliHost === 'function' &&
      globalThis.SubtitleParser.isBilibiliHost(getSubtitleNavigationHostname())
    );
  }

  function findSubtitleNavigationIndices(timeline, currentTime) {
    const normalizedTimeline = normalizeSubtitleNavigationTimeline(timeline);
    if (
      !subtitleNavigation ||
      typeof subtitleNavigation.findSubtitleIndexAtTime !== 'function' ||
      typeof subtitleNavigation.resolveSubtitleNavigationTargets !== 'function'
    ) {
      return {
        currentIndex: -1,
        previousIndex: null,
        replayIndex: null,
        nextIndex: null,
      };
    }

    const currentIndex = subtitleNavigation.findSubtitleIndexAtTime(
      normalizedTimeline,
      currentTime
    );
    const targets = subtitleNavigation.resolveSubtitleNavigationTargets(
      normalizedTimeline,
      currentTime
    );

    return {
      currentIndex,
      previousIndex: targets.previousIndex,
      replayIndex: targets.replayIndex,
      nextIndex: targets.nextIndex,
    };
  }

  function buildSubtitleNavigationSnapshot(timeline, currentTime) {
    const normalizedTimeline = normalizeSubtitleNavigationTimeline(timeline);
    const state = buildSharedSubtitleNavigationState({
      hostname: getSubtitleNavigationHostname() || 'www.bilibili.com',
      loading: false,
      hasVideo: true,
      currentTime,
      timeline: normalizedTimeline,
    });
    return createSubtitleNavigationSnapshotFromState(state);
  }

  function isSubtitleNavigationVideo(value) {
    return Boolean(value && typeof value.currentTime === 'number');
  }

  function buildSubtitleNavigationContext(video, timeline) {
    const normalizedTimeline = normalizeSubtitleNavigationTimeline(timeline);
    const state = buildSharedSubtitleNavigationState({
      hostname: getSubtitleNavigationHostname(),
      loading: false,
      hasVideo: isSubtitleNavigationVideo(video),
      currentTime: isSubtitleNavigationVideo(video) ? Number(video.currentTime) : Number.NaN,
      timeline: normalizedTimeline,
    });

    return {
      timeline: normalizedTimeline,
      video: isSubtitleNavigationVideo(video) ? video : null,
      state,
      snapshot: createSubtitleNavigationSnapshotFromState(state),
    };
  }

  async function readSubtitleNavigationContext() {
    if (!isSubtitleNavigationSupportedHost()) {
      return buildSubtitleNavigationContext(null, []);
    }

    const video = document.querySelector('video');
    if (!isSubtitleNavigationVideo(video)) {
      return buildSubtitleNavigationContext(null, []);
    }

    const timeline = hasMethod(globalThis.SubtitleParser, 'loadSubtitleTimeline')
      ? await globalThis.SubtitleParser.loadSubtitleTimeline()
      : [];
    return buildSubtitleNavigationContext(video, timeline);
  }

  async function readSubtitleNavigationSnapshot() {
    const context = await readSubtitleNavigationContext();
    return context.snapshot;
  }

  async function navigateSubtitleByAction(action) {
    const normalizedAction = normalizeSubtitleNavigationAction(action);
    if (!normalizedAction) {
      throw new Error('Invalid subtitle navigation action');
    }

    const context = await readSubtitleNavigationContext();
    if (!context.video) {
      return context.snapshot;
    }

    const targetIndex =
      normalizedAction === 'previous'
        ? context.state.previousIndex
        : normalizedAction === 'replay'
          ? context.state.replayIndex
          : context.state.nextIndex;
    if (
      !subtitleNavigation ||
      typeof subtitleNavigation.seekVideoToSubtitle !== 'function' ||
      subtitleNavigation.seekVideoToSubtitle(context.video, context.timeline, targetIndex) == null
    ) {
      return context.snapshot;
    }

    return buildSubtitleNavigationSnapshot(context.timeline, context.video.currentTime);
  }

  function watchRuntimeMessages() {
    if (
      typeof chrome === 'undefined' ||
      !chrome.runtime ||
      !chrome.runtime.onMessage ||
      typeof chrome.runtime.onMessage.addListener !== 'function'
    ) {
      return;
    }

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      const messageType = String(message && message.type ? message.type : '').trim();
      let task = null;

      if (messageType === ACTIVE_TAB_SUBTITLE_NAVIGATION_READ) {
        task = () => readSubtitleNavigationSnapshot();
      } else if (messageType === ACTIVE_TAB_SUBTITLE_NAVIGATION_NAVIGATE) {
        task = () => navigateSubtitleByAction(message && message.payload && message.payload.action);
      }

      if (!task) {
        return false;
      }

      Promise.resolve()
        .then(task)
        .then(
          (payload) => {
            sendResponse({ ok: true, payload });
          },
          (error) => {
            sendResponse({
              ok: false,
              error: toMessageError(error, `Failed to process ${messageType}`),
            });
          }
        );
      return true;
    });
  }

  function hasTranslationSettingChange(changes) {
    if (changes && changes[SETTINGS_STORAGE_KEY_V3]) {
      return true;
    }
    return TRANSLATION_SETTINGS_KEYS.some((key) => Boolean(changes && changes[key]));
  }

  function watchStorageChanges() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') {
        return;
      }

      const v3Changed = Boolean(changes[SETTINGS_STORAGE_KEY_V3]);
      const reviewDanmakuChanged = v3Changed || Boolean(changes.reviewDanmakuEnabled);
      const reviewDanmakuSpeedChanged = v3Changed || Boolean(changes.reviewDanmakuSpeed);
      const learningStateChanged = Boolean(
        changes[LEARNING_WORD_STATS_STORAGE_KEY] ||
        changes[REVIEW_QUEUE_STORAGE_KEY] ||
        changes[LEARNING_SUMMARY_STORAGE_KEY]
      );
      const hasTranslationChange = hasTranslationSettingChange(changes);
      if (
        !reviewDanmakuChanged &&
        !reviewDanmakuSpeedChanged &&
        !hasTranslationChange &&
        !learningStateChanged
      ) {
        return;
      }

      if (
        v3Changed &&
        sharedSettings &&
        typeof sharedSettings.normalizeSettingsV3 === 'function' &&
        typeof sharedSettings.resolveEffectiveRuntime === 'function'
      ) {
        const nextV3 = sharedSettings.normalizeSettingsV3(
          changes[SETTINGS_STORAGE_KEY_V3].newValue
        );
        settings = sharedSettings.resolveEffectiveRuntime(nextV3, {
          hostname: globalThis.location && globalThis.location.hostname,
        });
      } else {
        const updates = {};
        RUNTIME_SETTINGS_KEYS.forEach((key) => {
          if (!changes[key]) {
            return;
          }
          updates[key] = changes[key].newValue;
        });
        settings = buildRuntimeSettings(settings, updates);
      }

      renderGeneration += 1;

      if (reviewDanmakuSpeedChanged) {
        syncDanmakuSettings();
      }

      if (reviewDanmakuChanged) {
        syncEngineWithPlayback();
      }

      if (hasTranslationChange) {
        clearTranslationCache();
        if (webTextProcessTimer) {
          clearTimeout(webTextProcessTimer);
          webTextProcessTimer = null;
        }
        invalidateRenderedSubtitles();
        observeSubtitleChanges();
        startTimelinePolling();
        scheduleProcess();
      }

      if (
        learningStateChanged &&
        hasMethod(globalThis.VocabularyModule, 'refreshLearningStateFromStorage')
      ) {
        globalThis.VocabularyModule.refreshLearningStateFromStorage()
          .then(() => {
            clearTranslationCache();
            invalidateRenderedSubtitles();
            scheduleProcess();
          })
          .catch((error) => logError('Learning state refresh failed', error));
      }
    });
  }

  function getOverlayModuleFromGlobal() {
    const module = globalThis.ReactOverlayModule || globalThis.OverlayPanelModule;
    if (module && typeof module.mountOverlayPanel === 'function') {
      return module;
    }
    return null;
  }

  async function loadOverlayModule() {
    const existing = getOverlayModuleFromGlobal();
    if (existing) {
      overlayModuleCache = existing;
      return existing;
    }

    if (overlayModuleCache) {
      return overlayModuleCache;
    }

    if (overlayModulePromise) {
      return overlayModulePromise;
    }

    if (
      typeof chrome === 'undefined' ||
      !chrome.runtime ||
      typeof chrome.runtime.getURL !== 'function'
    ) {
      return null;
    }

    overlayModulePromise = import(chrome.runtime.getURL('dist/overlay.js'))
      .then((module) => {
        const globalModule = getOverlayModuleFromGlobal();
        if (globalModule) {
          overlayModuleCache = globalModule;
          return globalModule;
        }
        if (module && typeof module.mountOverlayPanel === 'function') {
          overlayModuleCache = module;
          return module;
        }
        return null;
      })
      .catch((error) => {
        logError('Overlay module load failed', error);
        return null;
      })
      .finally(() => {
        overlayModulePromise = null;
      });

    return overlayModulePromise;
  }

  async function init() {
    const overlayModule = await loadOverlayModule();
    if (
      !globalThis.SubtitleParser ||
      !globalThis.SubtitleTranslator ||
      !globalThis.VocabularyModule ||
      !globalThis.SubtitleRenderer ||
      !globalThis.TooltipModule ||
      !overlayModule
    ) {
      console.error('[BiliVocab] Required modules are missing.');
      return;
    }

    await Promise.all([
      VocabularyModule.loadVocabulary(),
      SubtitleParser.loadSubtitleTimeline().catch((error) => {
        logError('Subtitle timeline load failed', error);
        return [];
      }),
    ]);
    await getSettings();
    clearTranslationCache();

    TooltipModule.init();
    overlayModule.mountOverlayPanel();
    ensureRuntimeBindings();
    watchStorageChanges();
    observeSubtitleChanges();
    startTimelinePolling();
    scheduleProcess();

    console.log('[BiliVocab] Running with settings:', settings);
  }

  if (document.readyState === 'loading') {
    watchRuntimeMessages();
    document.addEventListener('DOMContentLoaded', () => {
      init().catch((error) => logError('Initialization failed', error));
    });
  } else {
    watchRuntimeMessages();
    init().catch((error) => logError('Initialization failed', error));
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      TRANSLATION_SETTINGS_KEYS,
      buildRuntimeSettings,
      createRenderSignature,
      createHitTrackingSignature,
      hasTranslationSettingChange,
      isRenderUpToDate,
      shouldRunReviewDanmaku,
      getPlaybackState,
      bindVideoPlaybackEvents,
      resetHitTrackingIfSourceChanged,
      recordRenderedHits,
      loadOverlayModule,
      runInAnimationFrame,
      isVideoSiteHost,
      shouldEnableTimelinePolling,
      shouldObserveDomMutations,
      shouldRetargetSubtitleObserver,
      shouldRefreshSubtitleObserver,
      shouldRestoreWebItems,
      shouldRunLegacyWebTextPipeline,
      shouldReplaceWebTextNode,
      renderWebTextReplacementHtml,
      normalizeSubtitleNavigationAction,
      findSubtitleNavigationIndices,
      buildSubtitleNavigationSnapshot,
      __readFromCacheForTest: readFromCache,
      __writeToCacheForTest: writeToCache,
      __clearTranslationCacheForTest: clearTranslationCache,
      __resetOverlayModuleStateForTest() {
        overlayModuleCache = null;
        overlayModulePromise = null;
      },
    };
  }
})();
