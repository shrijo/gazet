import React, { useState } from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { Text } from './Text';
import { useTheme } from '../theme';

interface AvatarProps {
  uri?: string;
  name?: string;
  size?: number;
}

export function Avatar({ uri, name, size = 32 }: AvatarProps) {
  const { colors, radius } = useTheme();
  const [error, setError] = useState(false);

  const initials = name
    ? name
        .split(' ')
        .slice(0, 2)
        .map(w => w[0])
        .join('')
        .toUpperCase()
    : '?';

  const style = {
    width: size,
    height: size,
    borderRadius: radius.md,
    backgroundColor: colors.accentMuted,
  };

  if (uri && !error) {
    return (
      <Image
        source={{ uri }}
        style={style}
        onError={() => setError(true)}
        resizeMode="cover"
      />
    );
  }

  return (
    <View style={[style, styles.fallback]}>
      <Text
        variant="labelSm"
        color="accent"
        style={{ fontSize: size * 0.35 }}
      >
        {initials}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
