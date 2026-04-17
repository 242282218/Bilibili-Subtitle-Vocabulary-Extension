(function (globalScope) {
  const KNOWN_CHINESE_WORDS = new Set([
    '我们',
    '你们',
    '他们',
    '字幕',
    '视频',
    '系统',
    '方法',
    '结果',
    '问题',
    '设计',
    '功能',
    '市场',
    '模型',
    '策略',
    '复杂',
    '效率',
    '算法',
    '资源',
    '保持',
    '预测',
    '优化',
    '评估',
    '推导',
    '约束',
    '假设',
    '框架',
    '分析',
    '提高',
    '增强',
    '方式',
    '实现',
    '高效',
    '显著',
    '减少',
    '扩展',
    '性能',
    '创新',
    '可持续',
    '整合',
    '转变',
    '协作',
    '准确性',
    '自适应',
    '需要',
    '可以',
    '使用',
  ]);

  const MAX_WORD_LENGTH = 4;

  function splitChineseChunk(chunk) {
    const text = String(chunk || '');
    const tokens = [];
    let cursor = 0;

    while (cursor < text.length) {
      let matched = '';
      const remaining = text.length - cursor;
      const maxLength = Math.min(MAX_WORD_LENGTH, remaining);

      for (let length = maxLength; length >= 2; length -= 1) {
        const candidate = text.slice(cursor, cursor + length);
        if (KNOWN_CHINESE_WORDS.has(candidate)) {
          matched = candidate;
          break;
        }
      }

      if (!matched) {
        matched = text[cursor];
      }

      tokens.push(matched);
      cursor += matched.length;
    }

    return tokens;
  }

  function segment(text) {
    const source = String(text || '');
    if (!source.trim()) {
      return [];
    }

    const coarseTokens = source.match(/[\u4e00-\u9fff]+|[a-zA-Z]+(?:'[a-zA-Z]+)?|\d+|[^\s]/g) || [];
    const tokens = [];

    coarseTokens.forEach((token) => {
      if (/^[\u4e00-\u9fff]+$/.test(token)) {
        splitChineseChunk(token).forEach((word) => tokens.push(word));
        return;
      }
      tokens.push(token);
    });

    return tokens;
  }

  const api = {
    segment,
    splitChineseChunk,
  };

  globalScope.ChineseSegmenter = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
