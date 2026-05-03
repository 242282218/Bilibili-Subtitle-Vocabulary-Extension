import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './ui.css';
import {
  SettingsV3,
  cloneSettingsV3,
  getProfileConfigById,
  isDomainEnabled,
  normalizeHostname,
  ProfileConfig,
  setExactDomainRuleEnabled,
  setActiveProfileConfig,
} from './settings-bridge';
import { getSiteToggleUiState } from './site-toggle-state';
import {
  ActiveTabSitePermissionState,
  ActiveTabSubtitleNavigation,
  ActiveTabSubtitleNavigationAction,
  ActiveTabSubtitleStatus,
  AdaptiveTuningState,
  ExperienceMetricsSnapshot,
  LearningStreak,
  LearningSummary,
  QuickReviewDashboard,
  navigateActiveTabSubtitle,
  openOptionsPage,
  readActiveTabSitePermissionState,
  readActiveTabSubtitleStatus,
  readAdaptiveTuningState,
  readEncounteredWordRanking,
  readExperienceMetricsSnapshot,
  readLearningStreak,
  readQuickReviewDashboard,
  removeActiveTabSitePermission,
  requestActiveTabSitePermission,
  setAdaptiveTuningEnabled,
  submitQuickReviewFeedback,
  subscribeActiveTabSubtitleStatus,
  subscribeAdaptiveTuningState,
  subscribeExperienceMetricsSnapshot,
  subscribeLearningStreak,
  subscribeQuickReviewSource,
} from './storage';
import {
  EncounteredWordRankingItem,
  EncounteredWordSortMode,
  QuickReviewAction,
  buildQuickReviewCard,
  formatReviewCountText,
  getRankingSummaryText,
  getRelativeSeenText,
} from './learning-dashboard';
import { useDocumentTheme } from './ui-theme';
import { useV3Settings } from './use-v3-settings';
import { StudyPreview } from './study-preview';

const HIGH_RISK_UNDO_WINDOW_MS = 6000;

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

const EMPTY_STREAK: LearningStreak = {
  currentStreak: 0,
  maxStreak: 0,
  lastActiveDate: '',
  totalActiveDays: 0,
  activeDays: [],
};

const EMPTY_SITE_PERMISSION: ActiveTabSitePermissionState = {
  hostname: '',
  originPattern: '',
  defaultSupported: false,
  authorized: false,
  canRequest: false,
  canRevoke: false,
  message: '正在读取当前站点授权状态...',
};

const EMPTY_ADAPTIVE_STATE: AdaptiveTuningState = {
  enabled: false,
  manualOverrideUntil: null,
  manualOverrideRemainingMs: 0,
  manualOverrideActive: false,
  feedbackWindowSize: 0,
  lastAppliedAt: null,
  lastAppliedMode: 'none',
  hint: '自动调优状态读取中。',
};

const EMPTY_EXPERIENCE_METRICS: ExperienceMetricsSnapshot = {
  windowDays: 7,
  updatedAt: null,
  contextMisreplaceReported: 0,
  contextMisreplaceHigh: 0,
  adaptiveDecisionApplied: 0,
  adaptiveManualOverride: 0,
  adaptiveToggleEnabled: 0,
  adaptiveToggleDisabled: 0,
  adaptiveToggleTotal: 0,
  adaptiveToggleDisableRate: 0,
};

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

const BILINGUAL_MODE_OPTIONS: Array<{ value: ProfileConfig['bilingualMode']; label: string }> = [
  { value: 'default', label: '括号释义' },
  { value: 'bilingual', label: '双语对照' },
  { value: 'english-only', label: '纯英文' },
];

