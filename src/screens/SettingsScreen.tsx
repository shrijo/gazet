import React, { useCallback } from 'react';
import {
  View,
  ScrollView,
  Switch,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { useTheme } from '../theme';
import { Text, Icon, ListItem } from '../components';
import { useAppStore } from '../hooks/useAppStore';
import { ThemeMode, ViewMode } from '../types';
import { importOPML, exportOPML } from '../services/opml';
import { File, Paths } from 'expo-file-system';
export function SettingsScreen() {
  const { colors, spacing, setMode } = useTheme();
  const insets = useSafeAreaInsets();
  const { state, updateSettings, importFeeds } = useAppStore();
  const { settings, folders, feeds } = state;

  const handleImportOPML = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ['text/xml', 'application/xml'] });
      if (result.canceled) return;
      const uri = result.assets[0].uri;
      const { folders: newFolders, feeds: newFeeds, errors } = await importOPML(uri);
      await importFeeds(newFolders, newFeeds);
      const msg = `Imported ${newFeeds.length} feed(s) and ${newFolders.length} folder(s).` +
        (errors.length ? `\n\n${errors.length} feed(s) failed to load.` : '');
      Alert.alert('Import Complete', msg);
    } catch {
      Alert.alert('Import Failed', 'Could not read the OPML file.');
    }
  }, [importFeeds]);

  const handleExportOPML = useCallback(async () => {
    const xml = exportOPML(folders, feeds);
    const file = new File(Paths.document, 'gazet-subscriptions.opml');
    file.write(xml);
    Alert.alert('Exported', 'Saved to gazet-subscriptions.opml in app documents.');
  }, [folders, feeds]);

  const divider = { borderBottomWidth: 1, borderBottomColor: colors.drawerDivider };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.drawer }]}
      edges={['bottom']}
    >
      <View style={{ paddingTop: insets.top }}>
        <View style={[styles.header, { paddingHorizontal: spacing[4] }]}>
          <Text variant="headingMd" style={{ color: colors.textPrimary }}>Settings</Text>
        </View>
      </View>

      <View style={{ height: 1, backgroundColor: colors.drawerDivider }} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: spacing[8] }}
      >
        <SectionLabel title="Appearance" spacing={spacing} colors={colors} />

        <Row label="Theme">
          <SegmentedControl
            options={[
              { label: 'System', value: 'system' },
              { label: 'Light', value: 'light' },
              { label: 'Dark', value: 'dark' },
            ]}
            selected={settings.themeMode}
            onSelect={v => {
              const m = v as ThemeMode;
              updateSettings({ themeMode: m });
              setMode(m);
            }}
          />
        </Row>

        <Row label="Default View">
          <SegmentedControl
            options={[
              { label: 'Cards', value: 'card' },
              { label: 'List', value: 'list' },
              { label: 'Reel', value: 'reel' },
            ]}
            selected={settings.viewMode}
            onSelect={v => updateSettings({ viewMode: v as ViewMode })}
          />
        </Row>

        <Row label="Show Images" style={divider}>
          <Switch
            value={settings.showImages}
            onValueChange={v => updateSettings({ showImages: v })}
            trackColor={{ true: colors.textPrimary }}
            thumbColor={colors.textInverse}
          />
        </Row>

        <Row label="Unread Badges" style={divider}>
          <Switch
            value={settings.showUnreadBadges}
            onValueChange={v => updateSettings({ showUnreadBadges: v })}
            trackColor={{ true: colors.textPrimary }}
            thumbColor={colors.textInverse}
          />
        </Row>

        <Row label="Hide Read Articles" style={divider}>
          <Switch
            value={settings.hideReadArticles}
            onValueChange={v => updateSettings({ hideReadArticles: v })}
            trackColor={{ true: colors.textPrimary }}
            thumbColor={colors.textInverse}
          />
        </Row>

        <ListItem
          left={<Icon name="cloud-upload-outline" size={18} color="secondary" />}
          center={<Text variant="labelMd" color="secondary">Import OPML</Text>}
          onPress={handleImportOPML}
          containerStyle={{ marginTop: spacing[2] }}
        />
        <ListItem
          left={<Icon name="cloud-download-outline" size={18} color="secondary" />}
          center={<Text variant="labelMd" color="secondary">Export OPML</Text>}
          onPress={handleExportOPML}
          containerStyle={{ borderBottomWidth: 1, borderBottomColor: colors.drawerDivider, paddingBottom: spacing[2] }}
        />

        <Text
          variant="labelSm"
          style={{
            color: colors.textTertiary,
            textTransform: 'uppercase',
            paddingHorizontal: spacing[4],
            paddingTop: spacing[4],
            paddingBottom: spacing[2],
          }}
        >
          Version 1.0.0
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionLabel({ title, spacing, colors }: { title: string; spacing: any; colors: any }) {
  return (
    <Text
      variant="labelSm"
      style={{
        color: colors.textTertiary,
        textTransform: 'uppercase',
        paddingHorizontal: spacing[4],
        paddingTop: spacing[5],
        paddingBottom: spacing[2],
      }}
    >
      {title}
    </Text>
  );
}

function Row({ label, children, style }: { label: string; children: React.ReactNode; style?: object }) {
  const { colors, spacing } = useTheme();
  return (
    <View
      style={[
        styles.row,
        { paddingHorizontal: spacing[4], paddingVertical: spacing[3], backgroundColor: colors.drawer },
        style,
      ]}
    >
      <Text variant="labelLg" style={{ color: colors.textPrimary }}>{label}</Text>
      {children}
    </View>
  );
}

function SegmentedControl<T extends string>({
  options,
  selected,
  onSelect,
}: {
  options: { label: string; value: T }[];
  selected: T;
  onSelect: (v: T) => void;
}) {
  const { colors, spacing } = useTheme();
  return (
    <View style={styles.segmented}>
      {options.map(opt => (
        <TouchableOpacity
          key={opt.value}
          onPress={() => onSelect(opt.value)}
          style={[
            styles.segment,
            {
              backgroundColor: selected === opt.value ? colors.drawerDivider : 'transparent',
              paddingHorizontal: spacing[2],
              paddingVertical: spacing[1],
            },
          ]}
        >
          <Text
            variant="labelSm"
            style={{
              color: selected === opt.value ? colors.textPrimary : colors.textTertiary,
            }}
          >
            {opt.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    height: 56, // matches HEADER_HEIGHT in ArticlesScreen so the divider lines up
    flexDirection: 'row',
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
  },
  segmented: {
    flexDirection: 'row',
    gap: 2,
  },
  segment: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
  },
});
