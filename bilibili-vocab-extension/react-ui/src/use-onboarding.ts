import { useEffect, useState } from 'react';
import {
  readOnboardingState,
  subscribeOnboardingState,
  completeOnboarding,
  OnboardingState,
  OnboardingGoal,
} from './storage';
import { applyOnboardingGoal, getOnboardingGoalTitle } from './onboarding';
import { SettingsV3 } from './settings-bridge';

export function useOnboarding(setStatus: (status: string) => void): {
  onboardingState: OnboardingState | null;
  onboardingBusy: OnboardingGoal | 'dismiss' | null;
  completeOnboardingFlow: (
    goal: OnboardingGoal | null,
    working?: SettingsV3,
    save?: (msg: string) => Promise<unknown>,
    setWorkingDirect?: (s: SettingsV3) => void
  ) => Promise<void>;
} {
  const [onboardingState, setOnboardingState] = useState<OnboardingState | null>(null);
  const [onboardingBusy, setOnboardingBusy] = useState<OnboardingGoal | 'dismiss' | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readOnboardingState()
      .then((next) => {
        if (!cancelled) setOnboardingState(next);
      })
      .catch(() => {
        if (!cancelled)
          setOnboardingState({ completedAt: null, selectedGoal: null, updatedAt: null });
      });
    const unsubscribe = subscribeOnboardingState((next) => {
      if (!cancelled) setOnboardingState(next);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  async function completeOnboardingFlow(
    goal: OnboardingGoal | null,
    working?: SettingsV3,
    save?: (msg: string) => Promise<unknown>,
    setWorkingDirect?: (s: SettingsV3) => void
  ) {
    if (onboardingBusy) return;

    setOnboardingBusy(goal || 'dismiss');
    try {
      if (goal && working && setWorkingDirect) {
        setWorkingDirect(applyOnboardingGoal(working, goal));
        if (save) {
          const saveResult = await save(`已应用${getOnboardingGoalTitle(goal)}策略。`);
          if (!saveResult) return;
        }
      }
      const nextState = await completeOnboarding(goal);
      setOnboardingState(nextState);
      setStatus(
        goal
          ? `30 秒上手已完成：${getOnboardingGoalTitle(goal)}。`
          : '已暂时跳过 30 秒上手，可继续使用当前配置。'
      );
    } catch {
      setStatus('上手配置保存失败，请稍后重试。');
    } finally {
      setOnboardingBusy(null);
    }
  }

  return { onboardingState, onboardingBusy, completeOnboardingFlow };
}
