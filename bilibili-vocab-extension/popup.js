const DEFAULT_SETTINGS = {
  enabled: true,
  schemaVersion: 2,
  reviewDanmakuEnabled: false,
  reviewDanmakuSpeed: 'normal',
  webPageEnabled: true,
  domainRules: {},
  vocabularyMode: 'core',
  examPreference: 'balanced',
  activeLevels: ['CET4', 'CET6', 'KAOYAN', 'IELTS', 'TOEFL'],
  replaceRatio: 0.2,
  maxReplaceCount: 2,
  targetCefr: 'B2',
};

const CEFR_LEVELS = new Set(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
const sharedSettings =
  globalThis.SharedSettings ||
  (typeof require === 'function' ? require('./sharedSettings.js') : null);
const learningState =
  globalThis.LearningState ||
  (typeof require === 'function' ? require('./learningState.js') : null);
const adaptiveTuning =
  globalThis.AdaptiveTuning ||
  (typeof require === 'function' ? require('./adaptiveTuning.js') : null);
const uiStateMachine =
  globalThis.SettingsUiStateMachine ||
  (typeof require === 'function' ? require('./settingsUiStateMachine.js') : null);
const WORD_STATS_STORAGE_KEY = 'bili_vocab_word_stats_v1';
const LEARNING_WORD_STATS_STORAGE_KEY = learningState
  ? learningState.STORAGE_KEYS.WORD_STATS_V2
  : 'bili_vocab_word_stats_v2';
const REVIEW_QUEUE_STORAGE_KEY = learningState
  ? learningState.STORAGE_KEYS.REVIEW_QUEUE
  : 'bili_vocab_review_queue_v1';
const LEARNING_SUMMARY_STORAGE_KEY = learningState
  ? learningState.STORAGE_KEYS.LEARNING_SUMMARY
  : 'bili_vocab_learning_summary_v1';
const doc = typeof document !== 'undefined' ? document : null;

if (sharedSettings) {
  Object.assign(DEFAULT_SETTINGS, sharedSettings.DEFAULT_SETTINGS);
}

const enabledInput = doc ? doc.getElementById('enabled') : null;
const webPageEnabledInput = doc ? doc.getElementById('webPageEnabled') : null;
const enabledStateBadge = doc ? doc.getElementById('enabledStateBadge') : null;
const replaceRatioInput = doc ? doc.getElementById('replaceRatio') : null;
const replaceRatioValue = doc ? doc.getElementById('replaceRatioValue') : null;
const replaceRatioHeroValue = doc ? doc.getElementById('replaceRatioHeroValue') : null;
const maxReplaceCountInput = doc ? doc.getElementById('maxReplaceCount') : null;
const maxReplaceHeroValue = doc ? doc.getElementById('maxReplaceHeroValue') : null;
const targetCefrInput = doc ? doc.getElementById('targetCefr') : null;
const targetCefrHeroValue = doc ? doc.getElementById('targetCefrHeroValue') : null;
const vocabularyModeInput = doc ? doc.getElementById('vocabularyMode') : null;
const examPreferenceInput = doc ? doc.getElementById('examPreference') : null;
const previewModeTag = doc ? doc.getElementById('previewModeTag') : null;
const mockSubtitlePreview = doc ? doc.getElementById('mockSubtitlePreview') : null;
const previewCaption = doc ? doc.getElementById('previewCaption') : null;
const levelsSummary = doc ? doc.getElementById('levelsSummary') : null;
const settingsPreview = doc ? doc.getElementById('settingsPreview') : null;
const saveButton = doc ? doc.getElementById('saveButton') : null;
const openOptionsButton = doc ? doc.getElementById('openOptionsButton') : null;
const reviewDanmakuButton = doc ? doc.getElementById('reviewDanmakuButton') : null;
const reviewDanmakuState = doc ? doc.getElementById('reviewDanmakuState') : null;
const reviewModeHint = doc ? doc.getElementById('reviewModeHint') : null;
const reviewDanmakuSpeedInput = doc ? doc.getElementById('reviewDanmakuSpeed') : null;
const statusNode = doc ? doc.getElementById('status') : null;
const toastNode = doc ? doc.getElementById('toast') : null;
const siteScopeHint = doc ? doc.getElementById('siteScopeHint') : null;
const siteToggleButton = doc ? doc.getElementById('siteToggleButton') : null;
const rankingTabs = doc ? Array.from(doc.querySelectorAll('.popup-ranking-tab')) : [];
const rankingList = doc ? doc.getElementById('rankingList') : null;
const rankingEmpty = doc ? doc.getElementById('rankingEmpty') : null;
const rankingSummary = doc ? doc.getElementById('rankingSummary') : null;
const heroMetricMetaNodes = doc ? Array.from(doc.querySelectorAll('.hero-metric__meta')) : [];
const reviewCountTodayNode = doc ? doc.getElementById('reviewCountToday') : null;
const reviewNewWordsNode = doc ? doc.getElementById('reviewNewWords') : null;
const reviewMasteredWordsNode = doc ? doc.getElementById('reviewMasteredWords') : null;
const quickReviewButton = doc ? doc.getElementById('quickReviewButton') : null;
const quickReviewWord = doc ? doc.getElementById('quickReviewWord') : null;
const quickReviewMeta = doc ? doc.getElementById('quickReviewMeta') : null;
const quickReviewDescription = doc ? doc.getElementById('quickReviewDescription') : null;
const reviewActionKnow = doc ? doc.getElementById('reviewActionKnow') : null;
const reviewActionFuzzy = doc ? doc.getElementById('reviewActionFuzzy') : null;
const reviewActionForgot = doc ? doc.getElementById('reviewActionForgot') : null;

let rankingSort = 'asc';
let reviewDanmakuEnabled = DEFAULT_SETTINGS.reviewDanmakuEnabled;
let runtimeSettings = normalizeSettings(DEFAULT_SETTINGS);
let currentSiteState = {
  hostname: '',
  enabled: true,
  loading: false,
};
let quickReviewState = {
  stats: {},
  queue: {},
  summary: getEmptyLearningSummary(),
};
const uiStateController =
  uiStateMachine && typeof uiStateMachine.createStateController === 'function'
    ? uiStateMachine.createStateController('idle')
    : null;

const SETTINGS_STORAGE_KEYS =
  sharedSettings && Array.isArray(sharedSettings.SETTINGS_STORAGE_KEYS)
    ? sharedSettings.SETTINGS_STORAGE_KEYS
    : [
        'enabled',
        'webPageEnabled',
        'reviewDanmakuEnabled',
        'reviewDanmakuSpeed',
        'vocabularyMode',
        'examPreference',
        'activeLevels',
        'replaceRatio',
        'maxReplaceCount',
        'targetCefr',
        'domainRules',
        'schemaVersion',
      ];

function getLevelCheckboxes() {
  if (!doc) {
    return [];
  }

  return Array.from(doc.querySelectorAll('input[name="activeLevels"]'));
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

function collectCurrentSettings() {
  const formValues = {
    enabled: enabledInput ? enabledInput.checked : DEFAULT_SETTINGS.enabled,
    webPageEnabled: webPageEnabledInput
      ? webPageEnabledInput.checked
      : DEFAULT_SETTINGS.webPageEnabled,
    reviewDanmakuEnabled,
    reviewDanmakuSpeed: reviewDanmakuSpeedInput
      ? reviewDanmakuSpeedInput.value
      : DEFAULT_SETTINGS.reviewDanmakuSpeed,
    vocabularyMode: vocabularyModeInput
      ? vocabularyModeInput.value
      : DEFAULT_SETTINGS.vocabularyMode,
    examPreference: examPreferenceInput
      ? examPreferenceInput.value
      : DEFAULT_SETTINGS.examPreference,
    activeLevels: collectActiveLevels(),
    replaceRatio: replaceRatioInput ? replaceRatioInput.value : DEFAULT_SETTINGS.replaceRatio,
    maxReplaceCount: maxReplaceCountInput
      ? maxReplaceCountInput.value
      : DEFAULT_SETTINGS.maxReplaceCount,
    targetCefr: targetCefrInput ? targetCefrInput.value : DEFAULT_SETTINGS.targetCefr,
  };

  if (sharedSettings && typeof sharedSettings.buildSettingsPayload === 'function') {
    return sharedSettings.buildSettingsPayload(runtimeSettings, formValues);
  }

  return normalizeSettings({
    ...runtimeSettings,
    ...formValues,
    domainRules: runtimeSettings.domainRules || {},
    schemaVersion: runtimeSettings.schemaVersion || DEFAULT_SETTINGS.schemaVersion,
  });
}

function resolveSettingsSnapshot(settings) {
  if (settings && typeof settings === 'object') {
    return normalizeSettings(settings);
  }

  return collectCurrentSettings();
}

function showToast(message) {
  if (!toastNode) {
    return;
  }

  toastNode.textContent = message;
  toastNode.classList.add('is-visible');

  clearTimeout(showToast.timerId);
  showToast.timerId = setTimeout(() => {
    toastNode.classList.remove('is-visible');
  }, 2200);
}

function setStatus(message, timeoutMs = 1800) {
  if (!statusNode) {
    return;
  }

  statusNode.textContent = message;
  clearTimeout(setStatus.timerId);
  if (Number(timeoutMs) > 0) {
    setStatus.timerId = setTimeout(() => {
      statusNode.textContent = '';
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

  const message = options.statusMessage || uiStateController.getMessage({ channel: 'status' });
  const timeoutMs = Object.prototype.hasOwnProperty.call(options, 'timeoutMs')
    ? options.timeoutMs
    : nextState === 'dirty' || nextState === 'saving'
      ? 0
      : 1800;
  setStatus(message, timeoutMs);
  return nextState;
}

function getChromeRuntimeError() {
  if (typeof chrome === 'undefined' || !chrome.runtime) {
    return null;
  }

  return chrome.runtime.lastError || null;
}

function readChromeLocalStorage(keysOrDefaults, onSuccess, onError) {
  chrome.storage.local.get(keysOrDefaults, (payload) => {
    const runtimeError = getChromeRuntimeError();
    if (runtimeError) {
      if (typeof onError === 'function') {
        onError(runtimeError);
      }
      return;
    }

    if (typeof onSuccess === 'function') {
      onSuccess(payload);
    }
  });
}

function markSettingsDirty(renderStatus = true) {
  updateSettingsState('USER_EDIT', { renderStatus: false });
  updateSettingsState('MARK_DIRTY', { renderStatus });
}

function refreshPreviewPanels(settings) {
  const nextSettings = resolveSettingsSnapshot(settings);
  updateSettingsPreview(nextSettings);
  updateMockPreview(nextSettings);
}

function normalizeHostname(hostname) {
  if (sharedSettings && typeof sharedSettings.normalizeHostname === 'function') {
    return sharedSettings.normalizeHostname(hostname);
  }

  return String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/\.+$/, '');
}

function getLearningStatusLabel(status) {
  if (learningState && typeof learningState.getStatusLabel === 'function') {
    return learningState.getStatusLabel(status);
  }

  const normalized = String(status || '')
    .trim()
    .toLowerCase();
  if (normalized === 'saved') return '已收藏';
  if (normalized === 'mastered') return '已掌握';
  if (normalized === 'seen' || normalized === 'learning' || normalized === 'reviewing')
    return '已遇见';
  if (normalized === 'unseen' || normalized === 'new') return '未巩固';
  if (normalized === 'skipped') return '已跳过';
  return '待判断';
}

function evaluateCurrentSiteEnabled(hostname, settings) {
  if (!hostname) {
    return true;
  }
  if (sharedSettings && typeof sharedSettings.isDomainEnabled === 'function') {
    return sharedSettings.isDomainEnabled(hostname, settings);
  }
  return true;
}

function updateSiteControls(settings) {
  runtimeSettings = normalizeSettings(settings);

  if (!siteScopeHint || !siteToggleButton) {
    return;
  }

  if (!currentSiteState.hostname) {
    siteScopeHint.textContent = '当前无法识别站点域名';
    siteToggleButton.textContent = '站点控制不可用';
    siteToggleButton.disabled = true;
    return;
  }

  currentSiteState.enabled = evaluateCurrentSiteEnabled(currentSiteState.hostname, runtimeSettings);
  siteScopeHint.textContent = `当前站点：${currentSiteState.hostname}`;
  siteToggleButton.textContent = currentSiteState.enabled ? '暂停当前站点' : '恢复当前站点';
  siteToggleButton.disabled = currentSiteState.loading;
}

function initCurrentSiteState() {
  if (typeof chrome === 'undefined' || !chrome.tabs || typeof chrome.tabs.query !== 'function') {
    updateSiteControls(runtimeSettings);
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = Array.isArray(tabs) && tabs.length ? tabs[0] : null;
    const url = activeTab && typeof activeTab.url === 'string' ? activeTab.url : '';
    let hostname = '';

    try {
      hostname = url ? normalizeHostname(new URL(url).hostname) : '';
    } catch (_error) {
      hostname = '';
    }

    currentSiteState.hostname = hostname;
    updateSiteControls(runtimeSettings);
  });
}

function toggleCurrentSiteScope() {
  if (
    !currentSiteState.hostname ||
    typeof chrome === 'undefined' ||
    !chrome.storage ||
    !chrome.storage.local
  ) {
    return;
  }

  currentSiteState.loading = true;
  updateSiteControls(runtimeSettings);
  const nextEnabled = !currentSiteState.enabled;

  const nextDomainRules = {
    ...(runtimeSettings.domainRules || {}),
  };

  if (nextEnabled) {
    delete nextDomainRules[currentSiteState.hostname];
  } else {
    nextDomainRules[currentSiteState.hostname] = {
      enabled: false,
    };
  }

  const nextSettings = sharedSettings
    ? sharedSettings.normalizeSettings({
        ...runtimeSettings,
        domainRules: nextDomainRules,
      })
    : normalizeSettings({
        ...runtimeSettings,
        domainRules: nextDomainRules,
      });

  chrome.storage.local.set(
    {
      domainRules: nextSettings.domainRules,
      schemaVersion: nextSettings.schemaVersion || DEFAULT_SETTINGS.schemaVersion,
    },
    () => {
      const runtimeError = getChromeRuntimeError();
      currentSiteState.loading = false;
      if (runtimeError) {
        updateSiteControls(runtimeSettings);
        setStatus('当前站点切换失败，请重试');
        showToast('站点设置保存失败');
        return;
      }

      runtimeSettings = nextSettings;
      currentSiteState.enabled = nextEnabled;
      updateSiteControls(runtimeSettings);
      setStatus(nextEnabled ? '当前站点已恢复' : '当前站点已暂停');
      showToast(`${currentSiteState.hostname} · ${nextEnabled ? '已恢复' : '已暂停'}`);
    }
  );
}

function normalizeTargetCefr(value) {
  if (sharedSettings) {
    return sharedSettings.normalizeTargetCefr(value);
  }

  const targetCefr = String(value || DEFAULT_SETTINGS.targetCefr)
    .trim()
    .toUpperCase();
  return CEFR_LEVELS.has(targetCefr) ? targetCefr : DEFAULT_SETTINGS.targetCefr;
}

function normalizeReviewDanmakuEnabled(value) {
  return value === true;
}

function normalizeReviewDanmakuSpeed(value) {
  if (sharedSettings) {
    return sharedSettings.normalizeReviewDanmakuSpeed(value);
  }

  const normalized = String(value || DEFAULT_SETTINGS.reviewDanmakuSpeed)
    .trim()
    .toLowerCase();
  return ['slow', 'normal', 'fast'].includes(normalized)
    ? normalized
    : DEFAULT_SETTINGS.reviewDanmakuSpeed;
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
    vocabularyMode:
      String(source.vocabularyMode || DEFAULT_SETTINGS.vocabularyMode)
        .trim()
        .toLowerCase() === 'full'
        ? 'full'
        : 'core',
    examPreference:
      String(source.examPreference || DEFAULT_SETTINGS.examPreference)
        .trim()
        .toLowerCase() === 'exam-first'
        ? 'exam-first'
        : 'balanced',
    domainRules:
      source.domainRules && typeof source.domainRules === 'object' ? source.domainRules : {},
    schemaVersion: Number(source.schemaVersion) || DEFAULT_SETTINGS.schemaVersion || 2,
    activeLevels:
      Array.isArray(source.activeLevels) && source.activeLevels.length
        ? source.activeLevels.slice()
        : DEFAULT_SETTINGS.activeLevels.slice(),
    replaceRatio: Math.min(0.3, Math.max(0.1, Number(source.replaceRatio))),
    maxReplaceCount: Math.min(
      5,
      Math.max(1, Math.floor(Number(source.maxReplaceCount) || DEFAULT_SETTINGS.maxReplaceCount))
    ),
    targetCefr: CEFR_LEVELS.has(targetCefr) ? targetCefr : DEFAULT_SETTINGS.targetCefr,
  };
}

function getReviewDanmakuSpeedLabel(speed) {
  if (sharedSettings) {
    return sharedSettings.getReviewDanmakuSpeedLabel(speed);
  }

  const preset = normalizeReviewDanmakuSpeed(speed);
  if (preset === 'slow') {
    return '慢';
  }
  if (preset === 'fast') {
    return '快';
  }
  return '标准';
}

function getReviewDanmakuButtonLabel(enabled) {
  return normalizeReviewDanmakuEnabled(enabled) ? '停止复习弹幕' : '启动复习弹幕';
}

function getHeroMetricMeta(type, value) {
  if (sharedSettings) {
    return sharedSettings.getHeroMetricMeta(type, value);
  }

  if (type === 'ratio') {
    const ratio = Math.min(0.3, Math.max(0.1, Number(value) || DEFAULT_SETTINGS.replaceRatio));
    if (ratio <= 0.15) {
      return '轻量低扰';
    }
    if (ratio >= 0.25) {
      return '强化输入';
    }
    return '均衡曝光';
  }

  if (type === 'reviewSpeed') {
    const speed = normalizeReviewDanmakuSpeed(value);
    if (speed === 'slow') {
      return '低压慢复习';
    }
    if (speed === 'fast') {
      return '冲刺高频';
    }
    return '稳定推进';
  }

  if (type === 'maxReplace') {
    const count = Math.min(
      5,
      Math.max(1, Math.floor(Number(value) || DEFAULT_SETTINGS.maxReplaceCount))
    );
    if (count >= 4) {
      return '高密度命中';
    }
    if (count <= 1) {
      return '轻量点状';
    }
    return '低干扰节奏';
  }

  if (type === 'cefr') {
    const cefr = normalizeTargetCefr(value);
    if (['A1', 'A2'].includes(cefr)) {
      return '稳步入门';
    }
    if (['C1', 'C2'].includes(cefr)) {
      return '进阶挑战';
    }
    return '渐进提升';
  }

  return '实时同步';
}

function getReviewDanmakuStateLabel(enabled) {
  return normalizeReviewDanmakuEnabled(enabled) ? '运行中' : '未启动';
}

function getReviewHintText(speed) {
  const preset = normalizeReviewDanmakuSpeed(speed);
  if (preset === 'slow') {
    return '当前适合低压力复习，建议在首次接触新视频或新词阶段使用。';
  }
  if (preset === 'fast') {
    return '当前更偏高频冲刺复习，适合你已经基本理解视频内容后强化记忆。';
  }
  return '当前适合标准节奏复习，兼顾理解和曝光频率。';
}

function getRankingSummaryText(items, sortMode) {
  if (!Array.isArray(items) || items.length === 0) {
    return '等待数据';
  }

  const top = items[0];
  return sortMode === 'desc'
    ? `最高频：${top.word} · ${top.hitCount} 次`
    : `待巩固：${top.word} · ${top.hitCount} 次`;
}

function getRelativeSeenText(lastSeen) {
  if (!lastSeen) {
    return '最近记录未知';
  }

  const diff = Date.now() - Number(lastSeen);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  if (diff < hour) {
    return `${Math.max(1, Math.floor(diff / minute))} 分钟前`;
  }
  if (diff < 24 * hour) {
    return `${Math.max(1, Math.floor(diff / hour))} 小时前`;
  }
  return `${Math.max(1, Math.floor(diff / (24 * hour)))} 天前`;
}

function getMockPreviewData(targetCefr, ratio, maxReplaceCount) {
  if (sharedSettings) {
    return sharedSettings.getMockPreviewData(targetCefr, ratio, maxReplaceCount);
  }

  const presetMap = {
    A1: ['learn', 'watch', 'word'],
    A2: ['improve', 'listen', 'memory'],
    B1: ['build', 'focus', 'exposure'],
    B2: ['system', 'listening', 'context'],
    C1: ['establish', 'retention', 'comprehension'],
    C2: ['internalize', 'lexicon', 'fluency'],
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
      tone: 'gentle',
      label: '轻量待机',
      summary: '当前未启用，可随时恢复温和输入',
    };
  }

  if (ratio >= 0.25 || maxReplaceCount >= 4) {
    return {
      tone: 'intensive',
      label: '强化曝光',
      summary: '适合熟悉内容后集中强化词汇刺激',
    };
  }

  if (ratio <= 0.15 && maxReplaceCount <= 2) {
    return {
      tone: 'gentle',
      label: '轻量输入',
      summary: '尽量保留字幕流畅性，降低理解压力',
    };
  }

  return {
    tone: 'balanced',
    label: '均衡输入',
    summary: '理解优先，保持稳定词汇曝光',
  };
}

function syncSurfaceTone(profile) {
  if (!doc || !profile) {
    return;
  }

  doc.body.dataset.learningTone = profile.tone;
}

function setButtonBusy(button, busyText, idleText) {
  if (!button) {
    return;
  }

  if (button.dataset.defaultLabel == null || button.dataset.defaultLabel === '') {
    button.dataset.defaultLabel = idleText || button.textContent;
  }

  const isBusy = Boolean(busyText);
  button.disabled = isBusy;
  button.classList.toggle('is-busy', isBusy);
  button.textContent = isBusy ? busyText : idleText || button.dataset.defaultLabel;
}

function clearTransientStatus() {
  if (statusNode) {
    statusNode.textContent = '';
  }

  if (toastNode) {
    toastNode.classList.remove('is-visible');
  }
}

function pulsePreviewCard() {
  if (!mockSubtitlePreview) {
    return;
  }

  mockSubtitlePreview.classList.remove('is-pulsing');
  void mockSubtitlePreview.offsetWidth;
  mockSubtitlePreview.classList.add('is-pulsing');
}

function refreshHeroState() {
  if (!doc) {
    return;
  }

  const enabled = enabledInput ? enabledInput.checked : DEFAULT_SETTINGS.enabled;
  doc.body.classList.toggle('is-extension-enabled', Boolean(enabled));
}

function updateMockPreview(settings) {
  if (!mockSubtitlePreview || !previewModeTag || !previewCaption) {
    return;
  }

  const snapshot = resolveSettingsSnapshot(settings);
  const ratio = Math.min(
    0.3,
    Math.max(0.1, Number(snapshot.replaceRatio) || DEFAULT_SETTINGS.replaceRatio)
  );
  const maxReplaceCount = Math.min(
    5,
    Math.max(1, Math.floor(Number(snapshot.maxReplaceCount) || DEFAULT_SETTINGS.maxReplaceCount))
  );
  const targetCefr = normalizeTargetCefr(snapshot.targetCefr);
  const enabled = snapshot.enabled !== false;
  const previewWords = getMockPreviewData(targetCefr, ratio, maxReplaceCount);
  const [firstWord = 'system', secondWord = 'listening', thirdWord = 'context'] = previewWords;
  const profile = getLearningProfile({ ratio, maxReplaceCount, enabled });

  previewModeTag.textContent = profile.label;
  previewModeTag.dataset.tone = profile.tone;
  mockSubtitlePreview.innerHTML = `预览：我今天想 <span class="preview-word">${firstWord}</span> 提升英语 <span class="preview-word">${secondWord}</span>${previewWords[2] ? ` 和 <span class="preview-word">${thirdWord}</span>` : ''}。`;
  previewCaption.textContent = `${profile.summary} 当前目标难度：${targetCefr}。`;
  syncSurfaceTone(profile);
  pulsePreviewCard();
}

function updateEnabledBadge(enabled) {
  if (!enabledStateBadge) {
    return;
  }

  const active = Boolean(enabled);
  enabledStateBadge.textContent = active ? '已启用' : '未启用';
  enabledStateBadge.classList.toggle('state-badge--on', active);
  enabledStateBadge.classList.toggle('state-badge--off', !active);
  refreshHeroState();
}

function getReplaceRatioPercentText(value) {
  const ratio = Math.min(0.3, Math.max(0.1, Number(value) || DEFAULT_SETTINGS.replaceRatio));
  return `${Math.round(ratio * 100)}%`;
}

function updateRatioLabel(value) {
  const numericValue = Number(value || DEFAULT_SETTINGS.replaceRatio);

  if (replaceRatioValue) {
    replaceRatioValue.textContent = numericValue.toFixed(2);
  }

  if (replaceRatioHeroValue) {
    replaceRatioHeroValue.textContent = getReplaceRatioPercentText(numericValue);
  }

  if (heroMetricMetaNodes[0]) {
    heroMetricMetaNodes[0].textContent = getHeroMetricMeta('ratio', numericValue);
  }
}

function updateMaxReplaceSummary(value) {
  if (!maxReplaceHeroValue) {
    return;
  }

  const count = Math.min(
    5,
    Math.max(1, Math.floor(Number(value) || DEFAULT_SETTINGS.maxReplaceCount))
  );
  maxReplaceHeroValue.textContent = `${count} 词`;

  if (heroMetricMetaNodes[2]) {
    heroMetricMetaNodes[2].textContent = getHeroMetricMeta('maxReplace', count);
  }
}

function updateTargetCefrSummary(value) {
  if (!targetCefrHeroValue) {
    return;
  }

  const cefr = normalizeTargetCefr(value);
  targetCefrHeroValue.textContent = cefr;

  if (heroMetricMetaNodes[1]) {
    heroMetricMetaNodes[1].textContent = getHeroMetricMeta('cefr', cefr);
  }
}

function updateLevelsSummary(levels) {
  if (!levelsSummary) {
    return;
  }

  const count = Array.isArray(levels) ? levels.length : collectActiveLevels().length;
  levelsSummary.textContent = `已选择 ${count} 个词库`;
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

function getQuickReviewEmptyState() {
  return {
    title: '当前没有待复习词',
    description: '继续看一段带字幕的视频，系统会把新命中的词汇自动加入复习池。',
  };
}

function formatReviewCountText(summary) {
  const payload = summary || {};
  return `今日待复习 ${Math.max(0, Math.floor(Number(payload.todayCount) || 0))}`;
}

function getReviewBucketLabel(bucket) {
  if (learningState && typeof learningState.getReviewBucketLabel === 'function') {
    return learningState.getReviewBucketLabel(bucket);
  }

  if (bucket === 'soon') {
    return '即将复习';
  }
  if (bucket === 'later') {
    return '后续回顾';
  }
  return '今日优先';
}

function normalizeReviewTimestamp(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return null;
  }
  return Math.floor(timestamp);
}

function formatReviewDueText(nextReviewAt, now = Date.now()) {
  const dueAt = normalizeReviewTimestamp(nextReviewAt);
  const current = normalizeReviewTimestamp(now) || Date.now();
  if (dueAt == null) {
    return '时间待定';
  }

  const delta = dueAt - current;
  if (delta <= 0) {
    return '现在复习';
  }

  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < hour) {
    const minutes = Math.max(1, Math.round(delta / minute));
    return `${minutes} 分钟后`;
  }
  if (delta < day) {
    const hours = Math.max(1, Math.round(delta / hour));
    return `${hours} 小时后`;
  }
  const days = Math.max(1, Math.round(delta / day));
  return `${days} 天后`;
}

