import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { store } from './store';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'edens_theme';

interface ThemeContextValue {
  themeMode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setThemeMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') {
      return saved;
    }
  } catch {}
  const fromStore = store.getValue('themeMode');
  if (fromStore === 'light' || fromStore === 'dark' || fromStore === 'system') {
    return fromStore;
  }
  return 'system';
}

function getSystemPreferredTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === 'system' ? getSystemPreferredTheme() : mode;
}

function applyResolvedThemeToDom(resolved: ResolvedTheme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.dataset.theme = resolved;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => readStoredThemeMode());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => {
    const initial = resolveTheme(readStoredThemeMode());
    applyResolvedThemeToDom(initial);
    return initial;
  });

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {}
    store.setValue('themeMode', mode);
    const nextResolved = resolveTheme(mode);
    setResolvedTheme(nextResolved);
    applyResolvedThemeToDom(nextResolved);
  }, []);

  const toggleTheme = useCallback(() => {
    const nextMode: ThemeMode = resolvedTheme === 'dark' ? 'light' : 'dark';
    setThemeMode(nextMode);
  }, [resolvedTheme, setThemeMode]);

  useEffect(() => {
    const nextResolved = resolveTheme(themeMode);
    setResolvedTheme(nextResolved);
    applyResolvedThemeToDom(nextResolved);

    if (themeMode !== 'system' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      const updated = mediaQuery.matches ? 'dark' : 'light';
      setResolvedTheme(updated);
      applyResolvedThemeToDom(updated);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [themeMode]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      const val = event.newValue;
      if (val === 'light' || val === 'dark' || val === 'system') {
        setThemeModeState(val);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const contextValue = useMemo<ThemeContextValue>(
    () => ({
      themeMode,
      resolvedTheme,
      setThemeMode,
      toggleTheme
    }),
    [themeMode, resolvedTheme, setThemeMode, toggleTheme]
  );

  return <ThemeContext.Provider value={contextValue}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}
