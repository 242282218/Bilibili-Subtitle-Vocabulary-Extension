(function (globalScope) {
  const TOOLTIP_ID = "bili-vocab-tooltip";
  let tooltipElement = null;
  let initialized = false;

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function ensureTooltipElement() {
    if (tooltipElement) {
      return tooltipElement;
    }

    tooltipElement = document.getElementById(TOOLTIP_ID);
    if (!tooltipElement) {
      tooltipElement = document.createElement("div");
      tooltipElement.id = TOOLTIP_ID;
      tooltipElement.setAttribute("role", "tooltip");
      document.body.appendChild(tooltipElement);
    }

    return tooltipElement;
  }

  function hideTooltip() {
    const tip = ensureTooltipElement();
    tip.classList.remove("visible");
  }

  function renderTooltipContent(wordElement) {
    const word = wordElement.dataset.word || wordElement.textContent || "";
    const meaning = wordElement.dataset.meaning || "";
    const level = wordElement.dataset.level || "";
    const cefrLevel = wordElement.dataset.cefrLevel || "";
    const frequency = wordElement.dataset.frequency || "";
    const phonetic = wordElement.dataset.phonetic || "";
    const pos = wordElement.dataset.pos || "";
    const definition = wordElement.dataset.definition || "";

    const detailLine = [pos, definition || meaning].filter(Boolean).join(" ");
    const tags = [level, cefrLevel ? `CEFR ${cefrLevel}` : ""].filter(Boolean).join(" · ");
    const frequencyLabel = Number.isFinite(Number(frequency)) && Number(frequency) > 0
      ? `语料频次: ${Number(frequency).toLocaleString()}`
      : "";

    return `
      <div class="bili-vocab-tooltip-word">${escapeHtml(word)}</div>
      ${phonetic ? `<div class="bili-vocab-tooltip-phonetic">${escapeHtml(phonetic)}</div>` : ""}
      <div class="bili-vocab-tooltip-meaning">${escapeHtml(detailLine || meaning)}</div>
      ${tags ? `<div class="bili-vocab-tooltip-level">${escapeHtml(tags)}</div>` : ""}
      ${frequencyLabel ? `<div class="bili-vocab-tooltip-frequency">${escapeHtml(frequencyLabel)}</div>` : ""}
    `;
  }

  function positionTooltip(targetElement) {
    const tip = ensureTooltipElement();
    const targetRect = targetElement.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();

    let left = window.scrollX + targetRect.left + targetRect.width / 2 - tipRect.width / 2;
    let top = window.scrollY + targetRect.top - tipRect.height - 10;

    if (left < 8) {
      left = 8;
    }

    const maxLeft = window.scrollX + window.innerWidth - tipRect.width - 8;
    if (left > maxLeft) {
      left = maxLeft;
    }

    if (top < window.scrollY + 8) {
      top = window.scrollY + targetRect.bottom + 10;
    }

    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  function showTooltip(wordElement) {
    if (!(wordElement instanceof HTMLElement)) {
      return;
    }

    const tip = ensureTooltipElement();
    tip.innerHTML = renderTooltipContent(wordElement);
    tip.classList.add("visible");
    positionTooltip(wordElement);
  }

  function getWordNode(target) {
    if (!(target instanceof Element)) {
      return null;
    }
    return target.closest(".bili-vocab-word");
  }

  function handleMouseOver(event) {
    const wordNode = getWordNode(event.target);
    if (!wordNode) {
      return;
    }
    showTooltip(wordNode);
  }

  function handleMouseOut(event) {
    const fromWord = getWordNode(event.target);
    if (!fromWord) {
      return;
    }

    const toWord = getWordNode(event.relatedTarget);
    if (toWord === fromWord) {
      return;
    }

    hideTooltip();
  }

  function handleFocusIn(event) {
    const wordNode = getWordNode(event.target);
    if (!wordNode) {
      return;
    }

    showTooltip(wordNode);
  }

  function handleFocusOut(event) {
    const wordNode = getWordNode(event.target);
    if (!wordNode) {
      return;
    }

    hideTooltip();
  }

  function handleDocumentClick(event) {
    const wordNode = getWordNode(event.target);
    if (wordNode) {
      showTooltip(wordNode);
      return;
    }

    const tip = ensureTooltipElement();
    if (!tip.contains(event.target)) {
      hideTooltip();
    }
  }

  function handleEscape(event) {
    if (event.key === "Escape") {
      hideTooltip();
    }
  }

  function init() {
    if (initialized) {
      return;
    }

    ensureTooltipElement();
    document.addEventListener("mouseover", handleMouseOver, true);
    document.addEventListener("mouseout", handleMouseOut, true);
    document.addEventListener("focusin", handleFocusIn, true);
    document.addEventListener("focusout", handleFocusOut, true);
    document.addEventListener("click", handleDocumentClick, true);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", hideTooltip);
    initialized = true;
  }

  const api = {
    init,
    hideTooltip
  };

  globalScope.TooltipModule = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
