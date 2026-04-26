import { palette } from './tokens';

export type ColorScheme = 'light' | 'dark';

export interface Colors {
  background: string;
  surface: string;
  surfaceRaised: string;
  surfaceOverlay: string;
  drawer: string;
  border: string;
  borderStrong: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textInverse: string;
  textLink: string;
  accent: string;
  accentMuted: string;
  accentForeground: string;
  unread: string;
  bookmarked: string;
  success: string;
  error: string;
  iconPrimary: string;
  iconSecondary: string;
  iconAccent: string;
  divider: string;
  placeholder: string;
  skeleton: string;
  skeletonHighlight: string;
  overlay: string;
  badgeBackground: string;
  badgeForeground: string;
  drawerDivider: string;
}

export const lightColors: Colors = {
  background: palette.white,
  surface: palette.white,
  surfaceRaised: palette.gray100,
  surfaceOverlay: palette.white,
  drawer: palette.white,
  border: palette.gray200,
  borderStrong: palette.gray400,
  textPrimary: palette.black,
  textSecondary: palette.gray500,
  textTertiary: palette.gray400,
  textInverse: palette.white,
  textLink: palette.black,
  accent: palette.black,
  accentMuted: palette.gray100,
  accentForeground: palette.white,
  unread: palette.black,
  bookmarked: palette.gray600,
  success: palette.green500,
  error: palette.red500,
  iconPrimary: palette.black,
  iconSecondary: palette.gray400,
  iconAccent: palette.black,
  divider: palette.gray100,
  placeholder: palette.gray300,
  skeleton: palette.gray100,
  skeletonHighlight: palette.gray200,
  overlay: 'rgba(0,0,0,0.3)',
  badgeBackground: palette.black,
  badgeForeground: palette.white,
  drawerDivider: '#D9D9D9',
};

export const darkColors: Colors = {
  background: palette.black,
  surface: palette.black,
  surfaceRaised: palette.gray900,
  surfaceOverlay: palette.gray900,
  drawer: palette.anthracite,
  border: palette.gray800,
  borderStrong: palette.gray700,
  textPrimary: palette.white,
  textSecondary: palette.gray400,
  textTertiary: palette.gray600,
  textInverse: palette.black,
  textLink: palette.white,
  accent: palette.white,
  accentMuted: palette.gray900,
  accentForeground: palette.black,
  unread: palette.white,
  bookmarked: palette.gray400,
  success: palette.green400,
  error: palette.red400,
  iconPrimary: palette.white,
  iconSecondary: palette.gray600,
  iconAccent: palette.white,
  divider: palette.gray900,
  placeholder: palette.gray700,
  skeleton: palette.gray900,
  skeletonHighlight: palette.gray800,
  overlay: 'rgba(0,0,0,0.7)',
  badgeBackground: palette.white,
  badgeForeground: palette.black,
  drawerDivider: '#121212',
};