function sortQuickReviewItems(items) {
  const bucketRank = {
    today: 0,
    soon: 1,
    later: 2,
  };
  const source = Array.isArray(items)
    ? items.filter((item) => Boolean(item) && typeof item === 'object')
    : [];
  return source.sort((left, right) => {
    const leftRank = Object.prototype.hasOwnProperty.call(bucketRank, left.dueBucket)
      ? bucketRank[left.dueBucket]
      : 9;
    const rightRank = Object.prototype.hasOwnProperty.call(bucketRank, right.dueBucket)
      ? bucketRank[right.dueBucket]
      : 9;
    const bucketDiff = leftRank - rightRank;
    if (bucketDiff !== 0) {
      return bucketDiff;
    }

    const leftDue = normalizeReviewTimestamp(left.nextReviewAt) || Number.POSITIVE_INFINITY;
    const rightDue = normalizeReviewTimestamp(right.nextReviewAt) || Number.POSITIVE_INFINITY;
    if (leftDue !== rightDue) {
      return leftDue - rightDue;
    }

    const leftUpdated = normalizeReviewTimestamp(left.updatedAt) || 0;
    const rightUpdated = normalizeReviewTimestamp(right.updatedAt) || 0;
    if (rightUpdated !== leftUpdated) {
      return rightUpdated - leftUpdated;
    }

    return String(left.word || '').localeCompare(String(right.word || ''));
  });
}

