import {
  SETTINGS_STORAGE_KEY_V3,
  SettingsV3,
  migrateToV3,
  normalizeSettingsV3,
} from './settings-bridge';
import {
  EncounteredWordRankingItem,
  EncounteredWordSortMode,
  QuickReviewAction,
  QuickReviewItem,
  normalizeEncounteredWord,
  sortEncounteredWords,
  sortQuickReviewItems,
} from './learning-dashboard';
import { MESSAGE_TYPES, sendRuntimeMessage } from './runtime-messaging';

const WORD_STATS_STORAGE_KEY = 'bili_vocab_word_stats_v1';
const LEARNING_SUMMARY_STORAGE_KEY = 'bili_vocab_learning_summary_v1';
const VOCABULARY_BOOK_STORAGE_KEY = 'bili_vocab_word_stats_v2';
const LEARNING_WORD_STATS_STORAGE_KEY = 'bili_vocab_word_stats_v2';
const REVIEW_QUEUE_STORAGE_KEY = 'bili_vocab_review_queue_v1';
const LEARNING_STREAK_STORAGE_KEY = 'bili_vocab_learning_streak_v1';
const ADAPTIVE_TUNING_STORAGE_KEY = 'bili_vocab_adaptive_tuning_v1';
const EXPERIENCE_METRICS_STORAGE_KEY = 'bili_vocab_experience_metrics_v1';
const ACTIVE_TAB_SUBTITLE_NAVIGATION_READ = 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_READ';
const ACTIVE_TAB_SUBTITLE_NAVIGATION_NAVIGATE =
  'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_NAVIGATE';
const ACTIVE_TAB_SUBTITLE_NAVIGATION_SUBSCRIBE =
  'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_SUBSCRIBE';
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

interface LearningRecord {
  word: string;
  translation?: string;
  level?: string;
  status?: string;
  hitCount?: number;
  exposureCount?: number;
  seenCount?: number;
  lastSeen?: number | null;
  lastSeenAt?: number | null;
  nextReviewBucket?: string;
  nextReviewAt?: number | null;
  intervalDays?: number | null;
  easeFactor?: number | null;
}

interface ReviewQueueEntry {
  word: string;
  dueBucket?: string;
  nextReviewAt?: number | null;
  intervalDays?: number | null;
  easeFactor?: number | null;
  updatedAt?: number | null;
}

interface LearningStateApi {
  normalizeLearningRecord?: (record: unknown, fallback?: Record<string, unknown>) => LearningRecord;
  normalizeReviewQueue?: (queue: unknown) => Record<string, ReviewQueueEntry>;
  buildLearningSummary?: (
    records: Record<string, LearningRecord>,
    queue: Record<string, ReviewQueueEntry>
  ) => unknown;
  migrateLegacyStat?: (record: unknown) => LearningRecord;
  applyLearningAction?: (record: LearningRecord, action: string, now: number) => LearningRecord;
  applyReviewFeedback?: (record: LearningRecord, action: string, now: number) => LearningRecord;
  syncReviewQueue?: (
    queue: Record<string, ReviewQueueEntry>,
    record: LearningRecord,
    now: number
  ) => Record<string, ReviewQueueEntry>;
  updateLearningStreak?: (now?: number) => Promise<LearningStreak> | LearningStreak;
}

declare global {
  interface Window {
    LearningState?: LearningStateApi;
  }
}

export interface QuickReviewDashboard {
  summary: LearningSummary;
  items: QuickReviewItem[];
}

