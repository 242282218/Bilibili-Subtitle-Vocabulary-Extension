type ReviewDanmakuSpeed = 'slow' | 'normal' | 'fast';
type VocabularyMode = 'core' | 'full';
type ExamPreference = 'balanced' | 'exam-first';
export type BuiltinProfileId = 'gentle' | 'balanced' | 'intensive';
export type ProfileId = BuiltinProfileId | string;

export interface ProfileConfig {
  enabled: boolean;
  replaceRatio: number;
  maxReplaceCount: number;
  targetCefr: string;
  activeLevels: string[];
  reviewDanmakuSpeed: ReviewDanmakuSpeed;
  vocabularyMode: VocabularyMode;
  examPreference: ExamPreference;
}

export interface DomainRule {
  enabled: boolean;
  pausedUntil?: number;
}

export interface OverlayState {
  hidden: boolean;
  collapsed: boolean;
  width: number;
  height: number;
  offsetRight: number;
  offsetBottom: number;
}

export interface GlobalControls {
  reviewDanmakuEnabled: boolean;
  webPageEnabled: boolean;
  siteRules: Record<string, DomainRule>;
  overlayState: OverlayState;
}

export interface CustomProfile {
  id: string;
  name: string;
  config: ProfileConfig;
  createdAt: number;
  updatedAt: number;
}

export interface SettingsV3 {
  schemaVersion: number;
  activeProfileId: ProfileId;
  profilesBuiltin: Record<BuiltinProfileId, ProfileConfig>;
  profilesCustom: CustomProfile[];
  globalControls: GlobalControls;
}

interface SharedSettingsApi {
  SETTINGS_STORAGE_KEY_V3?: string;
  BUILTIN_PROFILE_IDS?: BuiltinProfileId[];
  MAX_CUSTOM_PROFILES?: number;
  LEVELS?: string[];
  CEFR_LEVELS?: string[];
  REVIEW_SPEEDS?: string[];
  OVERLAY_DEFAULTS?: OverlayState;
  DEFAULT_SETTINGS?: Partial<ProfileConfig>;
  normalizeProfileConfig?: (value: unknown) => ProfileConfig;
  normalizeDomainRules?: (value: unknown) => Record<string, DomainRule>;
  normalizeHostname?: (hostname: string) => string;
  normalizeSettingsV3?: (value: unknown) => SettingsV3;
  getDefaultSettingsV3?: () => SettingsV3;
  migrateToV3?: (value: unknown) => SettingsV3;
  resolveEffectiveRuntime?: (
    value: SettingsV3,
    context?: { hostname?: string }
  ) => ProfileConfig & {
    webPageEnabled: boolean;
    reviewDanmakuEnabled: boolean;
    domainRules: Record<string, DomainRule>;
    siteEnabled: boolean;
  };
  getProfileConfigById?: (value: SettingsV3, profileId: ProfileId) => ProfileConfig;
  upsertCustomProfile?: (
    settings: SettingsV3,
    profileInput: Partial<CustomProfile> & { config?: Partial<ProfileConfig> }
  ) => SettingsV3;
  removeCustomProfile?: (settings: SettingsV3, profileId: string) => SettingsV3;
  isDomainEnabled?: (hostname: string, runtime: unknown) => boolean;
}

declare global {
  interface Window {
    SharedSettings?: SharedSettingsApi;
  }
}

const FALLBACK_LEVELS = ['CET4', 'CET6', 'KAOYAN', 'IELTS', 'TOEFL'];
const FALLBACK_CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const FALLBACK_REVIEW_SPEEDS = ['slow', 'normal', 'fast'];

const FALLBACK_OVERLAY: OverlayState = {
  hidden: false,
  collapsed: false,
  width: 420,
  height: 640,
  offsetRight: 24,
  offsetBottom: 96,
};

const FALLBACK_PROFILE: ProfileConfig = {
  enabled: true,
  replaceRatio: 0.2,
  maxReplaceCount: 2,
  targetCefr: 'B2',
  activeLevels: FALLBACK_LEVELS.slice(),
  reviewDanmakuSpeed: 'normal',
  vocabularyMode: 'core',
  examPreference: 'balanced',
};

