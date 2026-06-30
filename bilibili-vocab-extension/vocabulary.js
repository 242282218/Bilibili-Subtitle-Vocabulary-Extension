(function (globalScope) {
  const sharedSettings =
    globalScope.SharedSettings ||
    (typeof require === 'function' ? require('./sharedSettings.js') : null);
  const learningState =
    globalScope.LearningState ||
    (typeof require === 'function' ? require('./learningState.js') : null);
  const adaptiveTuning =
    globalScope.AdaptiveTuning ||
    (typeof require === 'function' ? require('./adaptiveTuning.js') : null);
  const Pure =
    globalScope.VocabularyPure ||
    (typeof require === 'function' ? require('./vocabulary-pure.js') : null);

  const {
    LEVELS,
    LEVEL_CLASS_MAP,
    LEVEL_PRIORITY,
    DEFAULT_ACTIVE_LEVELS,
    REVIEW_BUCKETS,
    DEFAULT_INTERVAL_DAYS,
    DEFAULT_EASE_FACTOR,
    MIN_EASE_FACTOR,
    MAX_EASE_FACTOR,
    MAX_INTERVAL_DAYS,
    ADAPTIVE_FEEDBACK_ACTIONS,
    normalizeLevel,
    normalizeWordKey,
    normalizeActiveLevels,
    splitMeaning,
    extractAliasTerms,
    normalizeHitCount,
    normalizeLastSeen,
    normalizeLearningStatus,
    normalizeReviewBucket,
    getIntervalByBucket,
    normalizeIntervalDays,
    normalizeEaseFactor,
    normalizeEntry,
    toWordStat,
    toLearningRecord,
    normalizeStoredStats,
    normalizeLearningStats,
    getLevelPriority,
    getLevelClass,
    getCoverageTierPriority,
    getCandidatePriority,
    createEntrySnapshotWithRecord,
    applyLearningRecordToEntry,
  } = Pure;

  const LEVEL_FILES = {
    CET4: 'data/cet4.json',
    CET6: 'data/cet6.json',
    KAOYAN: 'data/kaoyan.json',
    IELTS: 'data/ielts.json',
    TOEFL: 'data/toefl.json',
  };

  const WORD_STATS_STORAGE_KEY = 'bili_vocab_word_stats_v1';
  const LEARNING_WORD_STATS_STORAGE_KEY = learningState
    ? learningState.STORAGE_KEYS.WORD_STATS_V2
    : 'bili_vocab_word_stats_v2';
  const REVIEW_QUEUE_STORAGE_KEY = learningState
    ? learningState.STORAGE_KEYS.REVIEW_QUEUE
    : 'bili_vocab_review_queue_v1';
  const LEARNING_SUMMARY_STORAGE_KEY = learningState
    ? learningState.STORAGE_KEYS.LEARNING_SUMMARY
    : 'bili_vocab_learning_summary_v1';
  const STORAGE_THROTTLE_MS = 600;
  const logError =
    globalThis.Utils && typeof globalThis.Utils.logError === 'function'
      ? globalThis.Utils.logError
      : (context, error) => console.error(`[BiliVocab] ${context}:`, error);

  let vocabularyEntries = [];
  let loadPromise = null;
  const chineseTokenIndex = new Map();
  let sortedChineseTokens = [];
  const wordIndex = new Map();
  let persistTimer = null;
  let persistChain = Promise.resolve();
  let reviewQueue = {};
  let learningSummary = null;

  function getChromeRuntimeError() {
    if (typeof chrome === 'undefined' || !chrome.runtime) {
      return null;
    }
    return chrome.runtime.lastError || null;
  }

  function createStorageError(action, runtimeError) {
    const message =
      runtimeError && runtimeError.message ? runtimeError.message : 'unknown chrome runtime error';
    return new Error(`${action}: ${message}`);
  }

  function hasChromeLocalStorage() {
    return (
      typeof chrome !== 'undefined' &&
      chrome.storage &&
      chrome.storage.local &&
      typeof chrome.storage.local.get === 'function' &&
      typeof chrome.storage.local.set === 'function'
    );
  }

  function hasChromeRuntimeMessaging() {
    return (
      typeof chrome !== 'undefined' &&
      chrome.runtime &&
      typeof chrome.runtime.sendMessage === 'function'
    );
  }

  function sendRuntimeMessage(type, payload) {
    if (!hasChromeRuntimeMessaging()) {
      return Promise.reject(new Error('chrome.runtime.sendMessage unavailable'));
    }

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, payload }, (response) => {
        const runtimeError = getChromeRuntimeError();
        if (runtimeError) {
          reject(createStorageError('chrome.runtime.sendMessage failed', runtimeError));
          return;
        }
        if (!response || response.ok !== true) {
          reject(new Error(String((response && response.error) || 'runtime message failed')));
          return;
        }
        resolve(response.payload);
      });
    });
  }

  function persistLearningHit(record, payload, now) {
    return sendRuntimeMessage('BILI_VOCAB_LEARNING_RECORD_HIT', {
      ...payload,
      record,
      now,
    }).catch((error) => {
      logError('Vocabulary hit background persist failed', error);
      return null;
    });
  }

  function persistLearningReviewFeedback(word, action, now) {
    return sendRuntimeMessage('BILI_VOCAB_LEARNING_APPLY_REVIEW_FEEDBACK', {
      word,
      action,
      now,
    });
  }

  function readChromeLocalStorage(keys) {
    if (!hasChromeLocalStorage()) {
      return Promise.resolve({});
    }

    return new Promise((resolve, reject) => {
      chrome.storage.local.get(keys, (payload) => {
        const runtimeError = getChromeRuntimeError();
        if (runtimeError) {
          reject(createStorageError('chrome.storage.local.get failed', runtimeError));
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
          reject(createStorageError('chrome.storage.local.set failed', runtimeError));
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
      summary: learningState ? learningState.buildLearningSummary({}, {}) : null,
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
      LEARNING_SUMMARY_STORAGE_KEY,
    ]).then((payload) => {
      const legacyStats = normalizeStoredStats(payload[WORD_STATS_STORAGE_KEY]);
      const learningRecords = normalizeLearningStats(
        payload[LEARNING_WORD_STATS_STORAGE_KEY],
        legacyStats
      );
      const queue = learningState
        ? learningState.normalizeReviewQueue(payload[REVIEW_QUEUE_STORAGE_KEY])
        : {};
      const summary =
        payload[LEARNING_SUMMARY_STORAGE_KEY] &&
        typeof payload[LEARNING_SUMMARY_STORAGE_KEY] === 'object'
          ? payload[LEARNING_SUMMARY_STORAGE_KEY]
          : learningState
            ? learningState.buildLearningSummary(learningRecords, queue)
            : null;

      return {
        legacyStats,
        learningRecords,
        queue,
        summary,
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

  function createPersistSnapshot(
    entries = vocabularyEntries,
    queueState = reviewQueue,
    summary = null
  ) {
    const stats = {};
    const learningStats = buildActiveLearningRecords(entries);
    entries.forEach((entry) => {
      const hitCount = normalizeHitCount(entry.hitCount);
      const exposureCount = normalizeHitCount(
        entry.exposureCount != null ? entry.exposureCount : entry.hitCount
      );
      const seenCount = normalizeHitCount(entry.seenCount || entry.hitCount);
      const reviewCount = normalizeHitCount(entry.reviewCount);
      const saveCount = normalizeHitCount(entry.saveCount);
      if (
        hitCount <= 0 &&
        exposureCount <= 0 &&
        seenCount <= 0 &&
        reviewCount <= 0 &&
        saveCount <= 0
      ) {
        return;
      }

      const key = normalizeWordKey(entry.word);
      if (!key) {
        return;
      }

      stats[key] = toWordStat(entry);
    });

    const nextSummary =
      summary ||
      (learningState ? learningState.buildLearningSummary(learningStats, queueState) : null);
    return {
      stats,
      learningStats,
      queue: queueState,
      summary: nextSummary,
    };
  }

  function writeStoredStats(snapshot = createPersistSnapshot()) {
    const { stats, learningStats, queue, summary } = snapshot;
    return writeChromeLocalStorage({
      [WORD_STATS_STORAGE_KEY]: stats,
      [LEARNING_WORD_STATS_STORAGE_KEY]: learningStats,
      [REVIEW_QUEUE_STORAGE_KEY]: queue,
      [LEARNING_SUMMARY_STORAGE_KEY]: summary,
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
          logError('Vocabulary stats write failed', error);
        });
      });
    }, STORAGE_THROTTLE_MS);
  }

  function maybePersistAdaptiveFeedback(action, now = Date.now()) {
    if (!adaptiveTuning || typeof adaptiveTuning.persistFeedback !== 'function') {
      return;
    }

    const normalized = String(action || '')
      .trim()
      .toLowerCase();
    if (!ADAPTIVE_FEEDBACK_ACTIONS.has(normalized)) {
      return;
    }

    try {
      const result = adaptiveTuning.persistFeedback(normalized, { now });
      if (result && typeof result.then === 'function' && typeof result.catch === 'function') {
        result.catch(() => {});
      }
    } catch (_error) {
      // Ignore adaptive tuning failure; main learning flow should keep working.
    }
  }

  function replaceEntryInIndexes(oldEntry, newEntry) {
    const key = normalizeWordKey(newEntry.word);
    const entryIndex = vocabularyEntries.indexOf(oldEntry);
    if (entryIndex >= 0) vocabularyEntries[entryIndex] = newEntry;
    if (key) wordIndex.set(key, newEntry);

    if (Array.isArray(oldEntry.meaningTerms)) {
      oldEntry.meaningTerms.forEach((term) => {
        const token = String(term || '').trim();
        if (!token || token.length < 2) return;
        const entries = chineseTokenIndex.get(token);
        if (!entries) return;
        const idx = entries.indexOf(oldEntry);
        if (idx >= 0) entries[idx] = newEntry;
      });
    }
  }

  function applyStoredStats(entries, storedData) {
    const records = storedData && storedData.learningRecords ? storedData.learningRecords : {};
    entries.forEach((entry, index) => {
      const key = normalizeWordKey(entry.word);
      if (!key || !records[key]) {
        return;
      }

      entries[index] = applyLearningRecordToEntry(entry, records[key]);
    });

    reviewQueue = storedData && storedData.queue ? { ...storedData.queue } : {};
    learningSummary =
      storedData && storedData.summary ? storedData.summary : refreshLearningSummary(records);
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
        const token = String(term || '').trim();
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
        logError('Vocabulary stats read failed', error);
        return getEmptyStoredData();
      }),
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
        logError('Vocabulary load error', error);
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

  function findMatchesInText(text, activeLevels, selectionSettings) {
    const source = String(text || '');
    if (!source) {
      return [];
    }

    const allowedLevels = new Set(normalizeActiveLevels(activeLevels));
    const vocabularyMode = selectionSettings
      ? sharedSettings
        ? sharedSettings.normalizeVocabularyMode(selectionSettings.vocabularyMode)
        : 'core'
      : 'full';
    const matches = [];
    const selectedCache = new Map();

    for (const token of sortedChineseTokens) {
      const firstIndex = source.indexOf(token);
      if (firstIndex < 0) continue;

      const candidates = chineseTokenIndex.get(token);
      if (!candidates) continue;

      let selectedEntry = selectedCache.get(token);
      if (!selectedEntry) {
        const filtered = candidates.filter((entry) => {
          if (!allowedLevels.has(entry.level)) {
            return false;
          }

          if (vocabularyMode === 'core') {
            return entry.coverageTier === 'core';
          }

          return true;
        });
        if (filtered.length === 0) continue;

        selectedEntry =
          filtered.length === 1
            ? filtered[0]
            : filtered.reduce((best, curr) => {
                return getCandidatePriority(curr, vocabularyMode) >
                  getCandidatePriority(best, vocabularyMode)
                  ? curr
                  : best;
              });
        selectedCache.set(token, selectedEntry);
      }

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
          definition: selectedEntry.definition,
        });

        startIndex = foundIndex + token.length;
      }
    }

    matches.sort((a, b) => {
      if (a.start !== b.start) {
        return a.start - b.start;
      }

      const lengthDiff = b.end - b.start - (a.end - a.start);
      if (lengthDiff !== 0) {
        return lengthDiff;
      }

      return getLevelPriority(b.level) - getLevelPriority(a.level);
    });

    const uniqueBySpan = new Map();
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const key = `${match.start}-${match.end}`;
      if (!uniqueBySpan.has(key)) {
        uniqueBySpan.set(key, match);
      }
    }

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
      const previousRecord = toLearningRecord(entry);
      const exposurePayload = {
        word: entry.word,
        translation: entry.translation || entry.meaning,
        level: entry.level,
        sourceLevels: entry.sourceLevels || [entry.level],
      };
      const nextRecord = learningState.recordExposure(previousRecord, exposurePayload, now);
      const updated = applyLearningRecordToEntry(entry, nextRecord);
      replaceEntryInIndexes(entry, updated);
      reviewQueue = learningState.syncReviewQueue(reviewQueue, nextRecord, now);
      refreshLearningSummary(buildActiveLearningRecords(vocabularyEntries));
      void persistLearningHit(previousRecord, exposurePayload, now);
    } else {
      entry.hitCount = normalizeHitCount(entry.hitCount) + 1;
      entry.lastSeen = now;
      scheduleStatsPersist();
    }

    if (learningState && typeof learningState.updateLearningStreak === 'function') {
      void learningState.updateLearningStreak(now);
    }
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
        recentWords: [],
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
      later: 2,
    };

    return Object.values(reviewQueue || {})
      .map((item) => {
        const entry = wordIndex.get(normalizeWordKey(item.word));
        if (!entry) {
          return null;
        }
        const dueBucket = normalizeReviewBucket(item.dueBucket || entry.nextReviewBucket);
        const nextReviewAt = normalizeLastSeen(item.nextReviewAt || entry.nextReviewAt);
        const intervalDays = normalizeIntervalDays(
          item.intervalDays,
          getIntervalByBucket(dueBucket)
        );
        const easeFactor = normalizeEaseFactor(item.easeFactor, entry.easeFactor);
        const updatedAt = normalizeLastSeen(item.updatedAt);
        const lastSeenAt = normalizeLastSeen(item.lastSeenAt || entry.lastSeenAt || entry.lastSeen);
        return {
          word: entry.word,
          translation: entry.translation || entry.meaning,
          level: entry.level,
          status: entry.learningStatus || 'unseen',
          dueBucket,
          nextReviewAt,
          intervalDays,
          easeFactor,
          updatedAt,
          lastSeenAt,
        };
      })
      .filter(Boolean)
      .sort((left, right) => {
        const leftRank = Object.prototype.hasOwnProperty.call(bucketRank, left.dueBucket)
          ? bucketRank[left.dueBucket]
          : 9;
        const rightRank = Object.prototype.hasOwnProperty.call(bucketRank, right.dueBucket)
          ? bucketRank[right.dueBucket]
          : 9;
        const bucketDiff = leftRank - rightRank;
        if (bucketDiff !== 0) {
          return bucketDiff;
        }
        const leftDue = Number.isFinite(left.nextReviewAt)
          ? left.nextReviewAt
          : Number.POSITIVE_INFINITY;
        const rightDue = Number.isFinite(right.nextReviewAt)
          ? right.nextReviewAt
          : Number.POSITIVE_INFINITY;
        if (leftDue !== rightDue) {
          return leftDue - rightDue;
        }
        const leftUpdated = left.updatedAt || left.lastSeenAt || 0;
        const rightUpdated = right.updatedAt || right.lastSeenAt || 0;
        if (rightUpdated !== leftUpdated) {
          return rightUpdated - leftUpdated;
        }
        return String(left.word || '').localeCompare(String(right.word || ''));
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
      const normalizedAction = String(action || '')
        .trim()
        .toLowerCase();
      let committedPayload = null;
      try {
        committedPayload = await persistLearningReviewFeedback(key, normalizedAction, now);
      } catch (error) {
        logError('Vocabulary learning action write failed', error);
        return null;
      }

      const committedRecord =
        committedPayload &&
        committedPayload.stats &&
        typeof committedPayload.stats === 'object' &&
        committedPayload.stats[key]
          ? committedPayload.stats[key]
          : typeof learningState.applyLearningAction === 'function'
            ? learningState.applyLearningAction(toLearningRecord(entry), normalizedAction, now)
            : learningState.applyReviewFeedback(toLearningRecord(entry), normalizedAction, now);
      const updated = applyLearningRecordToEntry(entry, committedRecord);
      replaceEntryInIndexes(entry, updated);
      reviewQueue =
        committedPayload && committedPayload.queue && typeof committedPayload.queue === 'object'
          ? learningState.normalizeReviewQueue(committedPayload.queue)
          : learningState.syncReviewQueue(reviewQueue, committedRecord, now);
      learningSummary =
        committedPayload && committedPayload.summary && typeof committedPayload.summary === 'object'
          ? committedPayload.summary
          : refreshLearningSummary(buildActiveLearningRecords(vocabularyEntries));
      maybePersistAdaptiveFeedback(normalizedAction, now);
      if (typeof learningState.updateLearningStreak === 'function') {
        void learningState.updateLearningStreak(now);
      }
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
          lastSeen: normalizeLastSeen(entry.lastSeen),
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
      ? entries.map((entry) => normalizeEntry(entry, normalizeLevel(entry.level) || 'CET4'))
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
    __setEntriesForTest,
  };

  globalScope.VocabularyModule = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
