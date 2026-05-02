import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  TextInput,
  Modal,
  FlatList,
  ActivityIndicator,
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
  const { folders, feeds, filter, settings } = state;
  const showBadges = settings.showUnreadBadges;

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

  const totalUnread = feeds.reduce((sum, f) => sum + (f.unreadCount ?? 0), 0);
  const bookmarkCount = 0;

  function isActive(f: FeedFilter): boolean {
    return JSON.stringify(filter) === JSON.stringify(f);
  }

  function unreadForFeed(feedId: string) {
    return feeds.find(f => f.id === feedId)?.unreadCount ?? 0;
  }

  function unreadForFolder(folderId: string) {
    return feeds
      .filter(f => f.folderId === folderId)
      .reduce((sum, f) => sum + (f.unreadCount ?? 0), 0);
  }

  async function handleAddFolder() {
    if (!folderName.trim()) return;
    await addFolder(folderName.trim());
    setShowAddFolder(false);
    setFolderName('');
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
          right={showBadges && totalUnread > 0 ? <Badge count={totalUnread} /> : null}
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
          right={showBadges && bookmarkCount > 0 ? <Badge count={bookmarkCount} /> : null}
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
                right={showBadges && folderUnread > 0 ? <Badge count={folderUnread} /> : null}
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
                      showBadges={showBadges}
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
            showBadges={showBadges}
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
        presentationStyle="fullScreen"
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
              <Icon name="close-outline" size={24} color="secondary" />
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

      <AddFeedModal
        visible={showAddFeed}
        folders={folders}
        onClose={() => setShowAddFeed(false)}
        onAdd={addFeed}
      />

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
              <Icon name="close-outline" size={24} color="secondary" />
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

// ---------------------------------------------------------------------------
// Add Feed Modal — search-as-you-type via Feedly public API
// ---------------------------------------------------------------------------

interface FeedSearchResult {
  feedId: string;
  title: string;
  description?: string;
  subscribers?: number;
  iconUrl?: string;
  website?: string;
}

function formatSubscribers(n?: number): string {
  if (!n) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M subscribers`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k subscribers`;
  return `${n} subscribers`;
}

function urlFromFeedId(feedId: string): string {
  return feedId.startsWith('feed/') ? feedId.slice(5) : feedId;
}

function looksLikeUrl(s: string): boolean {
  return s.startsWith('http://') || s.startsWith('https://') || s.startsWith('www.');
}

function ResultIcon({ uri }: { uri: string }) {
  const [error, setError] = useState(false);
  if (error) return <Icon name="radio-outline" size={18} color="secondary" />;
  return (
    <Image
      source={{ uri }}
      style={styles.resultFavicon}
      onError={() => setError(true)}
    />
  );
}

function AddFeedModal({
  visible,
  folders,
  onClose,
  onAdd,
}: {
  visible: boolean;
  folders: Folder[];
  onClose: () => void;
  onAdd: (url: string, folderId?: string) => Promise<void>;
}) {
  const { colors, spacing, radius } = useTheme();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FeedSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingUrl, setAddingUrl] = useState<string | null>(null);
  const [folderId, setFolderId] = useState<string | undefined>();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset on open/close
  useEffect(() => {
    if (!visible) {
      setQuery('');
      setResults([]);
      setSearching(false);
      setAddingUrl(null);
      setFolderId(undefined);
    }
  }, [visible]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q) { setResults([]); setSearching(false); return; }

    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://cloud.feedly.com/v3/search/feeds?query=${encodeURIComponent(q)}&count=20`,
        );
        const data = await res.json();
        setResults(data.results ?? []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const handleAdd = useCallback(async (url: string) => {
    setAddingUrl(url);
    try {
      await onAdd(url, folderId);
      onClose();
    } catch {
      Alert.alert('Error', 'Could not load feed. Check the URL and try again.');
    } finally {
      setAddingUrl(null);
    }
  }, [onAdd, folderId, onClose]);

  const directUrl = looksLikeUrl(query.trim())
    ? (query.trim().startsWith('www.') ? `https://${query.trim()}` : query.trim())
    : null;

  const renderResult = useCallback(({ item }: { item: FeedSearchResult }) => {
    const url = urlFromFeedId(item.feedId);
    const isAdding = addingUrl === url;
    return (
      <TouchableOpacity
        onPress={() => handleAdd(url)}
        activeOpacity={0.6}
        disabled={addingUrl !== null}
        style={[styles.resultRow, { paddingHorizontal: spacing[4], paddingVertical: spacing[3] }]}
      >
        <View style={styles.resultIcon}>
          {item.iconUrl ? (
            <ResultIcon uri={item.iconUrl} />
          ) : (
            <Icon name="radio-outline" size={18} color="secondary" />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="labelLg" numberOfLines={1}>{item.title}</Text>
          {item.description ? (
            <Text variant="bodySm" color="secondary" numberOfLines={1} style={{ marginTop: 1 }}>
              {item.description}
            </Text>
          ) : null}
          {item.subscribers ? (
            <Text variant="caption" color="tertiary" style={{ marginTop: 2 }}>
              {formatSubscribers(item.subscribers)}
            </Text>
          ) : null}
        </View>
        {isAdding
          ? <ActivityIndicator size="small" color={colors.textTertiary} />
          : <Icon name="add-circle-outline" size={22} color="secondary" />
        }
      </TouchableOpacity>
    );
  }, [addingUrl, handleAdd, colors, spacing]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaView style={[styles.modal, { backgroundColor: colors.surface }]} edges={['top', 'bottom']}>

        {/* ── Fixed top section ── */}
        <View>
          <View style={[styles.modalHeader, { paddingHorizontal: spacing[4] }]}>
            <Text variant="headingMd">Add Feed</Text>
            <TouchableOpacity onPress={onClose}>
              <Icon name="close-outline" size={24} color="secondary" />
            </TouchableOpacity>
          </View>

          {/* Search input */}
          <View style={{ paddingHorizontal: spacing[4], marginBottom: spacing[3] }}>
            <View style={[styles.searchBox, {
              backgroundColor: colors.background,
              borderColor: colors.border,
              borderRadius: radius.lg,
            }]}>
              <Icon name="search-outline" size={18} color="secondary" />
              <TextInput
                style={[styles.searchInput, { color: colors.textPrimary }]}
                placeholder="Search or paste URL…"
                placeholderTextColor={colors.placeholder}
                value={query}
                onChangeText={setQuery}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                autoFocus
              />
              {searching && <ActivityIndicator size="small" color={colors.textTertiary} />}
              {!searching && query.length > 0 && (
                <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
                  <Icon name="close-circle" size={18} color="secondary" />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Folder picker */}
          {folders.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: spacing[4], gap: spacing[2] }}
              style={{ marginBottom: spacing[3] }}
            >
              <TouchableOpacity
                onPress={() => setFolderId(undefined)}
                style={[styles.chip, {
                  backgroundColor: !folderId ? colors.accent : colors.background,
                  borderColor: !folderId ? colors.accent : colors.border,
                }]}
              >
                <Text variant="labelSm" style={{ color: !folderId ? colors.textInverse : colors.textPrimary }}>
                  No folder
                </Text>
              </TouchableOpacity>
              {folders.map(f => (
                <TouchableOpacity
                  key={f.id}
                  onPress={() => setFolderId(f.id)}
                  style={[styles.chip, {
                    backgroundColor: folderId === f.id ? colors.accent : colors.background,
                    borderColor: folderId === f.id ? colors.accent : colors.border,
                  }]}
                >
                  <Text variant="labelSm" style={{ color: folderId === f.id ? colors.textInverse : colors.textPrimary }}>
                    {f.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          <Divider />

          {/* Direct URL row */}
          {directUrl && (
            <>
              <TouchableOpacity
                onPress={() => handleAdd(directUrl)}
                activeOpacity={0.6}
                disabled={addingUrl !== null}
                style={[styles.resultRow, { paddingHorizontal: spacing[4], paddingVertical: spacing[3] }]}
              >
                <View style={styles.resultIcon}>
                  <Icon name="link-outline" size={18} color="secondary" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text variant="labelLg">Subscribe to URL</Text>
                  <Text variant="bodySm" color="tertiary" numberOfLines={1}>{directUrl}</Text>
                </View>
                {addingUrl === directUrl
                  ? <ActivityIndicator size="small" color={colors.textTertiary} />
                  : <Icon name="add-circle-outline" size={22} color="secondary" />
                }
              </TouchableOpacity>
              {results.length > 0 && <Divider />}
            </>
          )}
        </View>

        {/* ── Scrollable results ── */}
        <FlatList
          style={{ flex: 1 }}
          data={results}
          keyExtractor={r => r.feedId}
          renderItem={renderResult}
          ItemSeparatorComponent={Divider}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            !searching && query.trim().length > 0 ? (
              <View style={{ alignItems: 'center', paddingTop: 48 }}>
                <Icon name="search-outline" size={36} color="secondary" />
                <Text variant="bodyMd" color="secondary" style={{ marginTop: spacing[3] }}>
                  No feeds found
                </Text>
                <Text variant="bodySm" color="tertiary" style={{ marginTop: spacing[1] }}>
                  Try a different term or paste a URL
                </Text>
              </View>
            ) : null
          }
        />
      </SafeAreaView>
    </Modal>
  );
}

function FeedRow({
  feed,
  unread,
  active,
  showBadges,
  onPress,
  onLongPress,
  indent = false,
  isLast = false,
}: {
  feed: Feed;
  unread: number;
  active: boolean;
  showBadges: boolean;
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
        {showBadges && unread > 0 && <Badge count={unread} />}
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
    borderRadius: 20,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 12,
    gap: 8,
    height: 44,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    height: '100%',
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  resultIcon: {
    width: 32,
    alignItems: 'center',
  },
  resultFavicon: {
    width: 22,
    height: 22,
    borderRadius: 4,
  },
});