const FALLBACK_DEFAULTS: SettingsV3 = {
  schemaVersion: 3,
  activeProfileId: 'balanced',
  profilesBuiltin: {
    gentle: {
      ...FALLBACK_PROFILE,
      replaceRatio: 0.15,
      maxReplaceCount: 1,
      reviewDanmakuSpeed: 'slow',
    },
    balanced: { ...FALLBACK_PROFILE },
    intensive: {
      ...FALLBACK_PROFILE,
      replaceRatio: 0.3,
      maxReplaceCount: 4,
      reviewDanmakuSpeed: 'fast',
    },
  },
  profilesCustom: [],
  globalControls: {
    reviewDanmakuEnabled: false,
    webPageEnabled: true,
    siteRules: {},
    overlayState: { ...FALLBACK_OVERLAY },
  },
};

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function normalizeSpeed(value: unknown): ReviewDanmakuSpeed {
  const normalized = String(value || FALLBACK_PROFILE.reviewDanmakuSpeed)
    .trim()
    .toLowerCase();
  if (normalized === 'slow' || normalized === 'fast') {
    return normalized;
  }
  return 'normal';
}

function normalizeMode(value: unknown): VocabularyMode {
  return String(value || FALLBACK_PROFILE.vocabularyMode)
    .trim()
    .toLowerCase() === 'full'
    ? 'full'
    : 'core';
}

function normalizePreference(value: unknown): ExamPreference {
  return String(value || FALLBACK_PROFILE.examPreference)
    .trim()
    .toLowerCase() === 'exam-first'
    ? 'exam-first'
    : 'balanced';
}

function normalizeCefr(value: unknown): string {
  const normalized = String(value || FALLBACK_PROFILE.targetCefr)
    .trim()
    .toUpperCase();
  return FALLBACK_CEFR.includes(normalized) ? normalized : FALLBACK_PROFILE.targetCefr;
}

function normalizeLevels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return FALLBACK_PROFILE.activeLevels.slice();
  }
  const normalized = value
    .map((item) =>
      String(item || '')
        .trim()
        .toUpperCase()
    )
    .filter((item) => FALLBACK_LEVELS.includes(item));
  return normalized.length
    ? Array.from(new Set(normalized))
    : FALLBACK_PROFILE.activeLevels.slice();
}

function normalizeProfileConfigFallback(value: unknown): ProfileConfig {
  const source = value && typeof value === 'object' ? (value as Partial<ProfileConfig>) : {};
  return {
    enabled: source.enabled !== false,
    replaceRatio: Math.max(
      0.1,
      Math.min(0.3, Number(source.replaceRatio) || FALLBACK_PROFILE.replaceRatio)
    ),
    maxReplaceCount: Math.max(
      1,
      Math.min(5, Math.floor(Number(source.maxReplaceCount) || FALLBACK_PROFILE.maxReplaceCount))
    ),
    targetCefr: normalizeCefr(source.targetCefr),
    activeLevels: normalizeLevels(source.activeLevels),
    reviewDanmakuSpeed: normalizeSpeed(source.reviewDanmakuSpeed),
    vocabularyMode: normalizeMode(source.vocabularyMode),
    examPreference: normalizePreference(source.examPreference),
  };
}

function normalizeHostnameFallback(hostname: string): string {
  const normalized = String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/\.+$/, '');
  if (!normalized) {
    return '';
  }
  if (normalized === 'localhost') {
    return normalized;
  }
  const segments = normalized.split('.');
  if (segments.length < 2) {
    return '';
  }
  const valid = segments.every((segment) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(segment));
  return valid ? normalized : '';
}

function normalizeDomainRulesFallback(value: unknown): Record<string, DomainRule> {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const output: Record<string, DomainRule> = {};
  Object.keys(value as Record<string, unknown>).forEach((hostname) => {
    const normalized = normalizeHostnameFallback(hostname);
    if (!normalized) {
      return;
    }
    const rawRule = (value as Record<string, unknown>)[hostname];
    if (!rawRule || typeof rawRule !== 'object') {
      return;
    }
    const nextRule: DomainRule = {
      enabled: (rawRule as Partial<DomainRule>).enabled !== false,
    };
    const pausedUntil = Number((rawRule as Partial<DomainRule>).pausedUntil);
    if (Number.isFinite(pausedUntil) && pausedUntil > 0) {
      nextRule.pausedUntil = Math.floor(pausedUntil);
    }
    output[normalized] = nextRule;
  });
  return output;
}

