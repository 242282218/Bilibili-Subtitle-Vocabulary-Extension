import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './ui.css';
import {
  CEFR_LEVELS,
  REVIEW_SPEEDS,
  THEME_MODES,
  cloneSettingsV3,
  getProfileConfigById,
  isDomainEnabled,
  listProfileOptions,
  normalizeHostname,
  resolveEffectiveRuntime,
  setExactDomainRuleEnabled,
  setActiveProfileConfig,
} from './settings-bridge';
import { getSiteToggleUiState } from './site-toggle-state';
import {
  EncounteredWordRankingItem,
  EncounteredWordSortMode,
  QuickReviewAction,
  buildQuickReviewCard,
  formatReviewCountText,
  getRankingSummaryText,
  getRelativeSeenText,
} from './learning-dashboard';
import { ShortcutGuide } from './shortcut-guide';
import { StudyPreview } from './study-preview';
import {
  ActiveTabSubtitleNavigation,
  ActiveTabSubtitleNavigationAction,
  AdaptiveTuningState,
  ExperienceMetricsSnapshot,
  LearningSummary,
  LearningStreak,
  QuickReviewDashboard,
  VocabularyExportFormat,
  readAdaptiveTuningState,
  readEncounteredWordRanking,
  readExperienceMetricsSnapshot,
  readLearningStreak,
  readQuickReviewDashboard,
  setAdaptiveTuningEnabled,
  submitQuickReviewFeedback,
  subscribeEncounteredWordStats,
  subscribeAdaptiveTuningState,
  subscribeExperienceMetricsSnapshot,
  subscribeLearningStreak,
  exportVocabularyBook,
  getCurrentTabHostname,
  navigateActiveTabSubtitle,
  openOptionsPage,
  readActiveTabSubtitleNavigation,
  subscribeQuickReviewSource,
} from './storage';
import { getThemeModeLabel, useDocumentTheme } from './ui-theme';
import { useV3Settings } from './use-v3-settings';

const HIGH_RISK_UNDO_WINDOW_MS = 6 * 1000;
const EMPTY_SUMMARY: LearningSummary = {
  todayCount: 0,
  newCount: 0,
  masteredCount: 0,
  recentWords: [],
};
const EMPTY_REVIEW_DASHBOARD: QuickReviewDashboard = {
  summary: EMPTY_SUMMARY,
  items: [],
};
const EMPTY_TAB_SUBTITLE_NAVIGATION: ActiveTabSubtitleNavigation = {
  supported: false,
  progressLabel: '未连接',
  headline: '当前标签页暂无字幕导航',
  description: '请先打开支持字幕的 Bilibili 视频页。',
  currentText: '还没有可直接跳转的字幕句段。',
  canGoPrevious: false,
  canReplay: false,
  canGoNext: false,
};
const EMPTY_STREAK: LearningStreak = {
  currentStreak: 0,
  maxStreak: 0,
  lastActiveDate: '',
  totalActiveDays: 0,
  activeDays: [],
};
const EXPORT_META: Record<
  VocabularyExportFormat,
  { label: string; extension: string; mimeType: string }
> = {
  json: {
    label: 'JSON',
    extension: 'json',
    mimeType: 'application/json',
  },
  csv: {
    label: 'CSV',
    extension: 'csv',
    mimeType: 'text/csv;charset=utf-8;',
  },
  anki: {
    label: 'Anki TSV',
    extension: 'tsv',
    mimeType: 'text/tab-separated-values;charset=utf-8;',
  },
};

interface PendingUndoAction {
  label: string;
  snapshot: ReturnType<typeof cloneSettingsV3>;
  expiresAt: number;
}

function asNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function formatLearningStreakHeadline(streak: LearningStreak): string {
  if (streak.currentStreak > 0) {
    return `已连续学习 ${streak.currentStreak} 天`;
  }
  return '连续学习尚未开始';
}

