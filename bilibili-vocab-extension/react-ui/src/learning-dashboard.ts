export type QuickReviewAction = 'know' | 'fuzzy' | 'dontknow';
export type EncounteredWordSortMode = 'asc' | 'desc';

export interface QuickReviewItem {
  word: string;
  translation: string;
  level: string;
  status: string;
  dueBucket: string;
  nextReviewAt: number | null;
  intervalDays: number | null;
  easeFactor: number | null;
  updatedAt: number;
}

export interface QuickReviewCardState {
  currentItem: QuickReviewItem | null;
  currentIndex: number;
  total: number;
  title: string;
  meta: string;
  description: string;
  empty: boolean;
}

export interface EncounteredWordRankingItem {
  word: string;
  translation: string;
  hitCount: number;
  lastSeen: number | null;
  level: string;
}

function normalizeTimestamp(value: unknown): number | null {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return null;
  }
  return Math.floor(timestamp);
}

export function getQuickReviewEmptyState(): {
  title: string;
  description: string;
  meta: string;
} {
  return {
    title: '当前没有待复习词',
    description: '继续看一段带字幕的视频，系统会把新命中的词汇自动加入复习池。',
    meta: '继续观看带字幕的视频后，这里会出现本轮优先回顾词。',
  };
}

export function formatReviewCountText(summary: { todayCount?: number } | null | undefined): string {
  const payload = summary || {};
  return `今日待复习 ${Math.max(0, Math.floor(Number(payload.todayCount) || 0))}`;
}

export function getReviewBucketLabel(bucket: unknown): string {
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

export function getLearningStatusLabel(status: unknown): string {
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

export function formatReviewDueText(nextReviewAt: unknown, now = Date.now()): string {
  const dueAt = normalizeTimestamp(nextReviewAt);
  const current = normalizeTimestamp(now) || Date.now();
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

export function sortQuickReviewItems(items: QuickReviewItem[]): QuickReviewItem[] {
  const bucketRank: Record<string, number> = {
    today: 0,
    soon: 1,
    later: 2,
  };
  return (Array.isArray(items) ? items : [])
    .filter((item): item is QuickReviewItem => Boolean(item && item.word))
    .slice()
    .sort((left, right) => {
      const leftRank = Object.prototype.hasOwnProperty.call(bucketRank, left.dueBucket)
        ? bucketRank[left.dueBucket]
        : 9;
      const rightRank = Object.prototype.hasOwnProperty.call(bucketRank, right.dueBucket)
        ? bucketRank[right.dueBucket]
        : 9;
      const bucketDiff = leftRank - rightRank;
      if (bucketDiff !== 0) {
        return bucketDiff;
      }

      const leftDue = normalizeTimestamp(left.nextReviewAt) || Number.POSITIVE_INFINITY;
      const rightDue = normalizeTimestamp(right.nextReviewAt) || Number.POSITIVE_INFINITY;
      if (leftDue !== rightDue) {
        return leftDue - rightDue;
      }

      const leftUpdated = normalizeTimestamp(left.updatedAt) || 0;
      const rightUpdated = normalizeTimestamp(right.updatedAt) || 0;
      if (rightUpdated !== leftUpdated) {
        return rightUpdated - leftUpdated;
      }

      return left.word.localeCompare(right.word);
    });
}

export function buildQuickReviewCard(
  items: QuickReviewItem[],
  cursor = 0,
  now = Date.now()
): QuickReviewCardState {
  const sorted = sortQuickReviewItems(items);
  if (!sorted.length) {
    const emptyState = getQuickReviewEmptyState();
    return {
      currentItem: null,
      currentIndex: 0,
      total: 0,
      title: emptyState.title,
      meta: emptyState.meta,
      description: emptyState.description,
      empty: true,
    };
  }

  const safeCursor = Math.max(0, cursor % sorted.length);
  const currentItem = sorted[safeCursor];
  return {
    currentItem,
    currentIndex: safeCursor,
    total: sorted.length,
    title: `${currentItem.word} · ${currentItem.translation || '-'}`,
    meta: `${currentItem.level || 'WORD'} · ${getReviewBucketLabel(
      currentItem.dueBucket
    )} · ${formatReviewDueText(currentItem.nextReviewAt, now)} · 当前状态 ${getLearningStatusLabel(
      currentItem.status
    )}`,
    description: '点击下方按钮，快速标记你对这个词的掌握程度。',
    empty: false,
  };
}

export function normalizeEncounteredWord(input: unknown): EncounteredWordRankingItem | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const source = input as Record<string, unknown>;
  const word = String(source.word || '').trim();
  if (!word) {
    return null;
  }

  const hitCount = Math.max(
    0,
    Math.floor(Number(source.hitCount ?? source.exposureCount ?? source.seenCount) || 0)
  );

  return {
    word,
    translation: String(source.translation || source.meaning || '').trim(),
    hitCount,
    lastSeen: normalizeTimestamp(source.lastSeenAt ?? source.lastSeen ?? source.updatedAt) || null,
    level: String(source.level || '')
      .trim()
      .toUpperCase(),
  };
}

export function sortEncounteredWords(
  items: EncounteredWordRankingItem[],
  sortMode: EncounteredWordSortMode
): EncounteredWordRankingItem[] {
  const mode = sortMode === 'desc' ? 'desc' : 'asc';
  return (Array.isArray(items) ? items : [])
    .filter((item): item is EncounteredWordRankingItem => Boolean(item && item.word))
    .slice()
    .sort((left, right) => {
      if (left.hitCount !== right.hitCount) {
        return mode === 'asc' ? left.hitCount - right.hitCount : right.hitCount - left.hitCount;
      }

      const leftSeen = left.lastSeen || 0;
      const rightSeen = right.lastSeen || 0;
      if (leftSeen !== rightSeen) {
        return mode === 'asc' ? leftSeen - rightSeen : rightSeen - leftSeen;
      }

      return left.word.localeCompare(right.word);
    });
}

export function getRankingSummaryText(
  items: EncounteredWordRankingItem[],
  sortMode: EncounteredWordSortMode
): string {
  if (!Array.isArray(items) || items.length === 0) {
    return '等待词汇命中后显示排行。';
  }

  const top = items[0];
  return sortMode === 'desc'
    ? `最高频：${top.word} · ${top.hitCount} 次`
    : `待巩固：${top.word} · ${top.hitCount} 次`;
}

export function getRelativeSeenText(lastSeen: unknown, now = Date.now()): string {
  const current = normalizeTimestamp(now) || Date.now();
  const timestamp = normalizeTimestamp(lastSeen);
  if (!timestamp) {
    return '最近记录未知';
  }

  const diff = current - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  if (diff < hour) {
    return `${Math.max(1, Math.floor(diff / minute))} 分钟前`;
  }
  if (diff < 24 * hour) {
    return `${Math.max(1, Math.floor(diff / hour))} 小时前`;
  }
  return `${Math.max(1, Math.floor(diff / (24 * hour)))} 天前`;
}
