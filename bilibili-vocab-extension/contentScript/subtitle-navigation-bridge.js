(function () {
  const isCommonJsRuntime = typeof module !== 'undefined' && module.exports;

  function createSubtitleNavigationBridge(deps) {
    const { getSubtitleNavigationController, logError } = deps;

    function normalizeSubtitleNavigationAction(value) {
      return getSubtitleNavigationController().normalizeSubtitleNavigationAction(value);
    }

    function findSubtitleNavigationIndices(timeline, currentTime) {
      return getSubtitleNavigationController().findSubtitleNavigationIndices(timeline, currentTime);
    }

    function buildSubtitleNavigationSnapshot(timeline, currentTime) {
      return getSubtitleNavigationController().buildSubtitleNavigationSnapshot(
        timeline,
        currentTime
      );
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

    return {
      normalizeSubtitleNavigationAction,
      findSubtitleNavigationIndices,
      buildSubtitleNavigationSnapshot,
      createSubtitleNavigationSnapshotSignature,
      createOverlaySubtitleNavigationSignature,
      isSubtitleNavigationStreamPort,
      queueSubtitleNavigationBroadcast,
      readOverlaySubtitleNavigationPayload,
      refreshOverlaySubtitleNavigation,
      subscribeOverlaySubtitleNavigation,
      ensureOverlaySubtitleNavigationBridge,
    };
  }

  globalThis.BiliVocabSubtitleNavigationBridge = { createSubtitleNavigationBridge };

  if (isCommonJsRuntime) {
    module.exports = { createSubtitleNavigationBridge };
  }
})();
