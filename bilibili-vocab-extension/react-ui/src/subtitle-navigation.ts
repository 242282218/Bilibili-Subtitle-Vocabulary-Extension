export interface SubtitleTimelineItem {
  from: number;
  to: number;
  content: string;
}

export interface SubtitleNavigationTargets {
  previousIndex: number | null;
  replayIndex: number | null;
  nextIndex: number | null;
}

export interface SubtitleNavigationState extends SubtitleNavigationTargets {
  supported: boolean;
  loading: boolean;
  total: number;
  currentIndex: number | null;
  progressLabel: string;
  headline: string;
  description: string;
  currentText: string;
}

interface BuildSubtitleNavigationStateOptions {
  hostname?: string;
  loading?: boolean;
  hasVideo?: boolean;
  currentTime?: number;
  timeline?: SubtitleTimelineItem[];
}

const SEEK_OFFSET_SECONDS = 0.02;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeText(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatSubtitleTime(value: number): string {
  if (!isFiniteNumber(value) || value < 0) {
    return '--:--.-';
  }

  const totalTenths = Math.round(value * 10);
  const minutes = Math.floor(totalTenths / 600);
  const seconds = Math.floor((totalTenths % 600) / 10);
  const tenths = totalTenths % 10;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`;
}

function formatSubtitleRange(item: SubtitleTimelineItem): string {
  return `${formatSubtitleTime(item.from)} - ${formatSubtitleTime(item.to)}`;
}

function createUnsupportedState(): SubtitleNavigationState {
  return {
    supported: false,
    loading: false,
    total: 0,
    currentIndex: null,
    progressLabel: '未支持',
    headline: '当前站点暂不支持句级跳转',
    description: '现阶段先在 Bilibili 字幕时间轴上提供上一句、重播和下一句导航。',
    currentText: '保留现有学习概览与调参能力，后续再扩展到其他站点。',
    previousIndex: null,
    replayIndex: null,
    nextIndex: null,
  };
}

function createWaitingVideoState(): SubtitleNavigationState {
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

function createLoadingState(): SubtitleNavigationState {
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

function createUnavailableTimelineState(): SubtitleNavigationState {
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

function createIdleState(
  timeline: SubtitleTimelineItem[],
  targets: SubtitleNavigationTargets,
  total: number
): SubtitleNavigationState {
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

function createActiveState(
  timeline: SubtitleTimelineItem[],
  activeIndex: number,
  targets: SubtitleNavigationTargets
): SubtitleNavigationState {
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

export function isSubtitleTimelineHostSupported(hostname: string): boolean {
  const normalized = String(hostname || '')
    .trim()
    .toLowerCase();
  return normalized === 'bilibili.com' || normalized.endsWith('.bilibili.com');
}

export function normalizeSubtitleTimeline(source: unknown): SubtitleTimelineItem[] {
  if (!Array.isArray(source)) {
    return [];
  }

  return source
    .map((item) => {
      const record = item as Record<string, unknown>;
      const from = Number(record && record.from);
      const to = Number(record && record.to);
      const content = normalizeText(record && record.content);
      if (!isFiniteNumber(from) || !isFiniteNumber(to) || from > to || !content) {
        return null;
      }
      return { from, to, content };
    })
    .filter((item): item is SubtitleTimelineItem => item != null)
    .sort((left, right) => left.from - right.from);
}

export function findSubtitleIndexAtTime(
  timeline: SubtitleTimelineItem[],
  currentTime: number
): number {
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

function findLastSubtitleBeforeTime(
  timeline: SubtitleTimelineItem[],
  currentTime: number
): number | null {
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

function findFirstSubtitleAfterTime(
  timeline: SubtitleTimelineItem[],
  currentTime: number
): number | null {
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

export function resolveSubtitleNavigationTargets(
  timeline: SubtitleTimelineItem[],
  currentTime: number
): SubtitleNavigationTargets {
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

export function buildSubtitleNavigationState(
  options: BuildSubtitleNavigationStateOptions
): SubtitleNavigationState {
  const hostname = String(options.hostname || '');
  const timeline = Array.isArray(options.timeline) ? options.timeline : [];
  if (!isSubtitleTimelineHostSupported(hostname)) {
    return createUnsupportedState();
  }

  if (options.hasVideo !== true) {
    return createWaitingVideoState();
  }

  if (options.loading === true) {
    return createLoadingState();
  }

  if (timeline.length === 0) {
    return createUnavailableTimelineState();
  }

  const currentTime = Number(options.currentTime);
  const targets = resolveSubtitleNavigationTargets(timeline, currentTime);
  const activeIndex = findSubtitleIndexAtTime(timeline, currentTime);

  if (activeIndex < 0) {
    return createIdleState(timeline, targets, timeline.length);
  }

  return createActiveState(timeline, activeIndex, targets);
}

export function seekVideoToSubtitle(
  video: { currentTime: number } | null | undefined,
  timeline: SubtitleTimelineItem[],
  targetIndex: number | null
): number | null {
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
