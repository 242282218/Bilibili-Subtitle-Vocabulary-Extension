(function (globalScope) {
  const LEVELS = ["CET4", "CET6", "KAOYAN", "IELTS", "TOEFL"];
  const REVIEW_DANMAKU_SPEED_PRESETS = ["slow", "normal", "fast"];

  const DEFAULT_SETTINGS = {
    enabled: true,
    reviewDanmakuEnabled: false,
    reviewDanmakuSpeed: "normal",
    activeLevels: LEVELS.slice(),
    replaceRatio: 0.2,
    maxReplaceCount: 2,
    targetCefr: "B2"
  };
  const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

  function clampRatio(value) {
    const ratio = Number(value);
    if (!Number.isFinite(ratio)) {
      return DEFAULT_SETTINGS.replaceRatio;
    }
    return Math.min(0.3, Math.max(0.1, Number(ratio.toFixed(2))));
  }

  function clampMaxReplaceCount(value) {
    const count = Number(value);
    if (!Number.isFinite(count)) {
      return DEFAULT_SETTINGS.maxReplaceCount;
    }
    return Math.min(5, Math.max(1, Math.floor(count)));
  }

  function normalizeLevel(level) {
    const normalized = String(level || "").trim().toUpperCase();
    if (!LEVELS.includes(normalized)) {
      return "";
    }
    return normalized;
  }

  function normalizeActiveLevels(levels) {
    if (!Array.isArray(levels)) {
      return [];
    }

    const uniqueLevels = [];
    levels.forEach((level) => {
      const normalized = normalizeLevel(level);
      if (!normalized || uniqueLevels.includes(normalized)) {
        return;
      }
      uniqueLevels.push(normalized);
    });

    return uniqueLevels;
  }

  function normalizeReviewDanmakuSpeed(speed) {
    const normalized = String(speed || DEFAULT_SETTINGS.reviewDanmakuSpeed).trim().toLowerCase();
    return REVIEW_DANMAKU_SPEED_PRESETS.includes(normalized) ? normalized : DEFAULT_SETTINGS.reviewDanmakuSpeed;
  }

  function normalizeStoredSettings(storedSettings) {
    const stored = storedSettings || {};
    const activeLevels = normalizeActiveLevels(stored.activeLevels);

    let migratedLevels = activeLevels;
    if (migratedLevels.length === 0) {
      const legacyLevel = normalizeLevel(stored.level);
      migratedLevels = legacyLevel ? [legacyLevel] : LEVELS.slice();
    }

    const targetCefr = String(stored.targetCefr || DEFAULT_SETTINGS.targetCefr).trim().toUpperCase();

    return {
      enabled: stored.enabled !== false,
      reviewDanmakuEnabled: stored.reviewDanmakuEnabled === true,
      reviewDanmakuSpeed: normalizeReviewDanmakuSpeed(stored.reviewDanmakuSpeed),
      activeLevels: migratedLevels,
      replaceRatio: clampRatio(stored.replaceRatio),
      maxReplaceCount: clampMaxReplaceCount(stored.maxReplaceCount),
      targetCefr: CEFR_LEVELS.includes(targetCefr) ? targetCefr : DEFAULT_SETTINGS.targetCefr
    };
  }

  function ensureDefaultSettings() {
    if (
      typeof chrome === "undefined" ||
      !chrome.storage ||
      !chrome.storage.local ||
      typeof chrome.storage.local.get !== "function"
    ) {
      return;
    }

    chrome.storage.local.get(null, (storedSettings) => {
      const normalized = normalizeStoredSettings(storedSettings);
      chrome.storage.local.set(normalized, () => {
        if (typeof chrome.storage.local.remove === "function") {
          chrome.storage.local.remove(["level", "testDanmakuMode"]);
        }
      });
    });
  }

  if (typeof chrome !== "undefined" && chrome.runtime) {
    chrome.runtime.onInstalled.addListener(() => {
      ensureDefaultSettings();
    });

    chrome.runtime.onStartup.addListener(() => {
      ensureDefaultSettings();
    });
  }

  const api = {
    LEVELS,
    REVIEW_DANMAKU_SPEED_PRESETS,
    DEFAULT_SETTINGS,
    normalizeReviewDanmakuSpeed,
    normalizeStoredSettings,
    ensureDefaultSettings
  };

  globalScope.BackgroundModule = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
