(function (globalScope) {
  const DEFAULT_SETTINGS = {
    activeLevels: ["CET4", "CET6", "KAOYAN", "IELTS", "TOEFL"],
    replaceRatio: 0.2,
    maxReplaceCount: 2,
    targetCefr: "B2"
  };
  const CEFR_RANK_MAP = {
    A1: 1,
    A2: 2,
    B1: 3,
    B2: 4,
    C1: 5,
    C2: 6
  };

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeRatio(value) {
    const ratio = Number(value);
    if (!Number.isFinite(ratio)) {
      return DEFAULT_SETTINGS.replaceRatio;
    }

    return Math.min(0.3, Math.max(0.1, Number(ratio.toFixed(2))));
  }

  function normalizeMaxReplaceCount(value) {
    const count = Number(value);
    if (!Number.isFinite(count)) {
      return DEFAULT_SETTINGS.maxReplaceCount;
    }

    return Math.min(5, Math.max(1, Math.floor(count)));
  }

  function normalizeActiveLevels(activeLevels) {
    if (globalScope.VocabularyModule && typeof globalScope.VocabularyModule.normalizeActiveLevels === "function") {
      return globalScope.VocabularyModule.normalizeActiveLevels(activeLevels);
    }

    const fallbackLevels = DEFAULT_SETTINGS.activeLevels;
    const allowedLevels = new Set(fallbackLevels);
    if (!Array.isArray(activeLevels)) {
      return fallbackLevels.slice();
    }

    const normalized = activeLevels
      .map((level) => String(level || "").trim().toUpperCase())
      .filter((level) => Boolean(level) && allowedLevels.has(level));

    return normalized.length ? Array.from(new Set(normalized)) : fallbackLevels.slice();
  }

  function normalizeTargetCefr(targetCefr) {
    const normalized = String(targetCefr || "").trim().toUpperCase();
    if (CEFR_RANK_MAP[normalized]) {
      return normalized;
    }
    return DEFAULT_SETTINGS.targetCefr;
  }

  function normalizeSettings(settings) {
    const source = settings || {};
    return {
      replaceRatio: normalizeRatio(source.replaceRatio),
      maxReplaceCount: normalizeMaxReplaceCount(source.maxReplaceCount),
      activeLevels: normalizeActiveLevels(source.activeLevels),
      targetCefr: normalizeTargetCefr(source.targetCefr)
    };
  }

  function createSettingsFingerprint(settings) {
    const normalized = normalizeSettings(settings);
    const sortedLevels = normalized.activeLevels.slice().sort();
    return `${normalized.replaceRatio.toFixed(2)}|${normalized.maxReplaceCount}|${normalized.targetCefr}|${sortedLevels.join(",")}`;
  }

  function getLevelPriority(level) {
    if (globalScope.VocabularyModule && typeof globalScope.VocabularyModule.getLevelPriority === "function") {
      return globalScope.VocabularyModule.getLevelPriority(level);
    }

    const fallback = {
      CET4: 1,
      CET6: 2,
      KAOYAN: 3,
      IELTS: 4,
      TOEFL: 5
    };

    return fallback[String(level || "").trim().toUpperCase()] || 0;
  }

  function hasOverlap(candidate, selected) {
    return selected.some((item) => !(candidate.end <= item.start || candidate.start >= item.end));
  }

  function normalizeWordKey(word) {
    return String(word || "").trim().toLowerCase();
  }

  function calculateReplacementCount(totalMatches, settings) {
    if (!totalMatches) {
      return 0;
    }

    const byRatio = Math.max(1, Math.ceil(totalMatches * settings.replaceRatio));
    return Math.min(settings.maxReplaceCount, byRatio);
  }

  function getCandidateCefrRank(candidate) {
    const directRank = Number(candidate && candidate.cefrRank);
    if (Number.isInteger(directRank) && directRank >= 1 && directRank <= 6) {
      return directRank;
    }

    const levelText = String((candidate && candidate.cefrLevel) || "").trim().toUpperCase();
    return CEFR_RANK_MAP[levelText] || 0;
  }

  function getCefrPreferenceScore(candidate, targetCefr) {
    const targetRank = CEFR_RANK_MAP[String(targetCefr || "").trim().toUpperCase()] || 0;
    if (!targetRank) {
      return 0;
    }

    const candidateRank = getCandidateCefrRank(candidate);
    if (!candidateRank) {
      return -100;
    }

    return 10 - Math.abs(candidateRank - targetRank);
  }

  function getFrequencyScore(candidate) {
    const frequency = Number(candidate && candidate.frequency);
    if (!Number.isFinite(frequency) || frequency < 0) {
      return 0;
    }
    return frequency;
  }

  function selectMatches(matches, settings) {
    if (!Array.isArray(matches) || matches.length === 0) {
      return [];
    }

    const normalizedSettings = normalizeSettings(settings);
    const targetCount = calculateReplacementCount(matches.length, normalizedSettings);

    const sortedCandidates = matches.slice().sort((a, b) => {
      const priorityDiff = getLevelPriority(b.level) - getLevelPriority(a.level);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      const cefrPreferenceDiff =
        getCefrPreferenceScore(b, normalizedSettings.targetCefr) -
        getCefrPreferenceScore(a, normalizedSettings.targetCefr);
      if (cefrPreferenceDiff !== 0) {
        return cefrPreferenceDiff;
      }

      const frequencyDiff = getFrequencyScore(b) - getFrequencyScore(a);
      if (frequencyDiff !== 0) {
        return frequencyDiff;
      }

      const lengthDiff = (b.end - b.start) - (a.end - a.start);
      if (lengthDiff !== 0) {
        return lengthDiff;
      }

      return a.start - b.start;
    });

    const selected = [];
    const selectedWordKeys = new Set();

    function trySelectCandidate(candidate, avoidDuplicateWord) {
      if (hasOverlap(candidate, selected)) {
        return false;
      }

      const wordKey = normalizeWordKey(candidate.word);
      if (avoidDuplicateWord && wordKey && selectedWordKeys.has(wordKey)) {
        return false;
      }

      selected.push(candidate);
      if (wordKey) {
        selectedWordKeys.add(wordKey);
      }

      return selected.length >= targetCount;
    }

    sortedCandidates.some((candidate) => trySelectCandidate(candidate, true));

    if (selected.length < targetCount) {
      sortedCandidates.some((candidate) => {
        if (selected.includes(candidate)) {
          return false;
        }

        return trySelectCandidate(candidate, false);
      });
    }

    return selected;
  }

  function buildTokens(text, matches) {
    const source = String(text || "");
    if (!source) {
      return [];
    }

    if (!Array.isArray(matches) || matches.length === 0) {
      return [{ type: "text", text: source }];
    }

    const tokens = [];
    const orderedMatches = matches.slice().sort((a, b) => a.start - b.start);

    let cursor = 0;
    orderedMatches.forEach((match) => {
      if (cursor < match.start) {
        tokens.push({
          type: "text",
          text: source.slice(cursor, match.start)
        });
      }

      tokens.push({
        type: "word",
        text: match.word,
        word: match.word,
        level: match.level,
        cefrLevel: match.cefrLevel,
        cefrRank: match.cefrRank,
        frequency: match.frequency,
        meaning: match.meaning,
        partOfSpeech: match.partOfSpeech,
        definition: match.definition,
        phonetic: match.phonetic,
        sourceText: source.slice(match.start, match.end)
      });

      cursor = match.end;
    });

    if (cursor < source.length) {
      tokens.push({
        type: "text",
        text: source.slice(cursor)
      });
    }

    return tokens;
  }

  function getWordDisplayText(token) {
    if (!token || typeof token !== "object") {
      return "";
    }

    const word = String(token.word || "").trim();
    if (!word) {
      return "";
    }

    const originalText = String(token.sourceText || token.meaning || "").trim();
    if (!originalText) {
      return word;
    }

    return `${word}（${originalText}）`;
  }

  function buildMixedText(tokens) {
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return "";
    }

    return tokens
      .map((token) => {
        if (token.type === "word") {
          return getWordDisplayText(token);
        }
        return token.text || "";
      })
      .join("");
  }

  async function processSubtitle(text, settings) {
    const sourceText = String(text || "").trim();
    if (!sourceText) {
      return {
        tokens: [],
        mixedText: "",
        replacements: [],
        html: ""
      };
    }

    if (!globalScope.VocabularyModule) {
      throw new Error("VocabularyModule is required");
    }

    await globalScope.VocabularyModule.loadVocabulary();

    if (globalScope.ChineseSegmenter && typeof globalScope.ChineseSegmenter.segment === "function") {
      globalScope.ChineseSegmenter.segment(sourceText);
    }

    const normalizedSettings = normalizeSettings(settings);
    const matches = globalScope.VocabularyModule.findMatchesInText(
      sourceText,
      normalizedSettings.activeLevels
    );
    const selected = selectMatches(matches, normalizedSettings);

    const tokens = buildTokens(sourceText, selected);
    const mixedText = buildMixedText(tokens);

    const replacements = selected.map((item) => ({
      word: item.word,
      meaning: item.meaning,
      level: item.level,
      cefrLevel: item.cefrLevel,
      cefrRank: item.cefrRank,
      frequency: item.frequency,
      partOfSpeech: item.partOfSpeech,
      definition: item.definition,
      phonetic: item.phonetic
    }));

    return {
      tokens,
      mixedText,
      replacements,
      html: escapeHtml(mixedText)
    };
  }

  const api = {
    normalizeRatio,
    normalizeMaxReplaceCount,
    normalizeSettings,
    normalizeTargetCefr,
    createSettingsFingerprint,
    selectMatches,
    buildTokens,
    getWordDisplayText,
    buildMixedText,
    processSubtitle
  };

  globalScope.SubtitleTranslator = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