function formatLearningStreakMeta(streak: LearningStreak): string {
  const parts = [`总学习 ${streak.totalActiveDays} 天`, `最长 ${streak.maxStreak} 天`];
  if (streak.lastActiveDate) {
    parts.push(
      streak.lastActiveDate === getTodayDateString()
        ? '今天已记录学习活动'
        : `上次活跃 ${streak.lastActiveDate}`
    );
  } else {
    parts.push('完成任一学习动作后会开始计数');
  }
  return parts.join(' · ');
}

function PopupApp() {
  const {
    working,
    saving,
    dirty,
    conflict,
    status,
    statusCode,
    feedback,
    setStatus,
    setWorkingDirect,
    mutateWorking,
    save,
    resolveConflictUseRemote,
    resolveConflictUseLocal,
  } = useV3Settings({
    initialStatus: '正在读取配置...',
  });
  const [summary, setSummary] = useState<LearningSummary>(EMPTY_SUMMARY);
  const [quickReview, setQuickReview] = useState<QuickReviewDashboard>(EMPTY_REVIEW_DASHBOARD);
  const [reviewCursor, setReviewCursor] = useState(0);
  const [reviewSubmitting, setReviewSubmitting] = useState<QuickReviewAction | null>(null);
  const [rankingSort, setRankingSort] = useState<EncounteredWordSortMode>('asc');
  const [rankingItems, setRankingItems] = useState<EncounteredWordRankingItem[]>([]);
  const [learningStreak, setLearningStreak] = useState<LearningStreak>(EMPTY_STREAK);
  const [hostname, setHostname] = useState('');
  const [subtitleNavigation, setSubtitleNavigation] = useState<ActiveTabSubtitleNavigation>(
    EMPTY_TAB_SUBTITLE_NAVIGATION
  );
  const [subtitleNavigating, setSubtitleNavigating] =
    useState<ActiveTabSubtitleNavigationAction | null>(null);
  const [adaptiveState, setAdaptiveState] = useState<AdaptiveTuningState | null>(null);
  const [experienceMetrics, setExperienceMetrics] = useState<ExperienceMetricsSnapshot | null>(
    null
  );
  const [pendingUndo, setPendingUndo] = useState<PendingUndoAction | null>(null);

  function applyAdaptiveSnapshot(
    nextAdaptive: AdaptiveTuningState,
    nextMetrics: ExperienceMetricsSnapshot
  ) {
    setAdaptiveState(nextAdaptive);
    setExperienceMetrics(nextMetrics);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [dashboardPayload, currentHostname, nextSubtitleNavigation] = await Promise.all([
          readQuickReviewDashboard(),
          getCurrentTabHostname(),
          readActiveTabSubtitleNavigation(),
        ]);
        if (cancelled) {
          return;
        }
        setSummary(dashboardPayload.summary);
        setQuickReview(dashboardPayload);
        setHostname(normalizeHostname(currentHostname));
        setSubtitleNavigation(nextSubtitleNavigation);
        setStatus('已加载当前策略，可快速调整后手动保存。');
      } catch {
        if (!cancelled) {
          setStatus('学习概览读取失败，请稍后重试。');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unsubscribeQuickReview = subscribeQuickReviewSource(() => {
      void readQuickReviewDashboard()
        .then((next) => {
          setQuickReview(next);
          setSummary(next.summary);
        })
        .catch(() => {
          setStatus('学习数据读取失败，请稍后重试。');
        });
    });
    return () => {
      unsubscribeQuickReview();
    };
  }, [setStatus]);

  useEffect(() => {
    if (!quickReview.items.length) {
      setReviewCursor(0);
      return;
    }
    setReviewCursor((current) => (current >= quickReview.items.length ? 0 : current));
  }, [quickReview.items]);

  useEffect(() => {
    if (!pendingUndo) {
      return () => {};
    }

    const timeout = window.setTimeout(
      () => {
        setPendingUndo((current) => {
          if (!current || current.expiresAt !== pendingUndo.expiresAt) {
            return current;
          }
          return null;
        });
      },
      Math.max(0, pendingUndo.expiresAt - Date.now())
    );

    return () => {
      window.clearTimeout(timeout);
    };
  }, [pendingUndo]);

  async function onNavigateSubtitle(action: ActiveTabSubtitleNavigationAction) {
    setSubtitleNavigating(action);
    try {
      const next = await navigateActiveTabSubtitle(action);
      setSubtitleNavigation(next);
      const label = action === 'previous' ? '上一句' : action === 'replay' ? '当前句' : '下一句';
      setStatus(next.supported ? `已同步当前标签页${label}字幕。` : next.description);
    } catch {
      setStatus('字幕导航失败，请刷新视频页后重试。');
    } finally {
      setSubtitleNavigating((current) => (current === action ? null : current));
    }
  }

  useEffect(() => {
    let cancelled = false;
    void readLearningStreak()
      .then((next) => {
        if (!cancelled) {
          setLearningStreak(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('连续学习进度读取失败，请稍后重试。');
        }
      });
    const unsubscribeLearningStreak = subscribeLearningStreak((next) => {
      setLearningStreak(next);
    });
    return () => {
      cancelled = true;
      unsubscribeLearningStreak();
    };
  }, [setStatus]);

  useEffect(() => {
    let cancelled = false;
    async function refreshRanking() {
      try {
        const next = await readEncounteredWordRanking(rankingSort);
        if (!cancelled) {
          setRankingItems(next);
        }
      } catch {
        if (!cancelled) {
          setStatus('生词排行读取失败，请稍后重试。');
        }
      }
    }

    void refreshRanking();
    const unsubscribeRanking = subscribeEncounteredWordStats(() => {
      void refreshRanking();
    });

    return () => {
      cancelled = true;
      unsubscribeRanking();
    };
  }, [rankingSort, setStatus]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([readAdaptiveTuningState(), readExperienceMetricsSnapshot(7)])
      .then(([nextAdaptive, nextMetrics]) => {
        if (!cancelled) {
          applyAdaptiveSnapshot(nextAdaptive, nextMetrics);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('自动调优状态读取失败，请稍后重试。');
        }
      });
    const unsubscribeAdaptive = subscribeAdaptiveTuningState((next) => {
      setAdaptiveState(next);
    });
    const unsubscribeMetrics = subscribeExperienceMetricsSnapshot((next) => {
      setExperienceMetrics(next);
    }, 7);
    return () => {
      cancelled = true;
      unsubscribeAdaptive();
      unsubscribeMetrics();
    };
  }, []);

  const profileOptions = useMemo(() => {
    if (!working) {
      return [];
    }
    return listProfileOptions(working);
  }, [working]);

  const activeProfile = useMemo(() => {
    if (!working) {
      return null;
    }
    return getProfileConfigById(working, working.activeProfileId);
  }, [working]);
  useDocumentTheme(activeProfile ? activeProfile.themeMode : 'auto');

  const runtime = useMemo(() => {
    if (!working) {
      return null;
    }
    return resolveEffectiveRuntime(working, hostname);
  }, [working, hostname]);

  const siteRuleEnabled = useMemo(() => {
    if (!working || !hostname) {
      return true;
    }
    return isDomainEnabled(hostname, {
      enabled: true,
      domainRules: working.globalControls.siteRules,
    });
  }, [working, hostname]);

  const siteToggleState = useMemo(
    () =>
      getSiteToggleUiState({
        hostname,
        profileEnabled: activeProfile ? activeProfile.enabled : true,
        siteRuleEnabled,
      }),
    [activeProfile, hostname, siteRuleEnabled]
  );
  const quickReviewCard = useMemo(
    () => buildQuickReviewCard(quickReview.items, reviewCursor),
    [quickReview.items, reviewCursor]
  );
  const rankingSummary = useMemo(
    () => getRankingSummaryText(rankingItems, rankingSort),
    [rankingItems, rankingSort]
  );

  function setGlobalSettings(patch: Partial<NonNullable<typeof working>['globalControls']>) {
    mutateWorking((draft) => {
      draft.globalControls = {
        ...draft.globalControls,
        ...patch,
      };
      return draft;
    });
  }

  function patchActiveProfile(patch: Partial<NonNullable<typeof activeProfile>>) {
    mutateWorking((draft) => {
      return setActiveProfileConfig(draft, draft.activeProfileId, patch);
    });
  }

  function setWorkingSafely(next: NonNullable<typeof working>) {
    setWorkingDirect(next);
  }

  function registerHighRiskUndo(snapshot: NonNullable<typeof working>, label: string) {
    setPendingUndo({
      label,
      snapshot: cloneSettingsV3(snapshot),
      expiresAt: Date.now() + HIGH_RISK_UNDO_WINDOW_MS,
    });
    setStatus(`${label}，可在 6 秒内撤销。`);
  }

  function undoHighRiskAction() {
    if (!pendingUndo) {
      return;
    }
    setWorkingDirect(cloneSettingsV3(pendingUndo.snapshot));
    setPendingUndo(null);
    setStatus('已撤销刚才的高风险操作。');
  }

  function toggleCurrentSite() {
    if (!working || siteToggleState.buttonDisabled) {
      setStatus(siteToggleState.hint);
      return;
    }
    const before = cloneSettingsV3(working);
    setGlobalSettings({
      siteRules: setExactDomainRuleEnabled(
        working.globalControls.siteRules,
        hostname,
        !siteRuleEnabled
      ),
    });
    registerHighRiskUndo(
      before,
      siteRuleEnabled ? `已暂停站点 ${hostname}` : `已恢复站点 ${hostname}`
    );
  }

  async function onSave() {
    const saveResult = await save('策略已保存。');
    if (!saveResult) {
      return;
    }
    setPendingUndo(null);
    try {
      const [nextAdaptive, nextMetrics] = await Promise.all([
        readAdaptiveTuningState(),
        readExperienceMetricsSnapshot(7),
      ]);
      applyAdaptiveSnapshot(nextAdaptive, nextMetrics);
      setStatus(
        saveResult.preservedLocalEdits
          ? `最近一次保存已完成，当前仍有未保存修改。${nextAdaptive.hint}`
          : `策略已保存。${nextAdaptive.hint}`
      );
    } catch {
      setStatus(
        saveResult.preservedLocalEdits
          ? '最近一次保存已完成，当前仍有未保存修改；自动调优状态刷新失败，请稍后重试。'
          : '策略已保存，但自动调优状态刷新失败，请稍后重试。'
      );
    }
  }

  async function onToggleAdaptive(checked: boolean) {
    try {
      const [nextAdaptive, nextMetrics] = await Promise.all([
        setAdaptiveTuningEnabled(checked),
        readExperienceMetricsSnapshot(7),
      ]);
      applyAdaptiveSnapshot(nextAdaptive, nextMetrics);
      setStatus(
        checked
          ? '已启用自动调优，后续会按反馈自动微调。'
          : '已关闭自动调优，后续仅按手动参数运行。'
      );
    } catch {
      setStatus('切换自动调优失败，请稍后重试。');
    }
  }

  async function refreshAdaptiveInsightsSilently() {
    try {
      const [nextAdaptive, nextMetrics] = await Promise.all([
        readAdaptiveTuningState(),
        readExperienceMetricsSnapshot(7),
      ]);
      applyAdaptiveSnapshot(nextAdaptive, nextMetrics);
    } catch {
      // Ignore secondary refresh failures to keep popup actions responsive.
    }
  }

  function cycleQuickReviewCard() {
    if (quickReview.items.length <= 1) {
      return;
    }
    setReviewCursor((current) => (current + 1) % quickReview.items.length);
  }

  async function handleQuickReviewAction(action: QuickReviewAction) {
    if (!quickReviewCard.currentItem || reviewSubmitting) {
      return;
    }

    const currentWord = quickReviewCard.currentItem.word;
    setReviewSubmitting(action);
    try {
      const result = await submitQuickReviewFeedback(currentWord, action);
      setQuickReview({
        summary: result.summary,
        items: result.items,
      });
      setSummary(result.summary);
      setReviewCursor(0);
      void refreshAdaptiveInsightsSilently();
      const actionText =
        action === 'know' ? '已标记为认识' : action === 'fuzzy' ? '已标记为模糊' : '已标记为不认识';
      setStatus(result.adaptiveApplied ? `${actionText}，并已触发自动调优。` : actionText);
    } catch {
      setStatus('快速复习保存失败，请重试。');
    } finally {
      setReviewSubmitting(null);
    }
  }

  async function handleExportVocabularyBook(format: VocabularyExportFormat) {
    try {
      const exportMeta = EXPORT_META[format];
      const content = await exportVocabularyBook(format);
      const blob = new Blob([content], { type: exportMeta.mimeType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute(
        'download',
        `bilibili-vocab-book-${new Date().toISOString().slice(0, 10)}.${exportMeta.extension}`
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setStatus(`生词本已导出（${exportMeta.label}）`);
    } catch (e) {
      setStatus('导出生词本失败，请重试');
      console.error('Export failed:', e);
    }
  }

  if (!working || !activeProfile || !runtime) {
    return (
      <main className="popup-shell">
        <section className="studio-hero">
          <span className="studio-eyebrow">Quick Control</span>
          <h1 className="studio-title">加载中</h1>
          <p className="studio-subtitle">{status}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="popup-shell">
      <section className="studio-hero stagger-enter" data-index="0">
        <span className="studio-eyebrow">Quick Control</span>
        <h1 className="studio-title">学习策略快控台</h1>
        <p className="studio-subtitle">
          当前站点：{hostname || '无法识别'} ·{' '}
          {!activeProfile.enabled ? '总开关关闭中' : runtime.siteEnabled ? '已启用' : '已暂停'}
        </p>
      </section>

      <section className="panel stack stagger-enter" data-index="1">
        <div className="inline">
          <h3>配置档切换</h3>
          <span className={`badge ${dirty ? 'warn' : 'good'}`}>{dirty ? '未保存' : '已同步'}</span>
        </div>
        <div className="field">
          <label htmlFor="popupProfileSelect">当前配置档</label>
          <select
            id="popupProfileSelect"
            value={String(working.activeProfileId)}
            onChange={(event) => {
              setWorkingSafely({
                ...working,
                activeProfileId: event.target.value,
              });
            }}
          >
            {profileOptions.map((option) => (
              <option key={option.id} value={String(option.id)}>
                {option.name}
              </option>
            ))}
          </select>
        </div>
        <div className="popup-metrics">
          <div className="popup-metric">
            <span>今日待复习</span>
            <strong>{summary.todayCount}</strong>
          </div>
          <div className="popup-metric">
            <span>新增词</span>
            <strong>{summary.newCount}</strong>
          </div>
          <div className="popup-metric">
            <span>已掌握</span>
            <strong>{summary.masteredCount}</strong>
          </div>
        </div>
        <div className="summary-item">
          <strong>{formatLearningStreakHeadline(learningStreak)}</strong>
          <span>{formatLearningStreakMeta(learningStreak)}</span>
        </div>
        <StudyPreview
          profile={activeProfile}
          title="实时学习预览"
          subtitle="保存前先看当前策略的替换密度和学习节奏。"
          sentenceVariant="popup"
          compact
        />
      </section>

      <section className="panel stack stagger-enter" data-index="2">
        <div className="inline wrap">
          <div>
            <h3>当前字幕导航</h3>
            <p className="panel-subtitle">直接控制当前标签页的上一句、重播和下一句。</p>
          </div>
          <span className={`badge ${subtitleNavigation.supported ? 'good' : ''}`}>
            {subtitleNavigation.progressLabel}
          </span>
        </div>
        <div className={`review-card${subtitleNavigation.canReplay ? '' : ' review-card--empty'}`}>
          <div className="review-card__head">
            <strong>{subtitleNavigation.headline}</strong>
            <span>{hostname || '当前标签页'}</span>
          </div>
          <p className="review-card__meta">{subtitleNavigation.description}</p>
          <p className="review-card__description">{subtitleNavigation.currentText}</p>
        </div>
        <div className="btn-row">
          <button
            type="button"
            className="btn ghost"
            onClick={() => void onNavigateSubtitle('previous')}
            disabled={!subtitleNavigation.canGoPrevious || !!subtitleNavigating}
          >
            {subtitleNavigating === 'previous' ? '跳转中...' : '上一句'}
          </button>
          <button
            type="button"
            className="btn secondary"
            onClick={() => void onNavigateSubtitle('replay')}
            disabled={!subtitleNavigation.canReplay || !!subtitleNavigating}
          >
            {subtitleNavigating === 'replay' ? '跳转中...' : '重播本句'}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => void onNavigateSubtitle('next')}
            disabled={!subtitleNavigation.canGoNext || !!subtitleNavigating}
          >
            {subtitleNavigating === 'next' ? '跳转中...' : '下一句'}
          </button>
        </div>
      </section>

      <section className="panel stack stagger-enter" data-index="3">
        <div className="inline wrap">
          <div>
            <h3>快速复习</h3>
            <p className="panel-subtitle">把刚积累的待复习词直接在真实 popup 里处理掉。</p>
          </div>
          <span className={`badge ${quickReviewCard.empty ? '' : 'good'}`}>
            {formatReviewCountText(summary)}
          </span>
        </div>
        <div className={`review-card${quickReviewCard.empty ? ' review-card--empty' : ''}`}>
          <div className="review-card__head">
            <strong>{quickReviewCard.title}</strong>
            <span>
              {quickReviewCard.total
                ? `${quickReviewCard.currentIndex + 1} / ${quickReviewCard.total}`
                : '等待新词'}
            </span>
          </div>
          <p className="review-card__meta">{quickReviewCard.meta}</p>
          <p className="review-card__description">{quickReviewCard.description}</p>
        </div>
        <div className="btn-row">
          <button
            type="button"
            className="btn ghost"
            onClick={cycleQuickReviewCard}
            disabled={quickReviewCard.empty || quickReview.items.length <= 1 || !!reviewSubmitting}
          >
            换一张
          </button>
          <button
            type="button"
            className="btn secondary"
            onClick={() => void handleQuickReviewAction('know')}
            disabled={quickReviewCard.empty || !!reviewSubmitting}
          >
            {reviewSubmitting === 'know' ? '提交中...' : '认识'}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => void handleQuickReviewAction('fuzzy')}
            disabled={quickReviewCard.empty || !!reviewSubmitting}
          >
            {reviewSubmitting === 'fuzzy' ? '提交中...' : '模糊'}
          </button>
          <button
            type="button"
            className="btn warn"
            onClick={() => void handleQuickReviewAction('dontknow')}
            disabled={quickReviewCard.empty || !!reviewSubmitting}
          >
            {reviewSubmitting === 'dontknow' ? '提交中...' : '不认识'}
          </button>
        </div>
      </section>

      <section className="panel stack stagger-enter" data-index="4">
        <div className="inline wrap">
          <div>
            <h3>生词排行</h3>
            <p className="panel-subtitle">切换查看当前最需要补强或命中最高频的词。</p>
          </div>
          <div className="btn-group">
            <button
              type="button"
              className={`btn ${rankingSort === 'asc' ? 'secondary' : 'ghost'}`}
              onClick={() => setRankingSort('asc')}
            >
              待巩固
            </button>
            <button
              type="button"
              className={`btn ${rankingSort === 'desc' ? 'secondary' : 'ghost'}`}
              onClick={() => setRankingSort('desc')}
            >
              最高频
            </button>
          </div>
        </div>
        <div className="summary-item">
          <strong>{rankingSummary}</strong>
          <span>排序会跟随最近命中与复习结果实时更新。</span>
        </div>
        {rankingItems.length > 0 ? (
          <div className="ranking-list">
            {rankingItems.map((item) => (
              <div
                className="ranking-item"
                key={`${rankingSort}-${item.word}-${item.lastSeen || 0}`}
              >
                <div className="ranking-item__main">
                  <div className="ranking-item__head">
                    <strong>{item.word}</strong>
                    <span className="badge">{item.level || 'WORD'}</span>
                  </div>
                  <span className="ranking-item__translation">{item.translation || '-'}</span>
                  <span className="ranking-item__meta">{getRelativeSeenText(item.lastSeen)}</span>
                </div>
                <span className="ranking-item__count">{item.hitCount}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="summary-item">
            <strong>暂无排行数据</strong>
            <span>继续观看带字幕的视频后，这里会出现高频命中词和待巩固词。</span>
          </div>
        )}
      </section>

      {conflict && (
        <section className="panel stack">
          <h3>检测到并发修改</h3>
          <div className="summary-item">
            <strong>其他页面已更新配置</strong>
            <span>
              冲突范围：{conflict.summary}
              。你可以应用远端版本，或保存本地版本覆盖远端（最后写入生效）。
            </span>
          </div>
          <div className="btn-row">
            <button
              type="button"
              className="btn ghost"
              onClick={() => resolveConflictUseRemote()}
              disabled={saving}
            >
              应用远端版本
            </button>
            <button
              type="button"
              className="btn warn"
              onClick={() => void resolveConflictUseLocal()}
              disabled={saving || !dirty}
            >
              应用本地版本
            </button>
          </div>
        </section>
      )}

      <section className="panel stack stagger-enter" data-index="5">
        <h3>全局开关</h3>
        <label className="switch-row">
          <span>
            <strong>字幕替换总开关</strong>
            <span className="desc">全局关闭时仅保留原始字幕。</span>
          </span>
          <input
            type="checkbox"
            checked={activeProfile.enabled}
            onChange={(event) => patchActiveProfile({ enabled: event.target.checked })}
          />
        </label>
        <label className="switch-row">
          <span>
            <strong>网页正文模式</strong>
            <span className="desc">启用后在正文文本区域执行词汇替换。</span>
          </span>
          <input
            type="checkbox"
            checked={working.globalControls.webPageEnabled}
            onChange={(event) => setGlobalSettings({ webPageEnabled: event.target.checked })}
          />
        </label>
        <label className="switch-row">
          <span>
            <strong>复习弹幕</strong>
            <span className="desc">在观看过程中穿插复习词汇。</span>
          </span>
          <input
            type="checkbox"
            checked={working.globalControls.reviewDanmakuEnabled}
            onChange={(event) => setGlobalSettings({ reviewDanmakuEnabled: event.target.checked })}
          />
        </label>
        <label className="switch-row">
          <span>
            <strong>启用自动调优</strong>
            <span className="desc">根据最近反馈自动微调替换比例、每句上限与复习节奏。</span>
          </span>
          <input
            type="checkbox"
            checked={adaptiveState ? adaptiveState.enabled : true}
            onChange={(event) => {
              void onToggleAdaptive(event.target.checked);
            }}
          />
        </label>
        <div className="summary-item">
          <strong>自动调优状态</strong>
          <span>{adaptiveState ? adaptiveState.hint : '正在读取自动调优状态...'}</span>
        </div>
        <div className="summary-item">
          <strong>近 7 天关键指标</strong>
          <span>
            {experienceMetrics
              ? `误替换反馈 ${experienceMetrics.contextMisreplaceReported} 次 · 自动调优执行 ${experienceMetrics.adaptiveDecisionApplied} 次`
              : '正在统计近 7 天关键指标...'}
          </span>
        </div>
        {pendingUndo && (
          <div className="summary-item">
            <strong>高风险操作可撤销</strong>
            <span>{pendingUndo.label}。6 秒内可撤销。</span>
            <div className="btn-row">
              <button type="button" className="btn ghost" onClick={undoHighRiskAction}>
                撤销该操作
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="panel stack stagger-enter" data-index="5">
        <h3>快速调参</h3>
        <div className="field">
          <label htmlFor="popupRatio">
            替换比例：{Math.round(activeProfile.replaceRatio * 100)}%
          </label>
          <input
            id="popupRatio"
            type="range"
            min={0.1}
            max={0.3}
            step={0.01}
            value={activeProfile.replaceRatio}
            onChange={(event) =>
              patchActiveProfile({
                replaceRatio: asNumber(event.target.value, activeProfile.replaceRatio),
              })
            }
          />
        </div>
        <div className="grid-two">
          <div className="field">
            <label htmlFor="popupMax">单句上限</label>
            <input
              id="popupMax"
              type="number"
              min={1}
              max={5}
              value={activeProfile.maxReplaceCount}
              onChange={(event) =>
                patchActiveProfile({
                  maxReplaceCount: asNumber(event.target.value, activeProfile.maxReplaceCount),
                })
              }
            />
          </div>
          <div className="field">
            <label htmlFor="popupCefr">目标 CEFR</label>
            <select
              id="popupCefr"
              value={activeProfile.targetCefr}
              onChange={(event) => patchActiveProfile({ targetCefr: event.target.value })}
            >
              {CEFR_LEVELS.map((cefr) => (
                <option key={cefr} value={cefr}>
                  {cefr}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="popupSpeed">复习节奏</label>
            <select
              id="popupSpeed"
              value={activeProfile.reviewDanmakuSpeed}
              onChange={(event) =>
                patchActiveProfile({
                  reviewDanmakuSpeed: event.target.value as 'slow' | 'normal' | 'fast',
                })
              }
            >
              {REVIEW_SPEEDS.map((speed) => (
                <option key={speed} value={speed}>
                  {speed}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="popupBilingualMode">显示模式</label>
            <select
              id="popupBilingualMode"
              value={activeProfile.bilingualMode}
              onChange={(event) =>
                patchActiveProfile({
                  bilingualMode: event.target.value as 'default' | 'bilingual' | 'english-only',
                })
              }
            >
              <option value="default">默认模式（词汇 + 括号释义）</option>
              <option value="bilingual">双语模式（整句对照）</option>
              <option value="english-only">纯英文模式（不显示括号）</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="popupThemeMode">主题模式</label>
            <select
              id="popupThemeMode"
              value={activeProfile.themeMode}
              onChange={(event) =>
                patchActiveProfile({
                  themeMode: event.target.value as 'auto' | 'light' | 'dark',
                })
              }
            >
              {THEME_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {getThemeModeLabel(mode)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="popupDomainToggle">站点级控制</label>
            <button
              id="popupDomainToggle"
              type="button"
              className="btn"
              onClick={toggleCurrentSite}
              disabled={siteToggleState.buttonDisabled}
            >
              {siteToggleState.buttonLabel}
            </button>
            <span className="hint">{siteToggleState.hint}</span>
          </div>
        </div>
        <div className="btn-row">
          <button type="button" className="btn ghost" onClick={() => void openOptionsPage()}>
            打开完整配置页
          </button>
          <div className="btn-group">
            <button
              type="button"
              className="btn secondary"
              onClick={() => handleExportVocabularyBook('json')}
            >
              导出JSON
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => handleExportVocabularyBook('csv')}
            >
              导出CSV
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => handleExportVocabularyBook('anki')}
            >
              导出Anki TSV
            </button>
          </div>
          <button
            type="button"
            className="btn primary"
            onClick={onSave}
            disabled={!dirty || saving}
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
        <p className="status-text">
          {status}
          {statusCode ? `（${statusCode}）` : ''}
          {feedback && feedback.suggestion ? ` · 建议：${feedback.suggestion}` : ''}
        </p>
      </section>

      {summary.recentWords.length > 0 && (
        <section className="panel stack">
          <h3>最近词汇</h3>
          <div className="summary-list">
            {summary.recentWords.map((item) => (
              <div className="summary-item" key={`${item.word}-${item.translation || ''}`}>
                <strong>{item.word}</strong>
                <span>
                  {item.translation || '暂无释义'}
                  {item.status ? ` · ${item.status}` : ''}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel stack">
        <ShortcutGuide title="快捷键速览" compact />
      </section>
    </main>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing #root for popup app');
}
createRoot(rootElement).render(<PopupApp />);