function normalizeLearningStats(rawStats) {
  if (!learningState || !rawStats || typeof rawStats !== 'object') {
    return {};
  }

  const normalized = {};
  Object.keys(rawStats).forEach((key) => {
    const item = rawStats[key];
    if (!item || typeof item !== 'object') {
      return;
    }

    const normalizedItem = learningState.normalizeLearningRecord(item, {
      word: item.word || key,
      level: item.level,
    });
    if (!normalizedItem.word) {
      return;
    }
    normalized[normalizedItem.word] = normalizedItem;
  });

  return normalized;
}

function getQuickReviewItems(limit = 5) {
  if (!learningState) {
    return [];
  }

  const queue = learningState.normalizeReviewQueue(quickReviewState.queue);

  const items = Object.values(queue)
    .map((item) => {
      const record = quickReviewState.stats[item.word];
      if (!record) {
        return null;
      }

      return {
        word: record.word,
        translation: record.translation,
        level: record.level,
        status: record.status,
        dueBucket: item.dueBucket,
        nextReviewAt: normalizeReviewTimestamp(item.nextReviewAt),
        intervalDays: Number(item.intervalDays) || null,
        easeFactor: Number(item.easeFactor) || null,
        updatedAt: normalizeReviewTimestamp(item.updatedAt || record.lastSeenAt || 0) || 0,
      };
    })
    .filter(Boolean);

  return sortQuickReviewItems(items).slice(0, limit);
}

