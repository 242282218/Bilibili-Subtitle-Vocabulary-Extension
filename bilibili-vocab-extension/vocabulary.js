(function (globalScope) {
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
  const STORAGE_THROTTLE_MS = 600;

  let vocabularyEntries = [];
  let loadPromise = null;
  const chineseTokenIndex = new Map();
  let sortedChineseTokens = [];
  const wordIndex = new Map();
  let persistTimer = null;

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
      hitCount: normalizeHitCount(entry.hitCount),
      lastSeen: normalizeLastSeen(entry.lastSeen),
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

  function readStoredStats() {
    return new Promise((resolve) => {
      if (
        typeof chrome === "undefined" ||
        !chrome.storage ||
        !chrome.storage.local ||
        typeof chrome.storage.local.get !== "function"
      ) {
        resolve({});
        return;
      }

      chrome.storage.local.get([WORD_STATS_STORAGE_KEY], (payload) => {
        const stats = payload ? payload[WORD_STATS_STORAGE_KEY] : null;
        resolve(normalizeStoredStats(stats));
      });
    });
  }

  function writeStoredStats() {
    if (
      typeof chrome === "undefined" ||
      !chrome.storage ||
      !chrome.storage.local ||
      typeof chrome.storage.local.set !== "function"
    ) {
      return;
    }

    const stats = {};
    vocabularyEntries.forEach((entry) => {
      const hitCount = normalizeHitCount(entry.hitCount);
      if (hitCount <= 0) {
        return;
      }

      const key = normalizeWordKey(entry.word);
      if (!key) {
        return;
      }

      stats[key] = toWordStat(entry);
    });

    chrome.storage.local.set({ [WORD_STATS_STORAGE_KEY]: stats });
  }

  function scheduleStatsPersist() {
    if (
      typeof chrome === "undefined" ||
      !chrome.storage ||
      !chrome.storage.local ||
      typeof chrome.storage.local.set !== "function"
    ) {
      return;
    }

    if (persistTimer) {
      return;
    }

    persistTimer = setTimeout(() => {
      persistTimer = null;
      writeStoredStats();
    }, STORAGE_THROTTLE_MS);
  }

  function applyStoredStats(entries, storedStats) {
    entries.forEach((entry) => {
      const key = normalizeWordKey(entry.word);
      if (!key || !storedStats[key]) {
        return;
      }

      const stat = storedStats[key];
      entry.hitCount = normalizeHitCount(stat.hitCount);
      entry.lastSeen = normalizeLastSeen(stat.lastSeen);
    });
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

    chineseTokenIndex.forEach((list) => {
      list.sort((a, b) => {
        return getLevelPriority(b.level) - getLevelPriority(a.level);
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

    loadPromise = Promise.all([Promise.all(LEVELS.map((level) => fetchLevelVocabulary(level))), readStoredStats()])
      .then(([results, storedStats]) => {
        vocabularyEntries = results
          .flat()
          .filter((entry) => Boolean(entry.word) && Boolean(entry.meaning) && Boolean(entry.level));

        applyStoredStats(vocabularyEntries, storedStats);
        rebuildIndex(vocabularyEntries);
        return vocabularyEntries;
      })
      .catch((error) => {
        console.error("[BiliVocab] Vocabulary load error:", error);
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

  function getLevelClass(level) {
    const normalized = normalizeLevel(level);
    return LEVEL_CLASS_MAP[normalized] || LEVEL_CLASS_MAP.CET4;
  }

  function findMatchesInText(text, activeLevels) {
    const source = String(text || "");
    if (!source) {
      return [];
    }

    const allowedLevels = new Set(normalizeActiveLevels(activeLevels));
    const matches = [];

    sortedChineseTokens.forEach((token) => {
      let startIndex = 0;
      while (startIndex < source.length) {
        const foundIndex = source.indexOf(token, startIndex);
        if (foundIndex < 0) {
          break;
        }

        const candidates = chineseTokenIndex.get(token) || [];
        const selectedEntry = candidates.find((entry) => allowedLevels.has(entry.level));

        if (selectedEntry) {
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
            phonetic: selectedEntry.phonetic,
            partOfSpeech: selectedEntry.partOfSpeech,
            definition: selectedEntry.definition
          });
        }

        startIndex = foundIndex + token.length;
      }
    });

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

    entry.hitCount = normalizeHitCount(entry.hitCount) + 1;
    entry.lastSeen = Date.now();
    scheduleStatsPersist();
    return true;
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
    findMatchesInText,
    recordHit,
    getEncounteredWords,
    __setEntriesForTest
  };

  globalScope.VocabularyModule = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
