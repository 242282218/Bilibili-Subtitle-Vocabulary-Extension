import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './ui.css';
import {
  CEFR_LEVELS,
  REVIEW_SPEEDS,
  cloneSettingsV3,
  getProfileConfigById,
  listProfileOptions,
  normalizeDomainRules,
  normalizeHostname,
  resolveEffectiveRuntime,
  setActiveProfileConfig,
} from './settings-bridge';
import {
  AdaptiveTuningState,
  ExperienceMetricsSnapshot,
  LearningStreak,
  LearningSummary,
  readAdaptiveTuningState,
  readExperienceMetricsSnapshot,
  setAdaptiveTuningEnabled,
  subscribeAdaptiveTuningState,
  subscribeExperienceMetricsSnapshot,
  getCurrentTabHostname,
  openOptionsPage,
  readLearningSummary,
  subscribeLearningSummary,
  exportVocabularyBook,
  readLearningStreak,
} from './storage';
import { useV3Settings } from './use-v3-settings';

const HIGH_RISK_UNDO_WINDOW_MS = 6 * 1000;

interface PendingUndoAction {
  label: string;
  snapshot: ReturnType<typeof cloneSettingsV3>;
  expiresAt: number;
}

function asNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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
  const [summary, setSummary] = useState<LearningSummary>({
    todayCount: 0,
    newCount: 0,
    masteredCount: 0,
    recentWords: [],
  });
  const [, setStreak] = useState<LearningStreak>({
    currentStreak: 0,
    maxStreak: 0,
    lastActiveDate: '',
    totalActiveDays: 0,
    activeDays: [],
  });
  const [hostname, setHostname] = useState('');
  const [adaptiveState, setAdaptiveState] = useState<AdaptiveTuningState | null>(null);
  const [experienceMetrics, setExperienceMetrics] = useState<ExperienceMetricsSnapshot | null>(
    null
  );
  const [pendingUndo, setPendingUndo] = useState<PendingUndoAction | null>(null);

  useEffect(() => {
    void (async () => {
      const [summaryPayload, currentHostname, streakPayload] = await Promise.all([
        readLearningSummary(),
        getCurrentTabHostname(),
        readLearningStreak(),
      ]);
      setSummary(summaryPayload);
      setHostname(normalizeHostname(currentHostname));
      setStreak(streakPayload);
      setStatus('已加载当前策略，可快速调整后手动保存。');
    })();
  }, []);

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

  useEffect(() => {
    const unsubscribeSummary = subscribeLearningSummary((next) => {
      setSummary(next);
    });
    return () => {
      unsubscribeSummary();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([readAdaptiveTuningState(), readExperienceMetricsSnapshot(7)]).then(
      ([nextAdaptive, nextMetrics]) => {
        if (!cancelled) {
          setAdaptiveState(nextAdaptive);
          setExperienceMetrics(nextMetrics);
        }
      }
    );
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

  const runtime = useMemo(() => {
    if (!working) {
      return null;
    }
    return resolveEffectiveRuntime(working, hostname);
  }, [working, hostname]);

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
    if (!working || !hostname) {
      setStatus('当前页面无法识别域名。');
      return;
    }
    const before = cloneSettingsV3(working);
    const enabled = runtime ? runtime.siteEnabled : true;
    const nextRules = { ...working.globalControls.siteRules };
    if (enabled) {
      nextRules[hostname] = { enabled: false };
    } else {
      delete nextRules[hostname];
    }
    setGlobalSettings({
      siteRules: normalizeDomainRules(nextRules),
    });
    registerHighRiskUndo(before, enabled ? `已暂停站点 ${hostname}` : `已恢复站点 ${hostname}`);
  }

  async function onSave() {
    const persisted = await save('策略已保存。');
    if (!persisted) {
      return;
    }
    const [nextAdaptive, nextMetrics] = await Promise.all([
      readAdaptiveTuningState(),
      readExperienceMetricsSnapshot(7),
    ]);
    setAdaptiveState(nextAdaptive);
    setExperienceMetrics(nextMetrics);
    setPendingUndo(null);
    setStatus(`策略已保存。${nextAdaptive.hint}`);
  }

  async function onToggleAdaptive(checked: boolean) {
    const [nextAdaptive, nextMetrics] = await Promise.all([
      setAdaptiveTuningEnabled(checked),
      readExperienceMetricsSnapshot(7),
    ]);
    setAdaptiveState(nextAdaptive);
    setExperienceMetrics(nextMetrics);
    setStatus(
      checked ? '已启用自动调优，后续会按反馈自动微调。' : '已关闭自动调优，后续仅按手动参数运行。'
    );
  }

  async function handleExportVocabularyBook(format: 'json' | 'csv') {
    try {
      const content = await exportVocabularyBook(format);
      const blob = new Blob([content], {
        type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8;',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute(
        'download',
        `bilibili-vocab-book-${new Date().toISOString().slice(0, 10)}.${format}`
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setStatus(`生词本已导出（${format.toUpperCase()}格式）`);
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
          当前站点：{hostname || '无法识别'} · {runtime.siteEnabled ? '已启用' : '已暂停'}
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

      <section className="panel stack stagger-enter" data-index="2">
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

      <section className="panel stack stagger-enter" data-index="3">
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
            <label htmlFor="popupDomainToggle">站点级控制</label>
            <button
              id="popupDomainToggle"
              type="button"
              className="btn"
              onClick={toggleCurrentSite}
            >
              {runtime.siteEnabled ? '暂停当前站点' : '恢复当前站点'}
            </button>
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
    </main>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing #root for popup app');
}
createRoot(rootElement).render(<PopupApp />);
