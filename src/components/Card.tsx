import React from 'react';
import {
  TouchableOpacity,
  View,
  StyleSheet,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { useTheme } from '../theme';

interface CardProps {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  elevated?: boolean;
  noPadding?: boolean;
}

export function Card({
  children,
  onPress,
  style,
  elevated = false,
  noPadding = false,
}: CardProps) {
  const { colors, radius, shadow, spacing } = useTheme();

  const baseStyle = {
    padding: noPadding ? 0 : spacing[4],
    overflow: 'hidden' as const,
    ...(elevated ? shadow.md : {}),
  };

  if (onPress) {
    return (
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.85}
        style={[baseStyle, style]}
      >
        {children}
      </TouchableOpacity>
    );
  }

  return <View style={[baseStyle, style]}>{children}</View>;
}
