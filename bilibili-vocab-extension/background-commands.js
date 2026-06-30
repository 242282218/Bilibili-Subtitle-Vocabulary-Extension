(function (globalScope) {
  // Dependencies are loaded by background.js importScripts before this module.
  // In Node tests, require() provides the same modules.

  const sharedSettings =
    globalScope.SharedSettings ||
    (typeof require === 'function' ? require('./sharedSettings.js') : null);
  const backgroundSettings =
    globalScope.BackgroundSettings ||
    (typeof require === 'function' ? require('./background-settings.js') : null);
  const backgroundStorage =
    globalScope.BackgroundStorage ||
    (typeof require === 'function' ? require('./background-storage.js') : null);
  const backgroundMessageHandler =
    globalScope.BackgroundMessageHandler ||
    (typeof require === 'function' ? require('./background-message-handler.js') : null);

  const DEFAULT_SETTINGS = backgroundSettings && backgroundSettings.DEFAULT_SETTINGS;
  const getStoragePayload = backgroundStorage && backgroundStorage.getStoragePayload;
  const normalizeCommandSettings =
    backgroundSettings && backgroundSettings.normalizeCommandSettings;
  const isSettingsV3Shape = backgroundSettings && backgroundSettings.isSettingsV3Shape;
  const patchActiveProfileConfig =
    backgroundSettings && backgroundSettings.patchActiveProfileConfig;
  const clampRatio = backgroundSettings && backgroundSettings.clampRatio;
  const enqueueSharedStateMutation =
    backgroundMessageHandler && backgroundMessageHandler.enqueueSharedStateMutation;
  const commitSettingsPayload =
    backgroundMessageHandler && backgroundMessageHandler.commitSettingsPayload;

  function applyCommandSettingsMutation(settings, command) {
    if (!isSettingsV3Shape(settings)) {
      return null;
    }

    switch (command) {
      case 'toggle-enabled':
        return patchActiveProfileConfig(settings, (config) => ({
          ...config,
          enabled: config.enabled !== true,
        }));

      case 'toggle-overlay': {
        const currentHidden =
          settings.globalControls.overlayState &&
          settings.globalControls.overlayState.hidden === true;
        return sharedSettings && typeof sharedSettings.normalizeSettingsV3 === 'function'
          ? sharedSettings.normalizeSettingsV3({
              ...settings,
              globalControls: {
                ...settings.globalControls,
                overlayState: {
                  ...settings.globalControls.overlayState,
                  hidden: !currentHidden,
                },
              },
            })
          : settings;
      }

      case 'increase-ratio':
        return patchActiveProfileConfig(settings, (config) => ({
          ...config,
          replaceRatio: clampRatio(
            (Number(config.replaceRatio) || DEFAULT_SETTINGS.replaceRatio) + 0.05
          ),
        }));

      case 'decrease-ratio':
        return patchActiveProfileConfig(settings, (config) => ({
          ...config,
          replaceRatio: clampRatio(
            (Number(config.replaceRatio) || DEFAULT_SETTINGS.replaceRatio) - 0.05
          ),
        }));

      default:
        return null;
    }
  }

  function commitCommandSettings(command) {
    return enqueueSharedStateMutation(async () => {
      const storage = await getStoragePayload(null);
      const currentSettings = normalizeCommandSettings(storage);
      const nextSettings = applyCommandSettingsMutation(currentSettings, command);
      if (!nextSettings) {
        return null;
      }

      return commitSettingsPayload({
        settings: nextSettings,
        markManualOverride: true,
        now: Date.now(),
      });
    });
  }

  const api = {
    applyCommandSettingsMutation,
    commitCommandSettings,
  };

  globalScope.BackgroundCommands = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
