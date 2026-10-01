import { useMemo, useState } from 'react';
import { Animated, Modal, PanResponder, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { refreshFuel } from '../lib/fuel';
import { colors } from '../lib/theme';
import { useFuel } from '../lib/useFuel';
import { FuelFeed } from './FuelFeed';
import { styles } from './ui';

const DURATION = 220;

/** Side panel that slides in from the left with fuel price announcements. Swipe left or tap outside to close. */
export function FuelDrawer({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const fuel = useFuel();
  const panelWidth = Math.min(380, Math.round(width * 0.88));
  const [progress] = useState(() => new Animated.Value(0)); // 0 = hidden, 1 = open

  const open = () => {
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: DURATION,
      useNativeDriver: true,
    }).start();
    refreshFuel();
  };
  const close = () =>
    Animated.timing(progress, {
      toValue: 0,
      duration: DURATION,
      useNativeDriver: true,
    }).start(() => onClose());

  // Swipe left on the panel to close it.
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => g.dx < -12 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderMove: (_, g) => progress.setValue(Math.max(0, Math.min(1, 1 + g.dx / panelWidth))),
        onPanResponderRelease: (_, g) => {
          if (g.dx < -panelWidth / 4 || g.vx < -0.5)
            Animated.timing(progress, {
              toValue: 0,
              duration: DURATION,
              useNativeDriver: true,
            }).start(() => onClose());
          else
            Animated.timing(progress, {
              toValue: 1,
              duration: 120,
              useNativeDriver: true,
            }).start();
        },
      }),
    [panelWidth, progress, onClose],
  );

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-panelWidth, 0],
  });
  const backdrop = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.45],
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onShow={open}
      onRequestClose={close}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: '#000',
          opacity: backdrop,
        }}
      >
        <Pressable style={{ flex: 1 }} onPress={close} accessibilityLabel="Close fuel prices" />
      </Animated.View>

      <Animated.View
        {...pan.panHandlers}
        accessibilityViewIsModal
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          width: panelWidth,
          backgroundColor: colors.bg,
          transform: [{ translateX }],
          borderTopRightRadius: 20,
          borderBottomRightRadius: 20,
          overflow: 'hidden',
          elevation: 16,
          shadowColor: '#000',
          shadowOpacity: 0.25,
          shadowRadius: 12,
        }}
      >
        <View
          style={{
            backgroundColor: colors.header,
            paddingTop: insets.top + 14,
            paddingBottom: 16,
            paddingHorizontal: 18,
          }}
        >
          <View style={[styles.row, { justifyContent: 'space-between' }]}>
            <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800' }}>⛽ Fuel Prices</Text>
            <Pressable onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <Text style={{ color: '#fff', fontSize: 20 }}>✕</Text>
            </Pressable>
          </View>
          <Text style={{ color: '#9CA3AF', marginTop: 4 }}>Price hikes & rollbacks in the Philippines</Text>
        </View>
        <ScrollView
          contentContainerStyle={{
            padding: 14,
            paddingBottom: insets.bottom + 24,
          }}
        >
          <FuelFeed fuel={fuel} onOpenLink={close} />
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}
