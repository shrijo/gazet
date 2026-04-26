import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { useTheme } from '../theme';

interface SkeletonProps {
  width?: number;
  height?: number;
  style?: StyleProp<ViewStyle>;
}

export function Skeleton({ width, height = 16, style }: SkeletonProps) {
  const { colors, radius, animation } = useTheme();
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.4,
          duration: animation.slow,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: animation.slow,
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [animation.slow, opacity]);

  return (
    <Animated.View
      style={[
        {
          ...(width !== undefined ? { width } : { alignSelf: 'stretch' as const }),
          height,
          borderRadius: radius.sm,
          backgroundColor: colors.skeleton,
          opacity,
        },
        style,
      ]}
    />
  );
}
