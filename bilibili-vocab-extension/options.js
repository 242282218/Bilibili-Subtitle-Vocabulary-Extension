const sharedSettings = globalThis.SharedSettings || (typeof require === "function" ? require("./sharedSettings.js") : null);
const adaptiveTuning = globalThis.AdaptiveTuning || (typeof require === "function" ? require("./adaptiveTuning.js") : null);
const uiStateMachine = globalThis.SettingsUiStateMachine || (typeof require === "function" ? require("./settingsUiStateMachine.js") : null);
const DEFAULT_SETTINGS = sharedSettings ? sharedSettings.DEFAULT_SETTINGS : {
  enabled: true,
  schemaVersion: 2,
  reviewDanmakuEnabled: false,
  reviewDanmakuSpeed: "normal",
  webPageEnabled: true,
  domainRules: {},
  vocabularyMode: "core",
  examPreference: "balanced",
  activeLevels: ["CET4", "CET6", "KAOYAN", "IELTS", "TOEFL"],
  replaceRatio: 0.2,
  maxReplaceCount: 2,
  targetCefr: "B2"
};

const LOCAL_CEFR_LEVELS = new Set(["A1", "A2", "B1", "B2", "C1", "C2"]);
const SCENE_PRESETS = sharedSettings ? sharedSettings.SCENE_PRESETS : {
  light: { replaceRatio: 0.15, maxReplaceCount: 1, reviewDanmakuSpeed: "slow" },
  balanced: { replaceRatio: 0.2, maxReplaceCount: 2, reviewDanmakuSpeed: "normal" },
  intensive: { replaceRatio: 0.3, maxReplaceCount: 4, reviewDanmakuSpeed: "fast" }
};
const doc = typeof document !== "undefined" ? document : null;

const enabledInput = doc ? doc.getElementById("enabled") : null;
const webPageEnabledInput = doc ? doc.getElementById("webPageEnabled") : null;
const enabledStateBadge = doc ? doc.getElementById("enabledStateBadge") : null;
const replaceRatioInput = doc ? doc.getElementById("replaceRatio") : null;
const replaceRatioValue = doc ? doc.getElementById("replaceRatioValue") : null;
const replaceRatioHeroValue = doc ? doc.getElementById("replaceRatioHeroValue") : null;
const maxReplaceCountInput = doc ? doc.getElementById("maxReplaceCount") : null;
const targetCefrInput = doc ? doc.getElementById("targetCefr") : null;
const targetCefrHeroValue = doc ? doc.getElementById("targetCefrHeroValue") : null;
const vocabularyModeInput = doc ? doc.getElementById("vocabularyMode") : null;
const examPreferenceInput = doc ? doc.getElementById("examPreference") : null;
const previewModeTag = doc ? doc.getElementById("previewModeTag") : null;
const mockSubtitlePreview = doc ? doc.getElementById("mockSubtitlePreview") : null;
const previewCaption = doc ? doc.getElementById("previewCaption") : null;
const reviewDanmakuSpeedInput = doc ? doc.getElementById("reviewDanmakuSpeed") : null;
const reviewSpeedHeroValue = doc ? doc.getElementById("reviewSpeedHeroValue") : null;
const levelsSummary = doc ? doc.getElementById("levelsSummary") : null;
const settingsPreview = doc ? doc.getElementById("settingsPreview") : null;
const recommendationBadge = doc ? doc.getElementById("recommendationBadge") : null;
const ratioRecommendation = doc ? doc.getElementById("ratioRecommendation") : null;
const levelRecommendation = doc ? doc.getElementById("levelRecommendation") : null;
const paceRecommendation = doc ? doc.getElementById("paceRecommendation") : null;
const saveButton = doc ? doc.getElementById("saveButton") : null;
const statusNode = doc ? doc.getElementById("status") : null;
const toastNode = doc ? doc.getElementById("toast") : null;
const heroMetricMetaNodes = doc ? Array.from(doc.querySelectorAll(".hero-metric__meta")) : [];
const sceneCards = doc ? Array.from(doc.querySelectorAll(".hub-scenario-card")) : [];
// 新增字段引用
const bilingualModeInput = doc ? doc.getElementById("bilingualMode") : null;
const themeModeInput = doc ? doc.getElementById("themeMode") : null;
const savedWordsCountEl = doc ? doc.getElementById("savedWordsCount") : null;
const currentStreakEl = doc ? doc.getElementById("currentStreak") : null;
const totalActiveDaysEl = doc ? doc.getElementById("totalActiveDays") : null;
const maxStreakEl = doc ? doc.getElementById("maxStreak") : null;
const exportJsonButton = doc ? doc.getElementById("exportJsonButton") : null;
const exportCsvButton = doc ? doc.getElementById("exportCsvButton") : null;
const exportAnkiButton = doc ? doc.getElementById("exportAnkiButton") : null;
const clearVocabButton = doc ? doc.getElementById("clearVocabButton") : null;
const exportSettingsButton = doc ? doc.getElementById("exportSettingsButton") : null;
const importSettingsButton = doc ? doc.getElementById("importSettingsButton") : null;
const resetSettingsButton = doc ? doc.getElementById("resetSettingsButton") : null;

