const DEFAULT_SETTINGS = {
  enabled: true,
  reviewDanmakuEnabled: false,
  reviewDanmakuSpeed: "normal",
  activeLevels: ["CET4", "CET6", "KAOYAN", "IELTS", "TOEFL"],
  replaceRatio: 0.2,
  maxReplaceCount: 2,
  targetCefr: "B2"
};

const CEFR_LEVELS = new Set(["A1", "A2", "B1", "B2", "C1", "C2"]);
const WORD_STATS_STORAGE_KEY = "bili_vocab_word_stats_v1";
const doc = typeof document !== "undefined" ? document : null;

const enabledInput = doc ? doc.getElementById("enabled") : null;
const replaceRatioInput = doc ? doc.getElementById("replaceRatio") : null;
const replaceRatioValue = doc ? doc.getElementById("replaceRatioValue") : null;
const maxReplaceCountInput = doc ? doc.getElementById("maxReplaceCount") : null;
const targetCefrInput = doc ? doc.getElementById("targetCefr") : null;
const saveButton = doc ? doc.getElementById("saveButton") : null;
const reviewDanmakuButton = doc ? doc.getElementById("reviewDanmakuButton") : null;
const reviewDanmakuState = doc ? doc.getElementById("reviewDanmakuState") : null;
const reviewDanmakuSpeedInput = doc ? doc.getElementById("reviewDanmakuSpeed") : null;
const statusNode = doc ? doc.getElementById("status") : null;
const rankingTabs = doc ? Array.from(doc.querySelectorAll(".popup-ranking-tab")) : [];
const rankingList = doc ? doc.getElementById("rankingList") : null;
const rankingEmpty = doc ? doc.getElementById("rankingEmpty") : null;

let rankingSort = "asc";
let reviewDanmakuEnabled = DEFAULT_SETTINGS.reviewDanmakuEnabled;

function getLevelCheckboxes() {
  if (!doc) {
    return [];
  }

  return Array.from(doc.querySelectorAll('input[name="activeLevels"]'));
}

function setStatus(message) {
  if (!statusNode) {
    return;
  }

  statusNode.textContent = message;
  setTimeout(() => {
    statusNode.textContent = "";
  }, 1500);
}

function updateRatioLabel(value) {
  if (!replaceRatioValue) {
    return;
  }

  replaceRatioValue.textContent = Number(value).toFixed(2);
}

function setActiveLevels(levels) {
  const selected = new Set(Array.isArray(levels) ? levels : DEFAULT_SETTINGS.activeLevels);
  getLevelCheckboxes().forEach((checkbox) => {
    checkbox.checked = selected.has(checkbox.value);
  });
}

function collectActiveLevels() {
  const selected = getLevelCheckboxes()
    .filter((checkbox) => checkbox.checked)
    .map((checkbox) => checkbox.value);

  return selected.length ? selected : DEFAULT_SETTINGS.activeLevels.slice();
}

function normalizeTargetCefr(value) {
  const targetCefr = String(value || DEFAULT_SETTINGS.targetCefr).trim().toUpperCase();
  return CEFR_LEVELS.has(targetCefr) ? targetCefr : DEFAULT_SETTINGS.targetCefr;
}

function normalizeReviewDanmakuEnabled(value) {
  return value === true;
}

function normalizeReviewDanmakuSpeed(value) {
  const normalized = String(value || DEFAULT_SETTINGS.reviewDanmakuSpeed).trim().toLowerCase();
  return ["slow", "normal", "fast"].includes(normalized) ? normalized : DEFAULT_SETTINGS.reviewDanmakuSpeed;
}

function getReviewDanmakuSpeedLabel(speed) {
  const preset = normalizeReviewDanmakuSpeed(speed);
  if (preset === "slow") {
    return "慢";
  }
  if (preset === "fast") {
    return "快";
  }
  return "标准";
}

function getReviewDanmakuButtonLabel(enabled) {
  return normalizeReviewDanmakuEnabled(enabled) ? "停止复习弹幕" : "启动复习弹幕";
}

