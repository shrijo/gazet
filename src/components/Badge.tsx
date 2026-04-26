import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from './Text';
import { useTheme } from '../theme';

interface BadgeProps {
  count: number;
  max?: number;
}

export function Badge({ count, max = 99 }: BadgeProps) {
  const { colors, radius } = useTheme();

  if (count <= 0) return null;

  const label = count > max ? `${max}+` : String(count);

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: colors.badgeBackground,
          borderRadius: radius.full,
          minWidth: label.length > 1 ? 20 : 18,
        },
      ]}
    >
      <Text variant="labelSm" color="inverse" style={styles.label}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    height: 18,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    lineHeight: 13,
  },
});
