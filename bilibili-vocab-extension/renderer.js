(function (globalScope) {
  const ENHANCED_CONTAINER_CLASS = "bili-vocab-enhanced-container";
  const LEGACY_CONTAINER_CLASS = "subtitle-container";
  const YOUTUBE_WORD_CLASS = "bili-vocab-word-youtube";

  function isYouTubeHost(hostname) {
    const host = String(hostname || "").toLowerCase();
    return host === "youtube.com" || host.endsWith(".youtube.com");
  }

  function shouldUseEnhancedContainerStyle(hostname) {
    return !isYouTubeHost(hostname);
  }

  function hasClass(element, className) {
    return Boolean(
      element &&
        element.classList &&
        typeof element.classList.contains === "function" &&
        element.classList.contains(className)
    );
  }

  function hasNestedCaptionSegment(element) {
    return Boolean(
      element &&
        typeof element.querySelector === "function" &&
        element.querySelector(".ytp-caption-segment")
    );
  }

  function shouldSkipYouTubeElementRewrite(element, hostname) {
    if (!isYouTubeHost(hostname)) {
      return false;
    }

    if (!hasClass(element, "ytp-caption-segment")) {
      return true;
    }

    return hasNestedCaptionSegment(element);
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
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

  function buildWordHtml(token, originalSubtitleText) {
    const levelClass = globalScope.VocabularyModule
      ? globalScope.VocabularyModule.getLevelClass(token.level)
      : "level-cet4";
    const hostname = globalScope.location && globalScope.location.hostname;
    const siteWordClass = isYouTubeHost(hostname) ? ` ${YOUTUBE_WORD_CLASS}` : "";

    const escapedWord = escapeHtml(token.word);
    const escapedMeaning = escapeHtml(token.meaning || "");
    const escapedLevel = escapeHtml(token.level || "");
    const escapedPos = escapeHtml(token.partOfSpeech || "");
    const escapedDefinition = escapeHtml(token.definition || "");
    const escapedPhonetic = escapeHtml(token.phonetic || "");
    const escapedCefrLevel = escapeHtml(token.cefrLevel || "");
    const escapedFrequency = escapeHtml(token.frequency || "");
    const escapedSourceText = escapeHtml(token.sourceText || "");
    const escapedOriginalSubtitle = escapeHtml(originalSubtitleText || "");
    const escapedDisplayText = escapeHtml(getWordDisplayText(token) || token.word);

    return `<span class="bili-vocab-word ${levelClass}${siteWordClass}" tabindex="0" data-word="${escapedWord}" data-meaning="${escapedMeaning}" data-level="${escapedLevel}" data-cefr-level="${escapedCefrLevel}" data-frequency="${escapedFrequency}" data-pos="${escapedPos}" data-definition="${escapedDefinition}" data-phonetic="${escapedPhonetic}" data-source-text="${escapedSourceText}" data-original-subtitle="${escapedOriginalSubtitle}">${escapedDisplayText}</span>`;
  }

  function renderTokensToHtml(tokens, originalSubtitleText) {
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return "";
    }

    return tokens
      .map((token) => {
        if (!token || typeof token !== "object") {
          return "";
        }
        if (token.type === "word") {
          return buildWordHtml(token, originalSubtitleText);
        }
        return escapeHtml(token.text || "");
      })
      .join("");
  }

  function normalizeText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function restoreSubtitleElement(element, fallbackText) {
    if (typeof HTMLElement === "undefined" || !(element instanceof HTMLElement)) {
      return false;
    }

    const hostname = globalScope.location && globalScope.location.hostname;
    if (shouldSkipYouTubeElementRewrite(element, hostname)) {
      return false;
    }

    const originalText = element.dataset.biliVocabOriginalText || fallbackText || "";
    element.textContent = originalText;
    element.classList.remove(ENHANCED_CONTAINER_CLASS);
    element.classList.remove(LEGACY_CONTAINER_CLASS);
    element.dataset.biliVocabRenderedText = normalizeText(originalText);
    return true;
  }

  function renderSubtitleElement(element, translationResult, sourceText) {
    if (typeof HTMLElement === "undefined" || !(element instanceof HTMLElement)) {
      return false;
    }

    const hostname = globalScope.location && globalScope.location.hostname;
    if (shouldSkipYouTubeElementRewrite(element, hostname)) {
      return false;
    }

    const normalizedSource = String(sourceText || "");
    const html = renderTokensToHtml(translationResult && translationResult.tokens, normalizedSource);
    const mixedText =
      translationResult && typeof translationResult.mixedText === "string"
        ? translationResult.mixedText
        : normalizedSource;

    if (shouldUseEnhancedContainerStyle(hostname)) {
      element.classList.add(ENHANCED_CONTAINER_CLASS);
      element.classList.remove(LEGACY_CONTAINER_CLASS);
    } else {
      element.classList.remove(ENHANCED_CONTAINER_CLASS);
      element.classList.remove(LEGACY_CONTAINER_CLASS);
    }

    element.innerHTML = html || escapeHtml(normalizedSource);
    element.dataset.biliVocabOriginalText = normalizedSource;
    element.dataset.biliVocabRenderedText = normalizeText(mixedText);
    return true;
  }

  const api = {
    ENHANCED_CONTAINER_CLASS,
    YOUTUBE_WORD_CLASS,
    isYouTubeHost,
    shouldUseEnhancedContainerStyle,
    shouldSkipYouTubeElementRewrite,
    escapeHtml,
    renderTokensToHtml,
    renderSubtitleElement,
    restoreSubtitleElement
  };

  globalScope.SubtitleRenderer = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