const VOCABULARY_BOOK_STORAGE_KEY = "bili_vocab_word_stats_v2";
const LEARNING_STREAK_STORAGE_KEY = "bili_vocab_learning_streak_v1";
let runtimeSettings = sharedSettings ? sharedSettings.normalizeSettings(DEFAULT_SETTINGS) : { ...DEFAULT_SETTINGS };
const uiStateController = uiStateMachine && typeof uiStateMachine.createStateController === "function"
  ? uiStateMachine.createStateController("idle")
  : null;

function getLevelCheckboxes() {
  return doc ? Array.from(doc.querySelectorAll('input[name="activeLevels"]')) : [];
}

function collectCurrentSettings() {
  const formValues = {
    enabled: enabledInput ? enabledInput.checked : DEFAULT_SETTINGS.enabled,
    webPageEnabled: webPageEnabledInput ? webPageEnabledInput.checked : DEFAULT_SETTINGS.webPageEnabled,
    replaceRatio: replaceRatioInput ? replaceRatioInput.value : DEFAULT_SETTINGS.replaceRatio,
    maxReplaceCount: maxReplaceCountInput ? maxReplaceCountInput.value : DEFAULT_SETTINGS.maxReplaceCount,
    targetCefr: targetCefrInput ? targetCefrInput.value : DEFAULT_SETTINGS.targetCefr,
    reviewDanmakuSpeed: reviewDanmakuSpeedInput ? reviewDanmakuSpeedInput.value : DEFAULT_SETTINGS.reviewDanmakuSpeed,
    vocabularyMode: vocabularyModeInput ? vocabularyModeInput.value : DEFAULT_SETTINGS.vocabularyMode,
    examPreference: examPreferenceInput ? examPreferenceInput.value : DEFAULT_SETTINGS.examPreference,
    bilingualMode: bilingualModeInput ? bilingualModeInput.value : "default",
    themeMode: themeModeInput ? themeModeInput.value : "auto",
    activeLevels: collectActiveLevels()
  };

  if (sharedSettings && typeof sharedSettings.buildSettingsPayload === "function") {
    return sharedSettings.buildSettingsPayload(runtimeSettings, formValues);
  }

  return normalizeSettings({
    ...runtimeSettings,
    ...formValues,
    domainRules: runtimeSettings.domainRules || {},
    schemaVersion: runtimeSettings.schemaVersion || DEFAULT_SETTINGS.schemaVersion
  });
}

function resolveSettingsSnapshot(settings) {
  if (settings && typeof settings === "object") {
    return normalizeSettings(settings);
  }

  return collectCurrentSettings();
}

function showToast(message) {
  if (!toastNode) {
    return;
  }

  toastNode.textContent = message;
  toastNode.classList.add("is-visible");

  clearTimeout(showToast.timerId);
  showToast.timerId = setTimeout(() => {
    toastNode.classList.remove("is-visible");
  }, 2200);
}

function getWordStatRecords(wordStats) {
  if (!wordStats || typeof wordStats !== "object") {
    return [];
  }

  return Object.values(wordStats).filter((item) => item && typeof item === "object");
}

function normalizeExportWordRecord(word) {
  if (!word || typeof word !== "object") {
    return null;
  }

  const normalizedWord = String(word.word || "").trim();
  if (!normalizedWord) {
    return null;
  }

  const details = word.details && typeof word.details === "object" ? word.details : {};
  const savedAt = Number(word.savedAt);
  const exposures = Number(word.exposures);

  return {
    word: normalizedWord,
    translation: String(word.translation || "").trim(),
    level: String(word.level || "").trim(),
    savedAt: Number.isFinite(savedAt) && savedAt > 0 ? Math.floor(savedAt) : null,
    exposures: Number.isFinite(exposures) && exposures > 0 ? Math.floor(exposures) : 0,
    details: {
      meaning: String(details.meaning || "").trim(),
      level: String(details.level || "").trim(),
      phonetic: String(details.phonetic || "").trim()
    }
  };
}

function normalizeExportWordRecords(words) {
  if (!Array.isArray(words)) {
    return [];
  }

  return words
    .map((word) => normalizeExportWordRecord(word))
    .filter(Boolean);
}

// 加载学习统计数据
async function loadLearningStats() {
  try {
    if (!chrome || !chrome.storage || !chrome.storage.local) return;

    const [vocabData, streakData] = await Promise.all([
      new Promise((resolve) => chrome.storage.local.get([VOCABULARY_BOOK_STORAGE_KEY], resolve)),
      new Promise((resolve) => chrome.storage.local.get([LEARNING_STREAK_STORAGE_KEY], resolve))
    ]);

    // 计算收藏单词数量
    const wordStats = vocabData[VOCABULARY_BOOK_STORAGE_KEY] || {};
    const savedCount = getWordStatRecords(wordStats).filter((word) => word.status === "saved").length;
    if (savedWordsCountEl) savedWordsCountEl.textContent = savedCount;

    // 学习打卡数据
    const streak = streakData[LEARNING_STREAK_STORAGE_KEY] || {};
    if (currentStreakEl) currentStreakEl.textContent = streak.currentStreak || 0;
    if (totalActiveDaysEl) totalActiveDaysEl.textContent = streak.totalActiveDays || 0;
    if (maxStreakEl) maxStreakEl.textContent = streak.maxStreak || 0;
  } catch (e) {
    console.error('Failed to load learning stats:', e);
  }
}

