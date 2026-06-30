import { useEffect, useState } from 'react';
import {
  readAdaptiveTuningState,
  readExperienceMetricsSnapshot,
  setAdaptiveTuningEnabled,
  subscribeAdaptiveTuningState,
  subscribeExperienceMetricsSnapshot,
  AdaptiveTuningState,
  ExperienceMetricsSnapshot,
} from '../lib/settings-client';

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

export function useAdaptiveTuning(setStatus: (status: string) => void): {
  adaptiveState: AdaptiveTuningState | null;
  experienceMetrics: ExperienceMetricsSnapshot | null;
  adaptiveBusy: boolean;
  onToggleAdaptive: (checked: boolean) => Promise<void>;
  refreshAfterSave: () => Promise<void>;
} {
  const [adaptiveState, setAdaptiveState] = useState<AdaptiveTuningState | null>(null);
  const [experienceMetrics, setExperienceMetrics] = useState<ExperienceMetricsSnapshot | null>(
    null
  );
  const [adaptiveBusy, setAdaptiveBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([readAdaptiveTuningState(), readExperienceMetricsSnapshot(7)])
      .then(([nextAdaptive, nextMetrics]) => {
        if (cancelled) return;
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

    const unsubscribeAdaptive = subscribeAdaptiveTuningState((next) => {
      if (!cancelled) setAdaptiveState(next);
    });
    const unsubscribeMetrics = subscribeExperienceMetricsSnapshot((next) => {
      if (!cancelled) setExperienceMetrics(next);
    }, 7);

    return () => {
      cancelled = true;
      unsubscribeAdaptive();
      unsubscribeMetrics();
    };
  }, [setStatus]);

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

  async function refreshAfterSave() {
    try {
      const [nextAdaptive, nextMetrics] = await Promise.all([
        readAdaptiveTuningState(),
        readExperienceMetricsSnapshot(7),
      ]);
      setAdaptiveState(nextAdaptive);
      setExperienceMetrics(nextMetrics);
    } catch {
      setStatus('自动调优状态刷新失败，请稍后重试。');
    }
  }

  return {
    adaptiveState,
    experienceMetrics,
    adaptiveBusy,
    onToggleAdaptive,
    refreshAfterSave,
  };
}