function normalizeOverlayStateFallback(value: unknown): OverlayState {
  const source = value && typeof value === 'object' ? (value as Partial<OverlayState>) : {};
  return {
    hidden: source.hidden === true,
    collapsed: source.collapsed === true,
    width: clamp(source.width, 320, 560, FALLBACK_OVERLAY.width),
    height: clamp(source.height, 360, 760, FALLBACK_OVERLAY.height),
    offsetRight: clamp(source.offsetRight, 12, 360, FALLBACK_OVERLAY.offsetRight),
    offsetBottom: clamp(source.offsetBottom, 24, 240, FALLBACK_OVERLAY.offsetBottom),
  };
}

function pickMatchedDomainRuleFallback(
  hostname: string,
  domainRules: Record<string, DomainRule>
): DomainRule | null {
  const normalizedHost = normalizeHostnameFallback(hostname);
  if (!normalizedHost) {
    return null;
  }
  if (domainRules[normalizedHost]) {
    return domainRules[normalizedHost];
  }
  const segments = normalizedHost.split('.');
  for (let index = 1; index < segments.length - 1; index += 1) {
    const candidate = segments.slice(index).join('.');
    if (domainRules[candidate]) {
      return domainRules[candidate];
    }
  }
  return null;
}

function isSameProfileConfigFallback(left: unknown, right: unknown): boolean {
  return (
    JSON.stringify(normalizeProfileConfigFallback(left)) ===
    JSON.stringify(normalizeProfileConfigFallback(right))
  );
}

function cloneSettings<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeSettingsV3Fallback(payload: unknown): SettingsV3 {
  const source = payload && typeof payload === 'object' ? (payload as Partial<SettingsV3>) : {};
  const profilesBuiltin: Record<BuiltinProfileId, ProfileConfig> = {
    gentle: normalizeProfileConfigFallback(source.profilesBuiltin?.gentle),
    balanced: normalizeProfileConfigFallback(source.profilesBuiltin?.balanced),
    intensive: normalizeProfileConfigFallback(source.profilesBuiltin?.intensive),
  };
  const custom = Array.isArray(source.profilesCustom)
    ? source.profilesCustom
        .filter((item): item is CustomProfile => Boolean(item && typeof item === 'object'))
        .map((item, index) => ({
          id: String(item.id || `custom-${index + 1}`),
          name: String(item.name || `自定义 ${index + 1}`),
          config: normalizeProfileConfigFallback(item.config),
          createdAt: Math.max(0, Math.floor(Number(item.createdAt) || Date.now())),
          updatedAt: Math.max(0, Math.floor(Number(item.updatedAt) || Date.now())),
        }))
    : [];
  const customIds = new Set(custom.map((item) => item.id));
  const activeCandidate = String(source.activeProfileId || 'balanced');
  const activeProfileId =
    activeCandidate in profilesBuiltin || customIds.has(activeCandidate)
      ? activeCandidate
      : 'balanced';

  return {
    schemaVersion: 3,
    activeProfileId,
    profilesBuiltin,
    profilesCustom: custom.slice(0, 5),
    globalControls: {
      reviewDanmakuEnabled: source.globalControls?.reviewDanmakuEnabled === true,
      webPageEnabled: source.globalControls?.webPageEnabled !== false,
      siteRules: normalizeDomainRulesFallback(source.globalControls?.siteRules),
      overlayState: normalizeOverlayStateFallback(source.globalControls?.overlayState),
    },
  };
}

const shared: SharedSettingsApi =
  typeof window !== 'undefined' && window.SharedSettings ? window.SharedSettings : {};

export const SETTINGS_STORAGE_KEY_V3 = shared.SETTINGS_STORAGE_KEY_V3 || 'bili_vocab_settings_v3';
export const BUILTIN_PROFILE_IDS: BuiltinProfileId[] = Array.isArray(shared.BUILTIN_PROFILE_IDS)
  ? (shared.BUILTIN_PROFILE_IDS as BuiltinProfileId[])
  : ['gentle', 'balanced', 'intensive'];
export const MAX_CUSTOM_PROFILES = Number(shared.MAX_CUSTOM_PROFILES) || 5;
export const LEVELS = Array.isArray(shared.LEVELS)
  ? shared.LEVELS.slice()
  : FALLBACK_LEVELS.slice();
export const CEFR_LEVELS = Array.isArray(shared.CEFR_LEVELS)
  ? shared.CEFR_LEVELS.slice()
  : FALLBACK_CEFR.slice();
