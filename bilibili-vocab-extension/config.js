(function (globalScope) {
  const LEVELS = ['CET4', 'CET6', 'KAOYAN', 'IELTS', 'TOEFL'];
  const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const REVIEW_SPEEDS = ['slow', 'normal', 'fast'];
  const REVIEW_DENSITIES = ['sparse', 'normal', 'dense'];
  const VOCABULARY_MODES = ['core', 'full'];
  const EXAM_PREFERENCES = ['balanced', 'exam-first'];

  const DEFAULT_SETTINGS = {
    enabled: true,
    schemaVersion: 2,
    reviewDanmakuEnabled: false,
    reviewDanmakuSpeed: 'normal',
    reviewDanmakuDensity: 'normal',
    vocabularyMode: 'core',
    examPreference: 'balanced',
    webPageEnabled: true,
    domainRules: {},
    activeLevels: LEVELS.slice(),
    replaceRatio: 0.2,
    maxReplaceCount: 2,
    targetCefr: 'B2',
    bilingualMode: 'default',
    themeMode: 'auto',
  };

  const STORAGE_KEYS = {
    WORD_STATS: 'bili_vocab_word_stats_v1',
  };

  const api = {
    LEVELS,
    CEFR_LEVELS,
    REVIEW_SPEEDS,
    REVIEW_DENSITIES,
    VOCABULARY_MODES,
    EXAM_PREFERENCES,
    DEFAULT_SETTINGS,
    STORAGE_KEYS,
  };

  globalScope.Config = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
