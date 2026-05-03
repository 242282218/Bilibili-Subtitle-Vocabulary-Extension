export type BiliVocabLevel = 'CET4' | 'CET6' | 'KAOYAN' | 'IELTS' | 'TOEFL';

export type BiliVocabReviewSpeed = 'slow' | 'normal' | 'fast';

export type BiliVocabBilingualMode = 'default' | 'bilingual' | 'english-only';

export interface BiliVocabRuntimeSettings {
  enabled: boolean;
  schemaVersion: number;
  reviewDanmakuEnabled: boolean;
  reviewDanmakuSpeed: BiliVocabReviewSpeed;
  webPageEnabled: boolean;
  domainRules: Record<string, { enabled?: boolean; pausedUntil?: number }>;
  activeLevels: BiliVocabLevel[];
  replaceRatio: number;
  maxReplaceCount: number;
  targetCefr: string;
  vocabularyMode: string;
  examPreference: string;
  bilingualMode: BiliVocabBilingualMode;
  themeMode: 'auto' | 'light' | 'dark';
  siteEnabled?: boolean;
}

export interface BiliVocabTranslationToken {
  type: 'text' | 'word';
  text?: string;
  word?: string;
  meaning?: string;
  level?: BiliVocabLevel | string;
  cefrLevel?: string;
  frequency?: number | string;
  partOfSpeech?: string;
  definition?: string;
  phonetic?: string;
  learningStatus?: string;
  sourceText?: string;
}

export interface BiliVocabTranslationResult {
  mixedText: string;
  tokens: BiliVocabTranslationToken[];
}

export interface BiliVocabSubtitleItem {
  element: HTMLElement;
  text?: string;
  mode?: 'subtitle' | 'page';
}

export interface BiliVocabSubtitleNavigationState {
  supported: boolean;
  loading: boolean;
  total: number;
  currentIndex: number | null;
  progressLabel: string;
  headline: string;
  description: string;
  currentText: string;
  previousIndex: number | null;
  replayIndex: number | null;
  nextIndex: number | null;
}

export interface BiliVocabSubtitleNavigationSnapshot {
  supported: boolean;
  progressLabel: string;
  headline: string;
  description: string;
  currentText: string;
  canGoPrevious: boolean;
  canReplay: boolean;
  canGoNext: boolean;
}

export interface BiliVocabLearningHit {
  word: string;
  sourceText: string;
  sourceUrl?: string;
  videoTime?: number;
  seenAt: number;
}

export interface BiliVocabSiteAdapterResult {
  hostname: string;
  videoKey: string;
  video?: HTMLVideoElement | null;
  subtitleItems: BiliVocabSubtitleItem[];
}
