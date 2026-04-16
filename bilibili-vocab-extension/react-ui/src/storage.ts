import {
  SETTINGS_STORAGE_KEY_V3,
  SettingsV3,
  migrateToV3,
  normalizeSettingsV3,
} from './settings-bridge';
import { MESSAGE_TYPES, sendRuntimeMessage } from './runtime-messaging';

const LEARNING_SUMMARY_STORAGE_KEY = 'bili_vocab_learning_summary_v1';
const VOCABULARY_BOOK_STORAGE_KEY = 'bili_vocab_word_stats_v2';
const LEARNING_STREAK_STORAGE_KEY = 'bili_vocab_learning_streak_v1';
const ADAPTIVE_TUNING_STORAGE_KEY = 'bili_vocab_adaptive_tuning_v1';
const EXPERIENCE_METRICS_STORAGE_KEY = 'bili_vocab_experience_metrics_v1';
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

function normalizeVocabularyWord(input: unknown): VocabularyWord | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const source = input as Record<string, unknown>;
  const word = String(source.word || '').trim();
  const status = String(source.status || '')
    .trim()
    .toLowerCase();
  if (!word || !status) {
    return null;
  }

  const detailsSource =
    source.details && typeof source.details === 'object'
      ? (source.details as Record<string, unknown>)
      : {};
  const exposures = Number(source.exposures);

  return {
    word,
    status,
    savedAt: normalizeTimestamp(source.savedAt) ?? undefined,
    exposures: Number.isFinite(exposures) && exposures > 0 ? Math.floor(exposures) : 0,
    details: {
      meaning: String(detailsSource.meaning || '').trim(),
      level: String(detailsSource.level || '').trim(),
      phonetic: String(detailsSource.phonetic || '').trim(),
    },
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

function getChromeRuntimeError(fallbackMessage: string): Error | null {
  if (typeof chrome === 'undefined' || !chrome.runtime) {
    return null;
  }
  const runtimeError = chrome.runtime.lastError;
  if (!runtimeError) {
    return null;
  }
  const message =
    typeof runtimeError.message === 'string' && runtimeError.message.trim()
      ? runtimeError.message.trim()
      : fallbackMessage;
  return new Error(message);
}

let storageMutationQueue = Promise.resolve();

function enqueueStorageMutation<T>(task: () => Promise<T>): Promise<T> {
  const nextTask = storageMutationQueue.then(task, task);
  storageMutationQueue = nextTask.then(
    () => undefined,
    () => undefined
  );
  return nextTask;
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
  return new Promise<T>((resolve, reject) => {
    chrome.storage.local.get(keys || null, (payload) => {
      const runtimeError = getChromeRuntimeError('chrome.storage.local.get failed');
      if (runtimeError) {
        reject(runtimeError);
        return;
      }
      resolve((payload || {}) as T);
    });
  });
}

export function writeStorage(payload: Record<string, unknown>): Promise<void> {
  if (!hasChromeStorage()) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    chrome.storage.local.set(payload, () => {
      const runtimeError = getChromeRuntimeError('chrome.storage.local.set failed');
      if (runtimeError) {
        reject(runtimeError);
        return;
      }
      resolve();
    });
  });
}

export async function loadSettingsV3(): Promise<SettingsV3> {
  return enqueueStorageMutation(async () => {
    const allPayload = await readStorage<Record<string, unknown>>(null);
    const settingsV3 = normalizeSettingsV3(migrateToV3(allPayload));
    await writeStorage({
      [SETTINGS_STORAGE_KEY_V3]: settingsV3,
    });
    return settingsV3;
  });
}

export async function saveSettingsV3(settings: SettingsV3): Promise<SettingsV3> {
  const normalized = normalizeSettingsV3(settings);
  return enqueueStorageMutation(async () => {
    const persisted = await sendRuntimeMessage<SettingsV3>(MESSAGE_TYPES.SETTINGS_COMMIT, {
      settings: normalized,
      markManualOverride: true,
      now: Date.now(),
    });
    return normalizeSettingsV3(persisted);
  });
}

export async function readAdaptiveTuningState(): Promise<AdaptiveTuningState> {
  const payload = await readStorage<Record<string, unknown>>([ADAPTIVE_TUNING_STORAGE_KEY]);
  return normalizeAdaptiveTuningState(payload[ADAPTIVE_TUNING_STORAGE_KEY], Date.now());
}

export async function setAdaptiveTuningEnabled(enabled: boolean): Promise<AdaptiveTuningState> {
  return enqueueStorageMutation(async () => {
    const nextRaw = await sendRuntimeMessage<Record<string, unknown>>(
      MESSAGE_TYPES.ADAPTIVE_SET_ENABLED,
      {
        enabled: enabled !== false,
        now: Date.now(),
      }
    );
    return normalizeAdaptiveTuningState(nextRaw, Date.now());
  });
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

  const savedWords = Object.values(wordStats)
    .map((entry) => normalizeVocabularyWord(entry))
    .filter((word): word is VocabularyWord => Boolean(word && word.status === 'saved'))
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