const THEME_MODE_OPTIONS: Array<{ value: ProfileConfig['themeMode']; label: string }> = [
  { value: 'auto', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

interface PendingUndoAction {
  label: string;
  snapshot: SettingsV3;
  expiresAt: number;
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

function formatPercent(value: number): string {
  const normalized = Math.max(0, Math.min(1, Number(value) || 0));
  return `${Math.round(normalized * 100)}%`;
}

function formatAdaptiveLastApplied(state: AdaptiveTuningState | null): string {
  if (!state || !state.lastAppliedAt) {
    return '尚未自动调整';
  }
  return `上次调优：${new Date(state.lastAppliedAt).toLocaleString()}`;
}

function formatManualOverride(state: AdaptiveTuningState | null): string {
  if (!state || !state.manualOverrideActive || state.manualOverrideRemainingMs <= 0) {
    return '当前没有人工覆盖窗口';
  }
  const minutes = Math.max(1, Math.ceil(state.manualOverrideRemainingMs / 60000));
  return `人工覆盖剩余约 ${minutes} 分钟`;
}

function getPermissionActionLabel(
  sitePermission: ActiveTabSitePermissionState,
  permissionRequesting: boolean
): string {
  if (permissionRequesting) {
    return '处理中...';
  }
  if (sitePermission.defaultSupported) {
    return '默认支持站点';
  }
  if (sitePermission.authorized) {
    return sitePermission.canRevoke ? '撤销授权' : '已授权';
  }
  return '授权当前站点';
}

function getSiteStatusView({
  hostname,
  profileEnabled,
  siteRuleEnabled,
  sitePermission,
}: {
  hostname: string;
  profileEnabled: boolean;
  siteRuleEnabled: boolean;
  sitePermission: ActiveTabSitePermissionState;
}): {
  badge: string;
  tone: 'good' | 'warn';
  headline: string;
  description: string;
} {
  if (!hostname) {
    return {
      badge: '未识别',
      tone: 'warn',
      headline: '当前页面无法识别域名',
      description: '请切换到可识别的站点后，再调整当前站点的运行状态。',
    };
  }

  if (!profileEnabled) {
    return {
      badge: '总开关关闭',
      tone: 'warn',
      headline: '当前配置档已关闭字幕替换',
      description: '恢复总开关后，当前站点会继续按站点规则运行。',
    };
  }

  if (!siteRuleEnabled) {
    return {
      badge: '已暂停',
      tone: 'warn',
      headline: `${hostname} 当前已暂停`,
      description: '该站点已被本地规则暂停；需要时可直接恢复。',
    };
  }

  if (sitePermission.defaultSupported) {
    return {
      badge: '已启用',
      tone: 'good',
      headline: `${hostname} 当前已启用`,
      description: '默认支持站点已随扩展安装授权，可直接运行。',
    };
  }

  if (sitePermission.authorized) {
    return {
      badge: '已授权',
      tone: 'good',
      headline: `${hostname} 已允许运行`,
      description: sitePermission.message,
    };
  }

  if (sitePermission.canRequest) {
    return {
      badge: '待授权',
      tone: 'warn',
      headline: `${hostname} 需要先授权`,
      description: sitePermission.message,
    };
  }

  return {
    badge: '受限',
    tone: 'warn',
    headline: `${hostname} 当前不可运行`,
    description: sitePermission.message,
  };
}

function canUseSubtitleAction(
  navigation: ActiveTabSubtitleNavigation,
  action: ActiveTabSubtitleNavigationAction
): boolean {
  if (!navigation.supported) {
    return false;
  }
  if (action === 'previous') {
    return navigation.canGoPrevious;
  }
  if (action === 'replay') {
    return navigation.canReplay;
  }
  return navigation.canGoNext;
}

function PopupApp() {
  const {
    working,
    loading,
    saving,
    dirty,
    conflict,
    status,
    statusCode,
    feedback,
    setStatus,
    setWorkingDirect,
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
  const [learningStreak, setLearningStreak] = useState<LearningStreak>(EMPTY_STREAK);
  const [encounteredRanking, setEncounteredRanking] = useState<EncounteredWordRankingItem[]>([]);
  const [rankingSortMode, setRankingSortMode] = useState<EncounteredWordSortMode>('asc');
  const [adaptiveState, setAdaptiveState] = useState<AdaptiveTuningState | null>(null);
  const [experienceMetrics, setExperienceMetrics] =
    useState<ExperienceMetricsSnapshot>(EMPTY_EXPERIENCE_METRICS);
  const [adaptiveBusy, setAdaptiveBusy] = useState(false);
  const [subtitleStatus, setSubtitleStatus] =
    useState<ActiveTabSubtitleStatus>(EMPTY_SUBTITLE_STATUS);
  const [subtitleActionBusy, setSubtitleActionBusy] =
    useState<ActiveTabSubtitleNavigationAction | null>(null);
  const [hostname, setHostname] = useState('');
  const [sitePermission, setSitePermission] =
    useState<ActiveTabSitePermissionState>(EMPTY_SITE_PERMISSION);
  const [permissionRequesting, setPermissionRequesting] = useState(false);
  const [pendingUndo, setPendingUndo] = useState<PendingUndoAction | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readQuickReviewDashboard()
      .then((dashboardPayload) => {
        if (cancelled) {
          return;
        }
        setSummary(dashboardPayload.summary);
        setQuickReview(dashboardPayload);
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('学习概览读取失败，请稍后重试。');
        }
      });

    const unsubscribeQuickReview = subscribeQuickReviewSource(() => {
      void readQuickReviewDashboard()
        .then((next) => {
          if (cancelled) {
            return;
          }
          setQuickReview(next);
          setSummary(next.summary);
        })
        .catch(() => {
          if (!cancelled) {
            setStatus('学习数据读取失败，请稍后重试。');
          }
        });
    });

    return () => {
      cancelled = true;
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
    let cancelled = false;
    const refreshEncounteredRanking = () => {
      void readEncounteredWordRanking(rankingSortMode, 6)
        .then((items) => {
          if (!cancelled) {
            setEncounteredRanking(items);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setStatus('生词排行读取失败，请稍后重试。');
          }
        });
    };

    refreshEncounteredRanking();
    const unsubscribeRankingSource = subscribeQuickReviewSource(refreshEncounteredRanking);

    return () => {
      cancelled = true;
      unsubscribeRankingSource();
    };
  }, [rankingSortMode, setStatus]);

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
      if (!cancelled) {
        setLearningStreak(next);
      }
    });

    return () => {
      cancelled = true;
      unsubscribeLearningStreak();
    };
  }, [setStatus]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([readAdaptiveTuningState(), readExperienceMetricsSnapshot(7)])
      .then(([nextAdaptive, nextMetrics]) => {
        if (cancelled) {
          return;
        }
        setAdaptiveState(nextAdaptive);
        setExperienceMetrics(nextMetrics);
      })
      .catch(() => {
        if (!cancelled) {
          setAdaptiveState(EMPTY_ADAPTIVE_STATE);
          setExperienceMetrics(EMPTY_EXPERIENCE_METRICS);
          setStatus('自动调优状态读取失败，请稍后重试。');
        }
      });

    const unsubscribeAdaptiveState = subscribeAdaptiveTuningState((next) => {
      if (!cancelled) {
        setAdaptiveState(next);
      }
    });
    const unsubscribeExperienceMetrics = subscribeExperienceMetricsSnapshot((next) => {
      if (!cancelled) {
        setExperienceMetrics(next);
      }
    }, 7);

    return () => {
      cancelled = true;
      unsubscribeAdaptiveState();
      unsubscribeExperienceMetrics();
    };
  }, [setStatus]);

  useEffect(() => {
    let cancelled = false;
    const refreshActiveTabSubtitleStatus = async () => {
      try {
        const next = await readActiveTabSubtitleStatus();
        if (!cancelled) {
          setSubtitleStatus(next);
        }
      } catch {
        if (!cancelled) {
          setSubtitleStatus(EMPTY_SUBTITLE_STATUS);
          setStatus('字幕导航状态读取失败，请稍后重试。');
        }
      }
    };

    void refreshActiveTabSubtitleStatus();
    const unsubscribeSubtitleStatus = subscribeActiveTabSubtitleStatus((next) => {
      if (!cancelled) {
        setSubtitleStatus(next);
      }
    });

    return () => {
      cancelled = true;
      unsubscribeSubtitleStatus();
    };
  }, [setStatus]);

  useEffect(() => {
    let cancelled = false;
    void readActiveTabSitePermissionState()
      .then((next) => {
        if (cancelled) {
          return;
        }
        setSitePermission(next);
        setHostname(normalizeHostname(next.hostname));
      })
      .catch(() => {
        if (!cancelled) {
          setSitePermission({
            ...EMPTY_SITE_PERMISSION,
            message: '当前站点授权状态读取失败，请稍后重试。',
          });
          setHostname('');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [status]);

  useEffect(() => {
    if (!pendingUndo) {
      return () => {};
    }
    const remainingMs = Math.max(0, pendingUndo.expiresAt - Date.now());
    const timeoutId = window.setTimeout(() => {
      setPendingUndo((current) =>
        current && current.expiresAt === pendingUndo.expiresAt ? null : current
      );
    }, remainingMs);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [pendingUndo]);

  const activeProfile = useMemo(() => {
    if (!working) {
      return null;
    }
    return getProfileConfigById(working, working.activeProfileId);
  }, [working]);

  useDocumentTheme(activeProfile ? activeProfile.themeMode : 'auto');

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

  const siteStatus = useMemo(
    () =>
      getSiteStatusView({
        hostname,
        profileEnabled: activeProfile ? activeProfile.enabled : true,
        siteRuleEnabled,
        sitePermission,
      }),
    [activeProfile, hostname, sitePermission, siteRuleEnabled]
  );

  const quickReviewCard = useMemo(
    () => buildQuickReviewCard(quickReview.items, reviewCursor),
    [quickReview.items, reviewCursor]
  );

  const rankingSummary = useMemo(
    () => getRankingSummaryText(encounteredRanking, rankingSortMode),
    [encounteredRanking, rankingSortMode]
  );

  const subtitleNavigation = subtitleStatus.subtitleNavigation;
  const statusCodeText = statusCode ? `（${statusCode}）` : '';

  function registerPendingUndo(snapshot: SettingsV3, label: string) {
    setPendingUndo({
      label,
      snapshot: cloneSettingsV3(snapshot),
      expiresAt: Date.now() + HIGH_RISK_UNDO_WINDOW_MS,
    });
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
      setAdaptiveState(nextAdaptive);
      setExperienceMetrics(nextMetrics);
      setStatus(
        saveResult.preservedLocalEdits
          ? `最近一次保存已完成，当前仍有未保存修改。${nextAdaptive.hint}`
          : `策略已保存。${nextAdaptive.hint}`
      );
    } catch {
      setStatus('策略已保存，但自动调优状态刷新失败，请稍后重试。');
    }
  }

  async function onToggleCurrentSite() {
    if (!working || siteToggleState.buttonDisabled) {
      setStatus(siteToggleState.hint);
      return;
    }

    if (!siteRuleEnabled && !sitePermission.defaultSupported && !sitePermission.authorized) {
      setStatus('需要先授权当前站点，再恢复站点运行。');
      return;
    }

    const before = cloneSettingsV3(working);
    const next = cloneSettingsV3(working);
    next.globalControls.siteRules = setExactDomainRuleEnabled(
      next.globalControls.siteRules,
      hostname,
      !siteRuleEnabled
    );
    setWorkingDirect(next);

    const saveResult = await save(
      siteRuleEnabled ? `已暂停站点 ${hostname}。` : `已恢复站点 ${hostname}。`
    );
    if (!saveResult) {
      setWorkingDirect(before);
      return;
    }
    registerPendingUndo(
      before,
      siteRuleEnabled ? `已暂停站点 ${hostname}` : `已恢复站点 ${hostname}`
    );
  }

  async function onRequestSitePermission() {
    setPermissionRequesting(true);
    try {
      const next = await requestActiveTabSitePermission();
      setSitePermission(next);
      setHostname(normalizeHostname(next.hostname));
      setStatus(next.authorized ? next.message : `${next.message} 拒绝授权不会恢复站点规则。`);
    } catch {
      setStatus('请求当前站点授权失败，请稍后重试。');
    } finally {
      setPermissionRequesting(false);
    }
  }

  async function onRemoveSitePermission() {
    setPermissionRequesting(true);
    try {
      const next = await removeActiveTabSitePermission();
      setSitePermission(next);
      setHostname(normalizeHostname(next.hostname));
      setStatus(next.message);
    } catch {
      setStatus('撤销当前站点授权失败，请稍后重试。');
    } finally {
      setPermissionRequesting(false);
    }
  }

  function onToggleSitePermission() {
    if (sitePermission.canRevoke) {
      void onRemoveSitePermission();
      return;
    }
    void onRequestSitePermission();
  }

  function cycleQuickReviewCard() {
    if (quickReview.items.length <= 1) {
      return;
    }
    setReviewCursor((current) => (current + 1) % quickReview.items.length);
  }

  async function updatePopupProfile(patch: Partial<ProfileConfig>) {
    if (!working) {
      return;
    }

    const next = setActiveProfileConfig(working, working.activeProfileId, patch);
    setWorkingDirect(next);
    await save('弹窗显示设置已保存。');
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
      const nextRanking = await readEncounteredWordRanking(rankingSortMode, 6).catch(() => null);
      if (nextRanking) {
        setEncounteredRanking(nextRanking);
      }
      const actionText =
        action === 'know' ? '已标记为认识' : action === 'fuzzy' ? '已标记为模糊' : '已标记为不认识';
      setStatus(result.adaptiveApplied ? `${actionText}，并已触发自动调优。` : actionText);
    } catch {
      setStatus('快速复习保存失败，请重试。');
    } finally {
      setReviewSubmitting(null);
    }
  }

  async function onToggleAdaptive(checked: boolean) {
    setAdaptiveBusy(true);
    try {
      const [nextAdaptive, nextMetrics] = await Promise.all([
        setAdaptiveTuningEnabled(checked),
        readExperienceMetricsSnapshot(7),
      ]);
      setAdaptiveState(nextAdaptive);
      setExperienceMetrics(nextMetrics);
      setStatus(checked ? '已启用自动调优。' : '已关闭自动调优。');
    } catch {
      setStatus('切换自动调优失败，请稍后重试。');
    } finally {
      setAdaptiveBusy(false);
    }
  }

  async function onNavigateSubtitle(action: ActiveTabSubtitleNavigationAction) {
    if (!canUseSubtitleAction(subtitleNavigation, action) || subtitleActionBusy) {
      return;
    }
    setSubtitleActionBusy(action);
    try {
      const nextNavigation = await navigateActiveTabSubtitle(action);
      setSubtitleStatus((current) => ({
        ...current,
        subtitleNavigation: nextNavigation,
      }));
      setStatus('字幕导航已更新。');
    } catch {
      setStatus('字幕导航失败，请稍后重试。');
    } finally {
      setSubtitleActionBusy(null);
    }
  }

  async function onResolveConflictUseLocal() {
    const result = await resolveConflictUseLocal('已应用本地版本，并覆盖外部修改。');
    if (!result) {
      return;
    }
    if (result.preservedLocalEdits) {
      setStatus('本地版本已覆盖远端，当前仍有未保存修改。');
    }
  }

  function onResolveConflictUseRemote() {
    resolveConflictUseRemote('已应用远端版本，当前与最新配置同步。');
    setPendingUndo(null);
  }

  async function onUndoPendingAction() {
    if (!pendingUndo) {
      return;
    }
    setWorkingDirect(cloneSettingsV3(pendingUndo.snapshot));
    const saveResult = await save('已撤销该操作。');
    if (!saveResult) {
      setStatus('撤销该操作失败，请重试。');
      return;
    }
    setPendingUndo(null);
  }

  if (!working || !activeProfile) {
    return (
      <main className="popup-shell">
        <section className="studio-hero">
          <span className="studio-eyebrow">Quick Control</span>
          <h1 className="studio-title">{loading ? '加载中' : '配置不可用'}</h1>
          <p className="studio-subtitle">
            {status}
            {statusCode ? `（${statusCode}）` : ''}
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="popup-shell">
      <section className="studio-hero stagger-enter" data-index="0">
        <div className="inline wrap">
          <div>
            <span className="studio-eyebrow">Quick Control</span>
            <h1 className="studio-title">当前页面学习助手</h1>
            <p className="studio-subtitle">
              当前站点：{hostname || '未识别'} · {siteStatus.badge}
            </p>
          </div>
          <button type="button" className="btn primary" onClick={() => void openOptionsPage()}>
            打开设置
          </button>
        </div>
      </section>

      <section className="panel stack stagger-enter" data-index="1">
        <StudyPreview
          profile={activeProfile}
          title="实时学习预览"
          subtitle="当前页面会按这个配置档渲染字幕和复习弹幕。"
          sentenceVariant="popup"
          compact
        />
        <div className="grid-two">
          <div className="field">
            <label htmlFor="popupBilingualMode">显示模式</label>
            <select
              id="popupBilingualMode"
              value={activeProfile.bilingualMode}
              onChange={(event) =>
                void updatePopupProfile({
                  bilingualMode: event.target.value as ProfileConfig['bilingualMode'],
                })
              }
              disabled={saving}
            >
              {BILINGUAL_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="popupThemeMode">主题模式</label>
            <select
              id="popupThemeMode"
              value={activeProfile.themeMode}
              onChange={(event) =>
                void updatePopupProfile({
                  themeMode: event.target.value as ProfileConfig['themeMode'],
                })
              }
              disabled={saving}
            >
              {THEME_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="btn-row">
          <button
            type="button"
            className="btn primary"
            onClick={() => void onSave()}
            disabled={saving}
          >
            {saving ? '保存中...' : dirty ? '保存策略' : '策略已同步'}
          </button>
        </div>
      </section>

      <section className="panel stack stagger-enter" data-index="2">
        <div className="inline wrap">
          <div>
            <h3>当前站点控制</h3>
            <p className="panel-subtitle">只保留当前页面最关键的启停与授权操作。</p>
          </div>
          <span className={`badge ${siteStatus.tone}`}>{siteStatus.badge}</span>
        </div>
        <div className="summary-item">
          <strong>{siteStatus.headline}</strong>
          <span>{siteStatus.description}</span>
        </div>
        <p className="panel-subtitle">
          拒绝授权不会恢复站点规则；如需重新启用，请授权后再恢复站点运行。
        </p>
        <div className="btn-row">
          <button
            type="button"
            className="btn secondary"
            onClick={() => void onToggleCurrentSite()}
            disabled={siteToggleState.buttonDisabled || saving}
          >
            {saving ? '处理中...' : siteToggleState.buttonLabel}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={onToggleSitePermission}
            disabled={
              permissionRequesting ||
              saving ||
              (!sitePermission.canRequest && !sitePermission.canRevoke)
            }
          >
            {getPermissionActionLabel(sitePermission, permissionRequesting)}
          </button>
        </div>
      </section>

      {conflict && (
        <section className="panel stack stagger-enter" data-index="3">
          <div className="inline wrap">
            <div>
              <h3>检测到并发修改</h3>
              <p className="panel-subtitle">当前弹窗配置与外部保存版本不一致。</p>
            </div>
            <span className="badge warn">冲突</span>
          </div>
          <div className="summary-item">
            <strong>冲突范围：{conflict.summary}</strong>
            <span>可应用远端版本，或应用本地版本覆盖远端。</span>
          </div>
          <div className="btn-row">
            <button
              type="button"
              className="btn ghost"
              onClick={onResolveConflictUseRemote}
              disabled={saving}
            >
              应用远端版本
            </button>
            <button
              type="button"
              className="btn warn"
              onClick={() => void onResolveConflictUseLocal()}
              disabled={saving}
            >
              应用本地版本
            </button>
          </div>
        </section>
      )}

      {pendingUndo && (
        <section className="panel stack stagger-enter" data-index="3">
          <div className="inline wrap">
            <div>
              <h3>{pendingUndo.label}</h3>
              <p className="panel-subtitle">6 秒内可撤销。</p>
            </div>
            <button
              type="button"
              className="btn ghost"
              onClick={() => void onUndoPendingAction()}
              disabled={saving}
            >
              撤销该操作
            </button>
          </div>
        </section>
      )}

      <section className="panel stack stagger-enter" data-index="4">
        <div className="inline wrap">
          <div>
            <h3>自动调优状态</h3>
            <p className="panel-subtitle">根据误替换反馈和复习行为自动微调策略。</p>
          </div>
          <span className={`badge ${adaptiveState && adaptiveState.enabled ? 'good' : 'warn'}`}>
            {adaptiveState && adaptiveState.enabled ? '运行中' : '已关闭'}
          </span>
        </div>
        <label className="switch-row">
          <span>
            <strong>启用自动调优</strong>
            <small>{adaptiveState ? adaptiveState.hint : '自动调优状态读取中。'}</small>
          </span>
          <input
            type="checkbox"
            checked={adaptiveState ? adaptiveState.enabled : false}
            onChange={(event) => void onToggleAdaptive(event.target.checked)}
            disabled={adaptiveBusy}
          />
        </label>
        <div className="summary-item">
          <strong>{formatAdaptiveLastApplied(adaptiveState)}</strong>
          <span>{formatManualOverride(adaptiveState)}</span>
        </div>
        <h4>近 7 天关键指标</h4>
        <div className="popup-metrics">
          <div className="popup-metric">
            <span>自动决策</span>
            <strong>{experienceMetrics.adaptiveDecisionApplied}</strong>
          </div>
          <div className="popup-metric">
            <span>误替换反馈</span>
            <strong>{experienceMetrics.contextMisreplaceReported}</strong>
          </div>
          <div className="popup-metric">
            <span>关闭率</span>
            <strong>{formatPercent(experienceMetrics.adaptiveToggleDisableRate)}</strong>
          </div>
        </div>
      </section>

      <section className="panel stack stagger-enter" data-index="5">
        <div className="inline wrap">
          <div>
            <h3>当前字幕导航</h3>
            <p className="panel-subtitle">直接控制当前标签页的上一句、重播和下一句。</p>
          </div>
          <span className={`badge ${subtitleNavigation.supported ? 'good' : 'warn'}`}>
            {subtitleNavigation.progressLabel}
          </span>
        </div>
        <div className="summary-item">
          <strong>{subtitleNavigation.headline}</strong>
          <span>{subtitleNavigation.description}</span>
        </div>
        <p className="review-card__description">{subtitleNavigation.currentText}</p>
        <div className="btn-row">
          <button
            type="button"
            className="btn ghost"
            onClick={() => void onNavigateSubtitle('previous')}
            disabled={!canUseSubtitleAction(subtitleNavigation, 'previous') || !!subtitleActionBusy}
          >
            {subtitleActionBusy === 'previous' ? '跳转中...' : '上一句'}
          </button>
          <button
            type="button"
            className="btn secondary"
            onClick={() => void onNavigateSubtitle('replay')}
            disabled={!canUseSubtitleAction(subtitleNavigation, 'replay') || !!subtitleActionBusy}
          >
            {subtitleActionBusy === 'replay' ? '跳转中...' : '重播本句'}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => void onNavigateSubtitle('next')}
            disabled={!canUseSubtitleAction(subtitleNavigation, 'next') || !!subtitleActionBusy}
          >
            {subtitleActionBusy === 'next' ? '跳转中...' : '下一句'}
          </button>
        </div>
      </section>

      <section className="panel stack stagger-enter" data-index="6">
        <div className="inline wrap">
          <div>
            <h3>快速复习</h3>
            <p className="panel-subtitle">优先处理当前最值得复习的一张卡片。</p>
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

      <section className="panel stack stagger-enter" data-index="7">
        <div className="inline wrap">
          <div>
            <h3>生词排行</h3>
            <p className="panel-subtitle">按命中次数找出最需要巩固的词。</p>
          </div>
          <button
            type="button"
            className="btn ghost"
            onClick={() => setRankingSortMode((current) => (current === 'asc' ? 'desc' : 'asc'))}
          >
            {rankingSortMode === 'asc' ? '查看高频' : '查看待巩固'}
          </button>
        </div>
        <div className="summary-item">
          <strong>{rankingSummary}</strong>
          <span>连续学习：{formatLearningStreakHeadline(learningStreak)}</span>
        </div>
        {encounteredRanking.length ? (
          <div className="stack">
            {encounteredRanking.map((item) => (
              <div className="summary-item" key={item.word}>
                <strong>
                  {item.word} {item.translation ? `· ${item.translation}` : ''}
                </strong>
                <span>
                  {item.level || 'WORD'} · 命中 {item.hitCount} 次 ·{' '}
                  {getRelativeSeenText(item.lastSeen)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="panel-subtitle">等待词汇命中后显示排行。</p>
        )}
      </section>

      <section className="panel stack stagger-enter" data-index="8">
        <div className="inline wrap">
          <div>
            <h3>今日关键指标</h3>
            <p className="panel-subtitle">只看今天最关键的学习进度。</p>
          </div>
          <span className={`badge ${learningStreak.currentStreak > 0 ? 'good' : ''}`}>
            {learningStreak.currentStreak > 0
              ? `${learningStreak.currentStreak} 天连学`
              : '今日进度'}
          </span>
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
      </section>

      <section className="panel stack stagger-enter" data-index="9">
        <p className={`status-text ${feedback ? `status-text--${feedback.stage}` : ''}`}>
          {status}
          {statusCodeText}
        </p>
        {feedback && feedback.suggestion && <p className="panel-subtitle">{feedback.suggestion}</p>}
      </section>
    </main>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing #root for popup app');
}
createRoot(rootElement).render(<PopupApp />);