function getEmptyLearningSummary() {
  return learningState
    ? learningState.buildLearningSummary({}, {})
    : {
        todayCount: 0,
        newCount: 0,
        masteredCount: 0,
        recentWords: [],
      };
}

function resetLearningDashboardState() {
  quickReviewState = {
    stats: {},
    queue: {},
    summary: getEmptyLearningSummary(),
  };
  return quickReviewState;
}

function renderLearningSummary() {
  const summary = quickReviewState.summary || {};
  if (reviewCountTodayNode) {
    reviewCountTodayNode.textContent = formatReviewCountText(summary);
  }
  if (reviewNewWordsNode) {
    reviewNewWordsNode.textContent = String(summary.newCount || 0);
  }
  if (reviewMasteredWordsNode) {
    reviewMasteredWordsNode.textContent = String(summary.masteredCount || 0);
  }
}

function renderQuickReviewCard() {
  const items = getQuickReviewItems(5);
  const currentItem = items[0] || null;
  quickReviewState.currentItem = currentItem;

  if (!currentItem) {
    const emptyState = getQuickReviewEmptyState();
    if (quickReviewWord) {
      quickReviewWord.textContent = emptyState.title;
    }
    if (quickReviewMeta) {
      quickReviewMeta.textContent = '继续观看带字幕的视频后，这里会出现本轮优先回顾词。';
    }
    if (quickReviewDescription) {
      quickReviewDescription.textContent = emptyState.description;
    }
    if (quickReviewButton) {
      quickReviewButton.disabled = true;
    }
    [reviewActionKnow, reviewActionFuzzy, reviewActionForgot].forEach((button) => {
      if (button) {
        button.disabled = true;
      }
    });
    return;
  }

  if (quickReviewWord) {
    quickReviewWord.textContent = `${currentItem.word} · ${currentItem.translation || '-'}`;
  }
  if (quickReviewMeta) {
    quickReviewMeta.textContent = `${currentItem.level} · ${getReviewBucketLabel(currentItem.dueBucket)} · ${formatReviewDueText(currentItem.nextReviewAt)} · 当前状态 ${getLearningStatusLabel(currentItem.status)}`;
  }
  if (quickReviewDescription) {
    quickReviewDescription.textContent = '点击下方按钮，快速标记你对这个词的掌握程度。';
  }
  if (quickReviewButton) {
    quickReviewButton.disabled = false;
  }
  [reviewActionKnow, reviewActionFuzzy, reviewActionForgot].forEach((button) => {
    if (button) {
      button.disabled = false;
    }
  });
}

