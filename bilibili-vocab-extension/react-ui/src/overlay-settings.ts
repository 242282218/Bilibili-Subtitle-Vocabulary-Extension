import type {
  BuiltinProfileId,
  DomainRule,
  OverlayState,
  ProfileConfig,
  ProfileId,
  SettingsV3,
} from './settings-bridge';

type OverlaySharedSettingsApi = {
  SETTINGS_STORAGE_KEY_V3?: string;
  CEFR_LEVELS?: string[];
  REVIEW_SPEEDS?: string[];
  normalizeProfileConfig?: (value: unknown) => ProfileConfig;
  normalizeSettingsV3?: (value: unknown) => SettingsV3;
  getDefaultSettingsV3?: () => SettingsV3;
  migrateToV3?: (value: unknown) => SettingsV3;
  getProfileConfigById?: (value: SettingsV3, profileId: ProfileId) => ProfileConfig;
};

type ProfileOption = { id: ProfileId; name: string; builtin: boolean };

const BUILTIN_PROFILE_IDS: BuiltinProfileId[] = ['gentle', 'balanced', 'intensive'];
const FALLBACK_LEVELS = ['CET4', 'CET6', 'KAOYAN', 'IELTS', 'TOEFL'];
const FALLBACK_CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const FALLBACK_REVIEW_SPEEDS = ['slow', 'normal', 'fast'];

const FALLBACK_PROFILE_LABELS: Record<BuiltinProfileId, string> = {
  gentle: '轻量输入',
  balanced: '均衡输入',
  intensive: '强化曝光',
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
  bilingualMode: 'default',
};

const FALLBACK_OVERLAY: OverlayState = {
  hidden: false,
  collapsed: false,
  width: 420,
  height: 640,
  offsetRight: 24,
  offsetBottom: 96,
};

const FALLBACK_DEFAULT_SETTINGS: SettingsV3 = {
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

function readSharedSettings(): OverlaySharedSettingsApi {
  if (typeof window === 'undefined') {
    return {};
  }
  const shared = (window as Window & { SharedSettings?: OverlaySharedSettingsApi }).SharedSettings;
  return shared && typeof shared === 'object' ? shared : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object';
}

function cloneSettings(settings: SettingsV3): SettingsV3 {
  return JSON.parse(JSON.stringify(settings)) as SettingsV3;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function normalizeCefr(value: unknown): string {
  const normalized = String(value || FALLBACK_PROFILE.targetCefr)
    .trim()
    .toUpperCase();
  return FALLBACK_CEFR.includes(normalized) ? normalized : FALLBACK_PROFILE.targetCefr;
}

function normalizeSpeed(value: unknown): ProfileConfig['reviewDanmakuSpeed'] {
  const normalized = String(value || FALLBACK_PROFILE.reviewDanmakuSpeed)
    .trim()
    .toLowerCase();
  if (normalized === 'slow' || normalized === 'fast') {
    return normalized;
  }
  return 'normal';
}

function normalizeVocabularyMode(value: unknown): ProfileConfig['vocabularyMode'] {
  return String(value || FALLBACK_PROFILE.vocabularyMode)
    .trim()
    .toLowerCase() === 'full'
    ? 'full'
    : 'core';
}

function normalizeExamPreference(value: unknown): ProfileConfig['examPreference'] {
  return String(value || FALLBACK_PROFILE.examPreference)
    .trim()
    .toLowerCase() === 'exam-first'
    ? 'exam-first'
    : 'balanced';
}

function normalizeBilingualMode(value: unknown): ProfileConfig['bilingualMode'] {
  const normalized = String(value || FALLBACK_PROFILE.bilingualMode)
    .trim()
    .toLowerCase();
  if (normalized === 'bilingual' || normalized === 'english-only') {
    return normalized;
  }
  return 'default';
}

function normalizeLevels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return FALLBACK_PROFILE.activeLevels.slice();
  }
  const levels = value
    .map((item) =>
      String(item || '')
        .trim()
        .toUpperCase()
    )
    .filter((item) => FALLBACK_LEVELS.includes(item));
  return levels.length ? Array.from(new Set(levels)) : FALLBACK_PROFILE.activeLevels.slice();
}

