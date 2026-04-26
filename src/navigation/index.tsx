import React from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ArticlesScreen } from '../screens/ArticlesScreen';
import { ArticleDetailScreen } from '../screens/ArticleDetailScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { DrawerContent } from '../screens/DrawerContent';
import { DrawerLayout } from './Drawer';
import { SettingsDrawerLayout } from './SettingsDrawer';
import { useTheme } from '../theme';

const Stack = createNativeStackNavigator();

function MainStack() {
  return (
    <SettingsDrawerLayout drawerContent={<SettingsScreen />}>
      <DrawerLayout drawerContent={<DrawerContent />}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Articles" component={ArticlesScreen} />
          <Stack.Screen
            name="ArticleDetail"
            component={ArticleDetailScreen}
            options={{ presentation: 'card' }}
          />
        </Stack.Navigator>
      </DrawerLayout>
    </SettingsDrawerLayout>
  );
}

export function AppNavigator() {
  const { colors, isDark } = useTheme();

  const navTheme = isDark
    ? {
        ...DarkTheme,
        colors: {
          ...DarkTheme.colors,
          background: colors.background,
          card: colors.surface,
          border: colors.border,
        },
      }
    : {
        ...DefaultTheme,
        colors: {
          ...DefaultTheme.colors,
          background: colors.background,
          card: colors.surface,
          border: colors.border,
        },
      };

  return (
    <NavigationContainer theme={navTheme}>
      <MainStack />
    </NavigationContainer>
  );
}
