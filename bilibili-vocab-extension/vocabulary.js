(function (globalScope) {
  const sharedSettings = globalScope.SharedSettings || (typeof require === "function" ? require("./sharedSettings.js") : null);
  const learningState = globalScope.LearningState || (typeof require === "function" ? require("./learningState.js") : null);
  const adaptiveTuning = globalScope.AdaptiveTuning || (typeof require === "function" ? require("./adaptiveTuning.js") : null);
  const LEVELS = ["CET4", "CET6", "KAOYAN", "IELTS", "TOEFL"];

  const LEVEL_CLASS_MAP = {
    CET4: "level-cet4",
    CET6: "level-cet6",
    KAOYAN: "level-kaoyan",
    IELTS: "level-ielts",
    TOEFL: "level-toefl"
  };

  const LEVEL_PRIORITY = {
    CET4: 1,
    CET6: 2,
    KAOYAN: 3,
    IELTS: 4,
    TOEFL: 5
  };

  const LEVEL_FILES = {
    CET4: "data/cet4.json",
    CET6: "data/cet6.json",
    KAOYAN: "data/kaoyan.json",
    IELTS: "data/ielts.json",
    TOEFL: "data/toefl.json"
  };

  const DEFAULT_ACTIVE_LEVELS = LEVELS.slice();
  const WORD_STATS_STORAGE_KEY = "bili_vocab_word_stats_v1";
  const LEARNING_WORD_STATS_STORAGE_KEY = learningState ? learningState.STORAGE_KEYS.WORD_STATS_V2 : "bili_vocab_word_stats_v2";
  const REVIEW_QUEUE_STORAGE_KEY = learningState ? learningState.STORAGE_KEYS.REVIEW_QUEUE : "bili_vocab_review_queue_v1";
  const LEARNING_SUMMARY_STORAGE_KEY = learningState ? learningState.STORAGE_KEYS.LEARNING_SUMMARY : "bili_vocab_learning_summary_v1";
  const STORAGE_THROTTLE_MS = 600;
  const REVIEW_BUCKETS = ["today", "soon", "later"];
  const DEFAULT_INTERVAL_DAYS = 1;
  const DEFAULT_EASE_FACTOR = 2.3;
  const MIN_EASE_FACTOR = 1.3;
  const MAX_EASE_FACTOR = 2.8;
  const MAX_INTERVAL_DAYS = 60;
  const ADAPTIVE_FEEDBACK_ACTIONS = new Set(["know", "fuzzy", "dontknow"]);
  const logError = (globalThis.Utils && typeof globalThis.Utils.logError === "function")
    ? globalThis.Utils.logError
    : ((context, error) => console.error(`[BiliVocab] ${context}:`, error));

  let vocabularyEntries = [];
  let loadPromise = null;
  const chineseTokenIndex = new Map();
  let sortedChineseTokens = [];
  const wordIndex = new Map();
  let persistTimer = null;
  let persistChain = Promise.resolve();
  let reviewQueue = {};
  let learningSummary = null;

  function normalizeLevel(level) {
    const normalized = String(level || "").trim().toUpperCase();
    if (!LEVELS.includes(normalized)) {
      return "";
    }
    return normalized;
  }

  function normalizeWordKey(word) {
    return String(word || "").trim().toLowerCase();
  }

  function normalizeActiveLevels(levels) {
    if (!Array.isArray(levels) || levels.length === 0) {
      return DEFAULT_ACTIVE_LEVELS.slice();
    }

    const normalizedLevels = [];
    levels.forEach((level) => {
      const normalized = normalizeLevel(level);
      if (!normalized || normalizedLevels.includes(normalized)) {
        return;
      }
      normalizedLevels.push(normalized);
    });

    if (normalizedLevels.length === 0) {
      return DEFAULT_ACTIVE_LEVELS.slice();
    }

    return normalizedLevels;
  }

  function splitMeaning(meaning) {
    const rawMeaning = String(meaning || "").trim();
    if (!rawMeaning) {
      return [];
    }

    return rawMeaning
      .split(/[;；,，、/]/)
      .map((part) => part.trim())
      .filter((part) => part.length > 1);
  }

  function extractAliasTerms(rawAliases) {
    if (!Array.isArray(rawAliases)) {
      return [];
    }

    return rawAliases
      .map((alias) => String(alias || "").trim())
      .filter((alias) => /[\u4e00-\u9fff]/.test(alias))
      .filter((alias) => alias.length > 1 && alias.length <= 8);
  }

  function normalizeHitCount(value) {
    const count = Number(value);
    if (!Number.isFinite(count) || count < 0) {
      return 0;
    }
    return Math.floor(count);
  }

  function normalizeLastSeen(value) {
    const lastSeen = Number(value);
    if (!Number.isFinite(lastSeen) || lastSeen <= 0) {
      return null;
    }
    return lastSeen;
  }

  function normalizeLearningStatus(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "new") {
      return "unseen";
    }
    if (normalized === "learning" || normalized === "reviewing") {
      return "seen";
    }
    if (["unseen", "seen", "saved", "mastered", "skipped"].includes(normalized)) {
      return normalized;
    }
    return "unseen";
  }

  function normalizeReviewBucket(value) {
    const normalized = String(value || "today").trim().toLowerCase();
    return REVIEW_BUCKETS.includes(normalized) ? normalized : "today";
  }

  function getIntervalByBucket(bucket) {
    const normalized = normalizeReviewBucket(bucket);
    if (normalized === "today") {
      return 1;
    }
    if (normalized === "soon") {
      return 3;
    }
    return 7;
  }

  function normalizeIntervalDays(value, fallback = DEFAULT_INTERVAL_DAYS) {
    const interval = Number(value);
    if (!Number.isFinite(interval) || interval <= 0) {
      const safeFallback = Number.isFinite(Number(fallback)) ? Number(fallback) : DEFAULT_INTERVAL_DAYS;
      return Math.min(MAX_INTERVAL_DAYS, Math.max(DEFAULT_INTERVAL_DAYS, Math.floor(safeFallback)));
    }
    return Math.min(MAX_INTERVAL_DAYS, Math.max(DEFAULT_INTERVAL_DAYS, Math.round(interval)));
  }

  function normalizeEaseFactor(value, fallback = DEFAULT_EASE_FACTOR) {
    const ease = Number(value);
    if (!Number.isFinite(ease)) {
      const safeFallback = Number.isFinite(Number(fallback)) ? Number(fallback) : DEFAULT_EASE_FACTOR;
      return Math.min(MAX_EASE_FACTOR, Math.max(MIN_EASE_FACTOR, Number(safeFallback.toFixed(2))));
    }
    return Math.min(MAX_EASE_FACTOR, Math.max(MIN_EASE_FACTOR, Number(ease.toFixed(2))));
  }

  function normalizeEntry(entry, fallbackLevel) {
    const level = normalizeLevel(entry.level) || fallbackLevel;
    const meaning = String(entry.meaning || entry.translation || "").trim();
    const meaningTerms = splitMeaning(meaning);
    const aliasTerms = extractAliasTerms(entry.aliases);
    const mergedTerms = Array.from(new Set([...meaningTerms, ...aliasTerms]));

    return {
      word: String(entry.word || "").trim(),
      meaning,
      translation: meaning,
      level,
      phonetic: String(entry.phonetic || "").trim(),
      partOfSpeech: String(entry.partOfSpeech || "").trim(),
      definition: String(entry.definition || "").trim(),
      aliases: aliasTerms,
      cefrLevel: String(entry.cefrLevel || "").trim().toUpperCase(),
      cefrRank: Number(entry.cefrRank) || 0,
      frequency: Number(entry.frequency) || 0,
      coverageTier: String(entry.coverageTier || "full").trim().toLowerCase() === "core" ? "core" : "full",
      sourceFlags: Array.isArray(entry.sourceFlags) ? entry.sourceFlags.map((item) => String(item || "").trim()).filter(Boolean) : [],
      altMeanings: Array.isArray(entry.altMeanings) ? entry.altMeanings.map((item) => String(item || "").trim()).filter(Boolean) : [],
      examFrequencyScore: Number(entry.examFrequencyScore) || 0,
      examPriorityScore: Number(entry.examPriorityScore) || 0,
      isPhraseBacked: entry.isPhraseBacked === true,
      phraseCount: Math.max(0, Math.floor(Number(entry.phraseCount) || 0)),
      hitCount: normalizeHitCount(entry.hitCount),
      exposureCount: normalizeHitCount(entry.exposureCount != null ? entry.exposureCount : entry.hitCount),
      seenCount: normalizeHitCount(entry.seenCount),
      lookupCount: normalizeHitCount(entry.lookupCount),
      saveCount: normalizeHitCount(entry.saveCount),
      firstSeenAt: normalizeLastSeen(entry.firstSeenAt || entry.firstSeen || entry.lastSeenAt || entry.lastSeen),
      lastSeen: normalizeLastSeen(entry.lastSeen),
      lastSeenAt: normalizeLastSeen(entry.lastSeenAt),
      reviewCount: normalizeHitCount(entry.reviewCount),
      lastReviewedAt: normalizeLastSeen(entry.lastReviewedAt),
      masteryScore: Math.max(0, Math.min(100, Math.floor(Number(entry.masteryScore) || 0))),
      learningStatus: normalizeLearningStatus(entry.learningStatus || entry.status || ""),
      nextReviewBucket: normalizeReviewBucket(entry.nextReviewBucket || "today"),
      intervalDays: normalizeIntervalDays(entry.intervalDays, getIntervalByBucket(entry.nextReviewBucket)),
      easeFactor: normalizeEaseFactor(entry.easeFactor),
      nextReviewAt: normalizeLastSeen(entry.nextReviewAt),
      meaningTerms: mergedTerms.length ? mergedTerms : [meaning]
    };
  }

  function toWordStat(entry) {
    return {
      word: entry.word,
      translation: entry.translation || entry.meaning,
      level: entry.level,
      hitCount: normalizeHitCount(entry.hitCount),
      lastSeen: normalizeLastSeen(entry.lastSeen)
    };
  }

  function normalizeStoredStats(raw) {
    if (!raw || typeof raw !== "object") {
      return {};
    }

    const normalized = {};
    Object.keys(raw).forEach((key) => {
      const item = raw[key];
      if (!item || typeof item !== "object") {
        return;
      }

      const normalizedWord = normalizeWordKey(item.word || key);
      if (!normalizedWord) {
        return;
      }

      normalized[normalizedWord] = {
        word: String(item.word || normalizedWord).trim(),
        translation: String(item.translation || item.meaning || "").trim(),
        level: normalizeLevel(item.level),
        hitCount: normalizeHitCount(item.hitCount),
        lastSeen: normalizeLastSeen(item.lastSeen)
      };
    });

    return normalized;
  }

  function toLearningRecord(entry) {
    return {
      word: entry.word,
      translation: entry.translation || entry.meaning,
      level: entry.level,
      sourceLevels: Array.isArray(entry.sourceLevels) && entry.sourceLevels.length ? entry.sourceLevels.slice() : [entry.level],
      exposureCount: normalizeHitCount(entry.exposureCount != null ? entry.exposureCount : entry.hitCount),
      hitCount: normalizeHitCount(entry.exposureCount != null ? entry.exposureCount : entry.hitCount),
      seenCount: normalizeHitCount(entry.seenCount || entry.hitCount),
      lookupCount: normalizeHitCount(entry.lookupCount),
      saveCount: normalizeHitCount(entry.saveCount),
      firstSeenAt: normalizeLastSeen(entry.firstSeenAt || entry.firstSeen || entry.lastSeenAt || entry.lastSeen),
      reviewCount: normalizeHitCount(entry.reviewCount),
      lastSeen: normalizeLastSeen(entry.lastSeen),
      lastSeenAt: normalizeLastSeen(entry.lastSeenAt || entry.lastSeen),
      lastReviewedAt: normalizeLastSeen(entry.lastReviewedAt),
      masteryScore: Math.max(0, Math.min(100, Math.floor(Number(entry.masteryScore) || 0))),
      status: normalizeLearningStatus(entry.learningStatus || "unseen"),
      nextReviewBucket: normalizeReviewBucket(entry.nextReviewBucket || "today"),
      intervalDays: normalizeIntervalDays(entry.intervalDays, getIntervalByBucket(entry.nextReviewBucket)),
      easeFactor: normalizeEaseFactor(entry.easeFactor),
      nextReviewAt: normalizeLastSeen(entry.nextReviewAt)
    };
  }

  function normalizeLearningStats(rawLearning, legacyStats) {
    if (learningState) {
      if (rawLearning && typeof rawLearning === "object") {
        const normalized = {};
        Object.keys(rawLearning).forEach((key) => {
          const item = rawLearning[key];
          if (!item || typeof item !== "object") {
            return;
          }
          const word = normalizeWordKey(item.word || key);
          if (!word) {
            return;
          }
          normalized[word] = learningState.normalizeLearningRecord(item, {
            word,
            level: item.level
          });
        });
        return normalized;
      }

      const migrated = {};
      Object.keys(legacyStats || {}).forEach((key) => {
        migrated[key] = learningState.migrateLegacyStat(legacyStats[key]);
      });
      return migrated;
    }

    return {};
  }

  function getChromeRuntimeError() {
    if (typeof chrome === "undefined" || !chrome.runtime) {
      return null;
    }
    return chrome.runtime.lastError || null;
  }

  function createStorageError(action, runtimeError) {
    const message = runtimeError && runtimeError.message
      ? runtimeError.message
      : "unknown chrome runtime error";
    return new Error(`${action}: ${message}`);
  }

  function hasChromeLocalStorage() {
    return typeof chrome !== "undefined" &&
      chrome.storage &&
      chrome.storage.local &&
      typeof chrome.storage.local.get === "function" &&
      typeof chrome.storage.local.set === "function";
  }

  function readChromeLocalStorage(keys) {
    if (!hasChromeLocalStorage()) {
      return Promise.resolve({});
    }

    return new Promise((resolve, reject) => {
      chrome.storage.local.get(keys, (payload) => {
        const runtimeError = getChromeRuntimeError();
        if (runtimeError) {
          reject(createStorageError("chrome.storage.local.get failed", runtimeError));
          return;
        }
        resolve(payload || {});
      });
    });
  }

  function writeChromeLocalStorage(payload) {
    if (!hasChromeLocalStorage()) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      chrome.storage.local.set(payload, () => {
        const runtimeError = getChromeRuntimeError();
        if (runtimeError) {
          reject(createStorageError("chrome.storage.local.set failed", runtimeError));
          return;
        }
        resolve();
      });
    });
  }

  function queuePersistOperation(task) {
    const run = persistChain.catch(() => {}).then(task);
    persistChain = run.catch(() => {});
    return run;
  }

  function getEmptyStoredData() {
    return {
      legacyStats: {},
      learningRecords: {},
      queue: {},
      summary: learningState ? learningState.buildLearningSummary({}, {}) : null
    };
  }

  function readStoredStats() {
    if (!hasChromeLocalStorage()) {
      return Promise.resolve(getEmptyStoredData());
    }

    return readChromeLocalStorage([
        WORD_STATS_STORAGE_KEY,
        LEARNING_WORD_STATS_STORAGE_KEY,
        REVIEW_QUEUE_STORAGE_KEY,
        LEARNING_SUMMARY_STORAGE_KEY
      ])
      .then((payload) => {
        const legacyStats = normalizeStoredStats(payload[WORD_STATS_STORAGE_KEY]);
        const learningRecords = normalizeLearningStats(payload[LEARNING_WORD_STATS_STORAGE_KEY], legacyStats);
        const queue = learningState
          ? learningState.normalizeReviewQueue(payload[REVIEW_QUEUE_STORAGE_KEY])
          : {};
        const summary = payload[LEARNING_SUMMARY_STORAGE_KEY] && typeof payload[LEARNING_SUMMARY_STORAGE_KEY] === "object"
          ? payload[LEARNING_SUMMARY_STORAGE_KEY]
          : (learningState ? learningState.buildLearningSummary(learningRecords, queue) : null);

        return {
          legacyStats,
          learningRecords,
          queue,
          summary
        };
      });
  }

  function refreshLearningSummary(records) {
    if (!learningState) {
      return null;
    }

    learningSummary = learningState.buildLearningSummary(records, reviewQueue);
    return learningSummary;
  }

  function buildActiveLearningRecords(entries = vocabularyEntries) {
    return entries.reduce((accumulator, item) => {
      const itemKey = normalizeWordKey(item.word);
      if (!itemKey) {
        return accumulator;
      }

      const hasState =
        normalizeHitCount(item.hitCount) > 0 ||
        normalizeHitCount(item.exposureCount) > 0 ||
        normalizeHitCount(item.reviewCount) > 0 ||
        normalizeHitCount(item.seenCount) > 0 ||
        normalizeHitCount(item.saveCount) > 0;
      if (hasState) {
        accumulator[itemKey] = toLearningRecord(item);
      }
      return accumulator;
    }, {});
  }

  function createPersistSnapshot(entries = vocabularyEntries, queueState = reviewQueue, summary = null) {
    const stats = {};
    const learningStats = buildActiveLearningRecords(entries);
    entries.forEach((entry) => {
      const hitCount = normalizeHitCount(entry.hitCount);
      const exposureCount = normalizeHitCount(entry.exposureCount != null ? entry.exposureCount : entry.hitCount);
      const seenCount = normalizeHitCount(entry.seenCount || entry.hitCount);
      const reviewCount = normalizeHitCount(entry.reviewCount);
      const saveCount = normalizeHitCount(entry.saveCount);
      if (hitCount <= 0 && exposureCount <= 0 && seenCount <= 0 && reviewCount <= 0 && saveCount <= 0) {
        return;
      }

      const key = normalizeWordKey(entry.word);
      if (!key) {
        return;
      }

      stats[key] = toWordStat(entry);
    });

    const nextSummary = summary || (learningState ? learningState.buildLearningSummary(learningStats, queueState) : null);
    return {
      stats,
      learningStats,
      queue: queueState,
      summary: nextSummary
    };
  }

  function writeStoredStats(snapshot = createPersistSnapshot()) {
    const {
      stats,
      learningStats,
      queue,
      summary
    } = snapshot;
    return writeChromeLocalStorage({
      [WORD_STATS_STORAGE_KEY]: stats,
      [LEARNING_WORD_STATS_STORAGE_KEY]: learningStats,
      [REVIEW_QUEUE_STORAGE_KEY]: queue,
      [LEARNING_SUMMARY_STORAGE_KEY]: summary
    });
  }

  function scheduleStatsPersist() {
    if (!hasChromeLocalStorage()) {
      return;
    }

    if (persistTimer) {
      return;
    }

    persistTimer = setTimeout(() => {
      persistTimer = null;
      queuePersistOperation(() => {
        return writeStoredStats().catch((error) => {
          logError("Vocabulary stats write failed", error);
        });
      });
    }, STORAGE_THROTTLE_MS);
  }

  function maybePersistAdaptiveFeedback(action, now = Date.now()) {
    if (!adaptiveTuning || typeof adaptiveTuning.persistFeedback !== "function") {
      return;
    }

    const normalized = String(action || "").trim().toLowerCase();
    if (!ADAPTIVE_FEEDBACK_ACTIONS.has(normalized)) {
      return;
    }

    try {
      const result = adaptiveTuning.persistFeedback(normalized, { now });
      if (result && typeof result.then === "function" && typeof result.catch === "function") {
        result.catch(() => {});
      }
    } catch (_error) {
      // Ignore adaptive tuning failure; main learning flow should keep working.
    }
  }

  function applyLearningRecordToEntry(entry, record) {
    if (!entry || !record) {
      return;
    }

    entry.exposureCount = normalizeHitCount(record.exposureCount != null ? record.exposureCount : record.hitCount);
    entry.hitCount = normalizeHitCount(entry.exposureCount);
    entry.seenCount = normalizeHitCount(record.seenCount || record.exposureCount || record.hitCount);
    entry.lookupCount = normalizeHitCount(record.lookupCount);
    entry.saveCount = normalizeHitCount(record.saveCount);
    entry.firstSeenAt = normalizeLastSeen(record.firstSeenAt || record.firstSeen || record.lastSeenAt || record.lastSeen);
    entry.lastSeen = normalizeLastSeen(record.lastSeen);
    entry.lastSeenAt = normalizeLastSeen(record.lastSeenAt || record.lastSeen);
    entry.reviewCount = normalizeHitCount(record.reviewCount);
    entry.lastReviewedAt = normalizeLastSeen(record.lastReviewedAt);
    entry.masteryScore = Math.max(0, Math.min(100, Math.floor(Number(record.masteryScore) || 0)));
    entry.learningStatus = normalizeLearningStatus(record.status || record.learningStatus || "unseen");
    entry.nextReviewBucket = normalizeReviewBucket(record.nextReviewBucket || "today");
    entry.intervalDays = normalizeIntervalDays(record.intervalDays, getIntervalByBucket(record.nextReviewBucket));
    entry.easeFactor = normalizeEaseFactor(record.easeFactor);
    entry.nextReviewAt = normalizeLastSeen(record.nextReviewAt);
    entry.sourceLevels = Array.isArray(record.sourceLevels) && record.sourceLevels.length
      ? record.sourceLevels.slice()
      : [entry.level];
  }

  function applyStoredStats(entries, storedData) {
    const records = storedData && storedData.learningRecords ? storedData.learningRecords : {};
    entries.forEach((entry) => {
      const key = normalizeWordKey(entry.word);
      if (!key || !records[key]) {
        return;
      }

      applyLearningRecordToEntry(entry, records[key]);
    });

    reviewQueue = storedData && storedData.queue ? { ...storedData.queue } : {};
    learningSummary = storedData && storedData.summary ? storedData.summary : refreshLearningSummary(records);
  }

  function createEntrySnapshotWithRecord(entry, record) {
    const snapshot = { ...entry };
    applyLearningRecordToEntry(snapshot, record);
    return snapshot;
  }

  function rebuildIndex(entries) {
    chineseTokenIndex.clear();
    wordIndex.clear();

    entries.forEach((entry) => {
      const wordKey = normalizeWordKey(entry.word);
      if (wordKey) {
        wordIndex.set(wordKey, entry);
      }

      entry.meaningTerms.forEach((term) => {
        const token = String(term || "").trim();
        if (!token || token.length < 2) {
          return;
        }

        if (!chineseTokenIndex.has(token)) {
          chineseTokenIndex.set(token, []);
        }

        chineseTokenIndex.get(token).push(entry);
      });
    });

    sortedChineseTokens = Array.from(chineseTokenIndex.keys()).sort((a, b) => b.length - a.length);
  }

  function getLevelPriority(level) {
    return LEVEL_PRIORITY[normalizeLevel(level)] || 0;
  }

  async function fetchLevelVocabulary(level) {
    const filePath = LEVEL_FILES[level];
    const response = await fetch(chrome.runtime.getURL(filePath));
    if (!response.ok) {
      throw new Error(`Failed to load ${filePath}`);
    }

    const json = await response.json();
    if (!Array.isArray(json)) {
      throw new Error(`${filePath} must be an array`);
    }

    return json.map((item) => normalizeEntry(item, level));
  }

  async function loadVocabulary() {
    if (vocabularyEntries.length > 0) {
      return vocabularyEntries;
    }

    if (loadPromise) {
      return loadPromise;
    }

    loadPromise = Promise.all([
      Promise.all(LEVELS.map((level) => fetchLevelVocabulary(level))),
      readStoredStats().catch((error) => {
        logError("Vocabulary stats read failed", error);
        return getEmptyStoredData();
      })
    ])
      .then(([results, storedData]) => {
        vocabularyEntries = results
          .flat()
          .filter((entry) => Boolean(entry.word) && Boolean(entry.meaning) && Boolean(entry.level));

        applyStoredStats(vocabularyEntries, storedData);
        rebuildIndex(vocabularyEntries);
        return vocabularyEntries;
      })
      .catch((error) => {
        logError("Vocabulary load error", error);
        vocabularyEntries = [];
        chineseTokenIndex.clear();
        wordIndex.clear();
        return vocabularyEntries;
      })
      .finally(() => {
        loadPromise = null;
      });

    return loadPromise;
  }

  async function refreshLearningStateFromStorage() {
    const storedData = await readStoredStats();
    applyStoredStats(vocabularyEntries, storedData);
    rebuildIndex(vocabularyEntries);
    return vocabularyEntries;
  }

  function getLevelClass(level) {
    const normalized = normalizeLevel(level);
    return LEVEL_CLASS_MAP[normalized] || LEVEL_CLASS_MAP.CET4;
  }

  function getCoverageTierPriority(entry, vocabularyMode) {
    if (vocabularyMode === "core") {
      return entry && entry.coverageTier === "core" ? 1000 : 0;
    }
    return entry && entry.coverageTier === "core" ? 100 : 10;
  }

  function getCandidatePriority(entry, vocabularyMode) {
    return getCoverageTierPriority(entry, vocabularyMode)
      + (Number(entry && entry.examPriorityScore) || 0)
      + (Number(entry && entry.examFrequencyScore) || 0) * 0.05
      + getLevelPriority(entry && entry.level) * 10
      + (Number(entry && entry.frequency) || 0) * 0.00001;
  }

  function findMatchesInText(text, activeLevels, selectionSettings) {
    const source = String(text || "");
    if (!source) {
      return [];
    }

    const allowedLevels = new Set(normalizeActiveLevels(activeLevels));
    const vocabularyMode = selectionSettings
      ? (sharedSettings
        ? sharedSettings.normalizeVocabularyMode(selectionSettings.vocabularyMode)
        : "core")
      : "full";
    const matches = [];

    for (const token of sortedChineseTokens) {
      const firstIndex = source.indexOf(token);
      if (firstIndex < 0) continue;

      const candidates = chineseTokenIndex.get(token);
      if (!candidates) continue;

      const filtered = candidates.filter((entry) => {
        if (!allowedLevels.has(entry.level)) {
          return false;
        }

        if (vocabularyMode === "core") {
          return entry.coverageTier === "core";
        }

        return true;
      });
      if (filtered.length === 0) continue;

      const selectedEntry = filtered.length === 1
        ? filtered[0]
        : filtered.reduce((best, curr) => {
          return getCandidatePriority(curr, vocabularyMode) > getCandidatePriority(best, vocabularyMode) ? curr : best;
        });

      let startIndex = 0;
      while (startIndex < source.length) {
        const foundIndex = source.indexOf(token, startIndex);
        if (foundIndex < 0) break;

        matches.push({
          start: foundIndex,
          end: foundIndex + token.length,
          chinese: token,
          word: selectedEntry.word,
          meaning: selectedEntry.meaning,
          level: selectedEntry.level,
          cefrLevel: selectedEntry.cefrLevel,
          cefrRank: selectedEntry.cefrRank,
          frequency: selectedEntry.frequency,
          coverageTier: selectedEntry.coverageTier,
          sourceFlags: selectedEntry.sourceFlags,
          altMeanings: selectedEntry.altMeanings,
          examFrequencyScore: selectedEntry.examFrequencyScore,
          examPriorityScore: selectedEntry.examPriorityScore,
          learningStatus: selectedEntry.learningStatus,
          isPhraseBacked: selectedEntry.isPhraseBacked,
          phraseCount: selectedEntry.phraseCount,
          phonetic: selectedEntry.phonetic,
          partOfSpeech: selectedEntry.partOfSpeech,
          definition: selectedEntry.definition
        });

        startIndex = foundIndex + token.length;
      }
    }

    matches.sort((a, b) => {
      if (a.start !== b.start) {
        return a.start - b.start;
      }

      const lengthDiff = (b.end - b.start) - (a.end - a.start);
      if (lengthDiff !== 0) {
        return lengthDiff;
      }

      return getLevelPriority(b.level) - getLevelPriority(a.level);
    });

    const uniqueBySpan = new Map();
    matches.forEach((match) => {
      const key = `${match.start}-${match.end}`;
      if (!uniqueBySpan.has(key)) {
        uniqueBySpan.set(key, match);
      }
    });

    return Array.from(uniqueBySpan.values());
  }

  function recordHit(word) {
    const key = normalizeWordKey(word);
    if (!key) {
      return false;
    }

    const entry = wordIndex.get(key);
    if (!entry) {
      return false;
    }

    const now = Date.now();
    if (learningState) {
      const nextRecord = learningState.recordExposure(toLearningRecord(entry), {
        word: entry.word,
        translation: entry.translation || entry.meaning,
        level: entry.level,
        sourceLevels: entry.sourceLevels || [entry.level]
      }, now);
      applyLearningRecordToEntry(entry, nextRecord);
      reviewQueue = learningState.syncReviewQueue(reviewQueue, nextRecord, now);
      refreshLearningSummary(buildActiveLearningRecords(vocabularyEntries));
    } else {
      entry.hitCount = normalizeHitCount(entry.hitCount) + 1;
      entry.lastSeen = now;
    }

    scheduleStatsPersist();
    return true;
  }

  function getLearningSummary() {
    if (!learningState) {
      return {
        todayCount: 0,
        soonCount: 0,
        queueCount: 0,
        unseenCount: 0,
        seenCount: 0,
        savedCount: 0,
        skippedCount: 0,
        newCount: 0,
        learningCount: 0,
        reviewingCount: 0,
        masteredCount: 0,
        recentWords: []
      };
    }

    if (!learningSummary) {
      refreshLearningSummary(buildActiveLearningRecords(vocabularyEntries));
    }

    return learningSummary || learningState.buildLearningSummary({}, {});
  }

  function getReviewQueue(limit = 5) {
    if (!learningState) {
      return [];
    }

    const bucketRank = {
      today: 0,
      soon: 1,
      later: 2
    };

    return Object.values(reviewQueue || {})
      .map((item) => {
        const entry = wordIndex.get(normalizeWordKey(item.word));
        if (!entry) {
          return null;
        }
        const dueBucket = normalizeReviewBucket(item.dueBucket || entry.nextReviewBucket);
        const nextReviewAt = normalizeLastSeen(item.nextReviewAt || entry.nextReviewAt);
        const intervalDays = normalizeIntervalDays(item.intervalDays, getIntervalByBucket(dueBucket));
        const easeFactor = normalizeEaseFactor(item.easeFactor, entry.easeFactor);
        const updatedAt = normalizeLastSeen(item.updatedAt);
        const lastSeenAt = normalizeLastSeen(item.lastSeenAt || entry.lastSeenAt || entry.lastSeen);
        return {
          word: entry.word,
          translation: entry.translation || entry.meaning,
          level: entry.level,
          status: entry.learningStatus || "unseen",
          dueBucket,
          nextReviewAt,
          intervalDays,
          easeFactor,
          updatedAt,
          lastSeenAt
        };
      })
      .filter(Boolean)
      .sort((left, right) => {
        const leftRank = Object.prototype.hasOwnProperty.call(bucketRank, left.dueBucket) ? bucketRank[left.dueBucket] : 9;
        const rightRank = Object.prototype.hasOwnProperty.call(bucketRank, right.dueBucket) ? bucketRank[right.dueBucket] : 9;
        const bucketDiff = leftRank - rightRank;
        if (bucketDiff !== 0) {
          return bucketDiff;
        }
        const leftDue = Number.isFinite(left.nextReviewAt) ? left.nextReviewAt : Number.POSITIVE_INFINITY;
        const rightDue = Number.isFinite(right.nextReviewAt) ? right.nextReviewAt : Number.POSITIVE_INFINITY;
        if (leftDue !== rightDue) {
          return leftDue - rightDue;
        }
        const leftUpdated = left.updatedAt || left.lastSeenAt || 0;
        const rightUpdated = right.updatedAt || right.lastSeenAt || 0;
        if (rightUpdated !== leftUpdated) {
          return rightUpdated - leftUpdated;
        }
        return String(left.word || "").localeCompare(String(right.word || ""));
      })
      .slice(0, limit);
  }

  async function applyLearningAction(word, action) {
    if (!learningState) {
      return null;
    }

    return queuePersistOperation(async () => {
      const key = normalizeWordKey(word);
      const entry = wordIndex.get(key);
      if (!entry) {
        return null;
      }

      const now = Date.now();
      const normalizedAction = String(action || "").trim().toLowerCase();
      const buildNextRecord = (record) => {
        return typeof learningState.applyLearningAction === "function"
          ? learningState.applyLearningAction(record, normalizedAction, now)
          : learningState.applyReviewFeedback(record, normalizedAction, now);
      };

      const snapshotRecord = buildNextRecord(toLearningRecord(entry));
      const snapshotEntries = vocabularyEntries.map((item) => {
        return item === entry ? createEntrySnapshotWithRecord(item, snapshotRecord) : item;
      });
      const snapshotQueue = learningState.syncReviewQueue(reviewQueue, snapshotRecord, now);

      try {
        await writeStoredStats(createPersistSnapshot(snapshotEntries, snapshotQueue));
      } catch (error) {
        logError("Vocabulary learning action write failed", error);
        return null;
      }

      const committedRecord = buildNextRecord(toLearningRecord(entry));
      applyLearningRecordToEntry(entry, committedRecord);
      reviewQueue = learningState.syncReviewQueue(reviewQueue, committedRecord, now);
      refreshLearningSummary(buildActiveLearningRecords(vocabularyEntries));
      scheduleStatsPersist();
      maybePersistAdaptiveFeedback(normalizedAction, now);
      return committedRecord;
    });
  }

  async function reviewWord(word, feedback) {
    return applyLearningAction(word, feedback);
  }

  function getEncounteredWords() {
    return vocabularyEntries
      .filter((entry) => normalizeHitCount(entry.hitCount) > 0)
      .map((entry) => {
        return {
          word: entry.word,
          translation: entry.translation || entry.meaning,
          meaning: entry.meaning,
          level: entry.level,
          hitCount: normalizeHitCount(entry.hitCount),
          lastSeen: normalizeLastSeen(entry.lastSeen)
        };
      });
  }

  function __setEntriesForTest(entries) {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }

    persistChain = Promise.resolve();
    reviewQueue = {};
    learningSummary = null;
    vocabularyEntries = Array.isArray(entries)
      ? entries.map((entry) => normalizeEntry(entry, normalizeLevel(entry.level) || "CET4"))
      : [];
    rebuildIndex(vocabularyEntries);
    return vocabularyEntries;
  }

  const api = {
    LEVELS,
    LEVEL_PRIORITY,
    DEFAULT_ACTIVE_LEVELS,
    WORD_STATS_STORAGE_KEY,
    normalizeLevel,
    normalizeActiveLevels,
    getLevelPriority,
    getLevelClass,
    loadVocabulary,
    refreshLearningStateFromStorage,
    findMatchesInText,
    recordHit,
    applyLearningAction,
    reviewWord,
    getReviewQueue,
    getLearningSummary,
    getEncounteredWords,
    __setEntriesForTest
  };

  globalScope.VocabularyModule = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
