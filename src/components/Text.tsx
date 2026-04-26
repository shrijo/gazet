import React from 'react';
import { Text as RNText, TextProps as RNTextProps, StyleSheet } from 'react-native';
import { useTheme } from '../theme';
import { lineHeight as lineHeightTokens } from '../theme/tokens';

type Variant =
  | 'displayLg'
  | 'displayMd'
  | 'headingLg'
  | 'headingMd'
  | 'headingSm'
  | 'bodyLg'
  | 'bodyMd'
  | 'bodySm'
  | 'labelLg'
  | 'labelMd'
  | 'labelSm'
  | 'caption';

type Color =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'inverse'
  | 'link'
  | 'accent'
  | 'error';

interface TextProps extends RNTextProps {
  variant?: Variant;
  color?: Color;
  children?: React.ReactNode;
}

export function Text({
  variant = 'bodyMd',
  color = 'primary',
  style,
  children,
  ...rest
}: TextProps) {
  const { colors, fontSize, fontWeight } = useTheme();
  const lineHeight = lineHeightTokens;

  const variantStyles: Record<Variant, object> = {
    displayLg: {
      fontSize: fontSize['3xl'],
      fontWeight: fontWeight.bold,
      lineHeight: fontSize['3xl'] * 1.2,
      letterSpacing: -0.5,
    },
    displayMd: {
      fontSize: fontSize['2xl'],
      fontWeight: fontWeight.bold,
      lineHeight: fontSize['2xl'] * 1.2,
      letterSpacing: -0.3,
    },
    headingLg: {
      fontSize: fontSize.xl,
      fontWeight: fontWeight.semibold,
      lineHeight: fontSize.xl * 1.3,
    },
    headingMd: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      lineHeight: fontSize.lg * 1.3,
    },
    headingSm: {
      fontSize: fontSize.md,
      fontWeight: fontWeight.semibold,
      lineHeight: fontSize.md * 1.3,
    },
    bodyLg: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.regular,
      lineHeight: fontSize.lg * 1.5,
    },
    bodyMd: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.regular,
      lineHeight: fontSize.base * 1.5,
    },
    bodySm: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.regular,
      lineHeight: fontSize.sm * 1.5,
    },
    labelLg: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.medium,
      lineHeight: fontSize.base * 1.4,
    },
    labelMd: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      lineHeight: fontSize.sm * 1.4,
    },
    labelSm: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      lineHeight: fontSize.xs * 1.4,
      letterSpacing: 0.3,
    },
    caption: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.regular,
      lineHeight: fontSize.xs * 1.4,
    },
  };

  const colorMap: Record<Color, string> = {
    primary: colors.textPrimary,
    secondary: colors.textSecondary,
    tertiary: colors.textTertiary,
    inverse: colors.textInverse,
    link: colors.textLink,
    accent: colors.accent,
    error: colors.error,
  };

  return (
    <RNText
      style={[variantStyles[variant], { color: colorMap[color] }, style]}
      {...rest}
    >
      {children}
    </RNText>
  );
}
