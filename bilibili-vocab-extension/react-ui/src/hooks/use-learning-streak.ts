import { useEffect, useState } from 'react';
import {
  readLearningStreak,
  subscribeLearningStreak,
  LearningStreak,
} from '../lib/learning-client';

const EMPTY_STREAK: LearningStreak = {
  currentStreak: 0,
  maxStreak: 0,
  lastActiveDate: '',
  totalActiveDays: 0,
  activeDays: [],
};

export function useLearningStreak(setStatus: (status: string) => void): {
  learningStreak: LearningStreak;
} {
  const [learningStreak, setLearningStreak] = useState<LearningStreak>(EMPTY_STREAK);

  useEffect(() => {
    let cancelled = false;
    void readLearningStreak()
      .then((next) => {
        if (!cancelled) setLearningStreak(next);
      })
      .catch(() => {
        if (!cancelled) setStatus('连续学习进度读取失败，请稍后重试。');
      });

    const unsubscribe = subscribeLearningStreak((next) => {
      if (!cancelled) setLearningStreak(next);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [setStatus]);

  return { learningStreak };
}