function getReviewDanmakuStateLabel(enabled) {
  return normalizeReviewDanmakuEnabled(enabled) ? "运行中" : "未启动";
}

function renderReviewDanmakuState(enabled) {
  reviewDanmakuEnabled = normalizeReviewDanmakuEnabled(enabled);

  if (reviewDanmakuButton) {
    reviewDanmakuButton.textContent = getReviewDanmakuButtonLabel(reviewDanmakuEnabled);
    reviewDanmakuButton.classList.toggle("is-active", reviewDanmakuEnabled);
  }

  if (reviewDanmakuState) {
    reviewDanmakuState.textContent = getReviewDanmakuStateLabel(reviewDanmakuEnabled);
    reviewDanmakuState.classList.toggle("is-active", reviewDanmakuEnabled);
  }
}

function renderReviewDanmakuSpeed(speed) {
  if (!reviewDanmakuSpeedInput) {
    return;
  }

  reviewDanmakuSpeedInput.value = normalizeReviewDanmakuSpeed(speed);
}

function loadSettings() {
  if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
    return;
  }

  chrome.storage.local.get(DEFAULT_SETTINGS, (settings) => {
    if (enabledInput) {
      enabledInput.checked = Boolean(settings.enabled);
    }

    if (replaceRatioInput) {
      replaceRatioInput.value = Number(settings.replaceRatio).toFixed(2);
      updateRatioLabel(settings.replaceRatio);
    }

    if (maxReplaceCountInput) {
      maxReplaceCountInput.value = String(settings.maxReplaceCount || DEFAULT_SETTINGS.maxReplaceCount);
    }

    if (targetCefrInput) {
      targetCefrInput.value = normalizeTargetCefr(settings.targetCefr);
    }

    renderReviewDanmakuState(settings.reviewDanmakuEnabled);
    renderReviewDanmakuSpeed(settings.reviewDanmakuSpeed);
    setActiveLevels(settings.activeLevels);
  });
}

function saveSettings() {
  if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
    return;
  }

  const payload = {
    enabled: enabledInput ? enabledInput.checked : DEFAULT_SETTINGS.enabled,
    reviewDanmakuEnabled,
    reviewDanmakuSpeed: normalizeReviewDanmakuSpeed(
      reviewDanmakuSpeedInput ? reviewDanmakuSpeedInput.value : DEFAULT_SETTINGS.reviewDanmakuSpeed
    ),
    activeLevels: collectActiveLevels(),
    replaceRatio: Math.min(0.3, Math.max(0.1, Number(replaceRatioInput ? replaceRatioInput.value : DEFAULT_SETTINGS.replaceRatio))),
    maxReplaceCount: Math.min(5, Math.max(1, Math.floor(Number(maxReplaceCountInput ? maxReplaceCountInput.value : 2) || 2))),
    targetCefr: normalizeTargetCefr(targetCefrInput ? targetCefrInput.value : DEFAULT_SETTINGS.targetCefr)
  };

  chrome.storage.local.set(payload, () => {
    setStatus("已保存");
  });
}

function toggleReviewDanmaku() {
  if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
    return;
  }

  const nextValue = !reviewDanmakuEnabled;
  chrome.storage.local.set(
    {
      reviewDanmakuEnabled: nextValue
    },
    () => {
      renderReviewDanmakuState(nextValue);
      setStatus(nextValue ? "复习弹幕已启动" : "复习弹幕已停止");
    }
  );
}

function normalizeWordStat(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const word = String(item.word || "").trim();
  if (!word) {
    return null;
  }

  return {
    word,
    translation: String(item.translation || item.meaning || "").trim(),
    hitCount: Math.max(0, Math.floor(Number(item.hitCount) || 0)),
    lastSeen: Number.isFinite(Number(item.lastSeen)) ? Number(item.lastSeen) : null,
    level: String(item.level || "").trim().toUpperCase()
  };
}

