(function (globalScope) {
  const DEFAULT_SETTINGS = {
    enabled: true,
    schemaVersion: 2,
    reviewDanmakuEnabled: false,
    reviewDanmakuSpeed: 'normal',
    webPageEnabled: true,
    domainRules: {},
    vocabularyMode: 'core',
    examPreference: 'balanced',
    activeLevels: ['CET4', 'CET6', 'KAOYAN', 'IELTS', 'TOEFL'],
    replaceRatio: 0.2,
    maxReplaceCount: 2,
    targetCefr: 'B2',
    overlayPanelHidden: false,
    overlayPanelCollapsed: false,
    overlayPanelWidth: 420,
    overlayPanelHeight: 640,
    overlayPanelOffsetRight: 24,
    overlayPanelOffsetBottom: 96,
  };
  const sharedSettings =
    globalScope.SharedSettings ||
    (typeof require === 'function' ? require('./sharedSettings.js') : null);
  const learningState =
    globalScope.LearningState ||
    (typeof require === 'function' ? require('./learningState.js') : null);
  const uiStateMachine =
    globalScope.SettingsUiStateMachine ||
    (typeof require === 'function' ? require('./settingsUiStateMachine.js') : null);

  const OVERLAY_MIN_WIDTH = 320;
  const OVERLAY_MAX_WIDTH = 560;
  const OVERLAY_MIN_HEIGHT = 360;
  const OVERLAY_MAX_HEIGHT = 760;
  const OVERLAY_MIN_OFFSET_RIGHT = 12;
  const OVERLAY_MAX_OFFSET_RIGHT = 360;
  const OVERLAY_MIN_OFFSET_BOTTOM = 24;
  const OVERLAY_MAX_OFFSET_BOTTOM = 240;
  const PANEL_DRAG_THRESHOLD = 4;
  const RESIZE_STORAGE_KEYS = [
    'overlayPanelWidth',
    'overlayPanelHeight',
    'overlayPanelCollapsed',
    'overlayPanelHidden',
    'overlayPanelOffsetRight',
    'overlayPanelOffsetBottom',
  ];
  const OVERLAY_INSTANCE_KEY = '__BILI_VOCAB_OVERLAY_INSTANCE__';

  if (sharedSettings) {
    Object.assign(DEFAULT_SETTINGS, sharedSettings.DEFAULT_SETTINGS);
  }
  const LEARNING_STATE_KEYS = learningState
    ? learningState.STORAGE_KEYS
    : {
        WORD_STATS_V2: 'bili_vocab_word_stats_v2',
        REVIEW_QUEUE: 'bili_vocab_review_queue_v1',
        LEARNING_SUMMARY: 'bili_vocab_learning_summary_v1',
      };

  function clampOverlayWidth(value) {
    const width = Number(value);
    if (!Number.isFinite(width)) {
      return DEFAULT_SETTINGS.overlayPanelWidth;
    }
    return Math.min(OVERLAY_MAX_WIDTH, Math.max(OVERLAY_MIN_WIDTH, Math.round(width)));
  }

  function clampOverlayHeight(value) {
    const height = Number(value);
    if (!Number.isFinite(height)) {
      return DEFAULT_SETTINGS.overlayPanelHeight;
    }
    return Math.min(OVERLAY_MAX_HEIGHT, Math.max(OVERLAY_MIN_HEIGHT, Math.round(height)));
  }

  function clampOverlayOffsetRight(value) {
    const offset = Number(value);
    if (!Number.isFinite(offset)) {
      return DEFAULT_SETTINGS.overlayPanelOffsetRight;
    }
    return Math.min(
      OVERLAY_MAX_OFFSET_RIGHT,
      Math.max(OVERLAY_MIN_OFFSET_RIGHT, Math.round(offset))
    );
  }

  function clampOverlayOffsetBottom(value) {
    const offset = Number(value);
    if (!Number.isFinite(offset)) {
      return DEFAULT_SETTINGS.overlayPanelOffsetBottom;
    }
    return Math.min(
      OVERLAY_MAX_OFFSET_BOTTOM,
      Math.max(OVERLAY_MIN_OFFSET_BOTTOM, Math.round(offset))
    );
  }

  function normalizeTargetCefr(value) {
    if (sharedSettings) {
      return sharedSettings.normalizeTargetCefr(value);
    }

    const targetCefr = String(value || DEFAULT_SETTINGS.targetCefr)
      .trim()
      .toUpperCase();
    return ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].includes(targetCefr)
      ? targetCefr
      : DEFAULT_SETTINGS.targetCefr;
  }

  function normalizeReviewDanmakuSpeed(value) {
    if (sharedSettings) {
      return sharedSettings.normalizeReviewDanmakuSpeed(value);
    }

    const normalized = String(value || DEFAULT_SETTINGS.reviewDanmakuSpeed)
      .trim()
      .toLowerCase();
    return ['slow', 'normal', 'fast'].includes(normalized)
      ? normalized
      : DEFAULT_SETTINGS.reviewDanmakuSpeed;
  }

  function getReviewDanmakuSpeedLabel(speed) {
    if (sharedSettings) {
      return sharedSettings.getReviewDanmakuSpeedLabel(speed);
    }

    const preset = normalizeReviewDanmakuSpeed(speed);
    if (preset === 'slow') {
      return '慢';
    }
    if (preset === 'fast') {
      return '快';
    }
    return '标准';
  }

  function getLearningProfile(settings) {
    const normalized = normalizeOverlaySettings(settings);
    if (!normalized.enabled) {
      return {
        tone: 'gentle',
        label: '轻量待机',
        summary: '当前未启用，可随时恢复温和输入',
      };
    }

    if (normalized.replaceRatio >= 0.25 || normalized.maxReplaceCount >= 4) {
      return {
        tone: 'intensive',
        label: '强化曝光',
        summary: '更适合复看熟悉内容后做集中刷词和冲刺记忆',
      };
    }

    if (normalized.replaceRatio <= 0.15 && normalized.maxReplaceCount <= 2) {
      return {
        tone: 'gentle',
        label: '轻量输入',
        summary: '更偏低干扰输入，适合首次观看或新主题适应',
      };
    }

    return {
      tone: 'balanced',
      label: '均衡输入',
      summary: '兼顾剧情理解和稳定词汇曝光，适合日常长期使用',
    };
  }

  function getAutoSaveStatusMessage(saved) {
    return saved ? '已自动保存' : '等待保存';
  }

  function getPresetSettings(mode) {
    if (sharedSettings) {
      const mappedMode = mode === 'gentle' ? 'light' : mode;
      const preset = sharedSettings.SCENE_PRESETS[mappedMode];
      if (preset) {
        return {
          ...preset,
          replaceRatio: mode === 'intensive' ? 0.25 : preset.replaceRatio,
        };
      }
    }

    if (mode === 'gentle') {
      return {
        replaceRatio: 0.15,
        maxReplaceCount: 1,
        reviewDanmakuSpeed: 'slow',
      };
    }

    if (mode === 'intensive') {
      return {
        replaceRatio: 0.25,
        maxReplaceCount: 4,
        reviewDanmakuSpeed: 'fast',
      };
    }

    return {
      replaceRatio: 0.2,
      maxReplaceCount: 2,
      reviewDanmakuSpeed: 'normal',
    };
  }

  function getMockSubtitlePreview(settings) {
    const normalized = normalizeOverlaySettings(settings);
    if (!normalized.enabled) {
      return '预览：当前处于待机状态，字幕会保持原样显示。';
    }

    if (sharedSettings) {
      const selected = sharedSettings.getMockPreviewData(
        normalized.targetCefr,
        normalized.replaceRatio,
        normalized.maxReplaceCount
      );
      const [first = 'system', second = 'vocabulary', third = 'context'] = selected;
      return `预览：这段视频会帮你 ${first} 稳定的 ${second}${selected[2] ? ` 与 ${third}` : ''} 输入节奏。`;
    }

    const presetMap = {
      A1: ['learn', 'watch', 'word'],
      A2: ['improve', 'listen', 'memory'],
      B1: ['build', 'focus', 'exposure'],
      B2: ['system', 'vocabulary', 'context'],
      C1: ['establish', 'retention', 'comprehension'],
      C2: ['internalize', 'lexicon', 'fluency'],
    };
    const words = presetMap[normalized.targetCefr] || presetMap.B2;
    const density = normalized.replaceRatio >= 0.25 ? 3 : normalized.replaceRatio <= 0.15 ? 1 : 2;
    const count = Math.min(
      words.length,
      Math.max(1, Math.min(normalized.maxReplaceCount, density))
    );
    const selected = words.slice(0, count);
    const [first = 'system', second = 'vocabulary', third = 'context'] = selected;
    return `预览：这段视频会帮你 ${first} 稳定的 ${second}${selected[2] ? ` 与 ${third}` : ''} 输入节奏。`;
  }

  function normalizeOverlaySettings(settings) {
    const source = { ...DEFAULT_SETTINGS, ...(settings || {}) };
    const normalizedShared = sharedSettings ? sharedSettings.normalizeSettings(source) : null;
    return {
      enabled: normalizedShared ? normalizedShared.enabled : source.enabled !== false,
      reviewDanmakuEnabled: source.reviewDanmakuEnabled === true,
      reviewDanmakuSpeed: normalizedShared
        ? normalizedShared.reviewDanmakuSpeed
        : normalizeReviewDanmakuSpeed(source.reviewDanmakuSpeed),
      vocabularyMode: normalizedShared
        ? normalizedShared.vocabularyMode
        : DEFAULT_SETTINGS.vocabularyMode,
      examPreference: normalizedShared
        ? normalizedShared.examPreference
        : DEFAULT_SETTINGS.examPreference,
      activeLevels: normalizedShared
        ? normalizedShared.activeLevels.slice()
        : Array.isArray(source.activeLevels) && source.activeLevels.length
          ? source.activeLevels.slice()
          : DEFAULT_SETTINGS.activeLevels.slice(),
      replaceRatio: normalizedShared
        ? normalizedShared.replaceRatio
        : Math.min(
            0.3,
            Math.max(0.1, Number(source.replaceRatio) || DEFAULT_SETTINGS.replaceRatio)
          ),
      maxReplaceCount: normalizedShared
        ? normalizedShared.maxReplaceCount
        : Math.min(
            5,
            Math.max(
              1,
              Math.floor(Number(source.maxReplaceCount) || DEFAULT_SETTINGS.maxReplaceCount)
            )
          ),
      targetCefr: normalizedShared
        ? normalizedShared.targetCefr
        : normalizeTargetCefr(source.targetCefr),
      overlayPanelHidden: source.overlayPanelHidden === true,
      overlayPanelCollapsed: source.overlayPanelCollapsed === true,
      overlayPanelWidth: clampOverlayWidth(source.overlayPanelWidth),
      overlayPanelHeight: clampOverlayHeight(source.overlayPanelHeight),
      overlayPanelOffsetRight: clampOverlayOffsetRight(source.overlayPanelOffsetRight),
      overlayPanelOffsetBottom: clampOverlayOffsetBottom(source.overlayPanelOffsetBottom),
    };
  }

  function getOverlaySettingsPreview(settings) {
    const normalized = normalizeOverlaySettings(settings);
    if (!normalized.enabled) {
      return '当前字幕替换处于关闭状态。重新启用后，悬浮控制台会继续按你的学习节奏进行词汇曝光。';
    }

    if (sharedSettings) {
      return sharedSettings.buildSettingsPreview(normalized);
    }

    const modeLabel = normalized.vocabularyMode === 'core' ? '核心高频' : '全量扩展';
    const preferenceLabel = normalized.examPreference === 'exam-first' ? '考试优先' : '均衡筛选';
    return `当前会在每句字幕中替换约 ${Math.round(normalized.replaceRatio * 100)}% 的词汇，单句最多 ${normalized.maxReplaceCount} 个词，帮助你以 ${normalized.targetCefr} 难度并结合 ${normalized.activeLevels.length} 个词库持续曝光；词库模式为${modeLabel}，筛选策略为${preferenceLabel}，复习节奏为${getReviewDanmakuSpeedLabel(normalized.reviewDanmakuSpeed)}。`;
  }

  function getLearningStatusLabel(status) {
    if (learningState && typeof learningState.getStatusLabel === 'function') {
      return learningState.getStatusLabel(status);
    }

    const normalized = String(status || '')
      .trim()
      .toLowerCase();
    if (normalized === 'saved') {
      return '已收藏';
    }
    if (normalized === 'mastered') {
      return '已掌握';
    }
    if (normalized === 'seen' || normalized === 'learning' || normalized === 'reviewing') {
      return '已遇见';
    }
    if (normalized === 'unseen' || normalized === 'new') {
      return '未巩固';
    }
    if (normalized === 'skipped') {
      return '已跳过';
    }
    return '待判断';
  }

  function getReviewBucketLabel(bucket) {
    if (learningState && typeof learningState.getReviewBucketLabel === 'function') {
      return learningState.getReviewBucketLabel(bucket);
    }

    const normalized = String(bucket || '')
      .trim()
      .toLowerCase();
    if (normalized === 'soon') {
      return '即将复习';
    }
    if (normalized === 'later') {
      return '后续回顾';
    }
    return '今日优先';
  }

  function normalizeReviewTimestamp(value) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      return null;
    }
    return Math.floor(timestamp);
  }

  function formatReviewDueText(nextReviewAt, now = Date.now()) {
    const dueAt = normalizeReviewTimestamp(nextReviewAt);
    const current = normalizeReviewTimestamp(now) || Date.now();
    if (dueAt == null) {
      return '时间待定';
    }

    const delta = dueAt - current;
    if (delta <= 0) {
      return '现在复习';
    }

    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (delta < hour) {
      const minutes = Math.max(1, Math.round(delta / minute));
      return `${minutes} 分钟后`;
    }
    if (delta < day) {
      const hours = Math.max(1, Math.round(delta / hour));
      return `${hours} 小时后`;
    }
    const days = Math.max(1, Math.round(delta / day));
    return `${days} 天后`;
  }

  function buildLearningSnapshot(summary, queue, index = 0, now = Date.now()) {
    const normalizedSummary = summary && typeof summary === 'object' ? summary : {};
    const items = Array.isArray(queue)
      ? queue
          .map((item) => {
            if (!item || typeof item !== 'object') {
              return null;
            }

            const word = String(item.word || '').trim();
            if (!word) {
              return null;
            }

            return {
              word,
              translation: String(item.translation || '').trim(),
              level: String(item.level || '')
                .trim()
                .toUpperCase(),
              dueBucket: String(item.dueBucket || '')
                .trim()
                .toLowerCase(),
              nextReviewAt: normalizeReviewTimestamp(item.nextReviewAt),
              status: String(item.status || '')
                .trim()
                .toLowerCase(),
            };
          })
          .filter(Boolean)
      : [];
    const safeIndex = items.length ? Math.max(0, index % items.length) : 0;
    const currentItem = items[safeIndex] || null;

    if (!currentItem) {
      return {
        headline: `今日待复习 ${Math.max(0, Math.floor(Number(normalizedSummary.todayCount) || 0))}`,
        newCount: String(Math.max(0, Math.floor(Number(normalizedSummary.newCount) || 0))),
        masteredCount: String(
          Math.max(0, Math.floor(Number(normalizedSummary.masteredCount) || 0))
        ),
        currentWord: '当前没有待复习词',
        currentMeta: '继续观看带字幕的视频后，这里会出现当前最优先回顾词。',
        currentDescription: '继续观看带字幕的视频，系统会把新命中的词自动加入复习池。',
        empty: true,
        currentWordKey: '',
      };
    }

    return {
      headline: `今日待复习 ${Math.max(0, Math.floor(Number(normalizedSummary.todayCount) || 0))}`,
      newCount: String(Math.max(0, Math.floor(Number(normalizedSummary.newCount) || 0))),
      masteredCount: String(Math.max(0, Math.floor(Number(normalizedSummary.masteredCount) || 0))),
      currentWord: `${currentItem.word} · ${currentItem.translation || '-'}`,
      currentMeta: `${currentItem.level || 'WORD'} · ${getReviewBucketLabel(currentItem.dueBucket)} · ${formatReviewDueText(currentItem.nextReviewAt, now)} · 当前状态 ${getLearningStatusLabel(currentItem.status)}`,
      currentDescription: '直接在视频内标记认识、模糊或不认识，后续排序会立即跟上你的判断。',
      empty: false,
      currentWordKey: String(currentItem.word || ''),
    };
  }

  function createOverlayPanel() {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return null;
    }

    const existing = document.getElementById('bili-vocab-overlay-panel');
    if (existing) {
      return existing;
    }

    const panel = document.createElement('aside');
    panel.id = 'bili-vocab-overlay-panel';
    panel.className = 'bili-vocab-overlay';
    panel.innerHTML = `
      <div class="bili-vocab-overlay__ambient" aria-hidden="true">
        <span class="bili-vocab-overlay__glow bili-vocab-overlay__glow--violet"></span>
        <span class="bili-vocab-overlay__glow bili-vocab-overlay__glow--cyan"></span>
        <span class="bili-vocab-overlay__gridline"></span>
      </div>
      <div class="bili-vocab-overlay__header" data-drag-handle="true">
        <div class="bili-vocab-overlay__brand-block">
          <div class="bili-vocab-overlay__eyebrow">字幕学习控制台</div>
          <div class="bili-vocab-overlay__title-row">
            <strong class="bili-vocab-overlay__title">Bilibili Vocabulary</strong>
            <span id="biliVocabOverlayBadge" class="bili-vocab-overlay__badge">未启用</span>
          </div>
          <div id="biliVocabOverlayHeroCaption" class="bili-vocab-overlay__hero-caption">让字幕替换、词库难度和复习节奏在观看过程中保持同步。</div>
        </div>
        <div class="bili-vocab-overlay__actions">
          <button id="biliVocabOverlayCollapse" class="bili-vocab-overlay__icon-button" type="button" aria-label="折叠面板">−</button>
          <button id="biliVocabOverlayHide" class="bili-vocab-overlay__icon-button" type="button" aria-label="隐藏面板">×</button>
        </div>
      </div>
      <div class="bili-vocab-overlay__hero-card">
        <div class="bili-vocab-overlay__hero-topline">
          <span class="bili-vocab-overlay__hero-kicker">Learning Mode</span>
          <span id="biliVocabOverlayModeTag" class="bili-vocab-overlay__mode-tag">均衡输入</span>
        </div>
        <div class="bili-vocab-overlay__preset-row" aria-label="学习预设">
          <button type="button" class="bili-vocab-overlay__preset-button" data-preset-mode="gentle">轻量输入</button>
          <button type="button" class="bili-vocab-overlay__preset-button" data-preset-mode="balanced">均衡输入</button>
          <button type="button" class="bili-vocab-overlay__preset-button" data-preset-mode="intensive">强化曝光</button>
        </div>
        <div id="biliVocabOverlayPreview" class="bili-vocab-overlay__preview"></div>
        <div id="biliVocabOverlayMockPreview" class="bili-vocab-overlay__mock-preview">预览：这段视频会帮你 system 稳定的 vocabulary 输入节奏。</div>
        <div id="biliVocabOverlayStrategyNote" class="bili-vocab-overlay__strategy-note">兼顾剧情理解和稳定词汇曝光，适合日常长期使用。</div>
        <div class="bili-vocab-overlay__metrics">
          <div class="bili-vocab-overlay__metric bili-vocab-overlay__metric--accent">
            <span class="bili-vocab-overlay__metric-label">替换强度</span>
            <strong id="biliVocabOverlayRatioValue">20%</strong>
          </div>
          <div class="bili-vocab-overlay__metric">
            <span class="bili-vocab-overlay__metric-label">目标难度</span>
            <strong id="biliVocabOverlayHeroCefr">B2</strong>
          </div>
          <div class="bili-vocab-overlay__metric">
            <span class="bili-vocab-overlay__metric-label">复习节奏</span>
            <strong id="biliVocabOverlayHeroReviewSpeed">标准</strong>
          </div>
        </div>
      </div>
      <div class="bili-vocab-overlay__body">
        <section class="bili-vocab-overlay__section bili-vocab-overlay__section--primary">
          <div class="bili-vocab-overlay__section-head">
            <div>
              <div class="bili-vocab-overlay__section-title">核心控制</div>
              <div class="bili-vocab-overlay__section-desc">最常调整的替换策略都放在这里，适合边看边微调。</div>
            </div>
            <span class="bili-vocab-overlay__section-pill">Live</span>
          </div>
          <label class="bili-vocab-overlay__switch-row">
            <span>
              <span class="bili-vocab-overlay__label">启用字幕词汇替换</span>
              <span class="bili-vocab-overlay__hint">立即控制当前视频页是否进行词汇替换</span>
            </span>
            <input id="biliVocabOverlayEnabled" type="checkbox" />
          </label>
          <label class="bili-vocab-overlay__field bili-vocab-overlay__field--range">
            <span class="bili-vocab-overlay__field-head">
              <span class="bili-vocab-overlay__label">替换比例</span>
              <span id="biliVocabOverlayRatioInlineValue" class="bili-vocab-overlay__value-pill">20%</span>
            </span>
            <input id="biliVocabOverlayRatio" type="range" min="0.1" max="0.3" step="0.05" />
          </label>
          <div class="bili-vocab-overlay__grid">
            <label class="bili-vocab-overlay__field">
              <span class="bili-vocab-overlay__label">单句上限</span>
              <input id="biliVocabOverlayMaxReplace" type="number" min="1" max="5" step="1" />
            </label>
            <label class="bili-vocab-overlay__field">
              <span class="bili-vocab-overlay__label">目标 CEFR</span>
              <select id="biliVocabOverlayCefr">
                <option value="A1">A1</option>
                <option value="A2">A2</option>
                <option value="B1">B1</option>
                <option value="B2">B2</option>
                <option value="C1">C1</option>
                <option value="C2">C2</option>
              </select>
            </label>
          </div>
        </section>
        <section class="bili-vocab-overlay__section">
          <div class="bili-vocab-overlay__section-head">
            <div>
              <div class="bili-vocab-overlay__section-title">策略与词库</div>
              <div class="bili-vocab-overlay__section-desc">把复习节拍和目标词库组合成更贴合你当前阶段的输入方案。</div>
            </div>
            <span id="biliVocabOverlayLevelsSummary" class="bili-vocab-overlay__section-meta">已选择 5 个词库</span>
          </div>
          <label class="bili-vocab-overlay__field">
            <span class="bili-vocab-overlay__label">复习弹幕速度</span>
            <select id="biliVocabOverlayReviewSpeed">
              <option value="slow">慢</option>
              <option value="normal">标准</option>
              <option value="fast">快</option>
            </select>
          </label>
          <div class="bili-vocab-overlay__grid">
            <label class="bili-vocab-overlay__field">
              <span class="bili-vocab-overlay__label">词库模式</span>
              <select id="biliVocabOverlayVocabularyMode">
                <option value="core">核心高频</option>
                <option value="full">全量扩展</option>
              </select>
            </label>
            <label class="bili-vocab-overlay__field">
              <span class="bili-vocab-overlay__label">筛选策略</span>
              <select id="biliVocabOverlayExamPreference">
                <option value="balanced">均衡筛选</option>
                <option value="exam-first">考试优先</option>
              </select>
            </label>
          </div>
          <fieldset class="bili-vocab-overlay__field bili-vocab-overlay__levels">
            <legend class="bili-vocab-overlay__label">激活词库</legend>
            <div class="bili-vocab-overlay__chips">
              <label><input type="checkbox" name="biliVocabOverlayLevels" value="CET4" /> <span>CET4</span></label>
              <label><input type="checkbox" name="biliVocabOverlayLevels" value="CET6" /> <span>CET6</span></label>
              <label><input type="checkbox" name="biliVocabOverlayLevels" value="KAOYAN" /> <span>考研</span></label>
              <label><input type="checkbox" name="biliVocabOverlayLevels" value="IELTS" /> <span>IELTS</span></label>
              <label><input type="checkbox" name="biliVocabOverlayLevels" value="TOEFL" /> <span>TOEFL</span></label>
            </div>
          </fieldset>
        </section>
        <section class="bili-vocab-overlay__section bili-vocab-overlay__section--learning">
          <div class="bili-vocab-overlay__section-head">
            <div>
              <div class="bili-vocab-overlay__section-title">今日学习反馈</div>
              <div class="bili-vocab-overlay__section-desc">边看边确认今天的待复习词，让学习闭环留在视频内完成。</div>
            </div>
            <span id="biliVocabOverlayReviewHeadline" class="bili-vocab-overlay__section-pill">今日待复习 0</span>
          </div>
          <div class="bili-vocab-overlay__learning-grid">
            <div class="bili-vocab-overlay__learning-stat">
              <span class="bili-vocab-overlay__learning-stat-label">新词</span>
              <strong id="biliVocabOverlayNewCount" class="bili-vocab-overlay__learning-stat-value">0</strong>
            </div>
            <div class="bili-vocab-overlay__learning-stat">
              <span class="bili-vocab-overlay__learning-stat-label">已掌握</span>
              <strong id="biliVocabOverlayMasteredCount" class="bili-vocab-overlay__learning-stat-value">0</strong>
            </div>
          </div>
          <div class="bili-vocab-overlay__review-card">
            <div class="bili-vocab-overlay__review-card-head">
              <span class="bili-vocab-overlay__review-card-label">本轮优先词</span>
              <button id="biliVocabOverlayReviewRefresh" class="bili-vocab-overlay__ghost-button" type="button">换一个</button>
            </div>
            <div id="biliVocabOverlayReviewWord" class="bili-vocab-overlay__review-word">当前没有待复习词</div>
            <div id="biliVocabOverlayReviewMeta" class="bili-vocab-overlay__review-meta">继续观看带字幕的视频后，这里会出现当前最优先回顾词。</div>
            <div id="biliVocabOverlayReviewDescription" class="bili-vocab-overlay__review-description">继续观看带字幕的视频，系统会把新命中的词自动加入复习池。</div>
            <div class="bili-vocab-overlay__action-row">
              <button id="biliVocabOverlayReviewKnow" class="bili-vocab-overlay__ghost-button" type="button">认识</button>
              <button id="biliVocabOverlayReviewFuzzy" class="bili-vocab-overlay__ghost-button" type="button">模糊</button>
              <button id="biliVocabOverlayReviewDontKnow" class="bili-vocab-overlay__ghost-button" type="button">不认识</button>
            </div>
          </div>
        </section>
        <div class="bili-vocab-overlay__footer">
          <div class="bili-vocab-overlay__footer-copy">
            <div class="bili-vocab-overlay__footer-title">应用到当前观看流</div>
            <span id="biliVocabOverlayAutoSaveState" class="bili-vocab-overlay__status">等待保存</span>
            <span id="biliVocabOverlayStatus" class="bili-vocab-overlay__status" aria-live="polite"></span>
          </div>
          <button id="biliVocabOverlaySave" class="bili-vocab-overlay__save" type="button">保存并应用</button>
        </div>
      </div>
      <button id="biliVocabOverlayResize" class="bili-vocab-overlay__resize" type="button" aria-label="调整面板大小"></button>
    `;

    const trigger = document.createElement('button');
    trigger.id = 'bili-vocab-overlay-trigger';
    trigger.className = 'bili-vocab-overlay-trigger';
    trigger.type = 'button';
    trigger.textContent = '学习面板';
    trigger.hidden = true;

    document.body.appendChild(panel);
    document.body.appendChild(trigger);

    return panel;
  }

  function getMountedOverlayInstance() {
    const candidate = globalScope[OVERLAY_INSTANCE_KEY];
    if (!candidate || typeof candidate !== 'object') {
      return null;
    }

    const panel = candidate.panel;
    if (panel && panel.isConnected === false) {
      globalScope[OVERLAY_INSTANCE_KEY] = null;
      return null;
    }

    return candidate;
  }

  function mountOverlayPanel() {
    const mountedInstance = getMountedOverlayInstance();
    if (mountedInstance) {
      return mountedInstance;
    }

    const panel = createOverlayPanel();
    if (!panel) {
      return null;
    }

    const trigger = document.getElementById('bili-vocab-overlay-trigger');
    const enabledInput = document.getElementById('biliVocabOverlayEnabled');
    const ratioInput = document.getElementById('biliVocabOverlayRatio');
    const ratioValue = document.getElementById('biliVocabOverlayRatioValue');
    const ratioInlineValue = document.getElementById('biliVocabOverlayRatioInlineValue');
    const heroCefr = document.getElementById('biliVocabOverlayHeroCefr');
    const heroReviewSpeed = document.getElementById('biliVocabOverlayHeroReviewSpeed');
    const modeTag = document.getElementById('biliVocabOverlayModeTag');
    const heroCaption = document.getElementById('biliVocabOverlayHeroCaption');
    const strategyNote = document.getElementById('biliVocabOverlayStrategyNote');
    const mockPreviewNode = document.getElementById('biliVocabOverlayMockPreview');
    const levelsSummary = document.getElementById('biliVocabOverlayLevelsSummary');
    const autoSaveStateNode = document.getElementById('biliVocabOverlayAutoSaveState');
    const maxReplaceInput = document.getElementById('biliVocabOverlayMaxReplace');
    const cefrInput = document.getElementById('biliVocabOverlayCefr');
    const reviewSpeedInput = document.getElementById('biliVocabOverlayReviewSpeed');
    const vocabularyModeInput = document.getElementById('biliVocabOverlayVocabularyMode');
    const examPreferenceInput = document.getElementById('biliVocabOverlayExamPreference');
    const reviewHeadlineNode = document.getElementById('biliVocabOverlayReviewHeadline');
    const reviewNewCountNode = document.getElementById('biliVocabOverlayNewCount');
    const reviewMasteredCountNode = document.getElementById('biliVocabOverlayMasteredCount');
    const reviewWordNode = document.getElementById('biliVocabOverlayReviewWord');
    const reviewMetaNode = document.getElementById('biliVocabOverlayReviewMeta');
    const reviewDescriptionNode = document.getElementById('biliVocabOverlayReviewDescription');
    const reviewRefreshButton = document.getElementById('biliVocabOverlayReviewRefresh');
    const reviewKnowButton = document.getElementById('biliVocabOverlayReviewKnow');
    const reviewFuzzyButton = document.getElementById('biliVocabOverlayReviewFuzzy');
    const reviewDontKnowButton = document.getElementById('biliVocabOverlayReviewDontKnow');
    const presetButtons = Array.from(panel.querySelectorAll('[data-preset-mode]'));
    const previewNode = document.getElementById('biliVocabOverlayPreview');
    const badgeNode = document.getElementById('biliVocabOverlayBadge');
    const statusNode = document.getElementById('biliVocabOverlayStatus');
    const saveButton = document.getElementById('biliVocabOverlaySave');
    const collapseButton = document.getElementById('biliVocabOverlayCollapse');
    const hideButton = document.getElementById('biliVocabOverlayHide');
    const resizeHandle = document.getElementById('biliVocabOverlayResize');

    let current = normalizeOverlaySettings(DEFAULT_SETTINGS);
    let autoSaveTimer = null;
    let reviewCursor = 0;
    let learningSnapshot = buildLearningSnapshot(null, []);
    const uiStateController =
      uiStateMachine && typeof uiStateMachine.createStateController === 'function'
        ? uiStateMachine.createStateController('idle')
        : null;

    function getLevelInputs() {
      return Array.from(document.querySelectorAll('input[name="biliVocabOverlayLevels"]'));
    }

    function collectLevels() {
      const checked = getLevelInputs()
        .filter((input) => input.checked)
        .map((input) => input.value);
      return checked.length ? checked : DEFAULT_SETTINGS.activeLevels.slice();
    }

    function buildPreviewSettings() {
      return normalizeOverlaySettings({
        ...current,
        enabled: enabledInput.checked,
        replaceRatio: ratioInput.value,
        maxReplaceCount: maxReplaceInput.value,
        targetCefr: cefrInput.value,
        reviewDanmakuSpeed: reviewSpeedInput.value,
        vocabularyMode: vocabularyModeInput ? vocabularyModeInput.value : current.vocabularyMode,
        examPreference: examPreferenceInput ? examPreferenceInput.value : current.examPreference,
        activeLevels: collectLevels(),
      });
    }

    function getLearningSummaryData() {
      if (
        !globalScope.VocabularyModule ||
        typeof globalScope.VocabularyModule.getLearningSummary !== 'function'
      ) {
        return {
          todayCount: 0,
          newCount: 0,
          masteredCount: 0,
        };
      }

      return globalScope.VocabularyModule.getLearningSummary();
    }

    function getReviewQueueData() {
      if (
        !globalScope.VocabularyModule ||
        typeof globalScope.VocabularyModule.getReviewQueue !== 'function'
      ) {
        return [];
      }

      return globalScope.VocabularyModule.getReviewQueue(5);
    }

    function renderLearningSnapshot(snapshot) {
      learningSnapshot = snapshot;

      if (reviewHeadlineNode) {
        reviewHeadlineNode.textContent = snapshot.headline;
      }
      if (reviewNewCountNode) {
        reviewNewCountNode.textContent = snapshot.newCount;
      }
      if (reviewMasteredCountNode) {
        reviewMasteredCountNode.textContent = snapshot.masteredCount;
      }
      if (reviewWordNode) {
        reviewWordNode.textContent = snapshot.currentWord;
      }
      if (reviewMetaNode) {
        reviewMetaNode.textContent = snapshot.currentMeta;
      }
      if (reviewDescriptionNode) {
        reviewDescriptionNode.textContent = snapshot.currentDescription;
      }

      const actionButtons = [reviewKnowButton, reviewFuzzyButton, reviewDontKnowButton];
      actionButtons.forEach((button) => {
        if (button) {
          button.disabled = snapshot.empty;
        }
      });
      if (reviewRefreshButton) {
        reviewRefreshButton.disabled = snapshot.empty;
      }
    }

    function refreshLearningInsights(resetCursor = false) {
      const queue = getReviewQueueData();
      if (resetCursor || reviewCursor >= queue.length) {
        reviewCursor = 0;
      }
      renderLearningSnapshot(buildLearningSnapshot(getLearningSummaryData(), queue, reviewCursor));
    }

    async function handleReviewFeedback(feedback) {
      if (learningSnapshot.empty || !learningSnapshot.currentWordKey) {
        return;
      }

      if (!globalScope.VocabularyModule) {
        return;
      }

      const currentWordKey = learningSnapshot.currentWordKey;
      const hasApplyLearningAction =
        typeof globalScope.VocabularyModule.applyLearningAction === 'function';
      const hasReviewWord = typeof globalScope.VocabularyModule.reviewWord === 'function';
      const nextRecord = hasApplyLearningAction
        ? await globalScope.VocabularyModule.applyLearningAction(currentWordKey, feedback)
        : hasReviewWord
          ? await globalScope.VocabularyModule.reviewWord(currentWordKey, feedback)
          : null;
      if (!nextRecord) {
        setStatus('复习结果保存失败，请重试');
        return;
      }

      reviewCursor = 0;
      refreshLearningInsights(true);

      const actionText =
        feedback === 'know'
          ? '已标记为认识'
          : feedback === 'fuzzy'
            ? '已标记为模糊'
            : '已标记为不认识';
      setStatus(`${currentWordKey} · ${actionText}`);
    }

    function updateAutoSaveState(savedOrState) {
      if (!autoSaveStateNode) {
        return;
      }
      if (uiStateMachine && typeof uiStateMachine.getStateMessage === 'function') {
        const state =
          typeof savedOrState === 'string' ? savedOrState : savedOrState ? 'synced' : 'dirty';
        autoSaveStateNode.textContent = uiStateMachine.getStateMessage(state, {
          channel: 'autosave',
        });
        return;
      }
      autoSaveStateNode.textContent = getAutoSaveStatusMessage(Boolean(savedOrState));
    }

    function setStatus(message, timeoutMs = 1800) {
      if (!statusNode) {
        return;
      }
      statusNode.textContent = message;
      clearTimeout(setStatus.timerId);
      if (Number(timeoutMs) > 0) {
        setStatus.timerId = setTimeout(() => {
          statusNode.textContent = '';
        }, timeoutMs);
      }
    }

    function updateSettingsState(event, options = {}) {
      if (!uiStateController) {
        if (options.statusMessage) {
          setStatus(options.statusMessage, options.timeoutMs);
        }
        if (Object.prototype.hasOwnProperty.call(options, 'autoSave')) {
          updateAutoSaveState(Boolean(options.autoSave));
        }
        return null;
      }

      const nextState = uiStateController.dispatch(event);
      if (options.renderStatus !== false) {
        const message =
          options.statusMessage || uiStateController.getMessage({ channel: 'status' });
        const timeoutMs = Object.prototype.hasOwnProperty.call(options, 'timeoutMs')
          ? options.timeoutMs
          : nextState === 'dirty' || nextState === 'saving'
            ? 0
            : 1800;
        setStatus(message, timeoutMs);
      }
      updateAutoSaveState(nextState);
      return nextState;
    }

    function markSettingsDirty(renderStatus = false) {
      updateSettingsState('USER_EDIT', { renderStatus: false });
      updateSettingsState('MARK_DIRTY', { renderStatus });
    }

    function refreshDisplay(settings) {
      const profile = getLearningProfile(settings);
      const modeLabel = settings.vocabularyMode === 'full' ? '全量扩展' : '核心高频';
      const preferenceLabel = settings.examPreference === 'exam-first' ? '考试优先' : '均衡筛选';
      panel.dataset.learningTone = profile.tone;
      ratioValue.textContent = `${Math.round(settings.replaceRatio * 100)}%`;
      ratioInlineValue.textContent = `${Math.round(settings.replaceRatio * 100)}%`;
      heroCefr.textContent = settings.targetCefr;
      heroReviewSpeed.textContent = getReviewDanmakuSpeedLabel(settings.reviewDanmakuSpeed);
      previewNode.textContent = getOverlaySettingsPreview(settings);
      mockPreviewNode.textContent = getMockSubtitlePreview(settings);
      strategyNote.textContent = profile.summary;
      heroCaption.textContent = settings.enabled
        ? `现在以 ${profile.label} 运行，当前为${modeLabel} / ${preferenceLabel}，词汇替换与复习节拍会随策略同步。`
        : '当前处于待机状态，重新启用后会恢复你的学习节奏配置。';
      modeTag.textContent = profile.label;
      modeTag.dataset.tone = profile.tone;
      badgeNode.textContent = settings.enabled ? '已启用' : '未启用';
      badgeNode.dataset.enabled = settings.enabled ? 'true' : 'false';
      presetButtons.forEach((button) => {
        button.classList.toggle('is-active', button.dataset.presetMode === profile.tone);
      });
      levelsSummary.textContent = `已选择 ${settings.activeLevels.length} 个词库`;
      updateAutoSaveState('idle');
    }

    function applyPanelState(settings) {
      current = normalizeOverlaySettings({ ...current, ...(settings || {}) });
      panel.style.width = `${current.overlayPanelWidth}px`;
      panel.style.height = current.overlayPanelCollapsed
        ? 'auto'
        : `${current.overlayPanelHeight}px`;
      if (window.innerWidth > 768) {
        panel.style.right = `${current.overlayPanelOffsetRight}px`;
        panel.style.bottom = `${current.overlayPanelOffsetBottom}px`;
      } else {
        panel.style.right = '12px';
        panel.style.bottom = '76px';
      }
      panel.classList.toggle('is-collapsed', current.overlayPanelCollapsed);
      panel.hidden = current.overlayPanelHidden;
      if (trigger) {
        trigger.hidden = !current.overlayPanelHidden;
      }
      enabledInput.checked = current.enabled;
      ratioInput.value = current.replaceRatio.toFixed(2);
      maxReplaceInput.value = String(current.maxReplaceCount);
      cefrInput.value = current.targetCefr;
      reviewSpeedInput.value = current.reviewDanmakuSpeed;
      if (vocabularyModeInput) {
        vocabularyModeInput.value = current.vocabularyMode;
      }
      if (examPreferenceInput) {
        examPreferenceInput.value = current.examPreference;
      }
      getLevelInputs().forEach((input) => {
        input.checked = current.activeLevels.includes(input.value);
      });
      refreshDisplay(current);
    }

    function persistSettings(partial, callback) {
      const next = normalizeOverlaySettings({
        ...current,
        ...partial,
        activeLevels: partial && partial.activeLevels ? partial.activeLevels : collectLevels(),
      });
      updateSettingsState('SAVE_START', { renderStatus: false });
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        applyPanelState(next);
        updateSettingsState('SAVE_SUCCESS', { renderStatus: false });
        if (typeof callback === 'function') {
          callback(next);
        }
        return;
      }
      chrome.storage.local.set(next, () => {
        const runtimeError = chrome.runtime && chrome.runtime.lastError;
        if (runtimeError) {
          updateSettingsState('SAVE_FAILURE', { statusMessage: '保存失败，请重试' });
          return;
        }
        applyPanelState(next);
        updateSettingsState('SAVE_SUCCESS', { renderStatus: false });
        if (typeof callback === 'function') {
          callback(next);
        }
      });
    }

    function persistPanelState(partial) {
      const payload = {};
      RESIZE_STORAGE_KEYS.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(partial, key)) {
          payload[key] = partial[key];
        }
      });
      persistSettings(payload);
    }

    function loadInitialState() {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        applyPanelState(DEFAULT_SETTINGS);
        updateSettingsState('SAVE_SUCCESS', { renderStatus: false });
        return;
      }
      chrome.storage.local.get(DEFAULT_SETTINGS, (stored) => {
        applyPanelState(stored);
        updateSettingsState('SAVE_SUCCESS', { renderStatus: false });
      });
    }

    function bindDrag() {
      const dragHandle = panel.querySelector('[data-drag-handle="true"]');
      if (!dragHandle) {
        return;
      }

      dragHandle.addEventListener('pointerdown', (event) => {
        const interactiveTarget =
          event.target instanceof Element
            ? event.target.closest('button, input, select, label')
            : null;
        if (interactiveTarget) {
          return;
        }

        event.preventDefault();
        const startX = event.clientX;
        const startY = event.clientY;
        const startRight = current.overlayPanelOffsetRight;
        const startBottom = current.overlayPanelOffsetBottom;
        let moved = false;

        function handlePointerMove(moveEvent) {
          const deltaX = moveEvent.clientX - startX;
          const deltaY = moveEvent.clientY - startY;
          if (!moved && Math.abs(deltaX) + Math.abs(deltaY) < PANEL_DRAG_THRESHOLD) {
            return;
          }
          moved = true;
          const nextRight = clampOverlayOffsetRight(startRight - deltaX);
          const nextBottom = clampOverlayOffsetBottom(startBottom - deltaY);
          panel.style.right = `${nextRight}px`;
          panel.style.bottom = `${nextBottom}px`;
          current.overlayPanelOffsetRight = nextRight;
          current.overlayPanelOffsetBottom = nextBottom;
        }

        function handlePointerUp() {
          window.removeEventListener('pointermove', handlePointerMove);
          window.removeEventListener('pointerup', handlePointerUp);
          if (!moved) {
            return;
          }
          persistPanelState({
            overlayPanelOffsetRight: current.overlayPanelOffsetRight,
            overlayPanelOffsetBottom: current.overlayPanelOffsetBottom,
          });
        }

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp, { once: true });
      });
    }

    function bindResize() {
      if (!resizeHandle) {
        return;
      }
      resizeHandle.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        const startX = event.clientX;
        const startY = event.clientY;
        const startWidth = current.overlayPanelWidth;
        const startHeight = current.overlayPanelHeight;

        function handlePointerMove(moveEvent) {
          const nextWidth = clampOverlayWidth(startWidth - (moveEvent.clientX - startX));
          const nextHeight = clampOverlayHeight(startHeight + (moveEvent.clientY - startY));
          panel.style.width = `${nextWidth}px`;
          panel.style.height = `${nextHeight}px`;
          current.overlayPanelWidth = nextWidth;
          current.overlayPanelHeight = nextHeight;
        }

        function handlePointerUp() {
          window.removeEventListener('pointermove', handlePointerMove);
          window.removeEventListener('pointerup', handlePointerUp);
          persistPanelState({
            overlayPanelWidth: current.overlayPanelWidth,
            overlayPanelHeight: current.overlayPanelHeight,
          });
        }

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp, { once: true });
      });
    }

    function scheduleAutoSave() {
      clearTimeout(autoSaveTimer);
      markSettingsDirty();
      autoSaveTimer = setTimeout(() => {
        persistSettings(
          {
            enabled: enabledInput.checked,
            replaceRatio: ratioInput.value,
            maxReplaceCount: maxReplaceInput.value,
            targetCefr: cefrInput.value,
            reviewDanmakuSpeed: reviewSpeedInput.value,
            vocabularyMode: vocabularyModeInput
              ? vocabularyModeInput.value
              : current.vocabularyMode,
            examPreference: examPreferenceInput
              ? examPreferenceInput.value
              : current.examPreference,
            activeLevels: collectLevels(),
            overlayPanelHidden: false,
            overlayPanelCollapsed: current.overlayPanelCollapsed,
            overlayPanelWidth: current.overlayPanelWidth,
            overlayPanelHeight: current.overlayPanelHeight,
            overlayPanelOffsetRight: current.overlayPanelOffsetRight,
            overlayPanelOffsetBottom: current.overlayPanelOffsetBottom,
          },
          () => {
            updateSettingsState('SAVE_SUCCESS', { statusMessage: '设置已自动应用' });
          }
        );
      }, 320);
    }

    presetButtons.forEach((button) => {
      button.addEventListener('click', () => {
        markSettingsDirty(false);
        const preset = getPresetSettings(button.dataset.presetMode);
        ratioInput.value = Number(preset.replaceRatio).toFixed(2);
        maxReplaceInput.value = String(preset.maxReplaceCount);
        reviewSpeedInput.value = preset.reviewDanmakuSpeed;
        refreshDisplay(buildPreviewSettings());
        scheduleAutoSave();
      });
    });

    saveButton.addEventListener('click', () => {
      persistSettings(
        {
          enabled: enabledInput.checked,
          replaceRatio: ratioInput.value,
          maxReplaceCount: maxReplaceInput.value,
          targetCefr: cefrInput.value,
          reviewDanmakuSpeed: reviewSpeedInput.value,
          vocabularyMode: vocabularyModeInput ? vocabularyModeInput.value : current.vocabularyMode,
          examPreference: examPreferenceInput ? examPreferenceInput.value : current.examPreference,
          activeLevels: collectLevels(),
          overlayPanelHidden: false,
          overlayPanelCollapsed: current.overlayPanelCollapsed,
          overlayPanelWidth: current.overlayPanelWidth,
          overlayPanelHeight: current.overlayPanelHeight,
          overlayPanelOffsetRight: current.overlayPanelOffsetRight,
          overlayPanelOffsetBottom: current.overlayPanelOffsetBottom,
        },
        () => {
          updateSettingsState('SAVE_SUCCESS', { statusMessage: '设置已保存并应用' });
        }
      );
    });

    ratioInput.addEventListener('input', () => {
      markSettingsDirty(false);
      refreshDisplay(buildPreviewSettings());
      scheduleAutoSave();
    });

    [
      enabledInput,
      maxReplaceInput,
      cefrInput,
      reviewSpeedInput,
      vocabularyModeInput,
      examPreferenceInput,
    ].forEach((input) => {
      input.addEventListener('change', () => {
        markSettingsDirty(false);
        refreshDisplay(buildPreviewSettings());
        scheduleAutoSave();
      });
    });

    getLevelInputs().forEach((input) => {
      input.addEventListener('change', () => {
        markSettingsDirty(false);
        refreshDisplay(buildPreviewSettings());
        scheduleAutoSave();
      });
    });

    collapseButton.addEventListener('click', () => {
      persistPanelState({ overlayPanelCollapsed: !current.overlayPanelCollapsed });
    });

    hideButton.addEventListener('click', () => {
      persistPanelState({ overlayPanelHidden: true });
    });

    if (trigger) {
      trigger.addEventListener('click', () => {
        persistPanelState({ overlayPanelHidden: false });
      });
    }

    if (reviewRefreshButton) {
      reviewRefreshButton.addEventListener('click', () => {
        const queue = getReviewQueueData();
        if (queue.length <= 1) {
          return;
        }
        reviewCursor = (reviewCursor + 1) % queue.length;
        renderLearningSnapshot(
          buildLearningSnapshot(getLearningSummaryData(), queue, reviewCursor)
        );
      });
    }

    if (reviewKnowButton) {
      reviewKnowButton.addEventListener('click', () => {
        void handleReviewFeedback('know');
      });
    }

    if (reviewFuzzyButton) {
      reviewFuzzyButton.addEventListener('click', () => {
        void handleReviewFeedback('fuzzy');
      });
    }

    if (reviewDontKnowButton) {
      reviewDontKnowButton.addEventListener('click', () => {
        void handleReviewFeedback('dontKnow');
      });
    }

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') {
          return;
        }
        const learningKeys = [
          LEARNING_STATE_KEYS.WORD_STATS_V2,
          LEARNING_STATE_KEYS.REVIEW_QUEUE,
          LEARNING_STATE_KEYS.LEARNING_SUMMARY,
        ];
        const learningStateChanged = learningKeys.some((key) => Boolean(changes[key]));
        const relevantKeys = Object.keys(DEFAULT_SETTINGS).filter((key) => Boolean(changes[key]));
        if (relevantKeys.length === 0 && !learningStateChanged) {
          return;
        }
        if (relevantKeys.length > 0) {
          const merged = { ...current };
          relevantKeys.forEach((key) => {
            merged[key] = changes[key].newValue;
          });
          applyPanelState(merged);
          updateSettingsState('SAVE_SUCCESS', { renderStatus: false });
        }
        if (learningStateChanged) {
          refreshLearningInsights();
        }
      });
    }

    bindDrag();
    bindResize();
    loadInitialState();
    refreshLearningInsights(true);

    const mountedApi = {
      panel,
      applyPanelState,
      persistSettings,
    };
    globalScope[OVERLAY_INSTANCE_KEY] = mountedApi;

    return mountedApi;
  }

  const api = {
    normalizeOverlaySettings,
    getOverlaySettingsPreview,
    getLearningProfile,
    getLearningStatusLabel,
    getAutoSaveStatusMessage,
    buildLearningSnapshot,
    getMockSubtitlePreview,
    getPresetSettings,
    clampOverlayOffsetRight,
    clampOverlayOffsetBottom,
    mountOverlayPanel,
  };

  globalScope.OverlayPanelModule = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
