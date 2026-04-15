import { SETTINGS_STORAGE_KEY_V3, migrateToV3, normalizeSettingsV3 } from './overlay-settings';
import type { SettingsV3 } from './overlay-settings';

const LEARNING_SUMMARY_STORAGE_KEY = 'bili_vocab_learning_summary_v1';
const ADAPTIVE_TUNING_STORAGE_KEY = 'bili_vocab_adaptive_tuning_v1';
const EXPERIENCE_METRICS_STORAGE_KEY = 'bili_vocab_experience_metrics_v1';
const ADAPTIVE_MANUAL_OVERRIDE_MS = 20 * 60 * 1000;

export interface LearningSummary {
  todayCount: number;
  newCount: number;
  masteredCount: number;
  recentWords: Array<{ word: string; translation?: string; status?: string }>;
}

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage) && Boolean(chrome.storage.local);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object';
}

function toPositiveInt(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function toDayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function normalizeLearningSummary(value: unknown): LearningSummary {
  const source = isRecord(value) ? value : {};
  const recentWords = Array.isArray(source.recentWords)
    ? source.recentWords
        .filter((item): item is Record<string, unknown> => isRecord(item))
        .map((item) => ({
          word: String(item.word || '').trim(),
          translation: String(item.translation || '').trim(),
          status: String(item.status || '').trim(),
        }))
        .filter((item) => Boolean(item.word))
    : [];
  return {
    todayCount: toPositiveInt(source.todayCount),
    newCount: toPositiveInt(source.newCount),
    masteredCount: toPositiveInt(source.masteredCount),
    recentWords: recentWords.slice(0, 5),
  };
}

function bumpAdaptiveManualOverrideMetric(metrics: unknown, now: number): Record<string, unknown> {
  const source = isRecord(metrics) ? metrics : {};
  const countersSource = isRecord(source.counters) ? source.counters : {};
  const dailySource = isRecord(source.daily) ? source.daily : {};
  const dayKey = toDayKey(now);
  const dayCountersSource = isRecord(dailySource[dayKey]) ? dailySource[dayKey] : {};
  return {
    ...source,
    schemaVersion: 1,
    updatedAt: now,
    counters: {
      ...countersSource,
      adaptiveManualOverride: toPositiveInt(countersSource.adaptiveManualOverride) + 1,
    },
    daily: {
      ...dailySource,
      [dayKey]: {
        ...dayCountersSource,
        adaptiveManualOverride: toPositiveInt(dayCountersSource.adaptiveManualOverride) + 1,
      },
    },
  };
}

export async function readStorage<T extends Record<string, unknown>>(
  keys?: string[] | null
): Promise<T> {
  if (!hasChromeStorage()) {
    return {} as T;
  }
  return new Promise<T>((resolve) => {
    chrome.storage.local.get(keys || null, (payload) => {
      resolve((payload || {}) as T);
    });
  });
}

export async function writeStorage(payload: Record<string, unknown>): Promise<void> {
  if (!hasChromeStorage()) {
    return;
  }
  await new Promise<void>((resolve) => {
    chrome.storage.local.set(payload, () => resolve());
  });
}

export async function loadOverlaySettingsV3(): Promise<SettingsV3> {
  const allPayload = await readStorage<Record<string, unknown>>(null);
  const settingsV3 = normalizeSettingsV3(migrateToV3(allPayload));
  await writeStorage({
    [SETTINGS_STORAGE_KEY_V3]: settingsV3,
  });
  return settingsV3;
}

export async function saveOverlaySettingsV3(settings: SettingsV3): Promise<SettingsV3> {
  const normalized = normalizeSettingsV3(settings);
  const now = Date.now();
  const payload = await readStorage<Record<string, unknown>>([
    ADAPTIVE_TUNING_STORAGE_KEY,
    EXPERIENCE_METRICS_STORAGE_KEY,
  ]);
  const adaptiveRaw = isRecord(payload[ADAPTIVE_TUNING_STORAGE_KEY])
    ? payload[ADAPTIVE_TUNING_STORAGE_KEY]
    : {};
  await writeStorage({
    [SETTINGS_STORAGE_KEY_V3]: normalized,
    [ADAPTIVE_TUNING_STORAGE_KEY]: {
      ...adaptiveRaw,
      enabled: adaptiveRaw.enabled !== false,
      manualOverrideUntil: now + ADAPTIVE_MANUAL_OVERRIDE_MS,
    },
    [EXPERIENCE_METRICS_STORAGE_KEY]: bumpAdaptiveManualOverrideMetric(
      payload[EXPERIENCE_METRICS_STORAGE_KEY],
      now
    ),
  });
  return normalized;
}

export async function readLearningSummary(): Promise<LearningSummary> {
  const payload = await readStorage<Record<string, unknown>>([LEARNING_SUMMARY_STORAGE_KEY]);
  return normalizeLearningSummary(payload[LEARNING_SUMMARY_STORAGE_KEY]);
}

export function subscribeOverlaySettingsChanges(
  onUpdate: (settings: SettingsV3) => void
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
    if (areaName !== 'local' || !changes[SETTINGS_STORAGE_KEY_V3]) {
      return;
    }
    onUpdate(normalizeSettingsV3(changes[SETTINGS_STORAGE_KEY_V3].newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}