function readLearningDashboard(callback) {
  if (!learningState || typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
    quickReviewState = resetLearningDashboardState();
    callback(quickReviewState);
    return;
  }

  readChromeLocalStorage(
    [
      WORD_STATS_STORAGE_KEY,
      LEARNING_WORD_STATS_STORAGE_KEY,
      REVIEW_QUEUE_STORAGE_KEY,
      LEARNING_SUMMARY_STORAGE_KEY,
    ],
    (payload) => {
      let stats = normalizeLearningStats(payload ? payload[LEARNING_WORD_STATS_STORAGE_KEY] : null);
      const queue = learningState.normalizeReviewQueue(
        payload ? payload[REVIEW_QUEUE_STORAGE_KEY] : null
      );
      if (
        Object.keys(stats).length === 0 &&
        payload &&
        payload[WORD_STATS_STORAGE_KEY] &&
        typeof payload[WORD_STATS_STORAGE_KEY] === 'object'
      ) {
        Object.keys(payload[WORD_STATS_STORAGE_KEY]).forEach((key) => {
          const item = payload[WORD_STATS_STORAGE_KEY][key];
          const migrated = learningState.migrateLegacyStat(item);
          if (!migrated.word) {
            return;
          }
          stats[migrated.word] = migrated;
        });
      }
      const summary =
        payload &&
        payload[LEARNING_SUMMARY_STORAGE_KEY] &&
        typeof payload[LEARNING_SUMMARY_STORAGE_KEY] === 'object'
          ? payload[LEARNING_SUMMARY_STORAGE_KEY]
          : learningState.buildLearningSummary(stats, queue);

      quickReviewState = {
        stats,
        queue,
        summary,
      };
      callback(quickReviewState);
    },
    () => {
      quickReviewState = resetLearningDashboardState();
      setStatus('学习数据读取失败，请重试');
      callback(quickReviewState);
    }
  );
}

