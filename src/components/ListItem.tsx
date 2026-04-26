import React from 'react';
import {
  TouchableOpacity,
  View,
  StyleSheet,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { useTheme } from '../theme';

interface ListItemProps {
  left?: React.ReactNode;
  center: React.ReactNode;
  right?: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  active?: boolean;
  disabled?: boolean;
}

export function ListItem({
  left,
  center,
  right,
  onPress,
  onLongPress,
  style,
  containerStyle,
  active = false,
  disabled = false,
}: ListItemProps) {
  const { spacing } = useTheme();

  const content = (
    <View
      style={[
        styles.row,
        {
          paddingVertical: spacing[2.5],
          paddingHorizontal: spacing[3],
          opacity: active ? 1 : 0.45,
        },
        style,
      ]}
    >
      {left && <View style={styles.left}>{left}</View>}
      <View style={styles.center}>{center}</View>
      {right && <View style={styles.right}>{right}</View>}
    </View>
  );

  if (onPress || onLongPress) {
    return (
      <TouchableOpacity onPress={onPress} onLongPress={onLongPress} activeOpacity={0.5} disabled={disabled} style={containerStyle}>
        {content}
      </TouchableOpacity>
    );
  }

  return <View style={containerStyle}>{content}</View>;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  left: {
    marginRight: 10,
  },
  center: {
    flex: 1,
  },
  right: {
    marginLeft: 8,
  },
});
