import { useEffect, useState } from 'react';
import type { ThemeMode } from './settings-bridge';

export type ResolvedThemeMode = 'light' | 'dark';

export const THEME_MODE_OPTIONS: ThemeMode[] = ['auto', 'light', 'dark'];

function getSystemDarkPreference(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

export function getThemeModeLabel(mode: ThemeMode): string {
  if (mode === 'light') {
    return '浅色';
  }
  if (mode === 'dark') {
    return '深色';
  }
  return '跟随系统';
}

export function resolveThemeMode(
  mode: ThemeMode,
  prefersDark = getSystemDarkPreference()
): ResolvedThemeMode {
  if (mode === 'light' || mode === 'dark') {
    return mode;
  }
  return prefersDark ? 'dark' : 'light';
}

export function useResolvedTheme(mode: ThemeMode): ResolvedThemeMode {
  const [prefersDark, setPrefersDark] = useState(() => getSystemDarkPreference());

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return () => {};
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const applyPreference = (matches: boolean) => {
      setPrefersDark(matches);
    };
    const handleChange = (event: MediaQueryListEvent) => {
      applyPreference(event.matches);
    };

    applyPreference(mediaQuery.matches);

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => {
        mediaQuery.removeEventListener('change', handleChange);
      };
    }

    mediaQuery.addListener(handleChange);
    return () => {
      mediaQuery.removeListener(handleChange);
    };
  }, []);

  return resolveThemeMode(mode, prefersDark);
}

export function useDocumentTheme(mode: ThemeMode): ResolvedThemeMode {
  const resolved = useResolvedTheme(mode);

  useEffect(() => {
    if (typeof document === 'undefined' || !document.body) {
      return () => {};
    }

    document.body.dataset.bsvTheme = resolved;
    document.body.dataset.bsvThemeMode = mode;
    return () => {
      delete document.body.dataset.bsvTheme;
      delete document.body.dataset.bsvThemeMode;
    };
  }, [mode, resolved]);

  return resolved;
}
