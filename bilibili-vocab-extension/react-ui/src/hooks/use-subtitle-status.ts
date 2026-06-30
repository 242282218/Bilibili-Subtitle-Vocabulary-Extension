import { useEffect, useState } from 'react';
import {
  readActiveTabSubtitleStatus,
  subscribeActiveTabSubtitleStatus,
  navigateActiveTabSubtitle,
  ActiveTabSubtitleStatus,
  ActiveTabSubtitleNavigation,
  ActiveTabSubtitleNavigationAction,
} from '../lib/subtitle-navigation-client';

const EMPTY_SUBTITLE_NAVIGATION: ActiveTabSubtitleNavigation = {
  supported: false,
  progressLabel: '未连接',
  headline: '当前标签页暂无字幕导航',
  description: '请先打开支持字幕的 Bilibili 视频页。',
  currentText: '还没有可直接跳转的字幕句段。',
  canGoPrevious: false,
  canReplay: false,
  canGoNext: false,
};

const EMPTY_SUBTITLE_STATUS: ActiveTabSubtitleStatus = {
  hostname: '',
  subtitleNavigation: EMPTY_SUBTITLE_NAVIGATION,
};

function canUseSubtitleAction(
  navigation: ActiveTabSubtitleNavigation,
  action: ActiveTabSubtitleNavigationAction
): boolean {
  if (!navigation.supported) return false;
  if (action === 'previous') return navigation.canGoPrevious;
  if (action === 'replay') return navigation.canReplay;
  return navigation.canGoNext;
}

export function useSubtitleStatus(setStatus: (status: string) => void): {
  subtitleNavigation: ActiveTabSubtitleNavigation;
  subtitleActionBusy: ActiveTabSubtitleNavigationAction | null;
  onNavigateSubtitle: (action: ActiveTabSubtitleNavigationAction) => Promise<void>;
  canUseSubtitleAction: (action: ActiveTabSubtitleNavigationAction) => boolean;
} {
  const [subtitleStatus, setSubtitleStatus] =
    useState<ActiveTabSubtitleStatus>(EMPTY_SUBTITLE_STATUS);
  const [subtitleActionBusy, setSubtitleActionBusy] =
    useState<ActiveTabSubtitleNavigationAction | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const next = await readActiveTabSubtitleStatus();
        if (!cancelled) setSubtitleStatus(next);
      } catch {
        if (!cancelled) {
          setSubtitleStatus(EMPTY_SUBTITLE_STATUS);
          setStatus('字幕导航状态读取失败，请稍后重试。');
        }
      }
    };

    void refresh();
    const unsubscribe = subscribeActiveTabSubtitleStatus((next) => {
      if (!cancelled) setSubtitleStatus(next);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [setStatus]);

  const subtitleNavigation = subtitleStatus.subtitleNavigation;

  async function onNavigateSubtitle(action: ActiveTabSubtitleNavigationAction) {
    if (!canUseSubtitleAction(subtitleNavigation, action) || subtitleActionBusy) return;
    setSubtitleActionBusy(action);
    try {
      const nextNavigation = await navigateActiveTabSubtitle(action);
      setSubtitleStatus((current) => ({ ...current, subtitleNavigation: nextNavigation }));
      setStatus('字幕导航已更新。');
    } catch {
      setStatus('字幕导航失败，请稍后重试。');
    } finally {
      setSubtitleActionBusy(null);
    }
  }

  return {
    subtitleNavigation,
    subtitleActionBusy,
    onNavigateSubtitle,
    canUseSubtitleAction: (action) => canUseSubtitleAction(subtitleNavigation, action),
  };
}
