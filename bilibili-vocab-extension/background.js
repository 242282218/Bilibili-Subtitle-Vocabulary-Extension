(function (globalScope) {
  const LEVELS = ["CET4", "CET6", "KAOYAN", "IELTS", "TOEFL"];
  const REVIEW_DANMAKU_SPEED_PRESETS = ["slow", "normal", "fast"];
  if (typeof importScripts === "function") {
    try {
      importScripts("sharedSettings.js");
    } catch (error) {
      // Ignore contexts that do not support importScripts.
    }
  }
  const sharedSettings = globalScope.SharedSettings || (typeof require === "function" ? require("./sharedSettings.js") : null);
  const SETTINGS_STORAGE_KEY_V3 = sharedSettings && sharedSettings.SETTINGS_STORAGE_KEY_V3
    ? sharedSettings.SETTINGS_STORAGE_KEY_V3
    : "bili_vocab_settings_v3";

  const OVERLAY_PANEL_DEFAULT_WIDTH = 420;
  const OVERLAY_PANEL_DEFAULT_HEIGHT = 640;
  const OVERLAY_PANEL_DEFAULT_OFFSET_RIGHT = 24;
  const OVERLAY_PANEL_DEFAULT_OFFSET_BOTTOM = 96;
  const OVERLAY_PANEL_MIN_WIDTH = 320;
  const OVERLAY_PANEL_MAX_WIDTH = 560;
  const OVERLAY_PANEL_MIN_HEIGHT = 360;
  const OVERLAY_PANEL_MAX_HEIGHT = 760;
  const OVERLAY_PANEL_MIN_OFFSET_RIGHT = 12;
  const OVERLAY_PANEL_MAX_OFFSET_RIGHT = 360;
  const OVERLAY_PANEL_MIN_OFFSET_BOTTOM = 24;
  const OVERLAY_PANEL_MAX_OFFSET_BOTTOM = 240;

  const DEFAULT_SETTINGS = {
    enabled: true,
    schemaVersion: 2,
    reviewDanmakuEnabled: false,
    reviewDanmakuSpeed: "normal",
    webPageEnabled: true,
    domainRules: {},
    vocabularyMode: "core",
    examPreference: "balanced",
    activeLevels: LEVELS.slice(),
    replaceRatio: 0.2,
    maxReplaceCount: 2,
    targetCefr: "B2",
    overlayPanelHidden: false,
    overlayPanelCollapsed: false,
    overlayPanelWidth: OVERLAY_PANEL_DEFAULT_WIDTH,
    overlayPanelHeight: OVERLAY_PANEL_DEFAULT_HEIGHT,
    overlayPanelOffsetRight: OVERLAY_PANEL_DEFAULT_OFFSET_RIGHT,
    overlayPanelOffsetBottom: OVERLAY_PANEL_DEFAULT_OFFSET_BOTTOM
  };

  if (sharedSettings) {
    Object.assign(DEFAULT_SETTINGS, sharedSettings.DEFAULT_SETTINGS);
  }
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
    if (sharedSettings) {
      return sharedSettings.normalizeReviewDanmakuSpeed(speed);
    }

    const normalized = String(speed || DEFAULT_SETTINGS.reviewDanmakuSpeed).trim().toLowerCase();
    return REVIEW_DANMAKU_SPEED_PRESETS.includes(normalized) ? normalized : DEFAULT_SETTINGS.reviewDanmakuSpeed;
  }

  function clampOverlayPanelWidth(value) {
    const width = Number(value);
    if (!Number.isFinite(width)) {
      return OVERLAY_PANEL_DEFAULT_WIDTH;
    }
    return Math.min(OVERLAY_PANEL_MAX_WIDTH, Math.max(OVERLAY_PANEL_MIN_WIDTH, Math.round(width)));
  }

  function clampOverlayPanelHeight(value) {
    const height = Number(value);
    if (!Number.isFinite(height)) {
      return OVERLAY_PANEL_DEFAULT_HEIGHT;
    }
    return Math.min(OVERLAY_PANEL_MAX_HEIGHT, Math.max(OVERLAY_PANEL_MIN_HEIGHT, Math.round(height)));
  }

  function clampOverlayPanelOffsetRight(value) {
    const offset = Number(value);
    if (!Number.isFinite(offset)) {
      return OVERLAY_PANEL_DEFAULT_OFFSET_RIGHT;
    }
    return Math.min(OVERLAY_PANEL_MAX_OFFSET_RIGHT, Math.max(OVERLAY_PANEL_MIN_OFFSET_RIGHT, Math.round(offset)));
  }

  function clampOverlayPanelOffsetBottom(value) {
    const offset = Number(value);
    if (!Number.isFinite(offset)) {
      return OVERLAY_PANEL_DEFAULT_OFFSET_BOTTOM;
    }
    return Math.min(OVERLAY_PANEL_MAX_OFFSET_BOTTOM, Math.max(OVERLAY_PANEL_MIN_OFFSET_BOTTOM, Math.round(offset)));
  }

  function buildNormalizedBaseSettings(stored, activeLevels) {
    const payload = {
      ...(stored || {}),
      activeLevels
    };

    if (sharedSettings && typeof sharedSettings.buildSettingsPayload === "function") {
      return sharedSettings.buildSettingsPayload(DEFAULT_SETTINGS, payload);
    }

    if (sharedSettings) {
      return sharedSettings.normalizeSettings(payload);
    }

    return {
      enabled: stored.enabled !== false,
      reviewDanmakuEnabled: stored.reviewDanmakuEnabled === true,
      reviewDanmakuSpeed: normalizeReviewDanmakuSpeed(stored.reviewDanmakuSpeed),
      vocabularyMode: DEFAULT_SETTINGS.vocabularyMode,
      examPreference: DEFAULT_SETTINGS.examPreference,
      webPageEnabled: stored.webPageEnabled !== false,
      domainRules: {},
      schemaVersion: 2,
      activeLevels,
      replaceRatio: clampRatio(stored.replaceRatio),
      maxReplaceCount: clampMaxReplaceCount(stored.maxReplaceCount),
      targetCefr: CEFR_LEVELS.includes(String(stored.targetCefr || DEFAULT_SETTINGS.targetCefr).trim().toUpperCase())
        ? String(stored.targetCefr || DEFAULT_SETTINGS.targetCefr).trim().toUpperCase()
        : DEFAULT_SETTINGS.targetCefr
    };
  }

  function normalizeStoredSettings(storedSettings) {
    const stored = storedSettings || {};
    const activeLevels = normalizeActiveLevels(stored.activeLevels);
    let migratedLevels = activeLevels;
    if (migratedLevels.length === 0) {
      const legacyLevel = normalizeLevel(stored.level);
      migratedLevels = legacyLevel ? [legacyLevel] : LEVELS.slice();
    }

    const normalizedBase = buildNormalizedBaseSettings(stored, migratedLevels);

    return {
      ...normalizedBase,
      overlayPanelHidden: stored.overlayPanelHidden === true,
      overlayPanelCollapsed: stored.overlayPanelCollapsed === true,
      overlayPanelWidth: clampOverlayPanelWidth(stored.overlayPanelWidth),
      overlayPanelHeight: clampOverlayPanelHeight(stored.overlayPanelHeight),
      overlayPanelOffsetRight: clampOverlayPanelOffsetRight(stored.overlayPanelOffsetRight),
      overlayPanelOffsetBottom: clampOverlayPanelOffsetBottom(stored.overlayPanelOffsetBottom)
    };
  }

  function normalizeCommandSettings(storagePayload) {
    if (sharedSettings && typeof sharedSettings.migrateToV3 === "function") {
      const migrated = sharedSettings.migrateToV3(storagePayload || {});
      if (typeof sharedSettings.normalizeSettingsV3 === "function") {
        return sharedSettings.normalizeSettingsV3(migrated);
      }
      return migrated;
    }

    return normalizeStoredSettings(storagePayload || {});
  }

  function isSettingsV3Shape(settings) {
    return Boolean(
      settings &&
      typeof settings === "object" &&
      settings.globalControls &&
      typeof settings.globalControls === "object" &&
      settings.profilesBuiltin &&
      typeof settings.profilesBuiltin === "object"
    );
  }

  function patchActiveProfileConfig(settingsV3, patcher) {
    if (!isSettingsV3Shape(settingsV3) || typeof patcher !== "function") {
      return settingsV3;
    }

    const normalizeV3 = sharedSettings && typeof sharedSettings.normalizeSettingsV3 === "function"
      ? sharedSettings.normalizeSettingsV3
      : (value) => value;
    const normalized = normalizeV3(settingsV3);
    const profileId = String(normalized.activeProfileId || "balanced").trim();
    const builtinIds = Array.isArray(sharedSettings && sharedSettings.BUILTIN_PROFILE_IDS)
      ? sharedSettings.BUILTIN_PROFILE_IDS
      : ["gentle", "balanced", "intensive"];

    if (builtinIds.includes(profileId)) {
      const currentConfig = normalized.profilesBuiltin[profileId] || normalized.profilesBuiltin.balanced;
      const nextConfig = patcher({ ...currentConfig });
      return normalizeV3({
        ...normalized,
        profilesBuiltin: {
          ...normalized.profilesBuiltin,
          [profileId]: {
            ...currentConfig,
            ...(nextConfig && typeof nextConfig === "object" ? nextConfig : {})
          }
        }
      });
    }

    const customProfiles = Array.isArray(normalized.profilesCustom) ? normalized.profilesCustom : [];
    const targetIndex = customProfiles.findIndex((item) => item && item.id === profileId);
    if (targetIndex < 0) {
      return normalized;
    }

    const targetProfile = customProfiles[targetIndex];
    const currentConfig = targetProfile && targetProfile.config && typeof targetProfile.config === "object"
      ? targetProfile.config
      : {};
    const nextConfig = patcher({ ...currentConfig });
    const nextProfiles = customProfiles.slice();
    nextProfiles[targetIndex] = {
      ...targetProfile,
      config: {
        ...currentConfig,
        ...(nextConfig && typeof nextConfig === "object" ? nextConfig : {})
      },
      updatedAt: Date.now()
    };

    return normalizeV3({
      ...normalized,
      profilesCustom: nextProfiles
    });
  }

  function getChromeRuntimeError() {
    if (
      typeof chrome === "undefined" ||
      !chrome.runtime ||
      !chrome.runtime.lastError
    ) {
      return null;
    }

    const message = String(chrome.runtime.lastError.message || "").trim();
    return new Error(message || "Chrome runtime error");
  }

  function logBackgroundError(context, error) {
    if (typeof console === "undefined" || typeof console.error !== "function") {
      return;
    }

    console.error(`[BiliVocab] ${context}:`, error);
  }

  function setStoragePayload(payload) {
    return new Promise((resolve, reject) => {
      if (
        typeof chrome === "undefined" ||
        !chrome.storage ||
        !chrome.storage.local ||
        typeof chrome.storage.local.set !== "function"
      ) {
        reject(new Error("chrome.storage.local.set unavailable"));
        return;
      }

      chrome.storage.local.set(payload, () => {
        const runtimeError = getChromeRuntimeError();
        if (runtimeError) {
          reject(runtimeError);
          return;
        }
        resolve();
      });
    });
  }

  function safeSendSettingsUpdated(tabId, settings) {
    if (
      typeof chrome === "undefined" ||
      !chrome.tabs ||
      typeof chrome.tabs.sendMessage !== "function"
    ) {
      return;
    }

    try {
      const result = chrome.tabs.sendMessage(tabId, {
        type: "SETTINGS_UPDATED",
        payload: settings
      });
      if (result && typeof result.catch === "function") {
        result.catch(() => {});
      }
    } catch (_error) {
      // Ignore tabs that cannot receive extension messages.
    }
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
      const normalizedLegacy = normalizeStoredSettings(storedSettings);
      const settingsV3 = sharedSettings && typeof sharedSettings.migrateToV3 === "function"
        ? sharedSettings.migrateToV3(storedSettings)
        : null;
      const nextPayload = settingsV3
        ? {
          [SETTINGS_STORAGE_KEY_V3]: settingsV3
        }
        : normalizedLegacy;

      setStoragePayload(nextPayload).then(() => {
        if (typeof chrome.storage.local.remove === "function") {
          const removableKeys = ["level", "testDanmakuMode"];
          if (Array.isArray(sharedSettings && sharedSettings.SETTINGS_STORAGE_KEYS)) {
            removableKeys.push(...sharedSettings.SETTINGS_STORAGE_KEYS);
          }
          chrome.storage.local.remove(Array.from(new Set(removableKeys)));
        }
      }).catch((error) => {
        logBackgroundError("Failed to initialize settings", error);
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

    // 快捷键命令处理
    if (chrome.commands && typeof chrome.commands.onCommand.addListener === "function") {
      chrome.commands.onCommand.addListener(async (command) => {
        if (!chrome.storage || !chrome.storage.local) return;

        // 读取当前设置
        const storage = await new Promise((resolve) => {
          chrome.storage.local.get(null, (payload) => resolve(payload));
        });

        let settings = normalizeCommandSettings(storage);
        const isV3 = isSettingsV3Shape(settings);
        let updated = false;

        switch (command) {
          case "toggle-enabled":
            if (isV3) {
              settings = patchActiveProfileConfig(settings, (config) => ({
                ...config,
                enabled: config.enabled !== true
              }));
              updated = true;
            }
            break;

          case "toggle-overlay":
            if (isV3) {
              const currentHidden = settings.globalControls.overlayState && settings.globalControls.overlayState.hidden === true;
              settings = (sharedSettings && typeof sharedSettings.normalizeSettingsV3 === "function"
                ? sharedSettings.normalizeSettingsV3({
                  ...settings,
                  globalControls: {
                    ...settings.globalControls,
                    overlayState: {
                      ...settings.globalControls.overlayState,
                      hidden: !currentHidden
                    }
                  }
                })
                : settings
              );
              updated = true;
            }
            break;

          case "increase-ratio":
            if (isV3) {
              settings = patchActiveProfileConfig(settings, (config) => ({
                ...config,
                replaceRatio: clampRatio((Number(config.replaceRatio) || DEFAULT_SETTINGS.replaceRatio) + 0.05)
              }));
              updated = true;
            }
            break;

          case "decrease-ratio":
            if (isV3) {
              settings = patchActiveProfileConfig(settings, (config) => ({
                ...config,
                replaceRatio: clampRatio((Number(config.replaceRatio) || DEFAULT_SETTINGS.replaceRatio) - 0.05)
              }));
              updated = true;
            }
            break;
        }

        if (updated) {
          try {
            await setStoragePayload({ [SETTINGS_STORAGE_KEY_V3]: settings });
          } catch (error) {
            logBackgroundError("Failed to persist command settings", error);
            return;
          }

          if (!chrome.tabs || typeof chrome.tabs.query !== "function") {
            return;
          }

          // 通知所有标签页设置已更新
          chrome.tabs.query({}, (tabs) => {
            tabs.forEach((tab) => {
              if (tab.id && tab.url && (tab.url.startsWith("http://") || tab.url.startsWith("https://"))) {
                safeSendSettingsUpdated(tab.id, settings);
              }
            });
          });
        }
      });
    }
  }

  const api = {
    LEVELS,
    REVIEW_DANMAKU_SPEED_PRESETS,
    DEFAULT_SETTINGS,
    normalizeReviewDanmakuSpeed: sharedSettings ? sharedSettings.normalizeReviewDanmakuSpeed : normalizeReviewDanmakuSpeed,
    normalizeStoredSettings,
    ensureDefaultSettings,
    clampOverlayPanelWidth,
    clampOverlayPanelHeight,
    clampOverlayPanelOffsetRight,
    clampOverlayPanelOffsetBottom
  };

  globalScope.BackgroundModule = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
