import { useMemo, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import overlayCss from './overlay.css?inline';
import {
  CEFR_LEVELS,
  ProfileConfig,
  REVIEW_SPEEDS,
  SettingsV3,
  getProfileConfigById,
  listProfileOptions,
  normalizeSettingsV3,
  setActiveProfileConfig,
} from './overlay-settings';
import {
  saveOverlaySettingsV3,
  readLearningSummary,
  LearningSummary,
  subscribeLearningSummary,
} from './overlay-storage';
import {
  SubtitleNavigationState,
  SubtitleTimelineItem,
  buildSubtitleNavigationState,
  isSubtitleTimelineHostSupported,
  normalizeSubtitleTimeline,
  seekVideoToSubtitle,
} from './subtitle-navigation';
import { getThemeModeLabel, THEME_MODE_OPTIONS, useResolvedTheme } from './ui-theme';
import { useOverlaySettings } from './use-overlay-settings';
import { startTransition, useRef } from 'react';

const ROOT_ID = 'bili-vocab-react-overlay-root';
const STYLE_ID = 'bili-vocab-react-overlay-style';

interface SubtitleParserApi {
  loadSubtitleTimeline?: () => Promise<unknown>;
}

function asNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampOffset(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function getRecentWordMeta(item: LearningSummary['recentWords'][number]): string {
  const parts = [item.translation, item.status].filter(Boolean);
  return parts.length ? parts.join(' · ') : '继续观看后会补齐释义和状态';
}

function readVideoElement(): HTMLVideoElement | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const video = document.querySelector('video');
  return video && 'currentTime' in video ? (video as HTMLVideoElement) : null;
}

function readSubtitleParser(): SubtitleParserApi | null {
  const scope = globalThis as typeof globalThis & { SubtitleParser?: SubtitleParserApi };
  return scope.SubtitleParser || null;
}

function OverlayApp() {
  const hostname =
    typeof globalThis.location !== 'undefined' ? String(globalThis.location.hostname || '') : '';
  const {
    working: settings,
    saving,
    dirty,
    status,
    setStatus,
    setWorkingDirect,
    mutateWorking,
    save,
  } = useOverlaySettings({
    initialStatus: '加载中...',
  });
  const [summary, setSummary] = useState<LearningSummary>({
    todayCount: 0,
    newCount: 0,
    masteredCount: 0,
    recentWords: [],
  });
  const subtitleTimelineRef = useRef<SubtitleTimelineItem[]>([]);
  const subtitleLoadingRef = useRef(isSubtitleTimelineHostSupported(hostname));
  const [subtitleNavigation, setSubtitleNavigation] = useState<SubtitleNavigationState>(() => {
    const video = readVideoElement();
    return buildSubtitleNavigationState({
      hostname,
      loading: subtitleLoadingRef.current,
      hasVideo: Boolean(video),
      currentTime: video ? Number(video.currentTime) : Number.NaN,
      timeline: subtitleTimelineRef.current,
    });
  });

  function syncSubtitleNavigation() {
    const video = readVideoElement();
    const nextState = buildSubtitleNavigationState({
      hostname,
      loading: subtitleLoadingRef.current,
      hasVideo: Boolean(video),
      currentTime: video ? Number(video.currentTime) : Number.NaN,
      timeline: subtitleTimelineRef.current,
    });
    startTransition(() => {
      setSubtitleNavigation(nextState);
    });
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const summaryPayload = await readLearningSummary();
        if (!cancelled) {
          setSummary(summaryPayload);
        }
      } catch {
        if (!cancelled) {
          setStatus('学习概览读取失败，请稍后重试。');
        }
      }
    })();
    const unsubscribeSummary = subscribeLearningSummary((next) => {
      setSummary(next);
    });
    return () => {
      cancelled = true;
      unsubscribeSummary();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setInterval(() => {
      if (!cancelled) {
        syncSubtitleNavigation();
      }
    }, 450);
    const subtitleParser = readSubtitleParser();

    syncSubtitleNavigation();
    if (
      !isSubtitleTimelineHostSupported(hostname) ||
      !subtitleParser ||
      typeof subtitleParser.loadSubtitleTimeline !== 'function'
    ) {
      subtitleLoadingRef.current = false;
      syncSubtitleNavigation();
      return () => {
        cancelled = true;
        window.clearInterval(timer);
      };
    }

    subtitleLoadingRef.current = true;
    void subtitleParser
      .loadSubtitleTimeline()
      .then((timeline) => {
        if (cancelled) {
          return;
        }
        subtitleTimelineRef.current = normalizeSubtitleTimeline(timeline);
        subtitleLoadingRef.current = false;
        syncSubtitleNavigation();
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        subtitleTimelineRef.current = [];
        subtitleLoadingRef.current = false;
        syncSubtitleNavigation();
      });

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [hostname]);

  const profileOptions = useMemo(() => {
    if (!settings) {
      return [];
    }
    return listProfileOptions(settings);
  }, [settings]);

  const profile = useMemo(() => {
    if (!settings) {
      return null;
    }
    return getProfileConfigById(settings, settings.activeProfileId);
  }, [settings]);
  const resolvedTheme = useResolvedTheme(profile ? profile.themeMode : 'auto');

  if (!settings || !profile) {
    return null;
  }

  const overlayState = settings.globalControls.overlayState;

  function mutateSettings(updater: (draft: SettingsV3) => SettingsV3) {
    mutateWorking((draft) => normalizeSettingsV3(updater(draft)));
  }

  function jumpToSubtitle(targetIndex: number | null, message: string) {
    const video = readVideoElement();
    const seekedAt = seekVideoToSubtitle(video, subtitleTimelineRef.current, targetIndex);
    if (seekedAt == null) {
      setStatus('当前没有可跳转的字幕句段。');
      return;
    }
    syncSubtitleNavigation();
    setStatus(`${message}（${seekedAt.toFixed(1)}s）`);
  }

  function patchProfile(patch: Partial<ProfileConfig>) {
    mutateWorking((draft) => setActiveProfileConfig(draft, draft.activeProfileId, patch));
  }

  function patchOverlayState(patch: Partial<SettingsV3['globalControls']['overlayState']>) {
    mutateSettings((draft) => {
      draft.globalControls.overlayState = {
        ...draft.globalControls.overlayState,
        ...patch,
      };
      return draft;
    });
  }

  async function persist(message: string) {
    await save(message);
  }

  async function persistImmediate(next: SettingsV3, message: string) {
    try {
      const persisted = await saveOverlaySettingsV3(next);
      setWorkingDirect(persisted);
      setStatus(message);
    } catch {
      setStatus('保存失败，请重试。');
    }
  }

  const hideOverlay = async () => {
    const next = normalizeSettingsV3({
      ...settings,
      globalControls: {
        ...settings.globalControls,
        overlayState: {
          ...settings.globalControls.overlayState,
          hidden: true,
        },
      },
    });
    await persistImmediate(next, '已隐藏悬浮面板。');
  };

  const showOverlay = async () => {
    const next = normalizeSettingsV3({
      ...settings,
      globalControls: {
        ...settings.globalControls,
        overlayState: {
          ...settings.globalControls.overlayState,
          hidden: false,
        },
      },
    });
    await persistImmediate(next, '悬浮面板已恢复。');
  };

  if (overlayState.hidden) {
    return (
      <button type="button" className="rv-fab" onClick={() => void showOverlay()}>
        打开学习面板
      </button>
    );
  }

  return (
    <div className="rv-overlay-root" data-theme={resolvedTheme}>
      <aside
        className="rv-overlay-panel"
        data-collapsed={overlayState.collapsed}
        style={{
          ['--rv-width' as string]: `${overlayState.width}px`,
          ['--rv-height' as string]: `${overlayState.height}px`,
          ['--rv-right' as string]: `${overlayState.offsetRight}px`,
          ['--rv-bottom' as string]: `${overlayState.offsetBottom}px`,
        }}
      >
        <header className="rv-overlay-head">
          <h3 className="rv-overlay-title">
            Subtitle Learning
            <strong>
              {profileOptions.find((item) => item.id === settings.activeProfileId)?.name ||
                '均衡输入'}
            </strong>
          </h3>
          <div className="rv-overlay-actions">
            <button
              type="button"
              className="rv-btn"
              onClick={() => patchOverlayState({ collapsed: !overlayState.collapsed })}
            >
              {overlayState.collapsed ? '展开' : '折叠'}
            </button>
            <button type="button" className="rv-btn" onClick={() => void hideOverlay()}>
              隐藏
            </button>
          </div>
        </header>
        {!overlayState.collapsed && (
          <div className="rv-overlay-body">
            <section className="rv-card rv-stats-card">
              <h4>今日学习进度</h4>
              <div className="rv-stats-grid">
                <div className="rv-stat-item">
                  <span className="rv-stat-value">{summary.todayCount}</span>
                  <span className="rv-stat-label">待复习</span>
                </div>
                <div className="rv-stat-item">
                  <span className="rv-stat-value">{summary.newCount}</span>
                  <span className="rv-stat-label">新遇见</span>
                </div>
                <div className="rv-stat-item">
                  <span className="rv-stat-value">{summary.masteredCount}</span>
                  <span className="rv-stat-label">已掌握</span>
                </div>
              </div>
              <div className="rv-recent-words">
                <div className="rv-recent-words__head">
                  <strong>最近词汇</strong>
                  <span>跟随学习状态实时刷新</span>
                </div>
                {summary.recentWords.length > 0 ? (
                  <div className="rv-recent-words__list">
                    {summary.recentWords.slice(0, 3).map((item) => (
                      <div
                        className="rv-recent-word"
                        key={`${item.word}-${item.translation || ''}`}
                      >
                        <strong>{item.word}</strong>
                        <span>{getRecentWordMeta(item)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rv-recent-words__empty">
                    继续观看带字幕的视频后，这里会显示最近命中的词。
                  </div>
                )}
              </div>
            </section>

            <section className="rv-card rv-subtitle-card">
              <div className="rv-subtitle-head">
                <div className="rv-subtitle-copy">
                  <h4>字幕导航</h4>
                  <p>{subtitleNavigation.description}</p>
                </div>
                <strong className="rv-subtitle-progress">{subtitleNavigation.progressLabel}</strong>
              </div>
              <div className="rv-subtitle-current" aria-live="polite">
                <span>{subtitleNavigation.headline}</span>
                <strong>{subtitleNavigation.currentText}</strong>
              </div>
              <div className="rv-subtitle-actions">
                <button
                  type="button"
                  className="rv-btn"
                  disabled={subtitleNavigation.previousIndex == null}
                  onClick={() =>
                    jumpToSubtitle(subtitleNavigation.previousIndex, '已跳到上一句字幕')
                  }
                >
                  上一句
                </button>
                <button
                  type="button"
                  className="rv-btn"
                  disabled={subtitleNavigation.replayIndex == null}
                  onClick={() => jumpToSubtitle(subtitleNavigation.replayIndex, '已重播当前字幕')}
                >
                  重播本句
                </button>
                <button
                  type="button"
                  className="rv-btn"
                  disabled={subtitleNavigation.nextIndex == null}
                  onClick={() => jumpToSubtitle(subtitleNavigation.nextIndex, '已跳到下一句字幕')}
                >
                  下一句
                </button>
              </div>
            </section>

            <section className="rv-card">
              <h4>配置档与学习强度</h4>
              <div className="rv-row">
                <div className="rv-field">
                  <label htmlFor="rvProfile">配置档</label>
                  <select
                    id="rvProfile"
                    value={String(settings.activeProfileId)}
                    onChange={(event) => {
                      mutateSettings((draft) => {
                        draft.activeProfileId = event.target.value;
                        return draft;
                      });
                    }}
                  >
                    {profileOptions.map((item) => (
                      <option key={item.id} value={String(item.id)}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="rv-field">
                  <label htmlFor="rvRatio">
                    替换比例：{Math.round(profile.replaceRatio * 100)}%
                  </label>
                  <input
                    id="rvRatio"
                    type="range"
                    min={0.1}
                    max={0.3}
                    step={0.01}
                    value={profile.replaceRatio}
                    onChange={(event) =>
                      patchProfile({
                        replaceRatio: asNumber(event.target.value, profile.replaceRatio),
                      })
                    }
                  />
                </div>
              </div>
              <div className="rv-grid-two">
                <div className="rv-field">
                  <label htmlFor="rvMax">单句上限</label>
                  <input
                    id="rvMax"
                    type="number"
                    min={1}
                    max={5}
                    value={profile.maxReplaceCount}
                    onChange={(event) =>
                      patchProfile({
                        maxReplaceCount: asNumber(event.target.value, profile.maxReplaceCount),
                      })
                    }
                  />
                </div>
                <div className="rv-field">
                  <label htmlFor="rvCefr">目标 CEFR</label>
                  <select
                    id="rvCefr"
                    value={profile.targetCefr}
                    onChange={(event) => patchProfile({ targetCefr: event.target.value })}
                  >
                    {CEFR_LEVELS.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </section>

            <section className="rv-card">
              <h4>运行开关</h4>
              <div className="rv-row">
                <label className="rv-switch">
                  <span>
                    <strong>字幕替换总开关</strong>
                    启用后按配置档策略替换词汇。
                  </span>
                  <input
                    type="checkbox"
                    checked={profile.enabled}
                    onChange={(event) => patchProfile({ enabled: event.target.checked })}
                  />
                </label>
                <label className="rv-switch">
                  <span>
                    <strong>页面正文模式</strong>
                    控制是否处理页面段落文本。
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.globalControls.webPageEnabled}
                    onChange={(event) => {
                      mutateSettings((draft) => {
                        draft.globalControls.webPageEnabled = event.target.checked;
                        return draft;
                      });
                    }}
                  />
                </label>
                <label className="rv-switch">
                  <span>
                    <strong>复习弹幕</strong>
                    在观看过程中回顾已学习词汇。
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.globalControls.reviewDanmakuEnabled}
                    onChange={(event) => {
                      mutateSettings((draft) => {
                        draft.globalControls.reviewDanmakuEnabled = event.target.checked;
                        return draft;
                      });
                    }}
                  />
                </label>
                <div className="rv-field">
                  <label htmlFor="rvSpeed">复习节奏</label>
                  <select
                    id="rvSpeed"
                    value={profile.reviewDanmakuSpeed}
                    onChange={(event) =>
                      patchProfile({
                        reviewDanmakuSpeed: event.target.value as 'slow' | 'normal' | 'fast',
                      })
                    }
                  >
                    {REVIEW_SPEEDS.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="rv-field">
                  <label htmlFor="rvTheme">主题模式</label>
                  <select
                    id="rvTheme"
                    value={profile.themeMode}
                    onChange={(event) =>
                      patchProfile({
                        themeMode: event.target.value as 'auto' | 'light' | 'dark',
                      })
                    }
                  >
                    {THEME_MODE_OPTIONS.map((mode) => (
                      <option key={mode} value={mode}>
                        {getThemeModeLabel(mode)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </section>

            <section className="rv-card">
              <h4>面板位置</h4>
              <div className="rv-shift">
                <button
                  type="button"
                  className="rv-btn"
                  onClick={() =>
                    patchOverlayState({
                      offsetRight: clampOffset(overlayState.offsetRight + 12, 12, 360),
                    })
                  }
                >
                  向左
                </button>
                <button
                  type="button"
                  className="rv-btn"
                  onClick={() =>
                    patchOverlayState({
                      offsetRight: clampOffset(overlayState.offsetRight - 12, 12, 360),
                    })
                  }
                >
                  向右
                </button>
                <button
                  type="button"
                  className="rv-btn"
                  onClick={() =>
                    patchOverlayState({
                      offsetBottom: clampOffset(overlayState.offsetBottom + 12, 24, 240),
                    })
                  }
                >
                  上移
                </button>
                <button
                  type="button"
                  className="rv-btn"
                  onClick={() =>
                    patchOverlayState({
                      offsetBottom: clampOffset(overlayState.offsetBottom - 12, 24, 240),
                    })
                  }
                >
                  下移
                </button>
              </div>
            </section>

            <footer className="rv-overlay-foot">
              <span className="rv-status">{status}</span>
              <div className="rv-shift">
                <button type="button" className="rv-btn" onClick={() => void hideOverlay()}>
                  隐藏面板
                </button>
                <button
                  type="button"
                  className="rv-btn rv-btn-primary"
                  onClick={() => void persist('已保存到扩展设置。')}
                  disabled={!dirty || saving}
                >
                  {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </footer>
          </div>
        )}
      </aside>
    </div>
  );
}

function mountOverlayPanel(): void {
  if (typeof document === 'undefined') {
    return;
  }
  if (document.getElementById(ROOT_ID)) {
    return;
  }
  if (!document.getElementById(STYLE_ID)) {
    const styleNode = document.createElement('style');
    styleNode.id = STYLE_ID;
    styleNode.textContent = overlayCss;
    document.documentElement.appendChild(styleNode);
  }
  const rootNode = document.createElement('div');
  rootNode.id = ROOT_ID;
  document.body.appendChild(rootNode);
  createRoot(rootNode).render(<OverlayApp />);
}

declare global {
  interface Window {
    ReactOverlayModule?: {
      mountOverlayPanel: () => void;
    };
  }
}

if (typeof window !== 'undefined') {
  window.ReactOverlayModule = {
    mountOverlayPanel,
  };
}

export { mountOverlayPanel };
