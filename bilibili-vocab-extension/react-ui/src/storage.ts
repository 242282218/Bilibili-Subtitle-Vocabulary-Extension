import {
  SETTINGS_STORAGE_KEY_V3,
  SettingsV3,
  migrateToV3,
  normalizeSettingsV3,
} from './settings-bridge';

const LEARNING_SUMMARY_STORAGE_KEY = 'bili_vocab_learning_summary_v1';
const VOCABULARY_BOOK_STORAGE_KEY = 'bili_vocab_word_stats_v2';
const LEARNING_STREAK_STORAGE_KEY = 'bili_vocab_learning_streak_v1';
const ADAPTIVE_TUNING_STORAGE_KEY = 'bili_vocab_adaptive_tuning_v1';
const EXPERIENCE_METRICS_STORAGE_KEY = 'bili_vocab_experience_metrics_v1';
const ADAPTIVE_MANUAL_OVERRIDE_MS = 20 * 60 * 1000;
const METRIC_COUNTER_KEYS = [
  'contextMisreplaceReported',
  'contextMisreplaceHigh',
  'adaptiveDecisionApplied',
  'adaptiveDecisionEaseDown',
  'adaptiveDecisionRampUp',
  'adaptiveDecisionStabilize',
  'adaptiveManualOverride',
  'adaptiveToggleEnabled',
  'adaptiveToggleDisabled',
] as const;

export interface LearningSummary {
  todayCount: number;
  newCount: number;
  masteredCount: number;
  recentWords: Array<{ word: string; translation?: string; status?: string }>;
}

export interface VocabularyWord {
  word: string;
  status: string;
  savedAt?: number;
  exposures?: number;
  details?: {
    meaning?: string;
    level?: string;
    phonetic?: string;
  };
}

export interface LearningStreak {
  currentStreak: number;
  maxStreak: number;
  lastActiveDate: string;
  totalActiveDays: number;
  activeDays: string[];
}

export interface AdaptiveTuningState {
  enabled: boolean;
  manualOverrideUntil: number | null;
  manualOverrideRemainingMs: number;
  manualOverrideActive: boolean;
  feedbackWindowSize: number;
  lastAppliedAt: number | null;
  lastAppliedMode: string;
  hint: string;
}

type MetricCounterKey = (typeof METRIC_COUNTER_KEYS)[number];
type MetricCounterMap = Record<MetricCounterKey, number>;

interface ExperienceMetricsState {
  schemaVersion: number;
  updatedAt: number | null;
  counters: MetricCounterMap;
  daily: Record<string, MetricCounterMap>;
}

export interface ExperienceMetricsSnapshot {
  windowDays: number;
  updatedAt: number | null;
  contextMisreplaceReported: number;
  contextMisreplaceHigh: number;
  adaptiveDecisionApplied: number;
  adaptiveManualOverride: number;
  adaptiveToggleEnabled: number;
  adaptiveToggleDisabled: number;
  adaptiveToggleTotal: number;
  adaptiveToggleDisableRate: number;
}

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage) && Boolean(chrome.storage.local);
}

function hasChromeTabs(): boolean {
  return (
    typeof chrome !== 'undefined' && Boolean(chrome.tabs) && typeof chrome.tabs.query === 'function'
  );
}

function normalizeTimestamp(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.floor(parsed);
}

function toDayKey(value: number): string {
  const timestamp = normalizeTimestamp(value) || Date.now();
  return new Date(timestamp).toISOString().slice(0, 10);
}

function clampWindowDays(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 7;
  }
  return Math.min(30, Math.max(1, Math.floor(parsed)));
}

function createEmptyMetricCounterMap(): MetricCounterMap {
  return METRIC_COUNTER_KEYS.reduce((accumulator, key) => {
    accumulator[key] = 0;
    return accumulator;
  }, {} as MetricCounterMap);
}

function normalizeMetricCounterMap(input: unknown): MetricCounterMap {
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const output = createEmptyMetricCounterMap();
  METRIC_COUNTER_KEYS.forEach((key) => {
    const value = Number(source[key]);
    output[key] = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  });
  return output;
}

