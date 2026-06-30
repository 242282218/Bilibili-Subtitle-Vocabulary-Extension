export type {
  BilingualMode,
  ThemeMode,
  BuiltinProfileId,
  ProfileId,
  ScenePresetKey,
  ReviewDanmakuSpeed,
  ReviewDanmakuDensity,
  VocabularyMode,
  ExamPreference,
  ProfileConfig,
  DomainRule,
  OverlayState,
  GlobalControls,
  CustomProfile,
  SettingsV3,
} from './settings-normalizer';

import type {
  BilingualMode,
  BuiltinProfileId,
  CustomProfile,
  DomainRule,
  OverlayState,
  ProfileConfig,
  ProfileId,
  ReviewDanmakuDensity,
  ReviewDanmakuSpeed,
  ScenePresetKey,
  SettingsV3,
  ThemeMode,
} from './settings-normalizer';

export interface ScenePreset {
  replaceRatio: number;
  maxReplaceCount: number;
  reviewDanmakuSpeed: ReviewDanmakuSpeed;
  reviewDanmakuDensity: ReviewDanmakuDensity;
}

export interface LearningProfileMeta {
  tone: 'gentle' | 'balanced' | 'intensive';
  label: string;
  summary: string;
}

export type EffectiveRuntime = ProfileConfig & {
  reviewDanmakuEnabled: boolean;
  webPageEnabled: boolean;
  domainRules: Record<string, DomainRule>;
  siteEnabled: boolean;
};

interface SharedSettingsApi {
  SETTINGS_STORAGE_KEY_V3: string;
  BUILTIN_PROFILE_IDS: BuiltinProfileId[];
  MAX_CUSTOM_PROFILES: number;
  LEVELS: string[];
  CEFR_LEVELS: string[];
  REVIEW_SPEEDS: ReviewDanmakuSpeed[];
  REVIEW_DENSITIES: ReviewDanmakuDensity[];
  THEME_MODES: ThemeMode[];
  OVERLAY_DEFAULTS: OverlayState;
  SCENE_PRESETS: Record<ScenePresetKey, ScenePreset>;
  normalizeProfileConfig: (value: unknown) => ProfileConfig;
  normalizeDomainRules: (value: unknown) => Record<string, DomainRule>;
  setExactDomainRuleEnabled: (
    domainRules: Record<string, DomainRule>,
    hostname: string,
    enabled: boolean
  ) => Record<string, DomainRule>;
  normalizeHostname: (hostname: string) => string;
  normalizeBilingualMode: (value: unknown) => BilingualMode;
  normalizeSettingsV3: (value: unknown) => SettingsV3;
  getDefaultSettingsV3: () => SettingsV3;
  migrateToV3: (value: unknown) => SettingsV3;
  resolveEffectiveRuntime: (value: SettingsV3, context?: { hostname?: string }) => EffectiveRuntime;
  getProfileConfigById: (value: SettingsV3, profileId: ProfileId) => ProfileConfig;
  upsertCustomProfile: (
    settings: SettingsV3,
    profileInput: Partial<CustomProfile> & { config?: Partial<ProfileConfig> }
  ) => SettingsV3;
  removeCustomProfile: (settings: SettingsV3, profileId: string) => SettingsV3;
  isDomainEnabled: (hostname: string, runtime: unknown) => boolean;
  getReviewDanmakuSpeedLabel: (speed: unknown) => string;
  getReviewDanmakuDensityLabel: (density: unknown) => string;
  getBilingualModeLabel: (mode: unknown) => string;
  getMockPreviewData: (targetCefr: unknown, ratio: unknown, maxReplaceCount: unknown) => string[];
  getLearningProfile: (settings: unknown) => LearningProfileMeta;
  buildSettingsPreview: (settings: unknown) => string;
  getPresetKeyFromSettings: (settings: unknown) => ScenePresetKey;
}

declare global {
  interface Window {
    SharedSettings?: SharedSettingsApi;
  }
}

const SHARED_SETTINGS_ERROR = 'SharedSettings is required before React settings bridge loads';

function readSharedSettings(): SharedSettingsApi | undefined {
  const globalShared =
    typeof globalThis !== 'undefined'
      ? (globalThis as typeof globalThis & { SharedSettings?: SharedSettingsApi }).SharedSettings
      : undefined;
  const windowShared =
    typeof window !== 'undefined'
      ? (window as Window & { SharedSettings?: SharedSettingsApi }).SharedSettings
      : undefined;
  const shared = windowShared || globalShared;
  return shared && typeof shared === 'object' ? shared : undefined;
}

function getSharedSettings(): SharedSettingsApi {
  const shared = readSharedSettings();
  if (!shared) {
    throw new Error(SHARED_SETTINGS_ERROR);
  }
  return shared;
}

