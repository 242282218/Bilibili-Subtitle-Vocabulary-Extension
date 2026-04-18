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

export interface OverlaySubtitleNavigationPayload {
  videoKey: string;
  state: SubtitleNavigationState;
}

interface OverlaySubtitleNavigationBridge {
  read?: () => OverlaySubtitleNavigationPayload;
  refresh?: () => Promise<OverlaySubtitleNavigationPayload>;
  subscribe?: (
    listener: (payload: OverlaySubtitleNavigationPayload) => void
  ) => (() => void) | void;
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

function readOverlaySubtitleNavigationBridge(): OverlaySubtitleNavigationBridge | null {
  const scope = globalThis as typeof globalThis & {
    BiliVocabOverlaySubtitleNavigationBridge?: OverlaySubtitleNavigationBridge;
  };
  return scope.BiliVocabOverlaySubtitleNavigationBridge || null;
}

function createFallbackOverlaySubtitleNavigationPayload(): OverlaySubtitleNavigationPayload {
  return {
    videoKey: '',
    state: buildSubtitleNavigationState({}),
  };
}

function normalizeOverlaySubtitleNavigationPayload(
  payload: unknown
): OverlaySubtitleNavigationPayload {
  const fallback = createFallbackOverlaySubtitleNavigationPayload();
  if (!payload || typeof payload !== 'object') {
    return fallback;
  }

  const record = payload as Partial<OverlaySubtitleNavigationPayload>;
  return {
    videoKey: record.videoKey == null ? '' : String(record.videoKey),
    state:
      record.state && typeof record.state === 'object'
        ? {
            ...fallback.state,
            ...record.state,
          }
        : fallback.state,
  };
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

export function readOverlaySubtitleNavigationState(): OverlaySubtitleNavigationPayload {
  const bridge = readOverlaySubtitleNavigationBridge();
  if (!bridge || typeof bridge.read !== 'function') {
    return createFallbackOverlaySubtitleNavigationPayload();
  }
  return normalizeOverlaySubtitleNavigationPayload(bridge.read());
}

export async function refreshOverlaySubtitleNavigationState(): Promise<OverlaySubtitleNavigationPayload> {
  const bridge = readOverlaySubtitleNavigationBridge();
  if (!bridge || typeof bridge.refresh !== 'function') {
    return readOverlaySubtitleNavigationState();
  }
  return normalizeOverlaySubtitleNavigationPayload(await bridge.refresh());
}

export function subscribeOverlaySubtitleNavigationState(
  listener: (payload: OverlaySubtitleNavigationPayload) => void
): () => void {
  const bridge = readOverlaySubtitleNavigationBridge();
  if (!bridge || typeof bridge.subscribe !== 'function') {
    return () => {};
  }
  const unsubscribe = bridge.subscribe((payload) => {
    listener(normalizeOverlaySubtitleNavigationPayload(payload));
  });
  return typeof unsubscribe === 'function' ? unsubscribe : () => {};
}
