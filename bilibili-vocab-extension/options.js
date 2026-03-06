const DEFAULT_SETTINGS = {
  enabled: true,
  reviewDanmakuSpeed: "normal",
  activeLevels: ["CET4", "CET6", "KAOYAN", "IELTS", "TOEFL"],
  replaceRatio: 0.2,
  maxReplaceCount: 2,
  targetCefr: "B2"
};

const CEFR_LEVELS = new Set(["A1", "A2", "B1", "B2", "C1", "C2"]);

const enabledInput = document.getElementById("enabled");
const replaceRatioInput = document.getElementById("replaceRatio");
const replaceRatioValue = document.getElementById("replaceRatioValue");
const maxReplaceCountInput = document.getElementById("maxReplaceCount");
const targetCefrInput = document.getElementById("targetCefr");
const reviewDanmakuSpeedInput = document.getElementById("reviewDanmakuSpeed");
const saveButton = document.getElementById("saveButton");
const statusNode = document.getElementById("status");

function getLevelCheckboxes() {
  return Array.from(document.querySelectorAll('input[name="activeLevels"]'));
}

function setStatus(message, timeoutMs = 1600) {
  statusNode.textContent = message;
  setTimeout(() => {
    statusNode.textContent = "";
  }, timeoutMs);
}

function updateRatioLabel(value) {
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

function normalizeSettings(settings) {
  const source = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  const targetCefr = String(source.targetCefr || DEFAULT_SETTINGS.targetCefr).trim().toUpperCase();
  const reviewDanmakuSpeed = String(source.reviewDanmakuSpeed || DEFAULT_SETTINGS.reviewDanmakuSpeed).trim().toLowerCase();

  return {
    enabled: source.enabled !== false,
    reviewDanmakuSpeed: ["slow", "normal", "fast"].includes(reviewDanmakuSpeed)
      ? reviewDanmakuSpeed
      : DEFAULT_SETTINGS.reviewDanmakuSpeed,
    activeLevels: collectActiveLevels(),
    replaceRatio: Math.min(0.3, Math.max(0.1, Number(source.replaceRatio))),
    maxReplaceCount: Math.min(5, Math.max(1, Math.floor(Number(source.maxReplaceCount) || 2))),
    targetCefr: CEFR_LEVELS.has(targetCefr) ? targetCefr : DEFAULT_SETTINGS.targetCefr
  };
}

function loadSettings() {
  chrome.storage.local.get(DEFAULT_SETTINGS, (settings) => {
    enabledInput.checked = Boolean(settings.enabled);
    replaceRatioInput.value = Number(settings.replaceRatio).toFixed(2);
    updateRatioLabel(settings.replaceRatio);
    maxReplaceCountInput.value = String(settings.maxReplaceCount || DEFAULT_SETTINGS.maxReplaceCount);
    targetCefrInput.value = CEFR_LEVELS.has(String(settings.targetCefr || "").toUpperCase())
      ? String(settings.targetCefr).toUpperCase()
      : DEFAULT_SETTINGS.targetCefr;
    reviewDanmakuSpeedInput.value = normalizeSettings(settings).reviewDanmakuSpeed;
    setActiveLevels(settings.activeLevels);
  });
}

function saveSettings() {
  const payload = normalizeSettings({
    enabled: enabledInput.checked,
    replaceRatio: replaceRatioInput.value,
    maxReplaceCount: maxReplaceCountInput.value,
    targetCefr: targetCefrInput.value,
    reviewDanmakuSpeed: reviewDanmakuSpeedInput.value
  });

  chrome.storage.local.set(payload, () => {
    setStatus("设置已保存");
  });
}

replaceRatioInput.addEventListener("input", () => {
  updateRatioLabel(replaceRatioInput.value);
});

saveButton.addEventListener("click", saveSettings);

document.addEventListener("DOMContentLoaded", loadSettings);
