import type {
  BuiltinProfileId,
  ProfileConfig,
  ProfileId,
  ReviewDanmakuDensity,
  ReviewDanmakuSpeed,
  SettingsV3,
} from './settings-normalizer';

type OverlaySharedSettingsApi = {
  SETTINGS_STORAGE_KEY_V3: string;
  BUILTIN_PROFILE_IDS: BuiltinProfileId[];
  CEFR_LEVELS: string[];
  REVIEW_SPEEDS: ReviewDanmakuSpeed[];
  REVIEW_DENSITIES: ReviewDanmakuDensity[];
  normalizeProfileConfig: (value: unknown) => ProfileConfig;
  normalizeSettingsV3: (value: unknown) => SettingsV3;
  migrateToV3: (value: unknown) => SettingsV3;
  getProfileConfigById: (value: SettingsV3, profileId: ProfileId) => ProfileConfig;
};

type ProfileOption = { id: ProfileId; name: string; builtin: boolean };

const PROFILE_LABELS: Record<BuiltinProfileId, string> = {
  gentle: '轻量输入',
  balanced: '均衡输入',
  intensive: '强化曝光',
};

const SHARED_SETTINGS_ERROR =
  'SharedSettings is required before React overlay settings bridge loads';

function readSharedSettings(): OverlaySharedSettingsApi | undefined {
  const globalShared =
    typeof globalThis !== 'undefined'
      ? (globalThis as typeof globalThis & { SharedSettings?: OverlaySharedSettingsApi })
          .SharedSettings
      : undefined;
  const windowShared =
    typeof window !== 'undefined'
      ? (window as Window & { SharedSettings?: OverlaySharedSettingsApi }).SharedSettings
      : undefined;
  const shared = windowShared || globalShared;
  return shared && typeof shared === 'object' ? shared : undefined;
}

function getSharedSettings(): OverlaySharedSettingsApi {
  const shared = readSharedSettings();
  if (!shared) {
    throw new Error(SHARED_SETTINGS_ERROR);
  }
  return shared;
}

function requireSharedSettingsFunction<T extends (...args: never[]) => unknown>(
  name: keyof OverlaySharedSettingsApi
): T {
  const value = shared[name];
  if (typeof value !== 'function') {
    throw new Error(`${SHARED_SETTINGS_ERROR}: ${String(name)} must be a function`);
  }
  return value as unknown as T;
}

function requireSharedSettingsArray<T>(name: keyof OverlaySharedSettingsApi): T[] {
  const value = shared[name];
  if (!Array.isArray(value)) {
    throw new Error(`${SHARED_SETTINGS_ERROR}: ${String(name)} must be an array`);
  }
  return value.slice() as T[];
}

function requireSharedSettingsValue<T>(name: keyof OverlaySharedSettingsApi): T {
  const value = shared[name];
  if (value == null) {
    throw new Error(`${SHARED_SETTINGS_ERROR}: ${String(name)} is missing`);
  }
  return value as T;
}

function cloneSettings(settings: SettingsV3): SettingsV3 {
  return JSON.parse(JSON.stringify(settings)) as SettingsV3;
}

const shared = getSharedSettings();

// Legacy storage key retained for backward compatibility with existing installs.
export const SETTINGS_STORAGE_KEY_V3 =
  requireSharedSettingsValue<string>('SETTINGS_STORAGE_KEY_V3');
export const BUILTIN_PROFILE_IDS =
  requireSharedSettingsArray<BuiltinProfileId>('BUILTIN_PROFILE_IDS');
export const CEFR_LEVELS = requireSharedSettingsArray<string>('CEFR_LEVELS');
export const REVIEW_SPEEDS = requireSharedSettingsArray<ReviewDanmakuSpeed>('REVIEW_SPEEDS');
export const REVIEW_DENSITIES =
  requireSharedSettingsArray<ReviewDanmakuDensity>('REVIEW_DENSITIES');

export type { ProfileConfig, SettingsV3 };

export function normalizeSettingsV3(input: unknown): SettingsV3 {
  return requireSharedSettingsFunction<OverlaySharedSettingsApi['normalizeSettingsV3']>(
    'normalizeSettingsV3'
  )(input);
}

export function migrateToV3(input: unknown): SettingsV3 {
  return requireSharedSettingsFunction<OverlaySharedSettingsApi['migrateToV3']>('migrateToV3')(
    input
  );
}

export function getProfileConfigById(settings: SettingsV3, profileId: ProfileId): ProfileConfig {
  return requireSharedSettingsFunction<OverlaySharedSettingsApi['getProfileConfigById']>(
    'getProfileConfigById'
  )(settings, profileId);
}

export function setActiveProfileConfig(
  settings: SettingsV3,
  profileId: ProfileId,
  patch: Partial<ProfileConfig>
): SettingsV3 {
  const normalized = normalizeSettingsV3(settings);
  const baseProfile = getProfileConfigById(normalized, profileId);
  const nextProfile = requireSharedSettingsFunction<
    OverlaySharedSettingsApi['normalizeProfileConfig']
  >('normalizeProfileConfig')({
    ...baseProfile,
    ...patch,
  });
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
    name: PROFILE_LABELS[id],
    builtin: true,
  }));
  const custom: ProfileOption[] = normalized.profilesCustom.map((item) => ({
    id: item.id,
    name: item.name,
    builtin: false,
  }));
  return [...builtins, ...custom];
}