function normalizeExperienceMetricsState(input: unknown): ExperienceMetricsState {
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const dailySource =
    source.daily && typeof source.daily === 'object'
      ? (source.daily as Record<string, unknown>)
      : {};
  const daily: Record<string, MetricCounterMap> = {};
  Object.keys(dailySource).forEach((dayKey) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
      return;
    }
    daily[dayKey] = normalizeMetricCounterMap(dailySource[dayKey]);
  });
  return {
    schemaVersion: 1,
    updatedAt: normalizeTimestamp(source.updatedAt),
    counters: normalizeMetricCounterMap(source.counters),
    daily,
  };
}

function applyMetricCountersToState(
  state: ExperienceMetricsState,
  counterKeys: MetricCounterKey[],
  now = Date.now()
): ExperienceMetricsState {
  const timestamp = normalizeTimestamp(now) || Date.now();
  const nextCounters = normalizeMetricCounterMap(state.counters);
  const nextDaily = { ...state.daily };
  const dayKey = toDayKey(timestamp);
  const dayCounters = normalizeMetricCounterMap(nextDaily[dayKey]);
  counterKeys.forEach((key) => {
    nextCounters[key] += 1;
    dayCounters[key] += 1;
  });
  nextDaily[dayKey] = dayCounters;
  return {
    schemaVersion: 1,
    updatedAt: timestamp,
    counters: nextCounters,
    daily: nextDaily,
  };
}

function listWindowDayKeys(days: number, now = Date.now()): string[] {
  const normalizedDays = clampWindowDays(days);
  const timestamp = normalizeTimestamp(now) || Date.now();
  const dayKeys: string[] = [];
  for (let index = 0; index < normalizedDays; index += 1) {
    dayKeys.push(toDayKey(timestamp - index * 24 * 60 * 60 * 1000));
  }
  return dayKeys;
}

