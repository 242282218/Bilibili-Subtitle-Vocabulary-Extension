(function () {
  const CONTENT_SCRIPT_INSTANCE_KEY = '__BILI_VOCAB_CONTENT_SCRIPT_INSTANCE__';
  const isCommonJsRuntime = typeof module !== 'undefined' && module.exports;
  if (!isCommonJsRuntime && globalThis[CONTENT_SCRIPT_INSTANCE_KEY]) {
    return;
  }
  if (!isCommonJsRuntime) {
    globalThis[CONTENT_SCRIPT_INSTANCE_KEY] = true;
  }

  const DEFAULT_SETTINGS = {
    enabled: true,
    schemaVersion: 2,
    reviewDanmakuEnabled: false,
    reviewDanmakuSpeed: 'normal',
    reviewDanmakuDensity: 'normal',
    webPageEnabled: true,
    domainRules: {},
    activeLevels: ['CET4', 'CET6', 'KAOYAN', 'IELTS', 'TOEFL'],
    replaceRatio: 0.2,
    maxReplaceCount: 2,
    targetCefr: 'B2',
    vocabularyMode: 'core',
    examPreference: 'balanced',
    bilingualMode: 'default',
    themeMode: 'auto',
  };
  const sharedSettings =
    globalThis.SharedSettings ||
    (typeof require === 'function' ? require('./sharedSettings.js') : null);
  const subtitleNavigation =
    globalThis.SubtitleNavigationShared ||
    (typeof require === 'function' ? require('./subtitleNavigation.js') : null);
  const overlaySubtitleNavigationBridgeRuntime =
    globalThis.BiliVocabOverlaySubtitleNavigationBridgeRuntime ||
    (typeof require === 'function' ? require('./overlaySubtitleNavigationBridge.js') : null);
  const subtitleNavigationControllerRuntime =
    globalThis.BiliVocabSubtitleNavigationControllerRuntime ||
    (typeof require === 'function' ? require('./subtitleNavigationController.js') : null);
  const runtimeSettingsSyncRuntime =
    globalThis.BiliVocabRuntimeSettingsSync ||
    (typeof require === 'function' ? require('./runtimeSettingsSync.js') : null);
  const webTextReplacementRuntime =
    globalThis.BiliVocabWebTextReplacement ||
    (typeof require === 'function' ? require('./webTextReplacement.js') : null);
  const overlayLoaderRuntime =
    globalThis.BiliVocabOverlayLoader ||
    (typeof require === 'function' ? require('./overlayLoader.js') : null);

  const PROCESS_DELAY_MS = 120;
  const MUTATION_OBSERVER_THROTTLE_MS = 500;
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
  const DEFAULT_OVERLAY_HOSTS = ['www.bilibili.com', 'www.youtube.com'];
  const TRANSLATION_SETTINGS_KEYS =
    sharedSettings && Array.isArray(sharedSettings.SETTINGS_STORAGE_KEYS)
      ? sharedSettings.SETTINGS_STORAGE_KEYS.filter(
          (key) =>
            key !== 'reviewDanmakuEnabled' &&
            key !== 'reviewDanmakuSpeed' &&
            key !== 'reviewDanmakuDensity'
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
    'reviewDanmakuDensity',
  ];
  const SETTINGS_STORAGE_KEY_V3 =
    sharedSettings && sharedSettings.SETTINGS_STORAGE_KEY_V3
      ? sharedSettings.SETTINGS_STORAGE_KEY_V3
      : 'bili_vocab_settings_v3';
  const ACTIVE_TAB_SUBTITLE_NAVIGATION_READ = 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_READ';
  const ACTIVE_TAB_SUBTITLE_NAVIGATION_NAVIGATE =
    'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_NAVIGATE';
  const ACTIVE_TAB_SUBTITLE_NAVIGATION_SUBSCRIBE =
    'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_SUBSCRIBE';
  const OVERLAY_SUBTITLE_NAVIGATION_BRIDGE_KEY = 'BiliVocabOverlaySubtitleNavigationBridge';
  const EFFECTIVE_DEFAULTS = sharedSettings
    ? { ...DEFAULT_SETTINGS, ...(sharedSettings.DEFAULT_SETTINGS || {}) }
    : { ...DEFAULT_SETTINGS };

  let observer = null;
  let observerTarget = null;
  let processTimer = null;
  let timelinePollTimer = null;
  let processing = false;
  let pendingProcess = false;
  let lastMutationObserverRefreshAt = 0;
  let settings = { ...EFFECTIVE_DEFAULTS };
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
  let subtitleNavigationController = null;
  let runtimeSettingsSyncController = null;
  let webTextReplacementController = null;
  let renderGeneration = 0;
  let overlayLoaderController = null;
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
  const DEBUG_LOG_FLAG = '__BILI_VOCAB_DEBUG_LOGS__';

  function shouldLogDebug() {
    return globalThis[DEBUG_LOG_FLAG] === true;
  }

  function logDebug(...args) {
    if (shouldLogDebug()) {
      console.debug(...args);
    }
  }

  function normalizeReviewDanmakuSpeed(speed) {
    if (sharedSettings) {
      return sharedSettings.normalizeReviewDanmakuSpeed(speed);
    }

    const normalized = String(speed || EFFECTIVE_DEFAULTS.reviewDanmakuSpeed)
      .trim()
      .toLowerCase();
    return ['slow', 'normal', 'fast'].includes(normalized)
      ? normalized
      : EFFECTIVE_DEFAULTS.reviewDanmakuSpeed;
  }

  function normalizeReviewDanmakuDensity(density) {
    if (sharedSettings && typeof sharedSettings.normalizeReviewDanmakuDensity === 'function') {
      return sharedSettings.normalizeReviewDanmakuDensity(density);
    }

    const normalized = String(density || EFFECTIVE_DEFAULTS.reviewDanmakuDensity)
      .trim()
      .toLowerCase();
    return ['sparse', 'normal', 'dense'].includes(normalized)
      ? normalized
      : EFFECTIVE_DEFAULTS.reviewDanmakuDensity;
  }

  function hasMethod(obj, method) {
    return obj && typeof obj[method] === 'function';
  }

  function isVideoSiteHost(hostname) {
    const normalized = String(hostname || '').toLowerCase();
    return VIDEO_SITE_HOSTS.some((site) => normalized === site || normalized.endsWith(`.${site}`));
  }

  function shouldLoadOverlayModuleForHost(hostname) {
    const normalized = String(hostname || '').toLowerCase();
    if (!normalized) {
      return true;
    }
    return DEFAULT_OVERLAY_HOSTS.includes(normalized);
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

  function shouldRunMutationObserverRefresh(now = Date.now()) {
    if (now - lastMutationObserverRefreshAt < MUTATION_OBSERVER_THROTTLE_MS) {
      return false;
    }

    lastMutationObserverRefreshAt = now;
    return true;
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

  function normalizeSettingsFallback(rawSettings) {
    const source = { ...EFFECTIVE_DEFAULTS, ...(rawSettings || {}) };
    const activeLevels = Array.isArray(source.activeLevels)
      ? source.activeLevels
          .map((level) =>
            String(level || '')
              .trim()
              .toUpperCase()
          )
          .filter(Boolean)
      : EFFECTIVE_DEFAULTS.activeLevels.slice();

    return {
      enabled: source.enabled !== false,
      reviewDanmakuEnabled: source.reviewDanmakuEnabled === true,
      reviewDanmakuSpeed: normalizeReviewDanmakuSpeed(source.reviewDanmakuSpeed),
      reviewDanmakuDensity: normalizeReviewDanmakuDensity(source.reviewDanmakuDensity),
      activeLevels: activeLevels.length
        ? Array.from(new Set(activeLevels))
        : EFFECTIVE_DEFAULTS.activeLevels.slice(),
      replaceRatio: Math.min(
        0.3,
        Math.max(0.1, Number(source.replaceRatio) || EFFECTIVE_DEFAULTS.replaceRatio)
      ),
      maxReplaceCount: Math.min(
        5,
        Math.max(
          1,
          Math.floor(Number(source.maxReplaceCount) || EFFECTIVE_DEFAULTS.maxReplaceCount)
        )
      ),
      targetCefr: hasMethod(globalThis.SubtitleTranslator, 'normalizeTargetCefr')
        ? globalThis.SubtitleTranslator.normalizeTargetCefr(source.targetCefr)
        : EFFECTIVE_DEFAULTS.targetCefr,
      webPageEnabled: source.webPageEnabled !== false,
      domainRules:
        source.domainRules && typeof source.domainRules === 'object' ? source.domainRules : {},
      schemaVersion: Number(source.schemaVersion) || 2,
    };
  }

  function getRuntimeSettingsSyncController() {
    if (runtimeSettingsSyncController) {
      return runtimeSettingsSyncController;
    }

    if (
      !runtimeSettingsSyncRuntime ||
      typeof runtimeSettingsSyncRuntime.createRuntimeSettingsSyncController !== 'function'
    ) {
      throw new Error('Runtime settings synchronization runtime unavailable');
    }

    runtimeSettingsSyncController = runtimeSettingsSyncRuntime.createRuntimeSettingsSyncController({
      sharedSettings,
      runtimeSettingsKeys: RUNTIME_SETTINGS_KEYS,
      settingsStorageKeyV3: SETTINGS_STORAGE_KEY_V3,
      learningWordStatsStorageKey: LEARNING_WORD_STATS_STORAGE_KEY,
      reviewQueueStorageKey: REVIEW_QUEUE_STORAGE_KEY,
      learningSummaryStorageKey: LEARNING_SUMMARY_STORAGE_KEY,
      normalizeSettingsFallback,
      createTranslationRuntimeFingerprint,
      resolveSettingsFromV3(nextV3Raw) {
        if (
          sharedSettings &&
          typeof sharedSettings.normalizeSettingsV3 === 'function' &&
          typeof sharedSettings.resolveEffectiveRuntime === 'function'
        ) {
          const nextV3 = sharedSettings.normalizeSettingsV3(nextV3Raw);
          return sharedSettings.resolveEffectiveRuntime(nextV3, {
            hostname: globalThis.location && globalThis.location.hostname,
          });
        }
        return getRuntimeSettingsSyncController().buildRuntimeSettings(settings, nextV3Raw);
      },
      getCurrentSettings() {
        return settings;
      },
      setCurrentSettings(nextSettings) {
        settings = nextSettings;
      },
      bumpRenderGeneration() {
        renderGeneration += 1;
      },
      handleReviewDanmakuSpeedChange() {
        syncDanmakuSettings();
      },
      handleReviewDanmakuChange() {
        syncEngineWithPlayback();
      },
      handleTranslationSettingsChange() {
        clearTranslationCache();
        if (webTextReplacementController) {
          webTextReplacementController.clearPendingTimer();
        }
        invalidateRenderedSubtitles();
        observeSubtitleChanges();
        startTimelinePolling();
        scheduleProcess();
      },
      handleLearningStateChange() {
        if (hasMethod(globalThis.VocabularyModule, 'refreshLearningStateFromStorage')) {
          return globalThis.VocabularyModule.refreshLearningStateFromStorage().then(() => {
            clearTranslationCache();
            invalidateRenderedSubtitles();
            scheduleProcess();
          });
        }
        return null;
      },
      logError,
    });
    return runtimeSettingsSyncController;
  }

  function normalizeSettings(rawSettings) {
    return getRuntimeSettingsSyncController().normalizeSettings(rawSettings);
  }

  function buildRuntimeSettings(baseSettings, updates) {
    return getRuntimeSettingsSyncController().buildRuntimeSettings(baseSettings, updates);
  }

  function getWebTextReplacementController() {
    if (webTextReplacementController) {
      return webTextReplacementController;
    }

    if (
      !webTextReplacementRuntime ||
      typeof webTextReplacementRuntime.createWebTextReplacementController !== 'function'
    ) {
      throw new Error('Web text replacement runtime unavailable');
    }

    webTextReplacementController = webTextReplacementRuntime.createWebTextReplacementController({
      processIntervalMs: WEB_TEXT_PROCESS_INTERVAL,
      getSettings() {
        return settings;
      },
      getRenderGeneration() {
        return renderGeneration;
      },
      createCacheKey,
      readCache(cacheKey) {
        return translationCache.get(cacheKey);
      },
      writeCache(cacheKey, result) {
        translationCache.set(cacheKey, result);
      },
      translateText(text, runtimeSettings) {
        return SubtitleTranslator.processSubtitle(text, runtimeSettings);
      },
      renderToHtml(result, sourceText, runtimeSettings) {
        return renderWebTextReplacementHtml(result, sourceText, runtimeSettings);
      },
      normalizeText,
      isVideoSiteHost,
      scheduleProcess,
      logError,
      getDocument() {
        return globalThis.document;
      },
      getHostname() {
        return globalThis.location && globalThis.location.hostname;
      },
    });
    return webTextReplacementController;
  }

  function importOverlayModuleBundle() {
    if (
      typeof chrome === 'undefined' ||
      !chrome.runtime ||
      typeof chrome.runtime.getURL !== 'function'
    ) {
      return null;
    }

    return import(chrome.runtime.getURL('dist/overlay.js'));
  }

  function getOverlayLoaderController() {
    if (overlayLoaderController) {
      return overlayLoaderController;
    }

    if (!overlayLoaderRuntime || typeof overlayLoaderRuntime.createOverlayLoader !== 'function') {
      throw new Error('Overlay loader runtime unavailable');
    }

    overlayLoaderController = overlayLoaderRuntime.createOverlayLoader({
      shouldLoadForHost: shouldLoadOverlayModuleForHost,
      importOverlayModule: importOverlayModuleBundle,
      getHostname() {
        return globalThis.location && globalThis.location.hostname;
      },
      logError,
    });
    return overlayLoaderController;
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

  function applyStoredSettings(stored) {
    if (
      sharedSettings &&
      typeof sharedSettings.migrateToV3 === 'function' &&
      typeof sharedSettings.resolveEffectiveRuntime === 'function'
    ) {
      const nextV3 = sharedSettings.migrateToV3(stored);
      if (
        typeof chrome !== 'undefined' &&
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
      return settings;
    }

    settings = buildRuntimeSettings(EFFECTIVE_DEFAULTS, stored);
    return settings;
  }

  function getSettings() {
    return new Promise((resolve) => {
      const storageApi =
        typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local
          ? chrome.storage.local
          : null;
      if (!storageApi || typeof storageApi.get !== 'function') {
        resolve(applyStoredSettings(null));
        return;
      }

      try {
        storageApi.get(null, (stored) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            logError('Settings read failed', chrome.runtime.lastError);
            resolve(applyStoredSettings(null));
            return;
          }
          resolve(applyStoredSettings(stored));
        });
      } catch (error) {
        logError('Settings read failed', error);
        resolve(applyStoredSettings(null));
      }
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

  function createTranslationRuntimeFingerprint(runtimeSettings) {
    const normalized = normalizeSettings(runtimeSettings);
    const translationFingerprint = hasMethod(
      globalThis.SubtitleTranslator,
      'createSettingsFingerprint'
    )
      ? globalThis.SubtitleTranslator.createSettingsFingerprint(normalized)
      : [
          normalized.replaceRatio.toFixed(2),
          normalized.maxReplaceCount,
          normalized.targetCefr,
          normalized.vocabularyMode,
          normalized.examPreference,
          normalized.activeLevels.slice().sort().join(','),
        ].join('|');
    const mode = normalized.enabled ? 'enabled' : 'disabled';
    const pageMode = normalized.webPageEnabled ? 'page-on' : 'page-off';
    const siteMode = isCurrentSiteEnabled(normalized) ? 'site-on' : 'site-off';
    return `${mode}::${pageMode}::${siteMode}::${normalized.bilingualMode}::${translationFingerprint}`;
  }

  function createRenderSignature(text, runtimeSettings) {
    const normalizedText = normalizeText(text);
    if (!normalizedText) {
      return '';
    }

    return `${createTranslationRuntimeFingerprint(runtimeSettings)}::${normalizedText}`;
  }

  function classifyRuntimeSettingsChange(previousSettings, nextSettings) {
    return getRuntimeSettingsSyncController().classifyRuntimeSettingsChange(
      previousSettings,
      nextSettings
    );
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

    const renderedWordKeys = new Set();
    result.tokens.forEach((token) => {
      if (!token || token.type !== 'word') {
        return;
      }

      const word = String(token.word || '').trim();
      const wordKey = word.toLowerCase();
      if (!word || renderedWordKeys.has(wordKey)) {
        return;
      }

      renderedWordKeys.add(wordKey);
      globalThis.VocabularyModule.recordHit(word);
      if (hasMethod(globalThis.SubtitleTranslator, 'reportRenderedExposure')) {
        globalThis.SubtitleTranslator.reportRenderedExposure(word);
      }
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
    if (hasMethod(globalThis.DanmakuModule, 'setDensityPreset')) {
      globalThis.DanmakuModule.setDensityPreset(settings.reviewDanmakuDensity);
    }
    if (hasMethod(globalThis.SchedulerModule, 'setDensityPreset')) {
      globalThis.SchedulerModule.setDensityPreset(settings.reviewDanmakuDensity);
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
    queueSubtitleNavigationBroadcast();
    syncEngineWithPlayback();
  }

  function onVideoPauseOrEnd() {
    queueSubtitleNavigationBroadcast();
    syncEngineWithPlayback();
  }

  function onVideoTimeUpdate() {
    queueSubtitleNavigationBroadcast();
  }

  function onVideoSeeked() {
    queueSubtitleNavigationBroadcast();
    syncEngineWithPlayback();
  }

  function unbindVideoPlaybackEvents(video) {
    if (!(video instanceof HTMLVideoElement)) {
      return;
    }
    video.removeEventListener('play', onVideoPlay);
    video.removeEventListener('pause', onVideoPauseOrEnd);
    video.removeEventListener('ended', onVideoPauseOrEnd);
    video.removeEventListener('timeupdate', onVideoTimeUpdate);
    video.removeEventListener('seeked', onVideoSeeked);
    video.removeEventListener('loadedmetadata', onVideoSeeked);
  }

  function bindVideoPlaybackEvents() {
    const video = document.querySelector('video');
    if (!(video instanceof HTMLVideoElement)) {
      unbindVideoPlaybackEvents(boundVideo);
      boundVideo = null;
      queueSubtitleNavigationBroadcast();
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
    boundVideo.addEventListener('timeupdate', onVideoTimeUpdate);
    boundVideo.addEventListener('seeked', onVideoSeeked);
    boundVideo.addEventListener('loadedmetadata', onVideoSeeked);
    queueSubtitleNavigationBroadcast();
  }

  function syncEngineWithPlayback() {
    const playbackState = getPlaybackState();
    if (!settings.reviewDanmakuEnabled) {
      stopReviewEngine(true);
      return;
    }

    if (!playbackState.hasVideo || playbackState.ended) {
      logDebug(
        '[DanmakuReview] syncEngine: no video or ended, stopping. hasVideo:',
        playbackState.hasVideo,
        'ended:',
        playbackState.ended
      );
      stopReviewEngine(!playbackState.hasVideo);
      return;
    }

    if (!shouldRunReviewDanmaku(settings, playbackState)) {
      logDebug(
        '[DanmakuReview] syncEngine: paused. reviewDanmakuEnabled:',
        settings.reviewDanmakuEnabled,
        'hasVideo:',
        playbackState.hasVideo,
        'paused:',
        playbackState.paused,
        'ended:',
        playbackState.ended
      );
      pauseReviewEngine();
      return;
    }

    logDebug('[DanmakuReview] syncEngine: starting engine');
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
      if (hasMethod(SubtitleParser, 'loadSubtitleTimeline')) {
        await SubtitleParser.loadSubtitleTimeline().catch((error) => {
          logError('Subtitle timeline refresh failed', error);
          return [];
        });
      }
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

  async function processWebPageText() {
    await getWebTextReplacementController().processPageText();
  }

  function containsUnsafeContent(root) {
    if (
      !webTextReplacementRuntime ||
      typeof webTextReplacementRuntime.containsUnsafeContent !== 'function'
    ) {
      return true;
    }
    return webTextReplacementRuntime.containsUnsafeContent(root);
  }

  function shouldReplaceWebTextNode(result, sourceText) {
    if (
      !webTextReplacementRuntime ||
      typeof webTextReplacementRuntime.shouldReplaceWebTextNode !== 'function'
    ) {
      return false;
    }
    return webTextReplacementRuntime.shouldReplaceWebTextNode(result, sourceText, normalizeText);
  }

  function renderWebTextReplacementHtml(result, sourceText, runtimeSettings) {
    if (
      !webTextReplacementRuntime ||
      typeof webTextReplacementRuntime.renderWebTextReplacementHtml !== 'function'
    ) {
      return '';
    }
    return webTextReplacementRuntime.renderWebTextReplacementHtml(
      result,
      sourceText,
      runtimeSettings,
      {
        renderToHtml(nextResult, nextSourceText, nextSettings) {
          if (
            !globalThis.SubtitleRenderer ||
            typeof globalThis.SubtitleRenderer.renderToHtml !== 'function'
          ) {
            return '';
          }
          return globalThis.SubtitleRenderer.renderToHtml(nextResult, nextSourceText, nextSettings);
        },
      }
    );
  }

  function observeSubtitleChanges() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    observerTarget = null;
    lastMutationObserverRefreshAt = 0;

    const observeTarget = resolveSubtitleObserverTarget(settings);
    if (!observeTarget) {
      return;
    }
    observerTarget = observeTarget;

    observer = new MutationObserver(() => {
      const latestTarget = resolveSubtitleObserverTarget(settings);
      if (shouldRefreshSubtitleObserver(observerTarget, latestTarget)) {
        // Why: keep observer target aligned with SPA DOM changes (body <-> subtitle container).
        observeSubtitleChanges();
      }

      if (!shouldRunMutationObserverRefresh()) {
        return;
      }

      ensureRuntimeBindings();
      startTimelinePolling();
      queueSubtitleNavigationBroadcast();
      processAll().catch((error) => logError('Process failed', error));
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
      const latestTarget = resolveSubtitleObserverTarget(settings);
      if (shouldRefreshSubtitleObserver(observerTarget, latestTarget)) {
        observeSubtitleChanges();
      }
      ensureRuntimeBindings();
      queueSubtitleNavigationBroadcast();
      scheduleProcess();
    }, TIMELINE_POLL_MS);
  }

  function getSubtitleNavigationController() {
    if (subtitleNavigationController) {
      return subtitleNavigationController;
    }

    if (
      !subtitleNavigationControllerRuntime ||
      typeof subtitleNavigationControllerRuntime.createSubtitleNavigationController !== 'function'
    ) {
      throw new Error('Subtitle navigation controller runtime unavailable');
    }

    subtitleNavigationController =
      subtitleNavigationControllerRuntime.createSubtitleNavigationController({
        subtitleNavigation,
        overlayBridgeRuntime: overlaySubtitleNavigationBridgeRuntime,
        readMessageType: ACTIVE_TAB_SUBTITLE_NAVIGATION_READ,
        navigateMessageType: ACTIVE_TAB_SUBTITLE_NAVIGATION_NAVIGATE,
        subscribeMessageType: ACTIVE_TAB_SUBTITLE_NAVIGATION_SUBSCRIBE,
        bridgeKey: OVERLAY_SUBTITLE_NAVIGATION_BRIDGE_KEY,
        getHostname() {
          return String((globalThis.location && globalThis.location.hostname) || '');
        },
        getVideo() {
          return document.querySelector('video');
        },
        getVideoKey() {
          if (hasMethod(globalThis.SubtitleParser, 'getCurrentSubtitleTimelineCacheKey')) {
            return globalThis.SubtitleParser.getCurrentSubtitleTimelineCacheKey();
          }
          return '';
        },
        loadTimeline() {
          if (hasMethod(globalThis.SubtitleParser, 'loadSubtitleTimeline')) {
            return globalThis.SubtitleParser.loadSubtitleTimeline();
          }
          return [];
        },
        isSupportedHostFallback(hostname) {
          return Boolean(
            globalThis.SubtitleParser &&
            typeof globalThis.SubtitleParser.isBilibiliHost === 'function' &&
            globalThis.SubtitleParser.isBilibiliHost(hostname)
          );
        },
        logError,
      });
    return subtitleNavigationController;
  }

  function normalizeSubtitleNavigationAction(value) {
    return getSubtitleNavigationController().normalizeSubtitleNavigationAction(value);
  }

  function findSubtitleNavigationIndices(timeline, currentTime) {
    return getSubtitleNavigationController().findSubtitleNavigationIndices(timeline, currentTime);
  }

  function buildSubtitleNavigationSnapshot(timeline, currentTime) {
    return getSubtitleNavigationController().buildSubtitleNavigationSnapshot(timeline, currentTime);
  }

  function createSubtitleNavigationSnapshotSignature(snapshot) {
    return getSubtitleNavigationController().createSubtitleNavigationSnapshotSignature(snapshot);
  }

  function createOverlaySubtitleNavigationSignature(payload) {
    return getSubtitleNavigationController().createOverlaySubtitleNavigationSignature(payload);
  }

  function isSubtitleNavigationStreamPort(port) {
    return getSubtitleNavigationController().isSubtitleNavigationStreamPort(port);
  }

  function queueSubtitleNavigationBroadcast() {
    getSubtitleNavigationController().queueSubtitleNavigationBroadcast();
  }

  function readOverlaySubtitleNavigationPayload() {
    return getSubtitleNavigationController().readOverlaySubtitleNavigationPayload();
  }

  async function refreshOverlaySubtitleNavigation() {
    return getSubtitleNavigationController().refreshOverlaySubtitleNavigation();
  }

  function subscribeOverlaySubtitleNavigation(listener) {
    return getSubtitleNavigationController().subscribeOverlaySubtitleNavigation(listener);
  }

  function ensureOverlaySubtitleNavigationBridge() {
    getSubtitleNavigationController().ensureOverlaySubtitleNavigationBridge(globalThis);
  }

  function watchRuntimePorts() {
    getSubtitleNavigationController().watchRuntimePorts(
      typeof chrome !== 'undefined' ? chrome.runtime : null
    );
  }

  function watchRuntimeMessages() {
    getSubtitleNavigationController().watchRuntimeMessages(
      typeof chrome !== 'undefined' ? chrome.runtime : null
    );
  }

  function hasRuntimeSettingsChange(changes) {
    return getRuntimeSettingsSyncController().hasRuntimeSettingsChange(changes);
  }

  function watchStorageChanges() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) {
      return;
    }
    getRuntimeSettingsSyncController().watchStorageChanges(chrome.storage);
  }

  async function loadOverlayModule() {
    return getOverlayLoaderController().load();
  }

  async function init() {
    const overlayModule = await loadOverlayModule();
    if (
      !globalThis.SubtitleParser ||
      !globalThis.SubtitleTranslator ||
      !globalThis.VocabularyModule ||
      !globalThis.SubtitleRenderer ||
      !globalThis.TooltipModule
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
    if (overlayModule) {
      try {
        overlayModule.mountOverlayPanel();
      } catch (error) {
        logError('Overlay module mount failed', error);
      }
    }
    ensureRuntimeBindings();
    watchStorageChanges();
    observeSubtitleChanges();
    startTimelinePolling();
    scheduleProcess();

    logDebug('[BiliVocab] Running with settings:', settings);
  }

  ensureOverlaySubtitleNavigationBridge();

  if (document.readyState === 'loading') {
    watchRuntimePorts();
    watchRuntimeMessages();
    document.addEventListener('DOMContentLoaded', () => {
      init().catch((error) => logError('Initialization failed', error));
    });
  } else {
    watchRuntimePorts();
    watchRuntimeMessages();
    init().catch((error) => logError('Initialization failed', error));
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      TRANSLATION_SETTINGS_KEYS,
      buildRuntimeSettings,
      classifyRuntimeSettingsChange,
      createRenderSignature,
      createHitTrackingSignature,
      hasRuntimeSettingsChange,
      isRenderUpToDate,
      shouldRunReviewDanmaku,
      getPlaybackState,
      watchStorageChanges,
      bindVideoPlaybackEvents,
      resetHitTrackingIfSourceChanged,
      recordRenderedHits,
      loadOverlayModule,
      init,
      applyTranslation,
      processSubtitles,
      processAll,
      runInAnimationFrame,
      isVideoSiteHost,
      shouldLoadOverlayModuleForHost,
      shouldEnableTimelinePolling,
      shouldObserveDomMutations,
      shouldRetargetSubtitleObserver,
      shouldRefreshSubtitleObserver,
      shouldRestoreWebItems,
      shouldRunLegacyWebTextPipeline,
      shouldReplaceWebTextNode,
      renderWebTextReplacementHtml,
      containsUnsafeContent,
      normalizeSubtitleNavigationAction,
      findSubtitleNavigationIndices,
      buildSubtitleNavigationSnapshot,
      createSubtitleNavigationSnapshotSignature,
      createOverlaySubtitleNavigationSignature,
      isSubtitleNavigationStreamPort,
      readOverlaySubtitleNavigationPayload,
      refreshOverlaySubtitleNavigation,
      subscribeOverlaySubtitleNavigation,
      __readFromCacheForTest: readFromCache,
      __writeToCacheForTest: writeToCache,
      __clearTranslationCacheForTest: clearTranslationCache,
      __resetOverlayModuleStateForTest() {
        if (overlayLoaderController) {
          overlayLoaderController.reset();
        }
        overlayLoaderController = null;
      },
    };
  }
})();
