'use client';

import * as React from 'react';

export type Theme = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  enableSystem?: boolean;
  attribute?: 'class' | string;
  disableTransitionOnChange?: boolean;
};

type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
};

const STORAGE_KEY = 'blostem-codex-theme';
const LEGACY_STORAGE_KEY = 'theme';

const ThemeContext = React.createContext<ThemeContextValue>({
  theme: 'dark',
  resolvedTheme: 'dark',
  setTheme: () => {},
});

function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === 'system' ? getSystemTheme() : theme;
}

function getStoredTheme(defaultTheme: Theme): Theme {
  if (typeof window === 'undefined') return defaultTheme;

  const storedTheme = window.localStorage.getItem(STORAGE_KEY);
  if (isTheme(storedTheme)) return storedTheme;

  const legacyTheme = window.localStorage.getItem(LEGACY_STORAGE_KEY);
  return isTheme(legacyTheme) ? legacyTheme : defaultTheme;
}

export function ThemeProvider({
  children,
  defaultTheme = 'dark',
  enableSystem = true,
}: ThemeProviderProps) {
  const [theme, setThemeState] = React.useState<Theme>(defaultTheme);
  const [resolvedTheme, setResolvedTheme] = React.useState<ResolvedTheme>(
    defaultTheme === 'light' ? 'light' : 'dark'
  );

  React.useEffect(() => {
    const loadTimer = window.setTimeout(() => {
      setThemeState(getStoredTheme(defaultTheme));
    }, 0);

    return () => window.clearTimeout(loadTimer);
  }, [defaultTheme]);

  React.useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    const applyTheme = () => {
      const nextTheme = theme === 'system' && !enableSystem ? defaultTheme : theme;
      const nextResolvedTheme = resolveTheme(nextTheme);

      document.documentElement.classList.toggle('dark', nextResolvedTheme === 'dark');
      document.documentElement.style.colorScheme = nextResolvedTheme;
      setResolvedTheme(nextResolvedTheme);
    };

    const applyTimer = window.setTimeout(applyTheme, 0);

    if (theme === 'system' && enableSystem) {
      media.addEventListener('change', applyTheme);
    }

    return () => {
      window.clearTimeout(applyTimer);
      media.removeEventListener('change', applyTheme);
    };
  }, [defaultTheme, enableSystem, theme]);

  const setTheme = React.useCallback((nextTheme: Theme) => {
    setThemeState(nextTheme);
    try {
      window.localStorage.setItem(STORAGE_KEY, nextTheme);
      window.localStorage.setItem(LEGACY_STORAGE_KEY, nextTheme);
    } catch {
      // Storage can be blocked in private or hardened browsing modes.
    }
  }, []);

  const value = React.useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [resolvedTheme, setTheme, theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return React.useContext(ThemeContext);
}