function escapeCsvCell(value) {
  return `"${String(value == null ? "" : value).replace(/"/g, '""')}"`;
}

function normalizeTsvCell(value) {
  return String(value == null ? "" : value).replace(/[\t\r\n]+/g, " ").trim();
}

function buildVocabularyExportPayload(savedWords, format = "json") {
  const safeWords = normalizeExportWordRecords(savedWords);
  if (format === "csv") {
    const headers = ["单词", "释义", "难度等级", "音标", "收藏时间", "遇见次数"];
    const rows = safeWords.map((word) => [
      word.word,
      word.details?.meaning || "",
      word.details?.level || "",
      word.details?.phonetic || "",
      word.savedAt ? new Date(word.savedAt).toLocaleString() : "",
      word.exposures || 0
    ]);

    return {
      content: [headers.join(","), ...rows.map((row) => row.map(escapeCsvCell).join(","))].join("\n"),
      mimeType: "text/csv;charset=utf-8;",
      extension: "csv",
      label: "CSV"
    };
  }

  if (format === "anki") {
    const headers = ["Front", "Back", "Level", "Phonetic", "SavedAt"];
    const rows = safeWords.map((word) => [
      normalizeTsvCell(word.word),
      normalizeTsvCell(word.details?.meaning || word.translation || ""),
      normalizeTsvCell(word.details?.level || word.level || ""),
      normalizeTsvCell(word.details?.phonetic || ""),
      normalizeTsvCell(word.savedAt ? new Date(word.savedAt).toISOString() : "")
    ]);

    return {
      content: [headers.join("\t"), ...rows.map((row) => row.join("\t"))].join("\n"),
      mimeType: "text/tab-separated-values;charset=utf-8;",
      extension: "tsv",
      label: "ANKI-TSV"
    };
  }

  return {
    content: JSON.stringify(safeWords, null, 2),
    mimeType: "application/json",
    extension: "json",
    label: "JSON"
  };
}

async function exportVocabularyBook(format = "json") {
  try {
    if (!chrome || !chrome.storage || !chrome.storage.local) {
      showToast('存储不可用，导出失败');
      return;
    }

    const payload = await new Promise((resolve) => chrome.storage.local.get([VOCABULARY_BOOK_STORAGE_KEY], resolve));
    const wordStats = payload[VOCABULARY_BOOK_STORAGE_KEY] || {};

    // 只导出生词本中的单词
    const savedWords = getWordStatRecords(wordStats)
      .filter((word) => word.status === "saved")
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));

    const exportPayload = buildVocabularyExportPayload(savedWords, format);

    const blob = new Blob([exportPayload.content], { type: exportPayload.mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `bilibili-vocab-book-${new Date().toISOString().slice(0, 10)}.${exportPayload.extension}`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`生词本已导出为${exportPayload.label}格式`);
  } catch (e) {
    console.error('Export failed:', e);
    showToast('导出失败，请重试');
  }
}

// 清空生词本
async function clearVocabularyBook() {
  if (!confirm('确定要清空所有收藏的单词吗？此操作不可恢复！')) {
    return;
  }

  try {
    if (!chrome || !chrome.storage || !chrome.storage.local) {
      showToast('存储不可用，操作失败');
      return;
    }

    const payload = await new Promise((resolve) => chrome.storage.local.get([VOCABULARY_BOOK_STORAGE_KEY], resolve));
    const wordStats = payload[VOCABULARY_BOOK_STORAGE_KEY] || {};

    // 将所有已收藏单词状态改为已遇见
    getWordStatRecords(wordStats).forEach((word) => {
      if (word.status === "saved") {
        word.status = "seen";
        delete word.savedAt;
      }
    });

    await new Promise((resolve) => chrome.storage.local.set({ [VOCABULARY_BOOK_STORAGE_KEY]: wordStats }, resolve));
    await loadLearningStats();
    showToast('生词本已清空');
  } catch (e) {
    console.error('Clear failed:', e);
    showToast('清空失败，请重试');
  }
}