function buildNextQuickReviewState(word, nextRecord, now) {
  return {
    ...quickReviewState,
    stats: {
      ...quickReviewState.stats,
      [word]: nextRecord,
    },
    queue: learningState.syncReviewQueue(quickReviewState.queue, nextRecord, now),
  };
}

function persistLearningDashboard(nextState, callback) {
  const state = nextState && typeof nextState === 'object' ? nextState : quickReviewState;
  const committedState = learningState
    ? {
        ...state,
        summary: learningState.buildLearningSummary(state.stats, state.queue),
      }
    : state;

  if (!learningState || typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
    if (typeof callback === 'function') {
      callback(null, committedState);
    }
    return;
  }

  chrome.storage.local.set(
    {
      [LEARNING_WORD_STATS_STORAGE_KEY]: committedState.stats,
      [REVIEW_QUEUE_STORAGE_KEY]: committedState.queue,
      [LEARNING_SUMMARY_STORAGE_KEY]: committedState.summary,
    },
    () => {
      if (typeof callback === 'function') {
        callback(getChromeRuntimeError(), committedState);
      }
    }
  );
}

function persistQuickReviewAdaptiveFeedback(normalizedAction, now) {
  if (!adaptiveTuning || typeof adaptiveTuning.persistFeedback !== 'function') {
    return;
  }

  try {
    const result = adaptiveTuning.persistFeedback(normalizedAction, { now });
    if (result && typeof result.then === 'function') {
      result
        .then((outcome) => {
          if (outcome && outcome.applied) {
            showToast('已根据最近反馈自动微调学习策略');
          }
        })
        .catch(() => {});
    }
  } catch (_error) {
    // Ignore adaptive tuning failures to keep quick review responsive.
  }
}

function handleQuickReviewFeedback(feedback) {
  if (!learningState || !quickReviewState.currentItem) {
    return;
  }

  const word = quickReviewState.currentItem.word;
  const record = quickReviewState.stats[word];
  if (!record) {
    return;
  }

  const normalizedAction = String(feedback || '')
    .trim()
    .toLowerCase();
  const now = Date.now();
  const nextRecord =
    typeof learningState.applyLearningAction === 'function'
      ? learningState.applyLearningAction(record, normalizedAction, now)
      : learningState.applyReviewFeedback(record, normalizedAction, now);
  const nextState = buildNextQuickReviewState(word, nextRecord, now);

  persistLearningDashboard(nextState, (runtimeError, committedState) => {
    if (runtimeError) {
      setStatus('快速复习保存失败，请重试');
      showToast('复习结果未保存');
      return;
    }

    quickReviewState = committedState;
    renderLearningSummary();
    renderQuickReviewCard();

    const actionText =
      feedback === 'know'
        ? '已标记为认识'
        : feedback === 'fuzzy'
          ? '已标记为模糊'
          : '已标记为不认识';
    const adaptiveHint =
      adaptiveTuning && typeof adaptiveTuning.getAdaptiveHint === 'function'
        ? adaptiveTuning.getAdaptiveHint(null, now)
        : '';
    setStatus(adaptiveHint ? `${actionText} · ${adaptiveHint}` : actionText);
    showToast(`${word} · ${actionText}`);
    persistQuickReviewAdaptiveFeedback(normalizedAction, now);
  });
}

function setActiveLevels(levels) {
  const selectedLevels = sharedSettings
    ? sharedSettings.normalizeActiveLevels(levels)
    : Array.isArray(levels)
      ? levels
      : DEFAULT_SETTINGS.activeLevels;
  const selected = new Set(selectedLevels);
  getLevelCheckboxes().forEach((checkbox) => {
    checkbox.checked = selected.has(checkbox.value);
  });
  updateLevelsSummary(Array.from(selected));
}

function renderReviewDanmakuState(enabled) {
  reviewDanmakuEnabled = normalizeReviewDanmakuEnabled(enabled);

  if (reviewDanmakuButton) {
    reviewDanmakuButton.textContent = getReviewDanmakuButtonLabel(reviewDanmakuEnabled);
    reviewDanmakuButton.classList.toggle('is-active', reviewDanmakuEnabled);
  }

  if (reviewDanmakuState) {
    reviewDanmakuState.textContent = getReviewDanmakuStateLabel(reviewDanmakuEnabled);
    reviewDanmakuState.classList.toggle('is-active', reviewDanmakuEnabled);
  }
}

function renderReviewDanmakuSpeed(speed) {
  if (!reviewDanmakuSpeedInput) {
    return;
  }

  reviewDanmakuSpeedInput.value = normalizeReviewDanmakuSpeed(speed);

  if (reviewModeHint) {
    reviewModeHint.textContent = getReviewHintText(speed);
  }
}

function applySettingsToUI(settings) {
  runtimeSettings = normalizeSettings(settings);

  if (enabledInput) {
    enabledInput.checked = Boolean(runtimeSettings.enabled);
  }

  if (webPageEnabledInput) {
    webPageEnabledInput.checked = runtimeSettings.webPageEnabled !== false;
  }

  if (replaceRatioInput) {
    replaceRatioInput.value = Number(runtimeSettings.replaceRatio).toFixed(2);
  }

  if (maxReplaceCountInput) {
    maxReplaceCountInput.value = String(
      runtimeSettings.maxReplaceCount || DEFAULT_SETTINGS.maxReplaceCount
    );
  }

  if (targetCefrInput) {
    targetCefrInput.value = normalizeTargetCefr(runtimeSettings.targetCefr);
  }
  if (vocabularyModeInput) {
    vocabularyModeInput.value = runtimeSettings.vocabularyMode || DEFAULT_SETTINGS.vocabularyMode;
  }
  if (examPreferenceInput) {
    examPreferenceInput.value = runtimeSettings.examPreference || DEFAULT_SETTINGS.examPreference;
  }

  renderReviewDanmakuState(runtimeSettings.reviewDanmakuEnabled);
  renderReviewDanmakuSpeed(runtimeSettings.reviewDanmakuSpeed);
  setActiveLevels(runtimeSettings.activeLevels);
  updateEnabledBadge(runtimeSettings.enabled);
  updateRatioLabel(runtimeSettings.replaceRatio);
  updateMaxReplaceSummary(runtimeSettings.maxReplaceCount);
  updateTargetCefrSummary(runtimeSettings.targetCefr);
  refreshPreviewPanels(runtimeSettings);
  updateSiteControls(runtimeSettings);
}

