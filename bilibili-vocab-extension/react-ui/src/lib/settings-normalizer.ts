export type ReviewDanmakuSpeed = 'slow' | 'normal' | 'fast';
export type ReviewDanmakuDensity = 'sparse' | 'normal' | 'dense';
export type VocabularyMode = 'core' | 'full';
export type ExamPreference = 'balanced' | 'exam-first';
export type BilingualMode = 'default' | 'bilingual' | 'english-only';
export type ThemeMode = 'auto' | 'light' | 'dark';
export type BuiltinProfileId = 'gentle' | 'balanced' | 'intensive';
export type ProfileId = BuiltinProfileId | string;
export type ScenePresetKey = 'light' | 'balanced' | 'intensive';

export interface ProfileConfig {
  enabled: boolean;
  replaceRatio: number;
  maxReplaceCount: number;
  targetCefr: string;
  activeLevels: string[];
  reviewDanmakuSpeed: ReviewDanmakuSpeed;
  reviewDanmakuDensity: ReviewDanmakuDensity;
  vocabularyMode: VocabularyMode;
  examPreference: ExamPreference;
  bilingualMode: BilingualMode;
  themeMode: ThemeMode;
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
