import React, { useState, useRef, useCallback, createContext, useContext } from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  Modal,
  Animated,
} from 'react-native';
import { useTheme } from '../theme';

interface SettingsDrawerContextValue {
  open: () => void;
  close: () => void;
}

const SettingsDrawerContext = createContext<SettingsDrawerContextValue>({
  open: () => {},
  close: () => {},
});

export function useSettingsDrawer() {
  return useContext(SettingsDrawerContext);
}

interface SettingsDrawerLayoutProps {
  drawerContent: React.ReactNode;
  children: React.ReactNode;
}

const DRAWER_WIDTH = 300;

export function SettingsDrawerLayout({ drawerContent, children }: SettingsDrawerLayoutProps) {
  const { colors } = useTheme();
  const [visible, setVisible] = useState(false);
  const translateX = useRef(new Animated.Value(DRAWER_WIDTH)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;

  const openDrawer = useCallback(() => {
    translateX.setValue(DRAWER_WIDTH);
    overlayOpacity.setValue(0);
    setVisible(true);
  }, [translateX, overlayOpacity]);

  const closeDrawer = useCallback(() => {
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: DRAWER_WIDTH,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start(() => setVisible(false));
  }, [translateX, overlayOpacity]);

  function handleShow() {
    Animated.parallel([
      Animated.spring(translateX, {
        toValue: 0,
        bounciness: 0,
        speed: 20,
        useNativeDriver: true,
      }),
      Animated.timing(overlayOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }

  return (
    <SettingsDrawerContext.Provider value={{ open: openDrawer, close: closeDrawer }}>
      <View style={styles.container}>
        {children}

        <Modal
          visible={visible}
          transparent
          animationType="none"
          onRequestClose={closeDrawer}
          presentationStyle="overFullScreen"
          onShow={handleShow}
        >
          <View style={styles.modalContainer}>
            <Animated.View
              style={[
                styles.overlay,
                { backgroundColor: colors.overlay, opacity: overlayOpacity },
              ]}
            >
              <Pressable style={StyleSheet.absoluteFill} onPress={closeDrawer} />
            </Animated.View>

            <Animated.View
              style={[
                styles.drawer,
                { backgroundColor: colors.drawer },
                { transform: [{ translateX }] },
              ]}
            >
              {drawerContent}
            </Animated.View>
          </View>
        </Modal>
      </View>
    </SettingsDrawerContext.Provider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  modalContainer: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  drawer: {
    width: DRAWER_WIDTH,
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    shadowColor: '#000',
    shadowOffset: { width: -2, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
});
