import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { normalizeSettingsV3 } from '../lib/overlay-settings';
import {
  loadOverlaySettingsV3,
  saveOverlaySettingsV3,
  subscribeOverlaySettingsChanges,
} from '../lib/overlay-storage';
import type { SettingsV3 } from '../lib/overlay-settings';

interface UseOverlaySettingsOptions {
  initialStatus?: string;
}

interface OverlaySettingsError {
  message: string;
  suggestion?: string;
}

interface UseOverlaySettingsResult {
  working: SettingsV3 | null;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  status: string;
  error: OverlaySettingsError | null;
  setStatus: (message: string) => void;
  setWorkingDirect: (settings: SettingsV3) => void;
  mutateWorking: (updater: (settings: SettingsV3) => SettingsV3) => void;
  save: (message?: string) => Promise<SettingsV3 | null>;
  reload: () => void;
}

function cloneSettings(settings: SettingsV3): SettingsV3 {
  return JSON.parse(JSON.stringify(settings)) as SettingsV3;
}

export function useOverlaySettings(
  options: UseOverlaySettingsOptions = {}
): UseOverlaySettingsResult {
  const { initialStatus = '正在读取配置...' } = options;

  const [saved, setSaved] = useState<SettingsV3 | null>(null);
  const [working, setWorking] = useState<SettingsV3 | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(initialStatus);
  const [error, setError] = useState<OverlaySettingsError | null>(null);
  const [loadNonce, setLoadNonce] = useState(0);

  const savedRef = useRef<SettingsV3 | null>(null);
  const dirtyRef = useRef(false);

  const dirty = useMemo(() => {
    if (!saved || !working) {
      return false;
    }
    return JSON.stringify(saved) !== JSON.stringify(working);
  }, [saved, working]);

  useEffect(() => {
    savedRef.current = saved;
  }, [saved]);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const settings = await loadOverlaySettingsV3();
        if (cancelled) {
          return;
        }
        setSaved(settings);
        setWorking(settings);
        setStatus('配置已同步，可在视频页直接调节。');
      } catch {
        if (cancelled) {
          return;
        }
        setError({
          message: '读取配置失败，请刷新后重试。',
          suggestion: '如问题持续，可尝试在选项页恢复默认设置。',
        });
        setStatus('读取配置失败，请刷新后重试。');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadNonce]);

  useEffect(() => {
    return subscribeOverlaySettingsChanges((next) => {
      setSaved(next);
      setWorking((previous) => {
        if (!previous || !dirtyRef.current) {
          setStatus('已同步外部更新。');
          return next;
        }
        setStatus('检测到外部更新，当前保留未保存编辑。');
        return previous;
      });
    });
  }, []);

  const reload = useCallback(() => {
    setLoadNonce((previous) => previous + 1);
  }, []);

  const setWorkingDirect = useCallback((next: SettingsV3) => {
    setWorking(normalizeSettingsV3(next));
  }, []);

  const mutateWorking = useCallback((updater: (settings: SettingsV3) => SettingsV3) => {
    setWorking((previous) => {
      if (!previous) {
        return previous;
      }
      return normalizeSettingsV3(updater(cloneSettings(previous)));
    });
  }, []);

  const save = useCallback(
    async (message = '已保存到扩展设置。') => {
      if (!working) {
        return null;
      }
      setSaving(true);
      try {
        const persisted = await saveOverlaySettingsV3(working);
        setSaved(persisted);
        setWorking(persisted);
        setStatus(message);
        return persisted;
      } catch {
        setStatus('保存失败，请重试。');
        return null;
      } finally {
        setSaving(false);
      }
    },
    [working]
  );

  return {
    working,
    loading,
    saving,
    dirty,
    status,
    error,
    setStatus,
    setWorkingDirect,
    mutateWorking,
    save,
    reload,
  };
}