// 导出设置
async function exportSettings() {
  try {
    const settings = collectCurrentSettings();
    const content = JSON.stringify(settings, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `bilibili-vocab-settings-${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('设置已导出');
  } catch (e) {
    console.error('Export settings failed:', e);
    showToast('导出设置失败');
  }
}

// 导入设置
function importSettings() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    try {
      const file = e.target.files[0];
      if (!file) return;

      const text = await file.text();
      const importedSettings = JSON.parse(text);

      // 验证并应用设置
      const normalized = sharedSettings ? sharedSettings.normalizeSettings(importedSettings) : normalizeSettings(importedSettings);
      await saveSettingsToStorage(normalized);
      await loadSettingsFromStorage();
      refreshUI();
      showToast('设置导入成功');
    } catch (e) {
      console.error('Import settings failed:', e);
      showToast('导入失败，请检查文件格式');
    }
  };
  input.click();
}

// 恢复默认设置
async function resetSettings() {
  if (!confirm('确定要恢复默认设置吗？所有自定义配置将会丢失！')) {
    return;
  }

  try {
    const defaultSettings = sharedSettings ? sharedSettings.normalizeSettings(DEFAULT_SETTINGS) : normalizeSettings(DEFAULT_SETTINGS);
    await saveSettingsToStorage(defaultSettings);
    await loadSettingsFromStorage();
    refreshUI();
    showToast('已恢复默认设置');
  } catch (e) {
    console.error('Reset settings failed:', e);
    showToast('恢复默认设置失败');
  }
}

function setStatus(message, timeoutMs = 1800) {
  if (!statusNode) {
    return;
  }

  statusNode.textContent = message;
  clearTimeout(setStatus.timerId);
  if (Number(timeoutMs) > 0) {
    setStatus.timerId = setTimeout(() => {
      statusNode.textContent = "";
    }, timeoutMs);
  }
}

function updateSettingsState(event, options = {}) {
  if (!uiStateController) {
    if (options.statusMessage) {
      setStatus(options.statusMessage, options.timeoutMs);
    }
    return null;
  }

  const nextState = uiStateController.dispatch(event);
  if (options.renderStatus === false) {
    return nextState;
  }

  const message = options.statusMessage || uiStateController.getMessage({ channel: "status" });
  const timeoutMs = Object.prototype.hasOwnProperty.call(options, "timeoutMs")
    ? options.timeoutMs
    : (nextState === "dirty" || nextState === "saving" ? 0 : 1800);
  setStatus(message, timeoutMs);
  return nextState;
}

function markSettingsDirty(renderStatus = true) {
  updateSettingsState("USER_EDIT", { renderStatus: false });
  updateSettingsState("MARK_DIRTY", { renderStatus });
}

function normalizeTargetCefr(value) {
  if (sharedSettings) {
    return sharedSettings.normalizeTargetCefr(value);
  }

  const targetCefr = String(value || DEFAULT_SETTINGS.targetCefr).trim().toUpperCase();
  return LOCAL_CEFR_LEVELS.has(targetCefr) ? targetCefr : DEFAULT_SETTINGS.targetCefr;
}

function normalizeReviewDanmakuSpeed(value) {
  if (sharedSettings) {
    return sharedSettings.normalizeReviewDanmakuSpeed(value);
  }

  const reviewDanmakuSpeed = String(value || DEFAULT_SETTINGS.reviewDanmakuSpeed).trim().toLowerCase();
  return ["slow", "normal", "fast"].includes(reviewDanmakuSpeed)
    ? reviewDanmakuSpeed
    : DEFAULT_SETTINGS.reviewDanmakuSpeed;
}

function getReviewDanmakuSpeedLabel(speed) {
  if (sharedSettings) {
    return sharedSettings.getReviewDanmakuSpeedLabel(speed);
  }

  const preset = normalizeReviewDanmakuSpeed(speed);
  if (preset === "slow") {
    return "慢";
  }
  if (preset === "fast") {
    return "快";
  }
  return "标准";
}

function getHeroMetricMeta(type, value) {
  if (sharedSettings) {
    return sharedSettings.getHeroMetricMeta(type, value);
  }

  if (type === "ratio") {
    const ratio = Math.min(0.3, Math.max(0.1, Number(value) || DEFAULT_SETTINGS.replaceRatio));
    if (ratio <= 0.15) {
      return "轻量低扰";
    }
    if (ratio >= 0.25) {
      return "强化输入";
    }
    return "均衡曝光";
  }

  if (type === "reviewSpeed") {
    const speed = normalizeReviewDanmakuSpeed(value);
    if (speed === "slow") {
      return "低压慢复习";
    }
    if (speed === "fast") {
      return "冲刺高频";
    }
    return "稳定推进";
  }

  if (type === "cefr") {
    const cefr = normalizeTargetCefr(value);
    if (["A1", "A2"].includes(cefr)) {
      return "稳步入门";
    }
    if (["C1", "C2"].includes(cefr)) {
      return "进阶挑战";
    }
    return "渐进提升";
  }

  return "实时同步";
}

function collectActiveLevels() {
  const selected = getLevelCheckboxes()
    .filter((checkbox) => checkbox.checked)
    .map((checkbox) => checkbox.value);

  if (sharedSettings) {
    return sharedSettings.normalizeActiveLevels(selected);
  }

  return selected.length ? selected : DEFAULT_SETTINGS.activeLevels.slice();
}

function setActiveLevels(levels) {
  const selectedLevels = sharedSettings
    ? sharedSettings.normalizeActiveLevels(levels)
    : (Array.isArray(levels) ? levels : DEFAULT_SETTINGS.activeLevels);
  const selected = new Set(selectedLevels);
  getLevelCheckboxes().forEach((checkbox) => {
    checkbox.checked = selected.has(checkbox.value);
  });
  updateLevelsSummary(Array.from(selected));
}

function updateLevelsSummary(levels) {
  if (!levelsSummary) {
    return;
  }

  const count = Array.isArray(levels) ? levels.length : collectActiveLevels().length;
  levelsSummary.textContent = `已选择 ${count} 个词库`;
}

function updateEnabledBadge(enabled) {
  if (!enabledStateBadge) {
    return;
  }

  const active = Boolean(enabled);
  enabledStateBadge.textContent = active ? "已启用" : "未启用";
  enabledStateBadge.classList.toggle("state-badge--on", active);
  enabledStateBadge.classList.toggle("state-badge--off", !active);
  refreshHeroState();
}

function updateRatioLabel(value) {
  const numericValue = Number(value || DEFAULT_SETTINGS.replaceRatio);
  if (replaceRatioValue) {
    replaceRatioValue.textContent = numericValue.toFixed(2);
  }
  if (replaceRatioHeroValue) {
    replaceRatioHeroValue.textContent = `${Math.round(numericValue * 100)}%`;
  }
  if (heroMetricMetaNodes[0]) {
    heroMetricMetaNodes[0].textContent = getHeroMetricMeta("ratio", numericValue);
  }
}

function updateTargetCefrSummary(value) {
  if (!targetCefrHeroValue) {
    return;
  }

  const cefr = normalizeTargetCefr(value);
  targetCefrHeroValue.textContent = cefr;
  if (heroMetricMetaNodes[1]) {
    heroMetricMetaNodes[1].textContent = getHeroMetricMeta("cefr", cefr);
  }
}

function updateReviewSpeedSummary(value) {
  if (!reviewSpeedHeroValue) {
    return;
  }

  const speed = normalizeReviewDanmakuSpeed(value);
  reviewSpeedHeroValue.textContent = getReviewDanmakuSpeedLabel(speed);
  if (heroMetricMetaNodes[2]) {
    heroMetricMetaNodes[2].textContent = getHeroMetricMeta("reviewSpeed", speed);
  }
}

function getMockPreviewData(targetCefr, ratio, maxReplaceCount) {
  if (sharedSettings) {
    return sharedSettings.getMockPreviewData(targetCefr, ratio, maxReplaceCount);
  }

  const presetMap = {
    A1: ["learn", "watch", "word"],
    A2: ["improve", "listen", "memory"],
    B1: ["build", "focus", "exposure"],
    B2: ["establish", "vocabulary", "context"],
    C1: ["internalize", "retention", "comprehension"],
    C2: ["synthesize", "lexicon", "fluency"]
  };

  const words = presetMap[normalizeTargetCefr(targetCefr)] || presetMap.B2;
  const density = ratio >= 0.25 ? 3 : ratio <= 0.15 ? 1 : 2;
  const count = Math.min(words.length, Math.max(1, Math.min(maxReplaceCount, density)));
  return words.slice(0, count);
}

function getLearningProfile({ ratio, maxReplaceCount, enabled }) {
  if (sharedSettings) {
    return sharedSettings.getLearningProfile({ ratio, maxReplaceCount, enabled });
  }

  if (!enabled) {
    return {
      tone: "gentle",
      label: "轻量待机",
      summary: "当前字幕替换已关闭，可随时恢复温和输入。"
    };
  }

  if (ratio >= 0.25 || maxReplaceCount >= 4) {
    return {
      tone: "intensive",
      label: "强化曝光",
      summary: "更适合熟悉视频内容后做集中刷词与短时强化。"
    };
  }

  if (ratio <= 0.15 && maxReplaceCount <= 2) {
    return {
      tone: "gentle",
      label: "轻量输入",
      summary: "更偏温和稳定，适合首次观看与低压力适应。"
    };
  }

  return {
    tone: "balanced",
    label: "均衡输入",
    summary: "兼顾理解效率与稳定词汇曝光，适合长期使用。"
  };
}

function syncSurfaceTone(profile) {
  if (!profile || !doc) {
    return;
  }

  doc.body.dataset.learningTone = profile.tone;
}

function setButtonBusy(button, busyText, idleText) {
  if (!button) {
    return;
  }

  if (button.dataset.defaultLabel == null || button.dataset.defaultLabel === "") {
    button.dataset.defaultLabel = idleText || button.textContent;
  }

  const isBusy = Boolean(busyText);
  button.disabled = isBusy;
  button.classList.toggle("is-busy", isBusy);
  button.textContent = isBusy ? busyText : (idleText || button.dataset.defaultLabel);
}

function pulsePreviewCard() {
  if (!mockSubtitlePreview) {
    return;
  }

  mockSubtitlePreview.classList.remove("is-pulsing");
  void mockSubtitlePreview.offsetWidth;
  mockSubtitlePreview.classList.add("is-pulsing");
}

function refreshHeroState() {
  if (!doc) {
    return;
  }

  doc.body.classList.toggle("is-extension-enabled", Boolean(enabledInput && enabledInput.checked));
}

function updateMockPreview(settings) {
  if (!previewModeTag || !mockSubtitlePreview || !previewCaption) {
    return;
  }

  const snapshot = resolveSettingsSnapshot(settings);
  const ratio = snapshot.replaceRatio;
  const maxReplaceCount = snapshot.maxReplaceCount;
  const targetCefr = snapshot.targetCefr;
  const enabled = snapshot.enabled !== false;
  const previewWords = getMockPreviewData(targetCefr, ratio, maxReplaceCount);
  const [firstWord = "establish", secondWord = "vocabulary", thirdWord = "context"] = previewWords;
  const profile = getLearningProfile({ ratio, maxReplaceCount, enabled });

  previewModeTag.textContent = profile.label;
  previewModeTag.dataset.tone = profile.tone;
  mockSubtitlePreview.innerHTML = `预览：这段视频会帮你 <span class="preview-word">${firstWord}</span> 稳定的 <span class="preview-word">${secondWord}</span>${previewWords[2] ? ` 与 <span class="preview-word">${thirdWord}</span>` : ""} 输入节奏。`;
  previewCaption.textContent = `${profile.summary} 当前目标难度：${targetCefr}。`;
  syncSurfaceTone(profile);
  pulsePreviewCard();
}

function getRecommendationColor(kind) {
  if (kind === "good") {
    return "good";
  }
  if (kind === "warn") {
    return "warn";
  }
  return "default";
}

function buildRecommendationPayload({ ratio, levelCount, speed, enabled, maxReplaceCount }) {
  const profile = getLearningProfile({ ratio, maxReplaceCount, enabled });
  let badgeText = `推荐：${profile.label}`;
  if (speed === "fast" && enabled) {
    badgeText = "推荐：冲刺曝光";
  } else if (speed === "slow" && enabled && profile.tone !== "intensive") {
    badgeText = "推荐：轻量输入";
  }

  return {
    badgeText,
    items: [
      {
        text: ratio >= 0.25
          ? "注意：当前替换比例偏高，适合熟悉剧情后集中刷词。"
          : ratio <= 0.15
            ? "良好：当前替换比例较轻，适合新视频或初次适应阶段。"
            : "建议：当前替换比例较均衡，适合多数视频场景。",
        tone: ratio >= 0.25 ? "warn" : ratio <= 0.15 ? "good" : "default"
      },
      {
        text: levelCount >= 4
          ? "建议：当前词库覆盖较广，适合综合积累。"
          : "良好：当前词库更聚焦，适合围绕明确考试目标专项记忆。",
        tone: levelCount >= 4 ? "default" : "good"
      },
      {
        text: speed === "fast"
          ? "注意：当前复习节奏偏快，更适合短时高频强化。"
          : speed === "slow"
            ? "良好：当前复习节奏偏慢，更适合降低干扰、循序渐进。"
            : "建议：当前复习节奏适合长期稳定复习。",
        tone: speed === "fast" ? "warn" : speed === "slow" ? "good" : "default"
      }
    ]
  };
}

function renderRecommendationList(input) {
  if (Array.isArray(input)) {
    input.forEach(({ node, text, tone }) => {
      if (!node) {
        return;
      }

      node.textContent = text;
      node.dataset.tone = getRecommendationColor(tone) === "default" ? "neutral" : getRecommendationColor(tone);
    });
    return;
  }

  return buildRecommendationPayload(input);
}

function updateRecommendationPanel(settings) {
  if (!recommendationBadge || !ratioRecommendation || !levelRecommendation || !paceRecommendation) {
    return;
  }

  const snapshot = resolveSettingsSnapshot(settings);
  const ratio = snapshot.replaceRatio;
  const levelCount = Array.isArray(snapshot.activeLevels) ? snapshot.activeLevels.length : 0;
  const speed = snapshot.reviewDanmakuSpeed;
  const maxReplaceCount = snapshot.maxReplaceCount;
  const rendered = buildRecommendationPayload({
    ratio,
    levelCount,
    speed,
    enabled: snapshot.enabled !== false,
    maxReplaceCount
  });

  recommendationBadge.textContent = rendered.badgeText;

  renderRecommendationList([
    { node: ratioRecommendation, text: rendered.items[0].text, tone: rendered.items[0].tone },
    { node: levelRecommendation, text: rendered.items[1].text, tone: rendered.items[1].tone },
    { node: paceRecommendation, text: rendered.items[2].text, tone: rendered.items[2].tone }
  ]);
}

function updateSettingsPreview(settings) {
  if (!settingsPreview) {
    return;
  }

  const payload = resolveSettingsSnapshot(settings);

  settingsPreview.textContent = sharedSettings
    ? sharedSettings.buildSettingsPreview(payload)
    : buildSettingsPreviewFallback(payload);
}

function normalizeSettings(settings) {
  if (sharedSettings) {
    return sharedSettings.normalizeSettings(settings);
  }

  const source = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  const targetCefr = normalizeTargetCefr(source.targetCefr);
  const reviewDanmakuSpeed = normalizeReviewDanmakuSpeed(source.reviewDanmakuSpeed);

  return {
    enabled: source.enabled !== false,
    webPageEnabled: source.webPageEnabled !== false,
    reviewDanmakuEnabled: source.reviewDanmakuEnabled === true,
    reviewDanmakuSpeed,
    vocabularyMode: String(source.vocabularyMode || DEFAULT_SETTINGS.vocabularyMode).trim().toLowerCase() === "full" ? "full" : "core",
    examPreference: String(source.examPreference || DEFAULT_SETTINGS.examPreference).trim().toLowerCase() === "exam-first" ? "exam-first" : "balanced",
    domainRules: source.domainRules && typeof source.domainRules === "object" ? source.domainRules : {},
    schemaVersion: Number(source.schemaVersion) || DEFAULT_SETTINGS.schemaVersion || 2,
    activeLevels: Array.isArray(source.activeLevels) && source.activeLevels.length
      ? source.activeLevels.slice()
      : DEFAULT_SETTINGS.activeLevels.slice(),
    replaceRatio: Math.min(0.3, Math.max(0.1, Number(source.replaceRatio))),
    maxReplaceCount: Math.min(5, Math.max(1, Math.floor(Number(source.maxReplaceCount) || 2))),
    targetCefr: LOCAL_CEFR_LEVELS.has(targetCefr) ? targetCefr : DEFAULT_SETTINGS.targetCefr
  };
}

function applySettingsToUI(settings) {
  const normalized = normalizeSettings(settings);
  runtimeSettings = normalized;
  enabledInput.checked = Boolean(normalized.enabled);
  if (webPageEnabledInput) {
    webPageEnabledInput.checked = normalized.webPageEnabled !== false;
  }
  replaceRatioInput.value = Number(normalized.replaceRatio).toFixed(2);
  maxReplaceCountInput.value = String(normalized.maxReplaceCount);
  targetCefrInput.value = normalized.targetCefr;
  reviewDanmakuSpeedInput.value = normalized.reviewDanmakuSpeed;
  if (vocabularyModeInput) {
    vocabularyModeInput.value = normalized.vocabularyMode;
  }
  if (examPreferenceInput) {
    examPreferenceInput.value = normalized.examPreference;
  }
  setActiveLevels(normalized.activeLevels);
  updateEnabledBadge(normalized.enabled);
  updateRatioLabel(normalized.replaceRatio);
  updateTargetCefrSummary(normalized.targetCefr);
  updateReviewSpeedSummary(normalized.reviewDanmakuSpeed);
  refreshDynamicPanels(normalized);
}

function getInitialOptionsSettings() {
  return normalizeSettings(DEFAULT_SETTINGS);
}

function hasStorageLocal() {
  return typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
}

async function saveSettingsToStorage(settings) {
  const payload = normalizeSettings(settings);
  if (!hasStorageLocal()) {
    runtimeSettings = payload;
    return payload;
  }

  await new Promise((resolve, reject) => {
    chrome.storage.local.set(payload, () => {
      const runtimeError = chrome.runtime && chrome.runtime.lastError;
      if (runtimeError) {
        reject(runtimeError);
        return;
      }
      resolve();
    });
  });

  runtimeSettings = payload;
  return payload;
}

async function loadSettingsFromStorage() {
  if (!hasStorageLocal()) {
    const snapshot = normalizeSettings(runtimeSettings);
    applySettingsToUI(snapshot);
    return snapshot;
  }

  const settings = await new Promise((resolve) => {
    chrome.storage.local.get(DEFAULT_SETTINGS, resolve);
  });
  applySettingsToUI(settings);
  return runtimeSettings;
}

function refreshUI() {
  refreshDynamicPanels(runtimeSettings);
}

function loadSettings() {
  if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
    applySettingsToUI(getInitialOptionsSettings());
    updateSettingsState("SAVE_SUCCESS", {
      statusMessage: "配置已同步，可编辑后手动保存。",
      timeoutMs: 1400
    });
    return;
  }

  chrome.storage.local.get(DEFAULT_SETTINGS, (settings) => {
    applySettingsToUI(settings);
    updateSettingsState("SAVE_SUCCESS", {
      statusMessage: "配置已同步，可编辑后手动保存。",
      timeoutMs: 1400
    });
  });
}

function saveSettings() {
  const payload = collectCurrentSettings();
  updateSettingsState("SAVE_START");
  setButtonBusy(saveButton, "保存中...", "保存设置");

  if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
    applySettingsToUI(payload);
    updateSettingsState("SAVE_SUCCESS", { statusMessage: "设置已保存并应用" });
    showToast("完整设置已保存");
    setButtonBusy(saveButton, "", "保存设置");
    return;
  }

  chrome.storage.local.set(payload, () => {
    const runtimeError = chrome.runtime && chrome.runtime.lastError;
    if (runtimeError) {
      updateSettingsState("SAVE_FAILURE");
      showToast("保存失败，请重试");
      setButtonBusy(saveButton, "", "保存设置");
      return;
    }
    applySettingsToUI(payload);
    if (adaptiveTuning && typeof adaptiveTuning.persistManualOverride === "function") {
      adaptiveTuning.persistManualOverride().catch(() => {});
    }
    updateSettingsState("SAVE_SUCCESS", { statusMessage: "设置已保存并应用" });
    showToast("完整设置已保存");
    setButtonBusy(saveButton, "", "保存设置");
  });
}

function getPresetKeyFromSettings(settings) {
  if (sharedSettings) {
    return sharedSettings.getPresetKeyFromSettings(settings);
  }

  const ratio = Number(settings.replaceRatio);
  const maxReplaceCount = Number(settings.maxReplaceCount);
  const speed = normalizeReviewDanmakuSpeed(settings.reviewDanmakuSpeed);

  if (ratio <= 0.15 && maxReplaceCount <= 1 && speed === "slow") {
    return "light";
  }
  if (ratio >= 0.3 && maxReplaceCount >= 4 && speed === "fast") {
    return "intensive";
  }
  return "balanced";
}

function buildSettingsPreviewFallback(settings) {
  const normalized = normalizeSettings(settings);
  if (!normalized.enabled) {
    return "当前字幕替换处于关闭状态。保存并启用后，扩展会按照你的学习目标自动调整词汇曝光。";
  }

  return `当前会在每句字幕中替换约 ${Math.round(normalized.replaceRatio * 100)}% 的词汇，单句最多 ${normalized.maxReplaceCount} 个词，帮助你以 ${normalized.targetCefr} 难度并结合 ${normalized.activeLevels.length} 个词库持续曝光；复习节奏为${getReviewDanmakuSpeedLabel(normalized.reviewDanmakuSpeed)}。`;
}

function syncScenePicker(settings) {
  const activePreset = getPresetKeyFromSettings(settings);
  sceneCards.forEach((card) => {
    const isActive = card.dataset.preset === activePreset;
    card.classList.toggle("is-active", isActive);
    card.setAttribute("aria-pressed", String(isActive));
  });
}

function initScenePicker() {
  sceneCards.forEach((card) => {
    const applyPreset = () => {
      const preset = SCENE_PRESETS[card.dataset.preset];
      if (!preset) {
        return;
      }

      markSettingsDirty(false);
      applySettingsToUI({ ...collectCurrentSettings(), ...preset });
      setStatus(`已应用${card.querySelector(".hub-scenario-card__title")?.textContent || "策略"}预设`, 1400);
    };

    card.addEventListener("click", applyPreset);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        applyPreset();
      }
    });
  });
}

function initScrollReveal() {
  if (!doc || typeof IntersectionObserver === "undefined") {
    return;
  }

  const revealTargets = Array.from(doc.querySelectorAll(".hub-reveal-target"));
  if (!revealTargets.length) {
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-revealed");
        observer.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.18
  });

  revealTargets.forEach((target) => observer.observe(target));
}

function refreshDynamicPanels(settings) {
  const snapshot = resolveSettingsSnapshot(settings);
  updateSettingsPreview(snapshot);
  updateRecommendationPanel(snapshot);
  updateMockPreview(snapshot);
  syncScenePicker(snapshot);
}

function bindEvents() {
  replaceRatioInput.addEventListener("input", () => {
    markSettingsDirty();
    updateRatioLabel(replaceRatioInput.value);
    refreshDynamicPanels();
  });

  enabledInput.addEventListener("change", () => {
    markSettingsDirty();
    updateEnabledBadge(enabledInput.checked);
    refreshDynamicPanels();
  });

  if (webPageEnabledInput) {
    webPageEnabledInput.addEventListener("change", () => {
      markSettingsDirty();
      refreshDynamicPanels();
    });
  }

  maxReplaceCountInput.addEventListener("input", () => {
    markSettingsDirty();
    refreshDynamicPanels();
  });

  targetCefrInput.addEventListener("change", () => {
    markSettingsDirty();
    updateTargetCefrSummary(targetCefrInput.value);
    refreshDynamicPanels();
  });

  reviewDanmakuSpeedInput.addEventListener("change", () => {
    markSettingsDirty();
    updateReviewSpeedSummary(reviewDanmakuSpeedInput.value);
    refreshDynamicPanels();
  });

  if (vocabularyModeInput) {
    vocabularyModeInput.addEventListener("change", () => {
      markSettingsDirty();
      refreshDynamicPanels();
    });
  }

  if (examPreferenceInput) {
    examPreferenceInput.addEventListener("change", () => {
      markSettingsDirty();
      refreshDynamicPanels();
    });
  }

  getLevelCheckboxes().forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      markSettingsDirty();
      updateLevelsSummary(collectActiveLevels());
      refreshDynamicPanels();
    });
  });

  saveButton.addEventListener("click", saveSettings);

  // 绑定新增按钮事件
  if (exportJsonButton) {
    exportJsonButton.addEventListener("click", () => exportVocabularyBook('json'));
  }
  if (exportCsvButton) {
    exportCsvButton.addEventListener("click", () => exportVocabularyBook('csv'));
  }
  if (exportAnkiButton) {
    exportAnkiButton.addEventListener("click", () => exportVocabularyBook("anki"));
  }
  if (clearVocabButton) {
    clearVocabButton.addEventListener("click", clearVocabularyBook);
  }
  if (exportSettingsButton) {
    exportSettingsButton.addEventListener("click", exportSettings);
  }
  if (importSettingsButton) {
    importSettingsButton.addEventListener("click", importSettings);
  }
  if (resetSettingsButton) {
    resetSettingsButton.addEventListener("click", resetSettings);
  }
}

function init() {
  bindEvents();
  initScenePicker();
  initScrollReveal();
  loadSettings();
  loadLearningStats(); // 加载学习统计数据
}

if (doc) {
  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SCENE_PRESETS,
    getInitialOptionsSettings,
    normalizeSettings: sharedSettings ? sharedSettings.normalizeSettings : normalizeSettings,
    getHeroMetricMeta: sharedSettings ? sharedSettings.getHeroMetricMeta : getHeroMetricMeta,
    getLearningProfile: sharedSettings ? sharedSettings.getLearningProfile : getLearningProfile,
    getRecommendationColor,
    renderRecommendationList,
    buildVocabularyExportPayload,
    importSettings,
    resetSettings
  };
}
