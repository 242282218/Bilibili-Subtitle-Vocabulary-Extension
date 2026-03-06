const test = require("node:test");
const assert = require("node:assert/strict");

const renderer = require("../renderer.js");

function createMockElement({ classNames = [], hasNestedCaptionSegment = false } = {}) {
  return {
    classList: {
      contains(name) {
        return classNames.includes(name);
      }
    },
    querySelector(selector) {
      if (selector === ".ytp-caption-segment" && hasNestedCaptionSegment) {
        return {};
      }
      return null;
    }
  };
}

test("shouldSkipYouTubeElementRewrite: non-leaf youtube caption node should be skipped", () => {
  const element = createMockElement({ classNames: ["caption-visual-line"] });
  assert.equal(renderer.shouldSkipYouTubeElementRewrite(element, "www.youtube.com"), true);
});

test("shouldSkipYouTubeElementRewrite: youtube caption leaf node should be renderable", () => {
  const element = createMockElement({ classNames: ["ytp-caption-segment"] });
  assert.equal(renderer.shouldSkipYouTubeElementRewrite(element, "www.youtube.com"), false);
});

test("shouldSkipYouTubeElementRewrite: node with nested caption segments should be skipped", () => {
  const element = createMockElement({
    classNames: ["ytp-caption-segment"],
    hasNestedCaptionSegment: true
  });

  assert.equal(renderer.shouldSkipYouTubeElementRewrite(element, "www.youtube.com"), true);
});

test("shouldSkipYouTubeElementRewrite: non-youtube host should not be skipped", () => {
  const element = createMockElement({ classNames: ["caption-visual-line"] });
  assert.equal(renderer.shouldSkipYouTubeElementRewrite(element, "www.bilibili.com"), false);
});

test("renderTokensToHtml: should render as word with original text in parentheses", () => {
  const html = renderer.renderTokensToHtml([
    { type: "text", text: "we " },
    {
      type: "word",
      word: "optimize",
      sourceText: "improve",
      meaning: "improve",
      level: "IELTS"
    },
    { type: "text", text: " system" }
  ]);

  assert.equal(html.includes("optimize（improve）"), true);
});