function normalizeProfileConfigFallback(value: unknown): ProfileConfig {
  const source = isRecord(value) ? value : {};
  return {
    enabled: source.enabled !== false,
    replaceRatio: Math.min(
      0.3,
      Math.max(0.1, Number(source.replaceRatio) || FALLBACK_PROFILE.replaceRatio)
    ),
    maxReplaceCount: Math.min(
      5,
      Math.max(1, Math.floor(Number(source.maxReplaceCount) || FALLBACK_PROFILE.maxReplaceCount))
    ),
    targetCefr: normalizeCefr(source.targetCefr),
    activeLevels: normalizeLevels(source.activeLevels),
    reviewDanmakuSpeed: normalizeSpeed(source.reviewDanmakuSpeed),
    vocabularyMode: normalizeVocabularyMode(source.vocabularyMode),
    examPreference: normalizeExamPreference(source.examPreference),
    bilingualMode: normalizeBilingualMode(source.bilingualMode),
  };
}

function normalizeDomainRulesFallback(value: unknown): Record<string, DomainRule> {
  if (!isRecord(value)) {
    return {};
  }
  const output: Record<string, DomainRule> = {};
  Object.keys(value).forEach((hostname) => {
    const nextRule = value[hostname];
    if (!isRecord(nextRule)) {
      return;
    }
    const normalizedHost = String(hostname).trim().toLowerCase();
    if (!normalizedHost) {
      return;
    }
    const rule: DomainRule = {
      enabled: nextRule.enabled !== false,
    };
    const pausedUntil = Number(nextRule.pausedUntil);
    if (Number.isFinite(pausedUntil) && pausedUntil > 0) {
      rule.pausedUntil = Math.floor(pausedUntil);
    }
    output[normalizedHost] = rule;
  });
  return output;
}

function normalizeOverlayStateFallback(value: unknown): OverlayState {
  const source = isRecord(value) ? value : {};
  return {
    hidden: source.hidden === true,
    collapsed: source.collapsed === true,
    width: clampNumber(source.width, 320, 560, FALLBACK_OVERLAY.width),
    height: clampNumber(source.height, 360, 760, FALLBACK_OVERLAY.height),
    offsetRight: clampNumber(source.offsetRight, 12, 360, FALLBACK_OVERLAY.offsetRight),
    offsetBottom: clampNumber(source.offsetBottom, 24, 240, FALLBACK_OVERLAY.offsetBottom),
  };
}

function isSameProfileConfigFallback(left: unknown, right: unknown): boolean {
  return (
    JSON.stringify(normalizeProfileConfigFallback(left)) ===
    JSON.stringify(normalizeProfileConfigFallback(right))
  );
}

function normalizeSettingsV3Fallback(value: unknown): SettingsV3 {
  const source = isRecord(value) ? value : {};
  const defaults = cloneSettings(FALLBACK_DEFAULT_SETTINGS);
  const rawBuiltin = isRecord(source.profilesBuiltin) ? source.profilesBuiltin : {};
  const rawBuiltinGentle = isRecord(rawBuiltin.gentle) ? rawBuiltin.gentle : {};
  const rawBuiltinBalanced = isRecord(rawBuiltin.balanced) ? rawBuiltin.balanced : {};
  const rawBuiltinIntensive = isRecord(rawBuiltin.intensive) ? rawBuiltin.intensive : {};
  const customProfiles = Array.isArray(source.profilesCustom)
    ? source.profilesCustom
        .filter((item) => isRecord(item))
        .map((item, index) => {
          const createdAt = Math.max(0, Math.floor(Number(item.createdAt) || Date.now()));
          return {
            id: String(item.id || `custom-${index + 1}`),
            name: String(item.name || `自定义 ${index + 1}`),
            config: normalizeProfileConfigFallback(item.config),
            createdAt,
            updatedAt: Math.max(createdAt, Math.floor(Number(item.updatedAt) || createdAt)),
          };
        })
        .slice(0, 5)
    : [];
  const customIds = new Set(customProfiles.map((item) => item.id));
  const activeProfileIdCandidate = String(source.activeProfileId || defaults.activeProfileId);
  const activeProfileId =
    BUILTIN_PROFILE_IDS.includes(activeProfileIdCandidate as BuiltinProfileId) ||
    customIds.has(activeProfileIdCandidate)
      ? activeProfileIdCandidate
      : defaults.activeProfileId;

  const rawGlobalControls = isRecord(source.globalControls) ? source.globalControls : {};
  return {
    schemaVersion: 3,
    activeProfileId,
    profilesBuiltin: {
      gentle: normalizeProfileConfigFallback({
        ...defaults.profilesBuiltin.gentle,
        ...rawBuiltinGentle,
      }),
      balanced: normalizeProfileConfigFallback({
        ...defaults.profilesBuiltin.balanced,
        ...rawBuiltinBalanced,
      }),
      intensive: normalizeProfileConfigFallback({
        ...defaults.profilesBuiltin.intensive,
        ...rawBuiltinIntensive,
      }),
    },
    profilesCustom: customProfiles,
    globalControls: {
      reviewDanmakuEnabled: rawGlobalControls.reviewDanmakuEnabled === true,
      webPageEnabled: rawGlobalControls.webPageEnabled !== false,
      siteRules: normalizeDomainRulesFallback(rawGlobalControls.siteRules),
      overlayState: normalizeOverlayStateFallback(rawGlobalControls.overlayState),
    },
  };
}