function sumMetricWindowCounter(
  state: ExperienceMetricsState,
  counterKey: MetricCounterKey,
  days: number,
  now = Date.now()
): number {
  return listWindowDayKeys(days, now).reduce((total, dayKey) => {
    const dailyCounters = state.daily[dayKey];
    const value = dailyCounters ? Number(dailyCounters[counterKey]) : 0;
    return total + (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
  }, 0);
}

function buildExperienceMetricsSnapshot(
  state: ExperienceMetricsState,
  days = 7,
  now = Date.now()
): ExperienceMetricsSnapshot {
  const windowDays = clampWindowDays(days);
  const contextMisreplaceReported = sumMetricWindowCounter(
    state,
    'contextMisreplaceReported',
    windowDays,
    now
  );
  const contextMisreplaceHigh = sumMetricWindowCounter(
    state,
    'contextMisreplaceHigh',
    windowDays,
    now
  );
  const adaptiveDecisionApplied = sumMetricWindowCounter(
    state,
    'adaptiveDecisionApplied',
    windowDays,
    now
  );
  const adaptiveManualOverride = sumMetricWindowCounter(
    state,
    'adaptiveManualOverride',
    windowDays,
    now
  );
  const adaptiveToggleEnabled = sumMetricWindowCounter(
    state,
    'adaptiveToggleEnabled',
    windowDays,
    now
  );
  const adaptiveToggleDisabled = sumMetricWindowCounter(
    state,
    'adaptiveToggleDisabled',
    windowDays,
    now
  );
  const adaptiveToggleTotal = adaptiveToggleEnabled + adaptiveToggleDisabled;
  const adaptiveToggleDisableRate =
    adaptiveToggleTotal > 0 ? Number((adaptiveToggleDisabled / adaptiveToggleTotal).toFixed(4)) : 0;

  return {
    windowDays,
    updatedAt: state.updatedAt,
    contextMisreplaceReported,
    contextMisreplaceHigh,
    adaptiveDecisionApplied,
    adaptiveManualOverride,
    adaptiveToggleEnabled,
    adaptiveToggleDisabled,
    adaptiveToggleTotal,
    adaptiveToggleDisableRate,
  };
}

function formatDurationLabel(durationMs: number): string {
  const minutes = Math.max(1, Math.ceil(durationMs / (60 * 1000)));
  if (minutes < 60) {
    return `${minutes} 分钟`;
  }
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时`;
  }
  const days = Math.ceil(hours / 24);
  return `${days} 天`;
}

function buildAdaptiveHint(
  enabled: boolean,
  manualOverrideActive: boolean,
  manualOverrideRemainingMs: number
): string {
  if (!enabled) {
    return '自动调优已关闭';
  }
  if (manualOverrideActive) {
    return `手动配置优先，约 ${formatDurationLabel(manualOverrideRemainingMs)} 后恢复自动调优`;
  }
  return '已启用自动调优';
}

function normalizeAdaptiveTuningState(input: unknown, now = Date.now()): AdaptiveTuningState {
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const manualOverrideUntil = normalizeTimestamp(source.manualOverrideUntil);
  const referenceNow = normalizeTimestamp(now) || Date.now();
  const manualOverrideRemainingMs =
    manualOverrideUntil != null ? Math.max(0, manualOverrideUntil - referenceNow) : 0;
  const manualOverrideActive = manualOverrideRemainingMs > 0;
  const enabled = source.enabled !== false;
  return {
    enabled,
    manualOverrideUntil,
    manualOverrideRemainingMs,
    manualOverrideActive,
    feedbackWindowSize: Array.isArray(source.feedbackWindow) ? source.feedbackWindow.length : 0,
    lastAppliedAt: normalizeTimestamp(source.lastAppliedAt),
    lastAppliedMode: String(source.lastAppliedMode || '')
      .trim()
      .toLowerCase(),
    hint: buildAdaptiveHint(enabled, manualOverrideActive, manualOverrideRemainingMs),
  };
}

export function readStorage<T extends Record<string, unknown>>(keys?: string[] | null): Promise<T> {
  if (!hasChromeStorage()) {
    return Promise.resolve({} as T);
  }
  return new Promise<T>((resolve) => {
    chrome.storage.local.get(keys || null, (payload) => {
      resolve((payload || {}) as T);
    });
  });
}

export function writeStorage(payload: Record<string, unknown>): Promise<void> {
  if (!hasChromeStorage()) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    chrome.storage.local.set(payload, () => resolve());
  });
}

export async function loadSettingsV3(): Promise<SettingsV3> {
  const allPayload = await readStorage<Record<string, unknown>>(null);
  const settingsV3 = normalizeSettingsV3(migrateToV3(allPayload));
  await writeStorage({
    [SETTINGS_STORAGE_KEY_V3]: settingsV3,
  });
  return settingsV3;
}

export async function saveSettingsV3(settings: SettingsV3): Promise<SettingsV3> {
  const normalized = normalizeSettingsV3(settings);
  const now = Date.now();
  const payload = await readStorage<Record<string, unknown>>([
    ADAPTIVE_TUNING_STORAGE_KEY,
    EXPERIENCE_METRICS_STORAGE_KEY,
  ]);
  const adaptiveState =
    payload[ADAPTIVE_TUNING_STORAGE_KEY] && typeof payload[ADAPTIVE_TUNING_STORAGE_KEY] === 'object'
      ? (payload[ADAPTIVE_TUNING_STORAGE_KEY] as Record<string, unknown>)
      : {};
  const nextMetrics = applyMetricCountersToState(
    normalizeExperienceMetricsState(payload[EXPERIENCE_METRICS_STORAGE_KEY]),
    ['adaptiveManualOverride'],
    now
  );

  await writeStorage({
    [ADAPTIVE_TUNING_STORAGE_KEY]: {
      ...adaptiveState,
      enabled: adaptiveState.enabled !== false,
      manualOverrideUntil: now + ADAPTIVE_MANUAL_OVERRIDE_MS,
    },
    [EXPERIENCE_METRICS_STORAGE_KEY]: nextMetrics,
    [SETTINGS_STORAGE_KEY_V3]: normalized,
  });
  return normalized;
}

export async function readAdaptiveTuningState(): Promise<AdaptiveTuningState> {
  const payload = await readStorage<Record<string, unknown>>([ADAPTIVE_TUNING_STORAGE_KEY]);
  return normalizeAdaptiveTuningState(payload[ADAPTIVE_TUNING_STORAGE_KEY], Date.now());
}

export async function setAdaptiveTuningEnabled(enabled: boolean): Promise<AdaptiveTuningState> {
  const now = Date.now();
  const payload = await readStorage<Record<string, unknown>>([
    ADAPTIVE_TUNING_STORAGE_KEY,
    EXPERIENCE_METRICS_STORAGE_KEY,
  ]);
  const source =
    payload[ADAPTIVE_TUNING_STORAGE_KEY] && typeof payload[ADAPTIVE_TUNING_STORAGE_KEY] === 'object'
      ? (payload[ADAPTIVE_TUNING_STORAGE_KEY] as Record<string, unknown>)
      : {};
  const nextRaw = {
    ...source,
    enabled: enabled !== false,
  };
  const nextMetrics = applyMetricCountersToState(
    normalizeExperienceMetricsState(payload[EXPERIENCE_METRICS_STORAGE_KEY]),
    [enabled !== false ? 'adaptiveToggleEnabled' : 'adaptiveToggleDisabled'],
    now
  );
  await writeStorage({
    [ADAPTIVE_TUNING_STORAGE_KEY]: nextRaw,
    [EXPERIENCE_METRICS_STORAGE_KEY]: nextMetrics,
  });
  return normalizeAdaptiveTuningState(nextRaw, now);
}

export async function readExperienceMetricsSnapshot(days = 7): Promise<ExperienceMetricsSnapshot> {
  const now = Date.now();
  const payload = await readStorage<Record<string, unknown>>([EXPERIENCE_METRICS_STORAGE_KEY]);
  const state = normalizeExperienceMetricsState(payload[EXPERIENCE_METRICS_STORAGE_KEY]);
  return buildExperienceMetricsSnapshot(state, days, now);
}

function normalizeLearningSummary(input: unknown): LearningSummary {
  const source = input && typeof input === 'object' ? (input as Partial<LearningSummary>) : {};
  const words = Array.isArray(source.recentWords)
    ? source.recentWords
        .filter((item): item is { word: string; translation?: string; status?: string } =>
          Boolean(item && typeof item === 'object')
        )
        .map((item) => ({
          word: String(item.word || '').trim(),
          translation: String(item.translation || '').trim(),
          status: String(item.status || '').trim(),
        }))
        .filter((item) => Boolean(item.word))
    : [];
  return {
    todayCount: Math.max(0, Math.floor(Number(source.todayCount) || 0)),
    newCount: Math.max(0, Math.floor(Number(source.newCount) || 0)),
    masteredCount: Math.max(0, Math.floor(Number(source.masteredCount) || 0)),
    recentWords: words.slice(0, 5),
  };
}

export async function readLearningSummary(): Promise<LearningSummary> {
  const payload = await readStorage<Record<string, unknown>>([LEARNING_SUMMARY_STORAGE_KEY]);
  return normalizeLearningSummary(payload[LEARNING_SUMMARY_STORAGE_KEY]);
}

export async function getCurrentTabHostname(): Promise<string> {
  if (!hasChromeTabs()) {
    return '';
  }
  return new Promise<string>((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = Array.isArray(tabs) && tabs.length ? tabs[0] : null;
      const rawUrl = activeTab && typeof activeTab.url === 'string' ? activeTab.url : '';
      try {
        resolve(rawUrl ? new URL(rawUrl).hostname : '');
      } catch {
        resolve('');
      }
    });
  });
}

// 生词本导出功能
export async function exportVocabularyBook(format: 'json' | 'csv' = 'json'): Promise<string> {
  const payload = await readStorage<Record<string, unknown>>([VOCABULARY_BOOK_STORAGE_KEY]);
  const wordStats = (payload[VOCABULARY_BOOK_STORAGE_KEY] as Record<string, VocabularyWord>) || {};

  // 只导出生词本中的单词
  const savedWords = Object.values(wordStats)
    .filter((word) => word.status === 'saved')
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));

  if (format === 'csv') {
    const headers = ['单词', '释义', '难度等级', '音标', '收藏时间', '遇见次数'];
    const rows = savedWords.map((word) => [
      word.word,
      word.details?.meaning || '',
      word.details?.level || '',
      word.details?.phonetic || '',
      word.savedAt ? new Date(word.savedAt).toLocaleString() : '',
      word.exposures || 0,
    ]);
    return [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');
  }

  return JSON.stringify(savedWords, null, 2);
}

function normalizeLearningStreak(input: unknown): LearningStreak {
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const activeDays = Array.isArray(source.activeDays)
    ? source.activeDays.map((day) => String(day || '').trim()).filter((day) => Boolean(day))
    : [];
  return {
    currentStreak: Math.max(0, Math.floor(Number(source.currentStreak) || 0)),
    maxStreak: Math.max(0, Math.floor(Number(source.maxStreak) || 0)),
    lastActiveDate: String(source.lastActiveDate || ''),
    totalActiveDays: Math.max(0, Math.floor(Number(source.totalActiveDays) || 0)),
    activeDays,
  };
}

// 学习 streak 相关
export async function readLearningStreak(): Promise<LearningStreak> {
  const payload = await readStorage<Record<string, unknown>>([LEARNING_STREAK_STORAGE_KEY]);
  return normalizeLearningStreak(payload[LEARNING_STREAK_STORAGE_KEY]);
}

export function subscribeSettingsChanges(onUpdate: (settings: SettingsV3) => void): () => void {
  if (
    typeof chrome === 'undefined' ||
    !chrome.storage ||
    !chrome.storage.onChanged ||
    typeof chrome.storage.onChanged.addListener !== 'function'
  ) {
    return () => {};
  }
  const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName !== 'local' || !changes[SETTINGS_STORAGE_KEY_V3]) {
      return;
    }
    const nextValue = changes[SETTINGS_STORAGE_KEY_V3].newValue;
    onUpdate(normalizeSettingsV3(nextValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}

export function subscribeAdaptiveTuningState(
  onUpdate: (state: AdaptiveTuningState) => void
): () => void {
  if (
    typeof chrome === 'undefined' ||
    !chrome.storage ||
    !chrome.storage.onChanged ||
    typeof chrome.storage.onChanged.addListener !== 'function'
  ) {
    return () => {};
  }
  const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName !== 'local' || !changes[ADAPTIVE_TUNING_STORAGE_KEY]) {
      return;
    }
    onUpdate(
      normalizeAdaptiveTuningState(changes[ADAPTIVE_TUNING_STORAGE_KEY].newValue, Date.now())
    );
  };
  chrome.storage.onChanged.addListener(listener);
  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}

export function subscribeExperienceMetricsSnapshot(
  onUpdate: (snapshot: ExperienceMetricsSnapshot) => void,
  days = 7
): () => void {
  if (
    typeof chrome === 'undefined' ||
    !chrome.storage ||
    !chrome.storage.onChanged ||
    typeof chrome.storage.onChanged.addListener !== 'function'
  ) {
    return () => {};
  }
  const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName !== 'local' || !changes[EXPERIENCE_METRICS_STORAGE_KEY]) {
      return;
    }
    const snapshot = buildExperienceMetricsSnapshot(
      normalizeExperienceMetricsState(changes[EXPERIENCE_METRICS_STORAGE_KEY].newValue),
      days,
      Date.now()
    );
    onUpdate(snapshot);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}

export function subscribeLearningSummary(onUpdate: (summary: LearningSummary) => void): () => void {
  if (
    typeof chrome === 'undefined' ||
    !chrome.storage ||
    !chrome.storage.onChanged ||
    typeof chrome.storage.onChanged.addListener !== 'function'
  ) {
    return () => {};
  }
  const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName !== 'local' || !changes[LEARNING_SUMMARY_STORAGE_KEY]) {
      return;
    }
    onUpdate(normalizeLearningSummary(changes[LEARNING_SUMMARY_STORAGE_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}

export async function openOptionsPage(): Promise<void> {
  if (
    typeof chrome !== 'undefined' &&
    chrome.runtime &&
    typeof chrome.runtime.openOptionsPage === 'function'
  ) {
    await chrome.runtime.openOptionsPage();
  }
}