export const REVIEW_SPEEDS = Array.isArray(shared.REVIEW_SPEEDS)
  ? shared.REVIEW_SPEEDS.slice()
  : FALLBACK_REVIEW_SPEEDS.slice();
export const OVERLAY_DEFAULTS = shared.OVERLAY_DEFAULTS
  ? { ...shared.OVERLAY_DEFAULTS }
  : { ...FALLBACK_OVERLAY };

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
  if (typeof shared.normalizeProfileConfig === 'function') {
    return shared.normalizeProfileConfig(input);
  }
  return normalizeProfileConfigFallback(input);
}

export function normalizeSettingsV3(input: unknown): SettingsV3 {
  if (typeof shared.normalizeSettingsV3 === 'function') {
    return shared.normalizeSettingsV3(input);
  }
  return normalizeSettingsV3Fallback(input);
}

export function getDefaultSettingsV3(): SettingsV3 {
  if (typeof shared.getDefaultSettingsV3 === 'function') {
    return shared.getDefaultSettingsV3();
  }
  return cloneSettings(FALLBACK_DEFAULTS);
}

export function migrateToV3(input: unknown): SettingsV3 {
  if (typeof shared.migrateToV3 === 'function') {
    return shared.migrateToV3(input);
  }
  if (
    input &&
    typeof input === 'object' &&
    SETTINGS_STORAGE_KEY_V3 in (input as Record<string, unknown>)
  ) {
    const mapped = (input as Record<string, unknown>)[SETTINGS_STORAGE_KEY_V3];
    return normalizeSettingsV3(mapped);
  }
  if (
    input &&
    typeof input === 'object' &&
    Number((input as Record<string, unknown>).schemaVersion) === 3 &&
    (input as Record<string, unknown>).profilesBuiltin
  ) {
    return normalizeSettingsV3(input);
  }

  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const defaults = getDefaultSettingsV3();
  const normalizedLegacyProfile = normalizeProfileConfigFallback(source);
  const next = {
    ...defaults,
    globalControls: {
      reviewDanmakuEnabled: source.reviewDanmakuEnabled === true,
      webPageEnabled: source.webPageEnabled !== false,
      siteRules: normalizeDomainRulesFallback(source.domainRules),
      overlayState: normalizeOverlayStateFallback({
        hidden: source.overlayPanelHidden,
        collapsed: source.overlayPanelCollapsed,
        width: source.overlayPanelWidth,
        height: source.overlayPanelHeight,
        offsetRight: source.overlayPanelOffsetRight,
        offsetBottom: source.overlayPanelOffsetBottom,
      }),
    },
  };

  if (!isSameProfileConfigFallback(normalizedLegacyProfile, next.profilesBuiltin.balanced)) {
    const importedProfile: CustomProfile = {
      id: 'legacy-imported',
      name: '历史配置',
      config: normalizedLegacyProfile,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    next.profilesCustom = [importedProfile];
    next.activeProfileId = importedProfile.id;
  }

  return normalizeSettingsV3(next);
}

export function getProfileConfigById(settings: SettingsV3, profileId: ProfileId): ProfileConfig {
  if (typeof shared.getProfileConfigById === 'function') {
    return shared.getProfileConfigById(settings, profileId);
  }
  if (profileId in settings.profilesBuiltin) {
    return settings.profilesBuiltin[profileId as BuiltinProfileId];
  }
  const custom = settings.profilesCustom.find((item) => item.id === profileId);
  return custom ? custom.config : settings.profilesBuiltin.balanced;
}

export function upsertCustomProfile(
  settings: SettingsV3,
  profileInput: Partial<CustomProfile> & { config?: Partial<ProfileConfig> }
): SettingsV3 {
  if (typeof shared.upsertCustomProfile === 'function') {
    return shared.upsertCustomProfile(settings, profileInput);
  }
  const copy = cloneSettings(settings);
  const id =
    String(profileInput.id || profileInput.name || `custom-${Date.now()}`)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-_]/g, '')
      .slice(0, 32) || `custom-${Date.now()}`;
  const index = copy.profilesCustom.findIndex((item) => item.id === id);
  const normalizedConfig = normalizeProfileConfig(profileInput.config || profileInput);
  const next: CustomProfile = {
    id,
    name: String(profileInput.name || '自定义配置').trim() || '自定义配置',
    config: normalizedConfig,
    createdAt: index >= 0 ? copy.profilesCustom[index].createdAt : Date.now(),
    updatedAt: Date.now(),
  };
  if (index >= 0) {
    copy.profilesCustom[index] = next;
  } else if (copy.profilesCustom.length < MAX_CUSTOM_PROFILES) {
    copy.profilesCustom.push(next);
  }
  return normalizeSettingsV3(copy);
}

