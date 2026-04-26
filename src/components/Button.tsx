import React from 'react';
import {
  TouchableOpacity,
  View,
  StyleSheet,
  ActivityIndicator,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { Icon } from './Icon';
import { useTheme } from '../theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps {
  label?: string;
  variant?: Variant;
  size?: Size;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  iconPosition?: 'left' | 'right';
  loading?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  fullWidth?: boolean;
}

export function Button({
  label,
  variant = 'primary',
  size = 'md',
  icon,
  iconPosition = 'left',
  loading = false,
  disabled = false,
  onPress,
  style,
  fullWidth = false,
}: ButtonProps) {
  const { colors, radius, spacing } = useTheme();

  const variantStyle: Record<Variant, { bg: string; border?: string; text: string }> = {
    primary: {
      bg: colors.accent,
      text: colors.accentForeground,
    },
    secondary: {
      bg: colors.surface,
      border: colors.border,
      text: colors.textPrimary,
    },
    ghost: {
      bg: 'transparent',
      text: colors.textPrimary,
    },
    danger: {
      bg: colors.error,
      text: colors.textInverse,
    },
  };

  const sizeStyle: Record<Size, { height: number; px: number; iconSize: number }> = {
    sm: { height: 32, px: spacing[3], iconSize: 14 },
    md: { height: 40, px: spacing[4], iconSize: 16 },
    lg: { height: 48, px: spacing[5], iconSize: 18 },
  };

  const v = variantStyle[variant];
  const s = sizeStyle[size];
  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.7}
      style={[
        styles.base,
        {
          height: s.height,
          paddingHorizontal: s.px,
          backgroundColor: v.bg,
          borderRadius: radius.lg,
          borderWidth: v.border ? 1 : 0,
          borderColor: v.border,
          opacity: isDisabled ? 0.5 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={v.text} />
      ) : (
        <View style={styles.content}>
          {icon && iconPosition === 'left' && (
            <View style={styles.iconLeft}>
              <Icon name={icon} size={s.iconSize} color={v.text} />
            </View>
          )}
          {label && (
            <Text
              variant={size === 'sm' ? 'labelMd' : 'labelLg'}
              style={{ color: v.text }}
            >
              {label}
            </Text>
          )}
          {icon && iconPosition === 'right' && (
            <View style={styles.iconRight}>
              <Icon name={icon} size={s.iconSize} color={v.text} />
            </View>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconLeft: {
    marginRight: 6,
  },
  iconRight: {
    marginLeft: 6,
  },
});
