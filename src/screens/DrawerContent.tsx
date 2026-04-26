import React, { useState } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  TextInput,
  Modal,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text as RNText, Image } from 'react-native';
import { useTheme } from '../theme';
import { Text, Badge, Divider, ListItem, Button, Icon } from '../components';
import { useAppStore } from '../hooks/useAppStore';
import { FeedFilter, Folder, Feed } from '../types';

export function DrawerContent() {
  const { colors, spacing, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const { state, setFilter, addFeed, addFolder, removeFolder, removeFeed, moveFeed } =
    useAppStore();
  const { folders, feeds, filter, articles } = state;

  const openFolderId = React.useMemo(() => {
    if (filter.type === 'folder') return filter.folderId;
    if (filter.type === 'feed') {
      return feeds.find(f => f.id === filter.feedId)?.folderId;
    }
    return undefined;
  }, [filter, feeds]);
  const [showAddFolder, setShowAddFolder] = useState(false);
  const [showFeedActions, setShowFeedActions] = useState(false);
  const [selectedFeed, setSelectedFeed] = useState<Feed | null>(null);

  const [folderName, setFolderName] = useState('');
  const [showAddFeed, setShowAddFeed] = useState(false);
  const [feedUrl, setFeedUrl] = useState('');
  const [feedFolderId, setFeedFolderId] = useState<string | undefined>();
  const [addingFeed, setAddingFeed] = useState(false);

  const totalUnread = articles.filter(a => !a.isRead).length;
  const bookmarkCount = articles.filter(a => a.isBookmarked).length;

  function isActive(f: FeedFilter): boolean {
    return JSON.stringify(filter) === JSON.stringify(f);
  }

function unreadForFeed(feedId: string) {
    return articles.filter(a => a.feedId === feedId && !a.isRead).length;
  }

  function unreadForFolder(folderId: string) {
    const ids = new Set(feeds.filter(f => f.folderId === folderId).map(f => f.id));
    return articles.filter(a => ids.has(a.feedId) && !a.isRead).length;
  }

  async function handleAddFolder() {
    if (!folderName.trim()) return;
    await addFolder(folderName.trim());
    setShowAddFolder(false);
    setFolderName('');
  }

  async function handleAddFeed() {
    if (!feedUrl.trim()) return;
    setAddingFeed(true);
    try {
      await addFeed(feedUrl.trim(), feedFolderId);
      setShowAddFeed(false);
      setFeedUrl('');
      setFeedFolderId(undefined);
    } catch {
      Alert.alert('Error', 'Could not load feed. Check the URL and try again.');
    } finally {
      setAddingFeed(false);
    }
  }

  function openFeedActions(feed: Feed) {
    setSelectedFeed(feed);
    setShowFeedActions(true);
  }

  function handleRemoveFolder(folder: Folder) {
    const folderFeeds = feeds.filter(f => f.folderId === folder.id);
    Alert.alert('Delete Folder', `Delete "${folder.name}" and all its feeds?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          for (const feed of folderFeeds) {
            await removeFeed(feed.id);
          }
          await removeFolder(folder.id);
        },
      },
    ]);
  }

  function handleRemoveFeed(feed: Feed) {
    Alert.alert('Remove Feed', `Remove "${feed.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          removeFeed(feed.id);
          setShowFeedActions(false);
        },
      },
    ]);
  }

  async function handleMoveFeed(folderId: string | undefined) {
    if (!selectedFeed) return;
    await moveFeed(selectedFeed.id, folderId);
    setShowFeedActions(false);
  }

  const rootFeeds = feeds.filter(f => !f.folderId);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.drawer }]}
      edges={['bottom']}
    >
      {/* Section 1: Title */}
      <View style={[styles.header, { paddingHorizontal: spacing[4], paddingTop: insets.top }]}>
        <RNText style={[styles.title, { color: colors.textPrimary }]}>gazet.</RNText>
      </View>

      <View style={[styles.sectionDivider, { backgroundColor: colors.drawerDivider }]} />

      {/* Section 2: Feeds — grows with content, shrinks and scrolls when space is tight */}
      <ScrollView
        style={{ flexGrow: 0, flexShrink: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={undefined}
      >
        <ListItem
          left={<Icon name="layers-outline" size={18} color="secondary" />}
          center={<Text variant="labelLg">All Articles</Text>}
          right={totalUnread > 0 ? <Badge count={totalUnread} /> : null}
          active={isActive({ type: 'all' })}
          onPress={() => setFilter({ type: 'all' })}
          containerStyle={[
            styles.itemDivider,
            { borderColor: colors.drawerDivider },
            isActive({ type: 'all' }) && { backgroundColor: colors.drawerDivider },
          ]}
        />
        <ListItem
          left={<Icon name="bookmark-outline" size={18} color="secondary" />}
          center={<Text variant="labelLg">Bookmarks</Text>}
          right={bookmarkCount > 0 ? <Badge count={bookmarkCount} /> : null}
          active={isActive({ type: 'bookmarks' })}
          onPress={() => setFilter({ type: 'bookmarks' })}
          containerStyle={[
            styles.itemDivider,
            { borderColor: colors.drawerDivider },
            isActive({ type: 'bookmarks' }) && { backgroundColor: colors.drawerDivider },
          ]}
        />

        {folders.map(folder => {
          const isOpen = openFolderId === folder.id;
          const folderFeeds = feeds.filter(f => f.folderId === folder.id);
          const folderUnread = unreadForFolder(folder.id);
          const folderActive = isActive({ type: 'folder', folderId: folder.id });

          return (
            <View key={folder.id}>
              <ListItem
                left={<Icon name="folder-outline" size={18} color="secondary" />}
                center={<Text variant="labelLg">{folder.name}</Text>}
                right={folderUnread > 0 ? <Badge count={folderUnread} /> : null}
                active={folderActive}
                onPress={() => setFilter({ type: 'folder', folderId: folder.id })}
                onLongPress={() => handleRemoveFolder(folder)}
                containerStyle={[
                  !isOpen && styles.itemDivider,
                  !isOpen && { borderColor: colors.drawerDivider },
                  folderActive && { backgroundColor: colors.drawerDivider },
                ]}
              />
              {isOpen && (
                <>
                  {folderFeeds.map((feed, idx) => (
                    <FeedRow
                      key={feed.id}
                      feed={feed}
                      unread={unreadForFeed(feed.id)}
                      active={isActive({ type: 'feed', feedId: feed.id })}
                      onPress={() => setFilter({ type: 'feed', feedId: feed.id })}
                      onLongPress={() => openFeedActions(feed)}
                      indent
                      isLast={idx === folderFeeds.length - 1}
                    />
                  ))}
                  <View style={[styles.itemDivider, { borderColor: colors.drawerDivider }]} />
                </>
              )}
            </View>
          );
        })}

        {rootFeeds.map(feed => (
          <FeedRow
            key={feed.id}
            feed={feed}
            unread={unreadForFeed(feed.id)}
            active={isActive({ type: 'feed', feedId: feed.id })}
            onPress={() => setFilter({ type: 'feed', feedId: feed.id })}
            onLongPress={() => openFeedActions(feed)}
          />
        ))}
      </ScrollView>

      {/* Section 3: Actions — always visible below feeds */}
      <View>
        <View style={[styles.sectionDivider, { backgroundColor: colors.drawerDivider, marginTop: -1 }]} />
        <ListItem
          left={<Icon name="add-outline" size={18} color="secondary" />}
          center={<Text variant="labelMd" color="secondary">Add Feed</Text>}
          onPress={() => setShowAddFeed(true)}
        />
        <ListItem
          left={<Icon name="folder-open-outline" size={18} color="secondary" />}
          center={<Text variant="labelMd" color="secondary">New Folder</Text>}
          onPress={() => setShowAddFolder(true)}
        />
      </View>

      {/* Feed Actions Sheet */}
      <Modal
        visible={showFeedActions}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowFeedActions(false)}
      >
        <SafeAreaView
          style={[styles.modal, { backgroundColor: colors.surface }]}
          edges={['top', 'bottom']}
        >
          <View style={[styles.modalHeader, { paddingHorizontal: spacing[4] }]}>
            <Text variant="headingMd" numberOfLines={1} style={{ flex: 1, marginRight: spacing[3] }}>
              {selectedFeed?.title}
            </Text>
            <TouchableOpacity onPress={() => setShowFeedActions(false)}>
              <Text variant="labelMd" color="secondary">Close</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ paddingHorizontal: spacing[4], gap: spacing[3] }}>
            {/* Move to folder */}
            <Text variant="labelSm" color="tertiary" style={{ textTransform: 'uppercase' }}>
              Move to folder
            </Text>

            <View
              style={{
                borderRadius: radius.xl,
                borderWidth: 1,
                borderColor: colors.border,
                overflow: 'hidden',
              }}
            >
              {/* No folder option */}
              <TouchableOpacity
                style={[
                  styles.folderOption,
                  {
                    paddingHorizontal: spacing[4],
                    paddingVertical: spacing[3],
                    backgroundColor:
                      !selectedFeed?.folderId ? colors.accentMuted : colors.surface,
                  },
                ]}
                onPress={() => handleMoveFeed(undefined)}
              >
                <Text
                  variant="labelLg"
                  style={{ color: !selectedFeed?.folderId ? colors.accent : colors.textPrimary }}
                >
                  No Folder
                </Text>
                {!selectedFeed?.folderId && (
                  <Text variant="labelSm" style={{ marginLeft: 'auto', color: colors.accent }}>✓</Text>
                )}
              </TouchableOpacity>

              {folders.map((folder, idx) => {
                const isCurrent = selectedFeed?.folderId === folder.id;
                return (
                  <View key={folder.id}>
                    <Divider />
                    <TouchableOpacity
                      style={[
                        styles.folderOption,
                        {
                          paddingHorizontal: spacing[4],
                          paddingVertical: spacing[3],
                          backgroundColor: isCurrent ? colors.accentMuted : colors.surface,
                        },
                      ]}
                      onPress={() => handleMoveFeed(folder.id)}
                    >
                      <Text
                        variant="labelLg"
                        style={{ color: isCurrent ? colors.accent : colors.textPrimary }}
                      >
                        {folder.name}
                      </Text>
                      {isCurrent && (
                        <Text variant="labelSm" style={{ marginLeft: 'auto', color: colors.accent }}>✓</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>

            {/* Danger zone */}
            <View style={{ marginTop: spacing[2] }}>
              <Button
                label="Remove Feed"
                variant="danger"
                fullWidth
                icon="trash-outline"
                onPress={() => selectedFeed && handleRemoveFeed(selectedFeed)}
              />
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Add Feed Modal */}
      <Modal
        visible={showAddFeed}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowAddFeed(false)}
      >
        <SafeAreaView
          style={[styles.modal, { backgroundColor: colors.surface }]}
          edges={['top', 'bottom']}
        >
          <View style={[styles.modalHeader, { paddingHorizontal: spacing[4] }]}>
            <Text variant="headingMd">Add Feed</Text>
            <TouchableOpacity onPress={() => setShowAddFeed(false)}>
              <Text variant="labelMd" color="secondary">Close</Text>
            </TouchableOpacity>
          </View>
          <View style={{ paddingHorizontal: spacing[4], gap: spacing[3] }}>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                  color: colors.textPrimary,
                  borderRadius: radius.lg,
                  paddingHorizontal: spacing[4],
                },
              ]}
              placeholder="https://example.com/feed.xml"
              placeholderTextColor={colors.placeholder}
              value={feedUrl}
              onChangeText={setFeedUrl}
              autoCapitalize="none"
              keyboardType="url"
              autoCorrect={false}
              autoFocus
            />
            {folders.length > 0 && (
              <View>
                <Text variant="labelMd" color="secondary" style={{ marginBottom: spacing[2] }}>
                  Add to folder (optional)
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={{ flexDirection: 'row', gap: spacing[2] }}>
                    <TouchableOpacity
                      onPress={() => setFeedFolderId(undefined)}
                      style={[styles.chip, { backgroundColor: !feedFolderId ? colors.accent : colors.background }]}
                    >
                      <Text variant="labelSm" style={{ color: !feedFolderId ? colors.textInverse : colors.textPrimary }}>
                        No folder
                      </Text>
                    </TouchableOpacity>
                    {folders.map(f => (
                      <TouchableOpacity
                        key={f.id}
                        onPress={() => setFeedFolderId(f.id)}
                        style={[styles.chip, { backgroundColor: feedFolderId === f.id ? colors.accent : colors.background }]}
                      >
                        <Text variant="labelSm" style={{ color: feedFolderId === f.id ? colors.textInverse : colors.textPrimary }}>
                          {f.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </View>
            )}
            <Button
              label={addingFeed ? 'Adding…' : 'Add Feed'}
              fullWidth
              onPress={handleAddFeed}
            />
          </View>
        </SafeAreaView>
      </Modal>

      {/* Add Folder Modal */}
      <Modal
        visible={showAddFolder}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowAddFolder(false)}
      >
        <SafeAreaView
          style={[styles.modal, { backgroundColor: colors.surface }]}
          edges={['top', 'bottom']}
        >
          <View style={[styles.modalHeader, { paddingHorizontal: spacing[4] }]}>
            <Text variant="headingMd">New Folder</Text>
            <TouchableOpacity onPress={() => setShowAddFolder(false)}>
              <Text variant="labelMd" color="secondary">Close</Text>
            </TouchableOpacity>
          </View>
          <View style={{ paddingHorizontal: spacing[4], gap: spacing[3] }}>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                  color: colors.textPrimary,
                  borderRadius: radius.lg,
                  paddingHorizontal: spacing[4],
                },
              ]}
              placeholder="Folder name"
              placeholderTextColor={colors.placeholder}
              value={folderName}
              onChangeText={setFolderName}
              autoFocus
            />
            <Button label="Create Folder" fullWidth onPress={handleAddFolder} />
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function FeedRow({
  feed,
  unread,
  active,
  onPress,
  onLongPress,
  indent = false,
  isLast = false,
}: {
  feed: Feed;
  unread: number;
  active: boolean;
  onPress: () => void;
  onLongPress: () => void;
  indent?: boolean;
  isLast?: boolean;
}) {
  const { colors, spacing } = useTheme();
  const [faviconError, setFaviconError] = React.useState(false);

  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.5}
      style={[
        indent
          ? (active ? { backgroundColor: colors.drawerDivider } : undefined)
          : [styles.itemDivider, { borderColor: colors.drawerDivider }, active && { backgroundColor: colors.drawerDivider }],
        { position: 'relative' },
      ]}
    >
      {indent && (
        <View style={{ position: 'absolute', left: spacing[3], top: 0, bottom: 0, width: 24 }}>
          <View style={{
            position: 'absolute',
            left: 7,
            top: 0,
            bottom: isLast ? '50%' : 0,
            width: 1,
            backgroundColor: colors.textTertiary,
          }} />
          <View style={{
            position: 'absolute',
            left: 7,
            right: 6,
            top: '50%',
            height: 1,
            backgroundColor: colors.textTertiary,
          }} />
        </View>
      )}
      <View
        style={[
          styles.feedRow,
          {
            paddingVertical: spacing[2.5],
            paddingRight: spacing[3],
            paddingLeft: indent ? spacing[3] + 24 : spacing[3],
            opacity: active ? 1 : 0.45,
          },
        ]}
      >
        {feed.faviconUrl && !faviconError ? (
          <Image source={{ uri: feed.faviconUrl }} style={styles.favicon} onError={() => setFaviconError(true)} />
        ) : (
          <Icon name="radio-outline" size={16} color="secondary" />
        )}
        <Text
          variant="labelMd"
          numberOfLines={1}
          style={{ flex: 1, color: colors.textPrimary, marginLeft: 10 }}
        >
          {feed.title}
        </Text>
        {unread > 0 && <Badge count={unread} />}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 16,
  },
  title: {
    fontSize: 30,
    fontWeight: '900',
    fontStyle: 'italic',
    lineHeight: 34,
    letterSpacing: -1.5,
  },
  sectionDivider: { height: 1 },
  itemDivider: { borderBottomWidth: 1 },
  rowEnd: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  feedRow: { flexDirection: 'row', alignItems: 'center' },
  favicon: { width: 16, height: 16, borderRadius: 3 },
  modal: { flex: 1 },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    marginBottom: 8,
  },
  folderOption: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    height: 48,
    borderWidth: 1,
    fontSize: 15,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
  },
});