function getInitialPopupSettings() {
  return normalizeSettings(DEFAULT_SETTINGS);
}

function buildSettingsPreviewFallback(settings) {
  const enabled = settings.enabled !== false;
  const ratio = Math.min(
    0.3,
    Math.max(0.1, Number(settings.replaceRatio) || DEFAULT_SETTINGS.replaceRatio)
  );
  const maxReplaceCount = Math.min(
    5,
    Math.max(1, Math.floor(Number(settings.maxReplaceCount) || DEFAULT_SETTINGS.maxReplaceCount))
  );
  const targetCefr = normalizeTargetCefr(settings.targetCefr);
  const activeLevels =
    Array.isArray(settings.activeLevels) && settings.activeLevels.length
      ? settings.activeLevels
      : DEFAULT_SETTINGS.activeLevels;

  return enabled
    ? `当前会在每句字幕中替换约 ${Math.round(ratio * 100)}% 的词汇，单句最多 ${maxReplaceCount} 个词，帮助你以 ${targetCefr} 难度并结合 ${activeLevels.length} 个词库持续曝光；复习节奏为${getReviewDanmakuSpeedLabel(settings.reviewDanmakuSpeed)}。`
    : '当前字幕替换处于关闭状态。保存并启用后，扩展会按照你的学习目标自动调整词汇曝光。';
}

function loadSettings() {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
    applySettingsToUI(getInitialPopupSettings());
    updateSettingsState('SAVE_SUCCESS', {
      statusMessage: '配置已同步，可编辑后手动保存。',
      timeoutMs: 1400,
    });
    return;
  }

  readChromeLocalStorage(
    DEFAULT_SETTINGS,
    (settings) => {
      applySettingsToUI(settings);
      updateSettingsState('SAVE_SUCCESS', {
        statusMessage: '配置已同步，可编辑后手动保存。',
        timeoutMs: 1400,
      });
    },
    () => {
      applySettingsToUI(getInitialPopupSettings());
      updateSettingsState('SAVE_FAILURE', {
        statusMessage: '配置读取失败，已回退默认值。',
      });
    }
  );
}

function saveSettings() {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
    updateSettingsState('SAVE_FAILURE', {
      statusMessage: '当前环境不支持保存，请在扩展页重试。',
    });
    return;
  }

  const payload = collectCurrentSettings();

  updateSettingsState('SAVE_START');
  setButtonBusy(saveButton, '保存中...', '保存字幕设置');

  chrome.storage.local.set(payload, () => {
    const runtimeError = chrome.runtime && chrome.runtime.lastError;
    if (runtimeError) {
      updateSettingsState('SAVE_FAILURE');
      showToast('保存失败，请重试');
      setButtonBusy(saveButton, '', '保存字幕设置');
      return;
    }

    applySettingsToUI(payload);
    if (adaptiveTuning && typeof adaptiveTuning.persistManualOverride === 'function') {
      adaptiveTuning.persistManualOverride().catch(() => {});
    }
    updateSettingsState('SAVE_SUCCESS', { statusMessage: '字幕设置已保存' });
    showToast('已保存当前学习策略');
    setButtonBusy(saveButton, '', '保存字幕设置');
  });
}

function toggleReviewDanmaku() {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
    return;
  }

  const nextValue = !reviewDanmakuEnabled;
  setButtonBusy(
    reviewDanmakuButton,
    nextValue ? '启动中...' : '停止中...',
    getReviewDanmakuButtonLabel(reviewDanmakuEnabled)
  );

  chrome.storage.local.set(
    {
      reviewDanmakuEnabled: nextValue,
    },
    () => {
      const runtimeError = getChromeRuntimeError();
      if (runtimeError) {
        setStatus('复习弹幕切换失败，请重试');
        showToast('复习弹幕切换失败');
        setButtonBusy(reviewDanmakuButton, '', getReviewDanmakuButtonLabel(reviewDanmakuEnabled));
        return;
      }

      renderReviewDanmakuState(nextValue);
      setStatus(nextValue ? '复习弹幕已启动' : '复习弹幕已停止');
      showToast(nextValue ? '复习弹幕已切换为运行中' : '复习弹幕已停止');
      setButtonBusy(reviewDanmakuButton, '', getReviewDanmakuButtonLabel(nextValue));
    }
  );
}

function openOptionsPage() {
  if (
    typeof chrome !== 'undefined' &&
    chrome.runtime &&
    typeof chrome.runtime.openOptionsPage === 'function'
  ) {
    chrome.runtime.openOptionsPage();
  }
}

function normalizeWordStat(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const word = String(item.word || '').trim();
  if (!word) {
    return null;
  }

  return {
    word,
    translation: String(item.translation || item.meaning || '').trim(),
    hitCount: Math.max(0, Math.floor(Number(item.hitCount) || 0)),
    lastSeen: Number.isFinite(Number(item.lastSeen)) ? Number(item.lastSeen) : null,
    level: String(item.level || '')
      .trim()
      .toUpperCase(),
  };
}

function sortEncounteredWords(list, sortMode) {
  const mode = sortMode === 'desc' ? 'desc' : 'asc';

  return list.slice().sort((left, right) => {
    if (left.hitCount !== right.hitCount) {
      return mode === 'asc' ? left.hitCount - right.hitCount : right.hitCount - left.hitCount;
    }

    const leftSeen = left.lastSeen || 0;
    const rightSeen = right.lastSeen || 0;
    if (leftSeen !== rightSeen) {
      return mode === 'asc' ? leftSeen - rightSeen : rightSeen - leftSeen;
    }

    return left.word.localeCompare(right.word);
  });
}

function readEncounteredWords(callback) {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
    callback([]);
    return;
  }

  readChromeLocalStorage(
    [WORD_STATS_STORAGE_KEY],
    (stored) => {
      const rawMap =
        stored &&
        stored[WORD_STATS_STORAGE_KEY] &&
        typeof stored[WORD_STATS_STORAGE_KEY] === 'object'
          ? stored[WORD_STATS_STORAGE_KEY]
          : {};

      const words = Object.values(rawMap)
        .map((item) => normalizeWordStat(item))
        .filter((item) => Boolean(item) && item.hitCount > 0);

      callback(words);
    },
    () => {
      setStatus('生词排行读取失败，请重试');
      callback([]);
    }
  );
}