export function removeCustomProfile(settings: SettingsV3, profileId: string): SettingsV3 {
  if (typeof shared.removeCustomProfile === 'function') {
    return shared.removeCustomProfile(settings, profileId);
  }
  const copy = cloneSettings(settings);
  copy.profilesCustom = copy.profilesCustom.filter((item) => item.id !== profileId);
  if (copy.activeProfileId === profileId) {
    copy.activeProfileId = 'balanced';
  }
  return normalizeSettingsV3(copy);
}

export function resolveEffectiveRuntime(
  settings: SettingsV3,
  hostname = ''
): ReturnType<NonNullable<SharedSettingsApi['resolveEffectiveRuntime']>> {
  if (typeof shared.resolveEffectiveRuntime === 'function') {
    return shared.resolveEffectiveRuntime(settings, { hostname });
  }
  const profile = getProfileConfigById(settings, settings.activeProfileId);
  const runtime = {
    ...profile,
    reviewDanmakuEnabled: settings.globalControls.reviewDanmakuEnabled,
    webPageEnabled: settings.globalControls.webPageEnabled,
    domainRules: settings.globalControls.siteRules,
    siteEnabled: false,
  };
  runtime.siteEnabled = isDomainEnabled(hostname, runtime);
  return runtime;
}

export function normalizeHostname(hostname: string): string {
  if (typeof shared.normalizeHostname === 'function') {
    return shared.normalizeHostname(hostname);
  }
  return normalizeHostnameFallback(hostname);
}

export function normalizeDomainRules(value: unknown): Record<string, DomainRule> {
  if (typeof shared.normalizeDomainRules === 'function') {
    return shared.normalizeDomainRules(value);
  }
  return normalizeDomainRulesFallback(value);
}

export function isDomainEnabled(hostname: string, runtime: unknown): boolean {
  if (typeof shared.isDomainEnabled === 'function') {
    return shared.isDomainEnabled(hostname, runtime);
  }
  if (
    runtime &&
    typeof runtime === 'object' &&
    'enabled' in (runtime as Record<string, unknown>) &&
    (runtime as { enabled?: boolean }).enabled === false
  ) {
    return false;
  }
  const normalizedHost = normalizeHostname(hostname);
  const rules =
    runtime && typeof runtime === 'object' && 'domainRules' in (runtime as Record<string, unknown>)
      ? (runtime as { domainRules?: Record<string, DomainRule> }).domainRules || {}
      : {};
  if (!normalizedHost) {
    return true;
  }
  const matchedRule = pickMatchedDomainRuleFallback(normalizedHost, rules);
  if (!matchedRule) {
    return true;
  }
  if (matchedRule.enabled === false) {
    return false;
  }
  if (
    Number.isFinite(Number(matchedRule.pausedUntil)) &&
    Number(matchedRule.pausedUntil) > Date.now()
  ) {
    return false;
  }
  return true;
}

export function cloneSettingsV3(settings: SettingsV3): SettingsV3 {
  return cloneSettings(settings);
}

export function setActiveProfileConfig(
  settings: SettingsV3,
  profileId: ProfileId,
  config: Partial<ProfileConfig>
): SettingsV3 {
  const copy = cloneSettings(settings);
  const normalized = normalizeProfileConfig({
    ...getProfileConfigById(copy, profileId),
    ...config,
  });
  if (profileId in copy.profilesBuiltin) {
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
  const builtin: Array<{ id: ProfileId; name: string; builtin: boolean }> = BUILTIN_PROFILE_IDS.map(
    (id) => ({
      id,
      name: PROFILE_META[id]?.label || id,
      builtin: true,
    })
  );
  const custom: Array<{ id: ProfileId; name: string; builtin: boolean }> =
    settings.profilesCustom.map((item) => ({
      id: item.id,
      name: item.name,
      builtin: false,
    }));
  return builtin.concat(custom);
}