export interface QuickReviewCommitResult extends QuickReviewDashboard {
  word: string;
  adaptiveApplied: boolean;
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

export type VocabularyExportFormat = 'json' | 'csv' | 'anki';
export type ActiveTabSubtitleNavigationAction = 'previous' | 'replay' | 'next';

export interface ActiveTabSubtitleNavigation {
  supported: boolean;
  progressLabel: string;
  headline: string;
  description: string;
  currentText: string;
  canGoPrevious: boolean;
  canReplay: boolean;
  canGoNext: boolean;
}

export interface ActiveTabSubtitleStatus {
  hostname: string;
  subtitleNavigation: ActiveTabSubtitleNavigation;
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

function hasChromeTabMessaging(): boolean {
  return hasChromeTabs() && typeof chrome.tabs.sendMessage === 'function';
}

function hasChromeTabConnections(): boolean {
  return hasChromeTabs() && typeof chrome.tabs.connect === 'function';
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object';
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
    const migratedSettings = normalizeSettingsV3(migrateToV3(allPayload));
    const currentPayload = await readStorage<Record<string, unknown>>([SETTINGS_STORAGE_KEY_V3]);
    const currentStoredSettings = currentPayload[SETTINGS_STORAGE_KEY_V3];

    if (currentStoredSettings != null) {
      return normalizeSettingsV3(currentStoredSettings);
    }

    await writeStorage({
      [SETTINGS_STORAGE_KEY_V3]: migratedSettings,
    });
    return migratedSettings;
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

function getLearningStateApi(): LearningStateApi | null {
  const scopedGlobal = globalThis as typeof globalThis & { LearningState?: LearningStateApi };
  return scopedGlobal.LearningState || null;
}

function buildEmptyLearningSummary(): LearningSummary {
  const learningState = getLearningStateApi();
  if (learningState && typeof learningState.buildLearningSummary === 'function') {
    return normalizeLearningSummary(learningState.buildLearningSummary({}, {}));
  }
  return {
    todayCount: 0,
    newCount: 0,
    masteredCount: 0,
    recentWords: [],
  };
}

function normalizeLearningStats(
  rawStats: unknown,
  learningState: LearningStateApi
): Record<string, LearningRecord> {
  if (!rawStats || typeof rawStats !== 'object' || !learningState.normalizeLearningRecord) {
    return {};
  }

  const normalized: Record<string, LearningRecord> = {};
  Object.keys(rawStats as Record<string, unknown>).forEach((key) => {
    const item = (rawStats as Record<string, unknown>)[key];
    if (!item || typeof item !== 'object') {
      return;
    }

    const normalizedItem = learningState.normalizeLearningRecord!(item, {
      word: (item as Record<string, unknown>).word || key,
      level: (item as Record<string, unknown>).level,
    });
    const normalizedWord = String(normalizedItem.word || '')
      .trim()
      .toLowerCase();
    if (!normalizedWord) {
      return;
    }
    normalized[normalizedWord] = normalizedItem;
  });
  return normalized;
}

function migrateLegacyLearningStats(
  rawStats: unknown,
  learningState: LearningStateApi
): Record<string, LearningRecord> {
  if (!rawStats || typeof rawStats !== 'object' || !learningState.migrateLegacyStat) {
    return {};
  }

  const normalized: Record<string, LearningRecord> = {};
  Object.keys(rawStats as Record<string, unknown>).forEach((key) => {
    const migrated = learningState.migrateLegacyStat!((rawStats as Record<string, unknown>)[key]);
    const normalizedWord = String(migrated.word || '')
      .trim()
      .toLowerCase();
    if (!normalizedWord) {
      return;
    }
    normalized[normalizedWord] = migrated;
  });
  return normalized;
}

function normalizeReviewQueue(
  rawQueue: unknown,
  learningState: LearningStateApi
): Record<string, ReviewQueueEntry> {
  if (!learningState.normalizeReviewQueue) {
    return {};
  }
  return learningState.normalizeReviewQueue(rawQueue);
}

function buildQuickReviewItems(
  stats: Record<string, LearningRecord>,
  queue: Record<string, ReviewQueueEntry>,
  limit = 5
): QuickReviewItem[] {
  const items = Object.values(queue)
    .map((item) => {
      const recordKey = String(item.word || '')
        .trim()
        .toLowerCase();
      const record = stats[recordKey];
      if (!record) {
        return null;
      }

      return {
        word: String(record.word || '').trim(),
        translation: String(record.translation || '').trim(),
        level: String(record.level || '')
          .trim()
          .toUpperCase(),
        status: String(record.status || '')
          .trim()
          .toLowerCase(),
        dueBucket: String(item.dueBucket || record.nextReviewBucket || 'today')
          .trim()
          .toLowerCase(),
        nextReviewAt: normalizeTimestamp(item.nextReviewAt ?? record.nextReviewAt),
        intervalDays: Number.isFinite(Number(item.intervalDays))
          ? Math.max(1, Math.floor(Number(item.intervalDays)))
          : null,
        easeFactor: Number.isFinite(Number(item.easeFactor)) ? Number(item.easeFactor) : null,
        updatedAt: normalizeTimestamp(item.updatedAt ?? record.lastSeenAt ?? record.lastSeen) || 0,
      } satisfies QuickReviewItem;
    })
    .filter((item): item is QuickReviewItem => Boolean(item && item.word));

  const safeLimit = Math.max(1, Math.floor(Number(limit) || 5));
  return sortQuickReviewItems(items).slice(0, safeLimit);
}

async function readQuickReviewState(limit = 5): Promise<{
  summary: LearningSummary;
  items: QuickReviewItem[];
  stats: Record<string, LearningRecord>;
  queue: Record<string, ReviewQueueEntry>;
}> {
  const learningState = getLearningStateApi();
  if (!learningState) {
    return {
      summary: buildEmptyLearningSummary(),
      items: [],
      stats: {},
      queue: {},
    };
  }

  const payload = await readStorage<Record<string, unknown>>([
    WORD_STATS_STORAGE_KEY,
    LEARNING_WORD_STATS_STORAGE_KEY,
    REVIEW_QUEUE_STORAGE_KEY,
    LEARNING_SUMMARY_STORAGE_KEY,
  ]);
  let stats = normalizeLearningStats(payload[LEARNING_WORD_STATS_STORAGE_KEY], learningState);
  if (!Object.keys(stats).length) {
    stats = migrateLegacyLearningStats(payload[WORD_STATS_STORAGE_KEY], learningState);
  }
  const queue = normalizeReviewQueue(payload[REVIEW_QUEUE_STORAGE_KEY], learningState);
  const summary =
    payload[LEARNING_SUMMARY_STORAGE_KEY] &&
    typeof payload[LEARNING_SUMMARY_STORAGE_KEY] === 'object'
      ? normalizeLearningSummary(payload[LEARNING_SUMMARY_STORAGE_KEY])
      : normalizeLearningSummary(
          learningState.buildLearningSummary ? learningState.buildLearningSummary(stats, queue) : {}
        );

  return {
    summary,
    items: buildQuickReviewItems(stats, queue, limit),
    stats,
    queue,
  };
}

export async function readQuickReviewDashboard(limit = 5): Promise<QuickReviewDashboard> {
  const state = await readQuickReviewState(limit);
  return {
    summary: state.summary,
    items: state.items,
  };
}

function normalizeQuickReviewAction(action: QuickReviewAction): string {
  const normalized = String(action || 'dontknow')
    .trim()
    .toLowerCase();
  if (normalized === 'know' || normalized === 'fuzzy') {
    return normalized;
  }
  return 'dontknow';
}

async function persistQuickReviewAdaptiveFeedback(action: string, now: number): Promise<boolean> {
  try {
    const outcome = await sendRuntimeMessage<Record<string, unknown>>(
      MESSAGE_TYPES.ADAPTIVE_PERSIST_FEEDBACK,
      {
        feedback: action,
        options: { now },
      }
    );
    return outcome.applied === true;
  } catch {
    return false;
  }
}

export async function submitQuickReviewFeedback(
  word: string,
  action: QuickReviewAction,
  limit = 5
): Promise<QuickReviewCommitResult> {
  const learningState = getLearningStateApi();
  const syncReviewQueue = learningState?.syncReviewQueue;
  const applyLearningAction = learningState?.applyLearningAction;
  const applyReviewFeedback = learningState?.applyReviewFeedback;
  if (!learningState || !syncReviewQueue || (!applyLearningAction && !applyReviewFeedback)) {
    throw new Error('LearningState unavailable');
  }

  return enqueueStorageMutation(async () => {
    const current = await readQuickReviewState(limit);
    const normalizedWord = String(word || '')
      .trim()
      .toLowerCase();
    const record = current.stats[normalizedWord];
    if (!record) {
      throw new Error('Review word unavailable');
    }

    const normalizedAction = normalizeQuickReviewAction(action);
    const now = Date.now();
    const nextRecord = applyLearningAction
      ? applyLearningAction(record, normalizedAction, now)
      : applyReviewFeedback!(record, normalizedAction, now);
    const nextStats = {
      ...current.stats,
      [normalizedWord]: nextRecord,
    };
    const nextQueue = syncReviewQueue(current.queue, nextRecord, now);
    const nextSummary = normalizeLearningSummary(
      learningState.buildLearningSummary
        ? learningState.buildLearningSummary(nextStats, nextQueue)
        : current.summary
    );

    await writeStorage({
      [LEARNING_WORD_STATS_STORAGE_KEY]: nextStats,
      [REVIEW_QUEUE_STORAGE_KEY]: nextQueue,
      [LEARNING_SUMMARY_STORAGE_KEY]: nextSummary,
    });

    // Streak bookkeeping should not block the main review commit path.
    void touchLearningStreak(now);
    const adaptiveApplied = await persistQuickReviewAdaptiveFeedback(normalizedAction, now);
    return {
      word: String(nextRecord.word || normalizedWord).trim(),
      summary: nextSummary,
      items: buildQuickReviewItems(nextStats, nextQueue, limit),
      adaptiveApplied,
    };
  });
}

function buildEncounteredWordFallback(
  rawStats: unknown,
  learningState: LearningStateApi | null
): EncounteredWordRankingItem[] {
  if (!learningState) {
    return [];
  }
  return Object.values(normalizeLearningStats(rawStats, learningState))
    .map((record) => normalizeEncounteredWord(record))
    .filter((item): item is EncounteredWordRankingItem => Boolean(item && item.hitCount > 0));
}

export async function readEncounteredWordRanking(
  sortMode: EncounteredWordSortMode = 'asc',
  limit = 6
): Promise<EncounteredWordRankingItem[]> {
  const payload = await readStorage<Record<string, unknown>>([
    WORD_STATS_STORAGE_KEY,
    LEARNING_WORD_STATS_STORAGE_KEY,
  ]);
  let items = Object.values(
    payload[WORD_STATS_STORAGE_KEY] && typeof payload[WORD_STATS_STORAGE_KEY] === 'object'
      ? (payload[WORD_STATS_STORAGE_KEY] as Record<string, unknown>)
      : {}
  )
    .map((entry) => normalizeEncounteredWord(entry))
    .filter((item): item is EncounteredWordRankingItem => Boolean(item && item.hitCount > 0));

  if (!items.length) {
    items = buildEncounteredWordFallback(
      payload[LEARNING_WORD_STATS_STORAGE_KEY],
      getLearningStateApi()
    );
  }

  const safeLimit = Math.max(1, Math.floor(Number(limit) || 6));
  return sortEncounteredWords(items, sortMode).slice(0, safeLimit);
}

export async function getCurrentTabHostname(): Promise<string> {
  const activeTab = await queryActiveTab().catch(() => null);
  return resolveHostnameFromTabUrl(activeTab && activeTab.url);
}

function createEmptyActiveTabSubtitleNavigation(
  description = '请先打开支持字幕的 Bilibili 视频页。'
): ActiveTabSubtitleNavigation {
  return {
    supported: false,
    progressLabel: '未连接',
    headline: '当前标签页暂无字幕导航',
    description,
    currentText: '还没有可直接跳转的字幕句段。',
    canGoPrevious: false,
    canReplay: false,
    canGoNext: false,
  };
}

function normalizeActiveTabSubtitleNavigation(value: unknown): ActiveTabSubtitleNavigation {
  const source = isObjectRecord(value) ? value : {};
  return {
    supported: source.supported === true,
    progressLabel: String(source.progressLabel || '未连接').trim() || '未连接',
    headline:
      String(source.headline || '当前标签页暂无字幕导航').trim() || '当前标签页暂无字幕导航',
    description:
      String(source.description || '请先打开支持字幕的 Bilibili 视频页。').trim() ||
      '请先打开支持字幕的 Bilibili 视频页。',
    currentText:
      String(source.currentText || '还没有可直接跳转的字幕句段。').trim() ||
      '还没有可直接跳转的字幕句段。',
    canGoPrevious: source.canGoPrevious === true,
    canReplay: source.canReplay === true,
    canGoNext: source.canGoNext === true,
  };
}

function resolveHostnameFromTabUrl(rawUrl: unknown): string {
  try {
    return rawUrl ? new URL(String(rawUrl)).hostname : '';
  } catch {
    return '';
  }
}

async function queryActiveTab(): Promise<chrome.tabs.Tab | null> {
  if (!hasChromeTabs()) {
    return null;
  }
  return new Promise<chrome.tabs.Tab | null>((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const runtimeError = getChromeRuntimeError('chrome.tabs.query failed');
      if (runtimeError) {
        reject(runtimeError);
        return;
      }
      resolve(Array.isArray(tabs) && tabs.length ? tabs[0] : null);
    });
  });
}

async function sendTabMessage<T>(
  activeTab: chrome.tabs.Tab | null,
  type: string,
  payload: Record<string, unknown>
): Promise<T> {
  if (!hasChromeTabMessaging()) {
    return Promise.reject(new Error('chrome.tabs.sendMessage unavailable'));
  }

  if (!activeTab || typeof activeTab.id !== 'number') {
    return Promise.reject(new Error('active tab unavailable'));
  }

  return new Promise<T>((resolve, reject) => {
    try {
      chrome.tabs.sendMessage(activeTab.id as number, { type, payload }, (response) => {
        const runtimeError = getChromeRuntimeError('chrome.tabs.sendMessage failed');
        if (runtimeError) {
          reject(runtimeError);
          return;
        }
        if (!response || response.ok !== true) {
          reject(
            new Error(String(response && response.error ? response.error : 'tab message failed'))
          );
          return;
        }
        resolve(response.payload as T);
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function sendActiveTabMessage<T>(type: string, payload: Record<string, unknown>): Promise<T> {
  return sendTabMessage(await queryActiveTab(), type, payload);
}

function connectTabPort(activeTab: chrome.tabs.Tab | null, name: string): chrome.runtime.Port {
  if (!hasChromeTabConnections()) {
    throw new Error('chrome.tabs.connect unavailable');
  }

  if (!activeTab || typeof activeTab.id !== 'number') {
    throw new Error('active tab unavailable');
  }

  return chrome.tabs.connect(activeTab.id, { name });
}

function buildEmptyActiveTabSubtitleStatus(hostname: string): ActiveTabSubtitleStatus {
  return {
    hostname,
    subtitleNavigation: createEmptyActiveTabSubtitleNavigation(
      hostname ? `${hostname} 当前还没有可用字幕导航。` : '当前标签页暂不支持字幕导航。'
    ),
  };
}

export async function readActiveTabSubtitleStatus(): Promise<ActiveTabSubtitleStatus> {
  const activeTab = await queryActiveTab().catch(() => null);
  const hostname = resolveHostnameFromTabUrl(activeTab && activeTab.url);

  try {
    const payload = await sendTabMessage<Record<string, unknown>>(
      activeTab,
      ACTIVE_TAB_SUBTITLE_NAVIGATION_READ,
      {}
    );
    return {
      hostname,
      subtitleNavigation: normalizeActiveTabSubtitleNavigation(payload),
    };
  } catch {
    return buildEmptyActiveTabSubtitleStatus(hostname);
  }
}

export async function readActiveTabSubtitleNavigation(): Promise<ActiveTabSubtitleNavigation> {
  return (await readActiveTabSubtitleStatus()).subtitleNavigation;
}

export async function navigateActiveTabSubtitle(
  action: ActiveTabSubtitleNavigationAction
): Promise<ActiveTabSubtitleNavigation> {
  const payload = await sendActiveTabMessage<Record<string, unknown>>(
    ACTIVE_TAB_SUBTITLE_NAVIGATION_NAVIGATE,
    { action }
  );
  return normalizeActiveTabSubtitleNavigation(payload);
}

function subscribeChromeTabActivation(onUpdate: () => void): () => void {
  if (
    typeof chrome === 'undefined' ||
    !chrome.tabs ||
    !chrome.tabs.onActivated ||
    typeof chrome.tabs.onActivated.addListener !== 'function'
  ) {
    return () => {};
  }

  const listener = () => {
    onUpdate();
  };
  chrome.tabs.onActivated.addListener(listener);
  return () => {
    chrome.tabs.onActivated.removeListener(listener);
  };
}

function subscribeChromeTabUpdates(onUpdate: () => void): () => void {
  if (
    typeof chrome === 'undefined' ||
    !chrome.tabs ||
    !chrome.tabs.onUpdated ||
    typeof chrome.tabs.onUpdated.addListener !== 'function'
  ) {
    return () => {};
  }

  const listener = (
    _tabId: number,
    changeInfo: { status?: string; url?: string },
    tab: chrome.tabs.Tab
  ) => {
    if (tab && tab.active === false) {
      return;
    }
    if (typeof changeInfo.url === 'string' || changeInfo.status === 'complete') {
      onUpdate();
    }
  };
  chrome.tabs.onUpdated.addListener(listener);
  return () => {
    chrome.tabs.onUpdated.removeListener(listener);
  };
}

export function subscribeActiveTabSubtitleStatus(
  onUpdate: (status: ActiveTabSubtitleStatus) => void
): () => void {
  if (!hasChromeTabs()) {
    return () => {};
  }

  let disposed = false;
  let currentPort: chrome.runtime.Port | null = null;
  let currentTabKey = '';

  const disconnectCurrentPort = () => {
    const port = currentPort;
    currentPort = null;
    currentTabKey = '';
    if (!port) {
      return;
    }
    try {
      port.disconnect();
    } catch {
      // Ignore disconnect races when the tab navigates away mid-cleanup.
    }
  };

  const reconnect = async () => {
    const activeTab = await queryActiveTab().catch(() => null);
    if (disposed) {
      return;
    }

    const hostname = resolveHostnameFromTabUrl(activeTab && activeTab.url);
    const nextTabKey =
      activeTab && typeof activeTab.id === 'number'
        ? `${activeTab.id}:${String(activeTab.url || '')}`
        : '';

    if (!nextTabKey) {
      disconnectCurrentPort();
      onUpdate(buildEmptyActiveTabSubtitleStatus(hostname));
      return;
    }

    if (currentPort && currentTabKey === nextTabKey) {
      return;
    }

    disconnectCurrentPort();
    currentTabKey = nextTabKey;

    let port: chrome.runtime.Port;
    try {
      port = connectTabPort(activeTab, ACTIVE_TAB_SUBTITLE_NAVIGATION_SUBSCRIBE);
    } catch {
      currentTabKey = '';
      onUpdate(buildEmptyActiveTabSubtitleStatus(hostname));
      return;
    }

    currentPort = port;
    port.onMessage.addListener((message: unknown) => {
      if (disposed || currentPort !== port) {
        return;
      }
      const payload =
        isObjectRecord(message) && Object.prototype.hasOwnProperty.call(message, 'payload')
          ? message.payload
          : message;
      onUpdate({
        hostname,
        subtitleNavigation: normalizeActiveTabSubtitleNavigation(payload),
      });
    });
    port.onDisconnect.addListener(() => {
      if (currentPort !== port) {
        return;
      }
      currentPort = null;
      currentTabKey = '';
      if (!disposed) {
        onUpdate(buildEmptyActiveTabSubtitleStatus(hostname));
      }
    });
  };

  const unsubscribeTabActivation = subscribeChromeTabActivation(() => {
    void reconnect();
  });
  const unsubscribeTabUpdates = subscribeChromeTabUpdates(() => {
    void reconnect();
  });

  void reconnect();

  return () => {
    disposed = true;
    unsubscribeTabActivation();
    unsubscribeTabUpdates();
    disconnectCurrentPort();
  };
}

function sanitizeAnkiField(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildAnkiTsv(savedWords: VocabularyWord[]): string {
  const headers = ['Front', 'Back', 'Level', 'Phonetic', 'SavedAt'];
  const rows = savedWords.map((word) => [
    sanitizeAnkiField(word.word),
    sanitizeAnkiField(word.details?.meaning || ''),
    sanitizeAnkiField(word.details?.level || ''),
    sanitizeAnkiField(word.details?.phonetic || ''),
    word.savedAt ? new Date(word.savedAt).toISOString() : '',
  ]);
  return [headers.join('\t'), ...rows.map((row) => row.join('\t'))].join('\n');
}

// 生词本导出功能
export async function exportVocabularyBook(
  format: VocabularyExportFormat = 'json'
): Promise<string> {
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

  if (format === 'anki') {
    return buildAnkiTsv(savedWords);
  }

  return JSON.stringify(savedWords, null, 2);
}

export async function clearVocabularyBook(): Promise<number> {
  return enqueueStorageMutation(async () => {
    const payload = await readStorage<Record<string, unknown>>([VOCABULARY_BOOK_STORAGE_KEY]);
    const sourceWordStats =
      payload[VOCABULARY_BOOK_STORAGE_KEY] &&
      typeof payload[VOCABULARY_BOOK_STORAGE_KEY] === 'object'
        ? (payload[VOCABULARY_BOOK_STORAGE_KEY] as Record<string, unknown>)
        : {};

    const nextWordStats = { ...sourceWordStats };
    let clearedCount = 0;

    Object.keys(nextWordStats).forEach((wordKey) => {
      const record = nextWordStats[wordKey];
      const status =
        record && typeof record === 'object'
          ? String((record as Record<string, unknown>).status || '')
              .trim()
              .toLowerCase()
          : '';
      if (!record || typeof record !== 'object' || status !== 'saved') {
        return;
      }

      const nextRecord: Record<string, unknown> = {
        ...(record as Record<string, unknown>),
        status: 'seen',
      };
      delete nextRecord.savedAt;
      nextWordStats[wordKey] = nextRecord;
      clearedCount += 1;
    });

    if (clearedCount === 0) {
      return 0;
    }

    await writeStorage({
      [VOCABULARY_BOOK_STORAGE_KEY]: nextWordStats,
    });

    return clearedCount;
  });
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

async function touchLearningStreak(now: number): Promise<void> {
  const learningState = getLearningStateApi();
  if (!learningState || typeof learningState.updateLearningStreak !== 'function') {
    return;
  }
  await learningState.updateLearningStreak(now);
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

export function subscribeLearningStreak(onUpdate: (streak: LearningStreak) => void): () => void {
  if (
    typeof chrome === 'undefined' ||
    !chrome.storage ||
    !chrome.storage.onChanged ||
    typeof chrome.storage.onChanged.addListener !== 'function'
  ) {
    return () => {};
  }
  const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName !== 'local' || !changes[LEARNING_STREAK_STORAGE_KEY]) {
      return;
    }
    onUpdate(normalizeLearningStreak(changes[LEARNING_STREAK_STORAGE_KEY].newValue));
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

function subscribeStorageKeys(keys: string[], onUpdate: () => void): () => void {
  if (
    typeof chrome === 'undefined' ||
    !chrome.storage ||
    !chrome.storage.onChanged ||
    typeof chrome.storage.onChanged.addListener !== 'function'
  ) {
    return () => {};
  }

  const watchedKeys = new Set(keys);
  const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName !== 'local') {
      return;
    }
    const changed = Object.keys(changes).some((key) => watchedKeys.has(key));
    if (changed) {
      onUpdate();
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}

export function subscribeQuickReviewSource(onUpdate: () => void): () => void {
  return subscribeStorageKeys(
    [
      WORD_STATS_STORAGE_KEY,
      LEARNING_WORD_STATS_STORAGE_KEY,
      REVIEW_QUEUE_STORAGE_KEY,
      LEARNING_SUMMARY_STORAGE_KEY,
    ],
    onUpdate
  );
}

export function subscribeEncounteredWordStats(onUpdate: () => void): () => void {
  return subscribeStorageKeys([WORD_STATS_STORAGE_KEY, LEARNING_WORD_STATS_STORAGE_KEY], onUpdate);
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