function renderRankingList(items) {
  if (!rankingList || !rankingEmpty) {
    return;
  }

  rankingList.innerHTML = '';

  if (rankingSummary) {
    rankingSummary.textContent = getRankingSummaryText(items, rankingSort);
  }

  if (items.length === 0) {
    rankingEmpty.style.display = 'block';
    return;
  }

  rankingEmpty.style.display = 'none';

  items.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'popup-ranking-item';

    const wordWrap = document.createElement('div');
    wordWrap.className = 'popup-ranking-main';

    const wordRow = document.createElement('div');
    wordRow.className = 'popup-ranking-word-row';

    const wordNode = document.createElement('span');
    wordNode.className = 'popup-ranking-word';
    wordNode.textContent = item.word;

    const levelNode = document.createElement('span');
    levelNode.className = 'popup-ranking-level';
    levelNode.textContent = item.level || 'WORD';

    const translationNode = document.createElement('span');
    translationNode.className = 'popup-ranking-translation';
    translationNode.textContent = item.translation || '-';

    const metaNode = document.createElement('span');
    metaNode.className = 'popup-ranking-meta';
    metaNode.textContent = getRelativeSeenText(item.lastSeen);

    const badgeNode = document.createElement('span');
    badgeNode.className = 'popup-ranking-badge';
    badgeNode.textContent = String(item.hitCount);

    wordRow.appendChild(wordNode);
    wordRow.appendChild(levelNode);
    wordWrap.appendChild(wordRow);
    wordWrap.appendChild(translationNode);
    wordWrap.appendChild(metaNode);
    li.appendChild(wordWrap);
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
  rankingSort = sortMode === 'desc' ? 'desc' : 'asc';

  rankingTabs.forEach((tab) => {
    const isCurrent = tab.dataset.sort === rankingSort;
    tab.classList.toggle('is-active', isCurrent);
  });

  refreshRanking();
}

function bindLivePreviewEvents() {
  if (replaceRatioInput) {
    replaceRatioInput.addEventListener('input', () => {
      markSettingsDirty();
      updateRatioLabel(replaceRatioInput.value);
      refreshPreviewPanels();
    });
  }

  if (enabledInput) {
    enabledInput.addEventListener('change', () => {
      markSettingsDirty();
      updateEnabledBadge(enabledInput.checked);
      refreshPreviewPanels();
    });
  }

  if (maxReplaceCountInput) {
    maxReplaceCountInput.addEventListener('input', () => {
      markSettingsDirty();
      updateMaxReplaceSummary(maxReplaceCountInput.value);
      refreshPreviewPanels();
    });
  }

  if (targetCefrInput) {
    targetCefrInput.addEventListener('change', () => {
      markSettingsDirty();
      updateTargetCefrSummary(targetCefrInput.value);
      refreshPreviewPanels();
    });
  }

  if (reviewDanmakuSpeedInput) {
    reviewDanmakuSpeedInput.addEventListener('change', () => {
      markSettingsDirty(false);
      const speedLabel = getReviewDanmakuSpeedLabel(reviewDanmakuSpeedInput.value);
      renderReviewDanmakuSpeed(reviewDanmakuSpeedInput.value);
      setStatus(`复习速度已切换为${speedLabel}`);
      showToast(`复习节奏：${speedLabel}`);
    });
  }

  if (vocabularyModeInput) {
    vocabularyModeInput.addEventListener('change', () => {
      markSettingsDirty();
      refreshPreviewPanels();
    });
  }

  if (examPreferenceInput) {
    examPreferenceInput.addEventListener('change', () => {
      markSettingsDirty();
      refreshPreviewPanels();
    });
  }

  getLevelCheckboxes().forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      markSettingsDirty();
      updateLevelsSummary(collectActiveLevels());
      refreshPreviewPanels();
    });
  });
}

function bindEvents() {
  bindLivePreviewEvents();

  if (saveButton) {
    saveButton.addEventListener('click', saveSettings);
  }

  if (openOptionsButton) {
    openOptionsButton.addEventListener('click', openOptionsPage);
  }

  if (reviewDanmakuButton) {
    reviewDanmakuButton.addEventListener('click', toggleReviewDanmaku);
  }

  if (webPageEnabledInput) {
    webPageEnabledInput.addEventListener('change', () => {
      markSettingsDirty();
      refreshPreviewPanels();
    });
  }

  if (siteToggleButton) {
    siteToggleButton.addEventListener('click', toggleCurrentSiteScope);
  }

  if (quickReviewButton) {
    quickReviewButton.addEventListener('click', () => {
      renderQuickReviewCard();
    });
  }

  if (reviewActionKnow) {
    reviewActionKnow.addEventListener('click', () => handleQuickReviewFeedback('know'));
  }

  if (reviewActionFuzzy) {
    reviewActionFuzzy.addEventListener('click', () => handleQuickReviewFeedback('fuzzy'));
  }

  if (reviewActionForgot) {
    reviewActionForgot.addEventListener('click', () => handleQuickReviewFeedback('dontKnow'));
  }

  rankingTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      setRankingSort(tab.dataset.sort || 'asc');
    });
  });

  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) {
    return;
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') {
      return;
    }

    const changedSettings = SETTINGS_STORAGE_KEYS.filter((key) => Boolean(changes[key]));
    if (changedSettings.length > 0) {
      const merged = { ...runtimeSettings };
      changedSettings.forEach((key) => {
        merged[key] = changes[key].newValue;
      });
      applySettingsToUI(merged);
    }

    if (changes[WORD_STATS_STORAGE_KEY]) {
      refreshRanking();
    }

    if (
      changes[LEARNING_WORD_STATS_STORAGE_KEY] ||
      changes[REVIEW_QUEUE_STORAGE_KEY] ||
      changes[LEARNING_SUMMARY_STORAGE_KEY]
    ) {
      readLearningDashboard(() => {
        renderLearningSummary();
        renderQuickReviewCard();
      });
    }
  });
}

function init() {
  bindEvents();
  initCurrentSiteState();
  loadSettings();
  readLearningDashboard(() => {
    renderLearningSummary();
    renderQuickReviewCard();
  });
  refreshRanking();
}

if (doc) {
  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getLearningProfile: sharedSettings ? sharedSettings.getLearningProfile : getLearningProfile,
    getReviewDanmakuButtonLabel,
    normalizeReviewDanmakuEnabled,
    getReviewDanmakuSpeedLabel,
    normalizeReviewDanmakuSpeed: sharedSettings
      ? sharedSettings.normalizeReviewDanmakuSpeed
      : normalizeReviewDanmakuSpeed,
    getHeroMetricMeta: sharedSettings ? sharedSettings.getHeroMetricMeta : getHeroMetricMeta,
    getInitialPopupSettings,
    collectActiveLevels,
    getQuickReviewEmptyState,
    formatReviewCountText,
    sortQuickReviewItems,
    formatReviewDueText,
    normalizeWordStat,
    sortEncounteredWords,
  };
}
