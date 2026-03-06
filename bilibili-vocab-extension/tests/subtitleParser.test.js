const test = require("node:test");
const assert = require("node:assert/strict");

const subtitleParser = require("../subtitleParser.js");

test("host detection: åº”è¯†åˆ« Bilibili ä¸Ž YouTube åŸŸå", () => {
  assert.equal(subtitleParser.isBilibiliHost("www.bilibili.com"), true);
  assert.equal(subtitleParser.isBilibiliHost("www.youtube.com"), false);
  assert.equal(subtitleParser.isYouTubeHost("www.youtube.com"), true);
  assert.equal(subtitleParser.isYouTubeHost("music.youtube.com"), true);
  assert.equal(subtitleParser.isYouTubeHost("www.bilibili.com"), false);
});

test("normalizeSubtitleUrl: åº”å°†åè®®ç›¸å¯¹åœ°å€è¡¥å…¨ä¸º https", () => {
  const normalized = subtitleParser.normalizeSubtitleUrl("//aisubtitle.hdslb.com/bfs/subtitle/demo.json");
  assert.equal(normalized, "https://aisubtitle.hdslb.com/bfs/subtitle/demo.json");
});

test("pickPreferredSubtitleTrack: åº”ä¼˜å…ˆé€‰æ‹©ç®€ä½“ä¸­æ–‡å­—å¹•è½¨é“", () => {
  const selected = subtitleParser.pickPreferredSubtitleTrack([
    { lan: "en-US", subtitle_url: "https://example.com/en.json" },
    { lan: "zh-Hans", subtitle_url: "https://example.com/zh-hans.json" },
    { lan: "zh-CN", subtitle_url: "https://example.com/zh-cn.json" }
  ]);

  assert.ok(selected);
  assert.equal(selected.lan, "zh-Hans");
});

test("findSubtitleByTime: åº”æŒ‰è§†é¢‘æ—¶é—´å‘½ä¸­æ­£ç¡®å­—å¹•åˆ†æ®µ", () => {
  const body = [
    { from: 0, to: 1.9, content: "ç¬¬ä¸€å¥" },
    { from: 2.0, to: 4.5, content: "ç¬¬äºŒå¥" }
  ];

  const matched = subtitleParser.findSubtitleByTime(body, 3.2);
  assert.ok(matched);
  assert.equal(matched.content, "ç¬¬äºŒå¥");
});

function createNode(parent = null) {
  return {
    parent,
    contains(target) {
      let cursor = target;
      while (cursor) {
        if (cursor === this) {
          return true;
        }
        cursor = cursor.parent || null;
      }
      return false;
    }
  };
}

test("addElementByContainment: ×Ó½Úµã³öÏÖÊ±Ó¦Ìæ»»ÒÑÊÕ¼¯µÄ¸¸½Úµã", () => {
  const parent = createNode();
  const child = createNode(parent);
  const collected = [parent];

  const added = subtitleParser.addElementByContainment(child, collected);

  assert.equal(added, true);
  assert.deepEqual(collected, [child]);
});

test("addElementByContainment: ¸¸½Úµãºó³öÏÖÊ±²»Ó¦¸²¸ÇÒÑÊÕ¼¯×Ó½Úµã", () => {
  const parent = createNode();
  const child = createNode(parent);
  const collected = [child];

  const added = subtitleParser.addElementByContainment(parent, collected);

  assert.equal(added, false);
  assert.deepEqual(collected, [child]);
});
