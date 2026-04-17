const test = require('node:test');
const assert = require('node:assert/strict');

const subtitleParser = require('../subtitleParser.js');

test('subtitle host guard: should match exact domain or subdomain only', () => {
  assert.equal(subtitleParser.isBilibiliHost('bilibili.com'), true);
  assert.equal(subtitleParser.isBilibiliHost('www.bilibili.com'), true);
  assert.equal(subtitleParser.isBilibiliHost('www.bilibili.com.evil'), false);
  assert.equal(subtitleParser.isBilibiliHost('evilbilibili.com'), false);

  assert.equal(subtitleParser.isYouTubeHost('youtube.com'), true);
  assert.equal(subtitleParser.isYouTubeHost('music.youtube.com'), true);
  assert.equal(subtitleParser.isYouTubeHost('youtube.com.evil'), false);
  assert.equal(subtitleParser.isYouTubeHost('evilyoutube.com'), false);
});
