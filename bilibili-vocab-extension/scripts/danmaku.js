(function (globalScope) {
  const DANMAKU_CONTAINER_ID = "bili-vocab-danmaku-layer";
  const DANMAKU_ITEM_CLASS = "bili-vocab-danmaku-item";
  const DANMAKU_ITEM_ASSOCIATED_CLASS = "bili-vocab-danmaku-item-associated";
  const PRIMARY_HOST_SELECTOR = ".bpx-player-video-wrap";
  const MAX_ONSCREEN_COUNT = 15;
  const TRACK_COUNT = 10;
  const SPEED_PRESET_TO_DURATION = {
    slow: 9200,
    normal: 7600,
    fast: 6200
  };

  let container = null;
  let hostObserver = null;
  let activeCount = 0;
  let speedPreset = "normal";
  const trackUsage = new Array(TRACK_COUNT).fill(null);

  function createContainerNode() {
    const node = document.createElement("div");
    node.id = DANMAKU_CONTAINER_ID;
    node.style.pointerEvents = "none";
    node.style.zIndex = "999";
    node.style.overflow = "hidden";
    node.style.position = "absolute";
    node.style.top = "0";
    node.style.left = "0";
    node.style.width = "100%";
    node.style.height = "100%";
    return node;
  }

  function getHostContainer() {
    const primary = document.querySelector(PRIMARY_HOST_SELECTOR);
    if (primary instanceof HTMLElement) {
      return primary;
    }

    const video = document.querySelector("video");
    if (video instanceof HTMLVideoElement && video.parentElement instanceof HTMLElement) {
      return video.parentElement;
    }

    return null;
  }

  function ensureHostLayout(host) {
    const style = globalScope.getComputedStyle(host);
    if (style.position === "static") {
      host.style.position = "relative";
    }
  }

  function mountContainer(host) {
    if (!(host instanceof HTMLElement)) {
      return null;
    }

    ensureHostLayout(host);

    const existing = host.querySelector(`#${DANMAKU_CONTAINER_ID}`);
    if (existing instanceof HTMLElement) {
      container = existing;
      return container;
    }

    container = createContainerNode();
    host.appendChild(container);
    return container;
  }

  function stopHostObserver() {
    if (!hostObserver) {
      return;
    }

    hostObserver.disconnect();
    hostObserver = null;
  }

  function initDanmakuContainer() {
    const host = getHostContainer();
    if (host) {
      stopHostObserver();
      return mountContainer(host);
    }

    if (hostObserver) {
      return null;
    }

    hostObserver = new MutationObserver(() => {
      const latestHost = getHostContainer();
      if (!latestHost) {
        return;
      }

      mountContainer(latestHost);
      stopHostObserver();
    });

    hostObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    return null;
  }

  function pickTrackIndex(now) {
    const available = [];

    for (let index = 0; index < TRACK_COUNT; index += 1) {
      if (trackUsage[index] === null) {
        available.push(index);
      }
    }

    if (available.length === 0) {
      return null;
    }

    const randomIndex = Math.floor(Math.random() * available.length);
    return available[randomIndex];
  }

  function normalizeSpeedPreset(value) {
    const normalized = String(value || "normal").trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(SPEED_PRESET_TO_DURATION, normalized) ? normalized : "normal";
  }

  function getFlyDurationMs() {
    return SPEED_PRESET_TO_DURATION[speedPreset];
  }

  function setSpeedPreset(nextSpeedPreset) {
    speedPreset = normalizeSpeedPreset(nextSpeedPreset);
    return speedPreset;
  }

  function formatDanmakuText(wordObj, isAssociated) {
    const word = String(wordObj && wordObj.word ? wordObj.word : "").trim();
    const translation = String(
      (wordObj && (wordObj.translation || wordObj.meaning)) || ""
    ).trim();

    if (!word && !translation) {
      return "";
    }

    const main = translation ? `${word} · ${translation}` : word;
    if (!isAssociated) {
      return main;
    }

    return `${main} · 关联`;
  }

  function cleanupNode(node, fallbackTimer, trackIndex) {
    if (fallbackTimer) {
      clearTimeout(fallbackTimer);
    }

    if (typeof trackIndex === "number" && trackUsage[trackIndex] === node) {
      trackUsage[trackIndex] = null;
    }

    if (node && node.parentElement) {
      node.parentElement.removeChild(node);
    }

    activeCount = Math.max(0, activeCount - 1);
  }

  function shootWordDanmaku(wordObj, isAssociated) {
    const root = initDanmakuContainer();
    if (!(root instanceof HTMLElement)) {
      return false;
    }

    if (activeCount >= MAX_ONSCREEN_COUNT) {
      return false;
    }

    const text = formatDanmakuText(wordObj, Boolean(isAssociated));
    if (!text) {
      return false;
    }

    const node = document.createElement("div");
    node.className = `${DANMAKU_ITEM_CLASS}${isAssociated ? ` ${DANMAKU_ITEM_ASSOCIATED_CLASS}` : ""}`;
    node.textContent = text;

    const trackIndex = pickTrackIndex(Date.now());
    if (trackIndex === null) {
      return false;
    }

    trackUsage[trackIndex] = node;

    const trackTop = ((trackIndex + 0.5) / TRACK_COUNT) * 100;
    node.style.top = `${trackTop}%`;
    node.style.left = "100%";
    node.style.transform = "translateX(40px)";
    const flyDurationMs = getFlyDurationMs();
    node.style.transition = `transform ${flyDurationMs}ms linear`;

    root.appendChild(node);
    activeCount += 1;

    const fallbackTimer = setTimeout(() => {
      cleanupNode(node, null, trackIndex);
    }, flyDurationMs + 500);

    node.addEventListener(
      "transitionend",
      () => {
        cleanupNode(node, fallbackTimer, trackIndex);
      },
      { once: true }
    );

    requestAnimationFrame(() => {
      node.style.transform = "translateX(calc(-100vw - 100% - 40px))";
    });

    return true;
  }

  function clearDanmaku() {
    if (!(container instanceof HTMLElement)) {
      return;
    }

    container.innerHTML = "";
    activeCount = 0;
    trackUsage.fill(null);
  }

  const api = {
    DANMAKU_CONTAINER_ID,
    MAX_ONSCREEN_COUNT,
    SPEED_PRESET_TO_DURATION,
    initDanmakuContainer,
    normalizeSpeedPreset,
    getFlyDurationMs,
    setSpeedPreset,
    shootWordDanmaku,
    clearDanmaku
  };

  globalScope.DanmakuModule = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
