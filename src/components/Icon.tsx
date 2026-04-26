import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';

type IconColor = 'primary' | 'secondary' | 'accent' | 'inverse' | 'error' | 'bookmarked';

interface IconProps {
  name: React.ComponentProps<typeof Ionicons>['name'];
  size?: number;
  color?: IconColor | string;
}

export function Icon({ name, size = 20, color = 'primary' }: IconProps) {
  const { colors } = useTheme();

  const colorMap: Record<IconColor, string> = {
    primary: colors.iconPrimary,
    secondary: colors.iconSecondary,
    accent: colors.iconAccent,
    inverse: colors.textInverse,
    error: colors.error,
    bookmarked: colors.bookmarked,
  };

  const resolvedColor = color in colorMap
    ? colorMap[color as IconColor]
    : color;

  return <Ionicons name={name} size={size} color={resolvedColor} />;
}
