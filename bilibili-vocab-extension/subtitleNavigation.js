(function () {
  const SEEK_OFFSET_SECONDS = 0.02;

  function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function normalizeText(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function formatSubtitleTime(value) {
    if (!isFiniteNumber(value) || value < 0) {
      return '--:--.-';
    }

    const totalTenths = Math.round(value * 10);
    const minutes = Math.floor(totalTenths / 600);
    const seconds = Math.floor((totalTenths % 600) / 10);
    const tenths = totalTenths % 10;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`;
  }

  function formatSubtitleRange(item) {
    return `${formatSubtitleTime(item.from)} - ${formatSubtitleTime(item.to)}`;
  }

  function createUnsupportedState() {
    return {
      supported: false,
      loading: false,
      total: 0,
      currentIndex: null,
      progressLabel: '未支持',
      headline: '当前站点暂不支持句级跳转',
      description: '现阶段仅在 Bilibili 字幕时间轴上提供上一句、重播本句和下一句导航。',
      currentText: '切到支持的视频页后即可使用句级字幕导航。',
      previousIndex: null,
      replayIndex: null,
      nextIndex: null,
    };
  }

  function createWaitingVideoState() {
    return {
      supported: true,
      loading: false,
      total: 0,
      currentIndex: null,
      progressLabel: '等待视频',
      headline: '等待视频加载',
      description: '打开带字幕的视频后，可直接在面板里按句回看和跳转。',
      currentText: '当前页面还没有可控制的视频元素。',
      previousIndex: null,
      replayIndex: null,
      nextIndex: null,
    };
  }

  function createLoadingState() {
    return {
      supported: true,
      loading: true,
      total: 0,
      currentIndex: null,
      progressLabel: '加载中',
      headline: '正在加载字幕时间轴',
      description: '载入完成后即可按句回看、重播本句和跳到下一句。',
      currentText: 'Bilibili 字幕轨道正在准备中。',
      previousIndex: null,
      replayIndex: null,
      nextIndex: null,
    };
  }

  function createUnavailableTimelineState() {
    return {
      supported: true,
      loading: false,
      total: 0,
      currentIndex: null,
      progressLabel: '0 / 0',
      headline: '当前视频暂无可用字幕时间轴',
      description: '没有检测到可跳转的字幕轨道；如果字幕稍后加载，可继续保持当前页面。',
      currentText: '当前还不能按句跳转。',
      previousIndex: null,
      replayIndex: null,
      nextIndex: null,
    };
  }

  function createIdleState(timeline, targets, total) {
    const anchorIndex = targets.nextIndex ?? targets.replayIndex ?? targets.previousIndex;
    const anchorItem = anchorIndex == null ? null : timeline[anchorIndex];
    const headline = targets.nextIndex != null ? '下一句字幕' : '最近字幕';
    const description = anchorItem
      ? `${formatSubtitleRange(anchorItem)} · 当前不在句段内，可直接跳转定位。`
      : '当前不在字幕句段内，可等待下一句出现或手动跳转。';

    return {
      supported: true,
      loading: false,
      total,
      currentIndex: null,
      progressLabel: '待定位',
      headline,
      description,
      currentText: anchorItem ? anchorItem.content : '等待字幕出现...',
      ...targets,
    };
  }

  function createActiveState(timeline, activeIndex, targets) {
    const currentItem = timeline[activeIndex];
    return {
      supported: true,
      loading: false,
      total: timeline.length,
      currentIndex: activeIndex,
      progressLabel: `${activeIndex + 1} / ${timeline.length}`,
      headline: '当前字幕',
      description: `${formatSubtitleRange(currentItem)} · 可直接回看上一句或跳到下一句。`,
      currentText: currentItem.content,
      ...targets,
    };
  }

  function isSubtitleTimelineHostSupported(hostname) {
    const normalized = String(hostname || '')
      .trim()
      .toLowerCase();
    return normalized === 'bilibili.com' || normalized.endsWith('.bilibili.com');
  }

  function normalizeSubtitleTimeline(source) {
    if (!Array.isArray(source)) {
      return [];
    }

    return source
      .map((item) => {
        const record = item && typeof item === 'object' ? item : {};
        const from = Number(record.from);
        const to = Number(record.to);
        const content = normalizeText(record.content);
        if (!isFiniteNumber(from) || !isFiniteNumber(to) || from > to || !content) {
          return null;
        }
        return { from, to, content };
      })
      .filter((item) => item != null)
      .sort((left, right) => left.from - right.from);
  }

  function findSubtitleIndexAtTime(timeline, currentTime) {
    if (!Array.isArray(timeline) || timeline.length === 0 || !isFiniteNumber(currentTime)) {
      return -1;
    }

    for (let index = 0; index < timeline.length; index += 1) {
      const item = timeline[index];
      if (currentTime >= item.from && currentTime <= item.to) {
        return index;
      }
    }

    return -1;
  }

  function findLastSubtitleBeforeTime(timeline, currentTime) {
    if (!Array.isArray(timeline) || timeline.length === 0 || !isFiniteNumber(currentTime)) {
      return null;
    }

    for (let index = timeline.length - 1; index >= 0; index -= 1) {
      if (timeline[index].from < currentTime) {
        return index;
      }
    }

    return null;
  }

  function findFirstSubtitleAfterTime(timeline, currentTime) {
    if (!Array.isArray(timeline) || timeline.length === 0 || !isFiniteNumber(currentTime)) {
      return null;
    }

    for (let index = 0; index < timeline.length; index += 1) {
      if (timeline[index].from > currentTime) {
        return index;
      }
    }

    return null;
  }

  function resolveSubtitleNavigationTargets(timeline, currentTime) {
    if (!Array.isArray(timeline) || timeline.length === 0) {
      return {
        previousIndex: null,
        replayIndex: null,
        nextIndex: null,
      };
    }

    const activeIndex = findSubtitleIndexAtTime(timeline, currentTime);
    if (activeIndex >= 0) {
      return {
        previousIndex: activeIndex > 0 ? activeIndex - 1 : null,
        replayIndex: activeIndex,
        nextIndex: activeIndex < timeline.length - 1 ? activeIndex + 1 : null,
      };
    }

    const previousIndex = findLastSubtitleBeforeTime(timeline, currentTime);
    const nextIndex = findFirstSubtitleAfterTime(timeline, currentTime);
    return {
      previousIndex,
      replayIndex: previousIndex ?? nextIndex,
      nextIndex,
    };
  }

  function buildSubtitleNavigationState(options) {
    const source = options && typeof options === 'object' ? options : {};
    const hostname = String(source.hostname || '');
    const timeline = Array.isArray(source.timeline) ? source.timeline : [];
    if (!isSubtitleTimelineHostSupported(hostname)) {
      return createUnsupportedState();
    }

    if (source.hasVideo !== true) {
      return createWaitingVideoState();
    }

    if (source.loading === true) {
      return createLoadingState();
    }

    if (timeline.length === 0) {
      return createUnavailableTimelineState();
    }

    const currentTime = Number(source.currentTime);
    const targets = resolveSubtitleNavigationTargets(timeline, currentTime);
    const activeIndex = findSubtitleIndexAtTime(timeline, currentTime);

    if (activeIndex < 0) {
      return createIdleState(timeline, targets, timeline.length);
    }

    return createActiveState(timeline, activeIndex, targets);
  }

  function createActiveTabSubtitleNavigationSnapshot(state) {
    const source = state && typeof state === 'object' ? state : createUnsupportedState();
    return {
      supported: source.supported === true,
      progressLabel: String(source.progressLabel || '未支持'),
      headline: String(source.headline || '当前标签页暂无字幕导航'),
      description: String(source.description || '请先打开支持字幕的 Bilibili 视频页。'),
      currentText: String(source.currentText || '还没有可直接跳转的字幕句段。'),
      canGoPrevious: source.previousIndex != null,
      canReplay: source.replayIndex != null,
      canGoNext: source.nextIndex != null,
    };
  }

  function seekVideoToSubtitle(video, timeline, targetIndex) {
    if (!video || !Array.isArray(timeline) || targetIndex == null) {
      return null;
    }

    const target = timeline[targetIndex];
    if (!target) {
      return null;
    }

    const nextTime = Math.max(0, target.from + SEEK_OFFSET_SECONDS);
    video.currentTime = nextTime;
    return nextTime;
  }

  const api = {
    createActiveTabSubtitleNavigationSnapshot,
    buildSubtitleNavigationState,
    findSubtitleIndexAtTime,
    isSubtitleTimelineHostSupported,
    normalizeSubtitleTimeline,
    resolveSubtitleNavigationTargets,
    seekVideoToSubtitle,
  };

  if (typeof globalThis !== 'undefined') {
    globalThis.SubtitleNavigationShared = api;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
