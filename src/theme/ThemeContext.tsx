import React, { createContext, useContext, useState, useEffect } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors, lightColors, darkColors, ColorScheme } from './colors';
import { spacing, radius, fontSize, fontWeight, shadow, animation } from './tokens';

type ThemeMode = 'system' | 'light' | 'dark';

interface Theme {
  colors: Colors;
  spacing: typeof spacing;
  radius: typeof radius;
  fontSize: typeof fontSize;
  fontWeight: typeof fontWeight;
  shadow: typeof shadow;
  animation: typeof animation;
  isDark: boolean;
  mode: ThemeMode;
}

interface ThemeContextValue extends Theme {
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setMode] = useState<ThemeMode>('system');

  useEffect(() => {
    AsyncStorage.getItem('@kern/settings').then(raw => {
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved?.themeMode) setMode(saved.themeMode);
    }).catch(() => {});
  }, []);

  const resolvedScheme: ColorScheme =
    mode === 'system'
      ? systemScheme === 'dark' ? 'dark' : 'light'
      : mode;

  const isDark = resolvedScheme === 'dark';
  const colors = isDark ? darkColors : lightColors;

  const theme: ThemeContextValue = {
    colors,
    spacing,
    radius,
    fontSize,
    fontWeight,
    shadow,
    animation,
    isDark,
    mode,
    setMode,
  };

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
