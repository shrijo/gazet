import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../theme';

interface DividerProps {
  inset?: number;
}

export function Divider({ inset = 0 }: DividerProps) {
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.divider,
        { backgroundColor: colors.divider, marginLeft: inset },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  divider: {
    height: StyleSheet.hairlineWidth,
    width: '100%',
  },
});