export const SETTINGS_STORAGE_KEY_V3 =
  readSharedSettings().SETTINGS_STORAGE_KEY_V3 || 'bili_vocab_settings_v3';
export const CEFR_LEVELS = Array.isArray(readSharedSettings().CEFR_LEVELS)
  ? readSharedSettings().CEFR_LEVELS!.slice()
  : FALLBACK_CEFR.slice();
export const REVIEW_SPEEDS = Array.isArray(readSharedSettings().REVIEW_SPEEDS)
  ? readSharedSettings().REVIEW_SPEEDS!.slice()
  : FALLBACK_REVIEW_SPEEDS.slice();

export type { ProfileConfig, SettingsV3 };

export function normalizeSettingsV3(input: unknown): SettingsV3 {
  const shared = readSharedSettings();
  if (typeof shared.normalizeSettingsV3 === 'function') {
    return shared.normalizeSettingsV3(input);
  }
  return normalizeSettingsV3Fallback(input);
}

export function migrateToV3(input: unknown): SettingsV3 {
  const shared = readSharedSettings();
  if (typeof shared.migrateToV3 === 'function') {
    return shared.migrateToV3(input);
  }
  if (isRecord(input) && SETTINGS_STORAGE_KEY_V3 in input) {
    return normalizeSettingsV3(input[SETTINGS_STORAGE_KEY_V3]);
  }
  if (isRecord(input) && Number(input.schemaVersion) === 3 && isRecord(input.profilesBuiltin)) {
    return normalizeSettingsV3(input);
  }

  const source = isRecord(input) ? input : {};
  const defaults = cloneSettings(FALLBACK_DEFAULT_SETTINGS);
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
    next.profilesCustom = [
      {
        id: 'legacy-imported',
        name: '历史配置',
        config: normalizedLegacyProfile,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];
    next.activeProfileId = 'legacy-imported';
  }

  return normalizeSettingsV3(next);
}

export function getProfileConfigById(settings: SettingsV3, profileId: ProfileId): ProfileConfig {
  const shared = readSharedSettings();
  if (typeof shared.getProfileConfigById === 'function') {
    return shared.getProfileConfigById(settings, profileId);
  }
  const normalized = normalizeSettingsV3(settings);
  if (BUILTIN_PROFILE_IDS.includes(profileId as BuiltinProfileId)) {
    return normalized.profilesBuiltin[profileId as BuiltinProfileId];
  }
  const customProfile = normalized.profilesCustom.find((item) => item.id === profileId);
  return customProfile ? customProfile.config : normalized.profilesBuiltin.balanced;
}

export function setActiveProfileConfig(
  settings: SettingsV3,
  profileId: ProfileId,
  patch: Partial<ProfileConfig>
): SettingsV3 {
  const shared = readSharedSettings();
  const normalized = normalizeSettingsV3(settings);
  const baseProfile = getProfileConfigById(normalized, profileId);
  const nextProfile =
    typeof shared.normalizeProfileConfig === 'function'
      ? shared.normalizeProfileConfig({ ...baseProfile, ...patch })
      : normalizeProfileConfigFallback({ ...baseProfile, ...patch });
  const next = cloneSettings(normalized);
  if (BUILTIN_PROFILE_IDS.includes(profileId as BuiltinProfileId)) {
    next.profilesBuiltin[profileId as BuiltinProfileId] = nextProfile;
  } else {
    next.profilesCustom = next.profilesCustom.map((item) =>
      item.id === profileId ? { ...item, config: nextProfile, updatedAt: Date.now() } : item
    );
  }
  return normalizeSettingsV3(next);
}

export function listProfileOptions(settings: SettingsV3): ProfileOption[] {
  const normalized = normalizeSettingsV3(settings);
  const builtins: ProfileOption[] = BUILTIN_PROFILE_IDS.map((id) => ({
    id,
    name: FALLBACK_PROFILE_LABELS[id],
    builtin: true,
  }));
  const custom: ProfileOption[] = normalized.profilesCustom.map((item) => ({
    id: item.id,
    name: item.name,
    builtin: false,
  }));
  return [...builtins, ...custom];
}