function requireSharedSettingsFunction<T extends (...args: never[]) => unknown>(
  name: keyof SharedSettingsApi
): T {
  const value = shared[name];
  if (typeof value !== 'function') {
    throw new Error(`${SHARED_SETTINGS_ERROR}: ${String(name)} must be a function`);
  }
  return value as unknown as T;
}

function requireSharedSettingsArray<T>(name: keyof SharedSettingsApi): T[] {
  const value = shared[name];
  if (!Array.isArray(value)) {
    throw new Error(`${SHARED_SETTINGS_ERROR}: ${String(name)} must be an array`);
  }
  return value.slice() as T[];
}

function requireSharedSettingsValue<T>(name: keyof SharedSettingsApi): T {
  const value = shared[name];
  if (value == null) {
    throw new Error(`${SHARED_SETTINGS_ERROR}: ${String(name)} is missing`);
  }
  return value as T;
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const shared = getSharedSettings();

// Legacy storage key retained for backward compatibility with existing installs.
export const SETTINGS_STORAGE_KEY_V3 =
  requireSharedSettingsValue<string>('SETTINGS_STORAGE_KEY_V3');
export const BUILTIN_PROFILE_IDS =
  requireSharedSettingsArray<BuiltinProfileId>('BUILTIN_PROFILE_IDS');
export const MAX_CUSTOM_PROFILES = Number(
  requireSharedSettingsValue<number>('MAX_CUSTOM_PROFILES')
);
export const LEVELS = requireSharedSettingsArray<string>('LEVELS');
export const CEFR_LEVELS = requireSharedSettingsArray<string>('CEFR_LEVELS');
export const REVIEW_SPEEDS = requireSharedSettingsArray<ReviewDanmakuSpeed>('REVIEW_SPEEDS');
export const REVIEW_DENSITIES =
  requireSharedSettingsArray<ReviewDanmakuDensity>('REVIEW_DENSITIES');
export const THEME_MODES = requireSharedSettingsArray<ThemeMode>('THEME_MODES');
export const OVERLAY_DEFAULTS = {
  ...requireSharedSettingsValue<OverlayState>('OVERLAY_DEFAULTS'),
};
export const SCENE_PRESETS: Record<ScenePresetKey, ScenePreset> = cloneValue(
  requireSharedSettingsValue<Record<ScenePresetKey, ScenePreset>>('SCENE_PRESETS')
);

export const PROFILE_META: Record<BuiltinProfileId, { label: string; summary: string }> = {
  gentle: {
    label: '轻量输入',
    summary: '优先保障观看流畅度，适合初次接触主题内容。',
  },
  balanced: {
    label: '均衡输入',
    summary: '在理解与曝光之间保持稳定节奏，适合日常长期学习。',
  },
  intensive: {
    label: '强化曝光',
    summary: '提高替换密度与复习频率，适合冲刺期或复看阶段。',
  },
};

export function normalizeProfileConfig(input: unknown): ProfileConfig {
  return requireSharedSettingsFunction<SharedSettingsApi['normalizeProfileConfig']>(
    'normalizeProfileConfig'
  )(input);
}

export function normalizeSettingsV3(input: unknown): SettingsV3 {
  return requireSharedSettingsFunction<SharedSettingsApi['normalizeSettingsV3']>(
    'normalizeSettingsV3'
  )(input);
}

export function getDefaultSettingsV3(): SettingsV3 {
  return requireSharedSettingsFunction<SharedSettingsApi['getDefaultSettingsV3']>(
    'getDefaultSettingsV3'
  )();
}

export function parseImportedSettingsText(rawText: string): SettingsV3 {
  return cloneSettingsV3(migrateToV3(JSON.parse(String(rawText))));
}

export function createResetSettingsSnapshot(): SettingsV3 {
  return cloneSettingsV3(getDefaultSettingsV3());
}

export function migrateToV3(input: unknown): SettingsV3 {
  return requireSharedSettingsFunction<SharedSettingsApi['migrateToV3']>('migrateToV3')(input);
}

export function getProfileConfigById(settings: SettingsV3, profileId: ProfileId): ProfileConfig {
  return requireSharedSettingsFunction<SharedSettingsApi['getProfileConfigById']>(
    'getProfileConfigById'
  )(settings, profileId);
}

export function upsertCustomProfile(
  settings: SettingsV3,
  profileInput: Partial<CustomProfile> & { config?: Partial<ProfileConfig> }
): SettingsV3 {
  return requireSharedSettingsFunction<SharedSettingsApi['upsertCustomProfile']>(
    'upsertCustomProfile'
  )(settings, profileInput);
}

export function removeCustomProfile(settings: SettingsV3, profileId: string): SettingsV3 {
  return requireSharedSettingsFunction<SharedSettingsApi['removeCustomProfile']>(
    'removeCustomProfile'
  )(settings, profileId);
}

export function resolveEffectiveRuntime(settings: SettingsV3, hostname = ''): EffectiveRuntime {
  return requireSharedSettingsFunction<SharedSettingsApi['resolveEffectiveRuntime']>(
    'resolveEffectiveRuntime'
  )(settings, { hostname });
}

export function normalizeHostname(hostname: string): string {
  return requireSharedSettingsFunction<SharedSettingsApi['normalizeHostname']>('normalizeHostname')(
    hostname
  );
}

export function normalizeDomainRules(value: unknown): Record<string, DomainRule> {
  return requireSharedSettingsFunction<SharedSettingsApi['normalizeDomainRules']>(
    'normalizeDomainRules'
  )(value);
}

export function setExactDomainRuleEnabled(
  domainRules: Record<string, DomainRule>,
  hostname: string,
  enabled: boolean
): Record<string, DomainRule> {
  return requireSharedSettingsFunction<SharedSettingsApi['setExactDomainRuleEnabled']>(
    'setExactDomainRuleEnabled'
  )(domainRules, hostname, enabled);
}

export function isDomainEnabled(hostname: string, runtime: unknown): boolean {
  return requireSharedSettingsFunction<SharedSettingsApi['isDomainEnabled']>('isDomainEnabled')(
    hostname,
    runtime
  );
}

export function cloneSettingsV3(settings: SettingsV3): SettingsV3 {
  return cloneValue(settings);
}

export function getReviewDanmakuSpeedLabel(speed: unknown): string {
  return requireSharedSettingsFunction<SharedSettingsApi['getReviewDanmakuSpeedLabel']>(
    'getReviewDanmakuSpeedLabel'
  )(speed);
}

export function getReviewDanmakuDensityLabel(density: unknown): string {
  return requireSharedSettingsFunction<SharedSettingsApi['getReviewDanmakuDensityLabel']>(
    'getReviewDanmakuDensityLabel'
  )(density);
}

export function getBilingualModeLabel(mode: unknown): string {
  return requireSharedSettingsFunction<SharedSettingsApi['getBilingualModeLabel']>(
    'getBilingualModeLabel'
  )(mode);
}

export function getMockPreviewData(
  targetCefr: unknown,
  ratio: unknown,
  maxReplaceCount: unknown
): string[] {
  return requireSharedSettingsFunction<SharedSettingsApi['getMockPreviewData']>(
    'getMockPreviewData'
  )(targetCefr, ratio, maxReplaceCount);
}

export function getLearningProfile(settings: unknown): LearningProfileMeta {
  return requireSharedSettingsFunction<SharedSettingsApi['getLearningProfile']>(
    'getLearningProfile'
  )(settings);
}

export function buildSettingsPreview(settings: unknown): string {
  return requireSharedSettingsFunction<SharedSettingsApi['buildSettingsPreview']>(
    'buildSettingsPreview'
  )(settings);
}

export function getPresetKeyFromSettings(settings: unknown): ScenePresetKey {
  return requireSharedSettingsFunction<SharedSettingsApi['getPresetKeyFromSettings']>(
    'getPresetKeyFromSettings'
  )(settings);
}

export function setActiveProfileConfig(
  settings: SettingsV3,
  profileId: ProfileId,
  config: Partial<ProfileConfig>
): SettingsV3 {
  const copy = cloneSettingsV3(normalizeSettingsV3(settings));
  const normalized = normalizeProfileConfig({
    ...getProfileConfigById(copy, profileId),
    ...config,
  });
  if (BUILTIN_PROFILE_IDS.includes(profileId as BuiltinProfileId)) {
    copy.profilesBuiltin[profileId as BuiltinProfileId] = normalized;
  } else {
    copy.profilesCustom = copy.profilesCustom.map((item) =>
      item.id === profileId ? { ...item, config: normalized, updatedAt: Date.now() } : item
    );
  }
  return normalizeSettingsV3(copy);
}

export function listProfileOptions(
  settings: SettingsV3
): Array<{ id: ProfileId; name: string; builtin: boolean }> {
  const normalized = normalizeSettingsV3(settings);
  const builtin: Array<{ id: ProfileId; name: string; builtin: boolean }> = BUILTIN_PROFILE_IDS.map(
    (id) => ({
      id,
      name: PROFILE_META[id]?.label || id,
      builtin: true,
    })
  );
  const custom: Array<{ id: ProfileId; name: string; builtin: boolean }> =
    normalized.profilesCustom.map((item) => ({
      id: item.id,
      name: item.name,
      builtin: false,
    }));
  return builtin.concat(custom);
}
