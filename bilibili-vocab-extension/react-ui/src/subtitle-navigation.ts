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

interface SubtitleNavigationApi {
  buildSubtitleNavigationState: (
    options: BuildSubtitleNavigationStateOptions
  ) => SubtitleNavigationState;
  findSubtitleIndexAtTime: (timeline: SubtitleTimelineItem[], currentTime: number) => number;
  isSubtitleTimelineHostSupported: (hostname: string) => boolean;
  normalizeSubtitleTimeline: (source: unknown) => SubtitleTimelineItem[];
  resolveSubtitleNavigationTargets: (
    timeline: SubtitleTimelineItem[],
    currentTime: number
  ) => SubtitleNavigationTargets;
  seekVideoToSubtitle: (
    video: { currentTime: number } | null | undefined,
    timeline: SubtitleTimelineItem[],
    targetIndex: number | null
  ) => number | null;
}

function readSubtitleNavigationApi(): SubtitleNavigationApi {
  const scope = globalThis as typeof globalThis & {
    SubtitleNavigationShared?: SubtitleNavigationApi;
  };
  if (scope.SubtitleNavigationShared) {
    return scope.SubtitleNavigationShared;
  }
  throw new Error('Missing subtitle navigation runtime');
}

export function isSubtitleTimelineHostSupported(hostname: string): boolean {
  return readSubtitleNavigationApi().isSubtitleTimelineHostSupported(hostname);
}

export function normalizeSubtitleTimeline(source: unknown): SubtitleTimelineItem[] {
  return readSubtitleNavigationApi().normalizeSubtitleTimeline(source);
}

export function findSubtitleIndexAtTime(
  timeline: SubtitleTimelineItem[],
  currentTime: number
): number {
  return readSubtitleNavigationApi().findSubtitleIndexAtTime(timeline, currentTime);
}

export function resolveSubtitleNavigationTargets(
  timeline: SubtitleTimelineItem[],
  currentTime: number
): SubtitleNavigationTargets {
  return readSubtitleNavigationApi().resolveSubtitleNavigationTargets(timeline, currentTime);
}

export function buildSubtitleNavigationState(
  options: BuildSubtitleNavigationStateOptions
): SubtitleNavigationState {
  return readSubtitleNavigationApi().buildSubtitleNavigationState(options);
}

export function seekVideoToSubtitle(
  video: { currentTime: number } | null | undefined,
  timeline: SubtitleTimelineItem[],
  targetIndex: number | null
): number | null {
  return readSubtitleNavigationApi().seekVideoToSubtitle(video, timeline, targetIndex);
}