function sortEncounteredWords(list, sortMode) {
  const mode = sortMode === "desc" ? "desc" : "asc";

  return list.slice().sort((left, right) => {
    if (left.hitCount !== right.hitCount) {
      return mode === "asc" ? left.hitCount - right.hitCount : right.hitCount - left.hitCount;
    }

    const leftSeen = left.lastSeen || 0;
    const rightSeen = right.lastSeen || 0;
    if (leftSeen !== rightSeen) {
      return mode === "asc" ? leftSeen - rightSeen : rightSeen - leftSeen;
    }

    return left.word.localeCompare(right.word);
  });
}

function readEncounteredWords(callback) {
  if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
    callback([]);
    return;
  }

  chrome.storage.local.get([WORD_STATS_STORAGE_KEY], (stored) => {
    const rawMap = stored && stored[WORD_STATS_STORAGE_KEY] && typeof stored[WORD_STATS_STORAGE_KEY] === "object"
      ? stored[WORD_STATS_STORAGE_KEY]
      : {};

    const words = Object.values(rawMap)
      .map((item) => normalizeWordStat(item))
      .filter((item) => Boolean(item) && item.hitCount > 0);

    callback(words);
  });
}

function renderRankingList(items) {
  if (!rankingList || !rankingEmpty) {
    return;
  }

  rankingList.innerHTML = "";

  if (items.length === 0) {
    rankingEmpty.style.display = "block";
    return;
  }

  rankingEmpty.style.display = "none";

  items.forEach((item) => {
    const li = document.createElement("li");
    li.className = "popup-ranking-item";

    const wordNode = document.createElement("span");
    wordNode.className = "popup-ranking-word";
    wordNode.textContent = item.word;

    const translationNode = document.createElement("span");
    translationNode.className = "popup-ranking-translation";
    translationNode.textContent = item.translation || "-";

    const badgeNode = document.createElement("span");
    badgeNode.className = "popup-ranking-badge";
    badgeNode.textContent = String(item.hitCount);

    li.appendChild(wordNode);
    li.appendChild(translationNode);
    li.appendChild(badgeNode);
    rankingList.appendChild(li);
  });
}

function refreshRanking() {
  readEncounteredWords((words) => {
    const sorted = sortEncounteredWords(words, rankingSort);
    renderRankingList(sorted);
  });
}

function setRankingSort(sortMode) {
  rankingSort = sortMode === "desc" ? "desc" : "asc";

  rankingTabs.forEach((tab) => {
    const isCurrent = tab.dataset.sort === rankingSort;
    tab.classList.toggle("is-active", isCurrent);
  });

  refreshRanking();
}

function bindEvents() {
  if (replaceRatioInput) {
    replaceRatioInput.addEventListener("input", () => {
      updateRatioLabel(replaceRatioInput.value);
    });
  }

  if (saveButton) {
    saveButton.addEventListener("click", saveSettings);
  }

  if (reviewDanmakuButton) {
    reviewDanmakuButton.addEventListener("click", toggleReviewDanmaku);
  }

  rankingTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      setRankingSort(tab.dataset.sort || "asc");
    });
  });

  if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.onChanged) {
    return;
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    if (changes.reviewDanmakuEnabled) {
      renderReviewDanmakuState(changes.reviewDanmakuEnabled.newValue);
    }

    if (changes.reviewDanmakuSpeed) {
      renderReviewDanmakuSpeed(changes.reviewDanmakuSpeed.newValue);
    }

    if (changes[WORD_STATS_STORAGE_KEY]) {
      refreshRanking();
    }
  });
}

function init() {
  bindEvents();
  loadSettings();
  refreshRanking();
}

if (doc) {
  doc.addEventListener("DOMContentLoaded", init);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    getReviewDanmakuButtonLabel,
    normalizeReviewDanmakuEnabled,
    getReviewDanmakuSpeedLabel,
    normalizeReviewDanmakuSpeed,
    normalizeWordStat,
    sortEncounteredWords
  };
}
