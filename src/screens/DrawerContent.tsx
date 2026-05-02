import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  useWindowDimensions,
  Alert,
  TextInput,
  Modal,
  FlatList,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  PanResponder,
  LayoutAnimation,
  UIManager,
  Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text as RNText } from 'react-native';
import { useTheme } from '../theme';
import { Text, Badge, Divider, ListItem, Button, Icon } from '../components';
import { useAppStore } from '../hooks/useAppStore';
import { useDrawer } from '../navigation/Drawer';
import { FeedFilter, Folder, Feed } from '../types';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ---------------------------------------------------------------------------
// DrawerContent
// ---------------------------------------------------------------------------

export function DrawerContent() {
  const { colors, spacing, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const { close: closeDrawer } = useDrawer();
  const {
    state, setFilter, addFeed, addFolder, updateFolder,
    removeFolder, removeFeed, moveFeed, reorderFolders, reorderFeeds,
  } = useAppStore();
  const { folders, feeds, filter, settings } = state;
  const showBadges = settings.showUnreadBadges;

  const [isEditing, setIsEditing]         = useState(false);
  const [isDragging, setIsDragging]       = useState(false);
  const [showAddFolder, setShowAddFolder] = useState(false);
  const [showFeedActions, setShowFeedActions] = useState(false);
  const [selectedFeed, setSelectedFeed]   = useState<Feed | null>(null);
  const [folderName, setFolderName]       = useState('');
  const [showAddFeed, setShowAddFeed]     = useState(false);
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null);
  const [openFolderIds, setOpenFolderIds] = useState<Set<string>>(new Set());

  // Open all folders when entering edit mode
  useEffect(() => {
    if (isEditing) setOpenFolderIds(new Set(folders.map(f => f.id)));
  }, [isEditing]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleFolderOpen(folderId: string) {
    setOpenFolderIds(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId); else next.add(folderId);
      return next;
    });
  }

  // Normal-mode accordion state — independent of the active filter
  const [normalOpenFolderIds, setNormalOpenFolderIds] = useState<Set<string>>(() => {
    const s = new Set<string>();
    if (filter.type === 'folder') s.add(filter.folderId);
    if (filter.type === 'feed') { const fid = feeds.find(f => f.id === filter.feedId)?.folderId; if (fid) s.add(fid); }
    return s;
  });
  function toggleNormalFolder(folderId: string) {
    setNormalOpenFolderIds(prev => { const n = new Set(prev); if (n.has(folderId)) n.delete(folderId); else n.add(folderId); return n; });
  }

  const totalUnread   = feeds.reduce((s, f) => s + (f.unreadCount ?? 0), 0);
  const bookmarkCount = 0;
  const rootFeeds     = feeds.filter(f => !f.folderId);

  // Each folder + its feeds as one draggable group
  type FolderGroup = { id: string; folder: Folder; feeds: Feed[] };
  const folderGroups = React.useMemo<FolderGroup[]>(
    () => folders.map(folder => ({ id: folder.id, folder, feeds: feeds.filter(f => f.folderId === folder.id) })),
    [folders, feeds],
  );

  function isActive(f: FeedFilter) { return JSON.stringify(filter) === JSON.stringify(f); }
  function unreadForFeed(id: string) { return feeds.find(f => f.id === id)?.unreadCount ?? 0; }
  function unreadForFolder(id: string) {
    return feeds.filter(f => f.folderId === id).reduce((s, f) => s + (f.unreadCount ?? 0), 0);
  }

  async function handleAddFolder() {
    if (!folderName.trim()) return;
    await addFolder(folderName.trim());
    setShowAddFolder(false);
    setFolderName('');
  }

  async function handleDeleteFolder(folder: Folder) {
    for (const f of feeds.filter(f => f.folderId === folder.id)) await removeFeed(f.id);
    await removeFolder(folder.id);
  }

  function handleRemoveFeed(feed: Feed) {
    Alert.alert('Remove Feed', `Remove "${feed.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => { removeFeed(feed.id); setShowFeedActions(false); } },
    ]);
  }

  function handleReorderGroups(next: FolderGroup[]) {
    reorderFolders(next.map(g => g.folder));
    // Preserve intra-folder order; just re-sequence the groups
    reorderFeeds([...next.flatMap(g => g.feeds), ...rootFeeds]);
  }
  function handleReorderFolderFeeds(folderId: string, next: Feed[]) {
    const others = feeds.filter(f => f.folderId !== folderId);
    reorderFeeds([...others, ...next]);
  }
  function handleReorderRootFeeds(next: Feed[]) {
    reorderFeeds([...feeds.filter(f => f.folderId), ...next]);
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.drawer }]} edges={['bottom']}>

      {/* ── Header — title only, no edit button ── */}
      <View style={{ paddingTop: insets.top }}>
        <View style={[styles.header, { paddingHorizontal: spacing[4] }]}>
          <RNText style={[styles.title, { color: colors.textPrimary }]}>gazet.</RNText>
        </View>
      </View>

      <View style={[styles.divider, { backgroundColor: colors.drawerDivider }]} />

      {/* ── List ── */}
      <ScrollView
        style={{ flexGrow: 0, flexShrink: 1 }}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!isDragging}
      >
        {isEditing ? (
          /* ── Edit mode ── */
          <View>
            {/* Folder groups — folder row + its feeds move as one unit */}
            {folderGroups.length > 0 && (
              <DraggableSection
                items={folderGroups}
                onReorder={handleReorderGroups}
                onDragActive={setIsDragging}
              >
                {(group, panHandlers, dragging) => {
                  const isOpen = openFolderIds.has(group.id);
                  return (
                    <View>
                      <EditFolderRow
                        folder={group.folder}
                        panHandlers={panHandlers}
                        dragging={dragging}
                        isOpen={isOpen}
                        onToggle={() => toggleFolderOpen(group.id)}
                        onEdit={() => setEditingFolder(group.folder)}
                      />
                      {isOpen && group.feeds.length > 0 && (
                        <DraggableSection
                          items={group.feeds}
                          onReorder={next => handleReorderFolderFeeds(group.folder.id, next)}
                          onDragActive={setIsDragging}
                        >
                          {(feed, feedPR, feedDragging) => (
                            <EditFeedRow
                              feed={feed}
                              indent
                              panHandlers={feedPR}
                              dragging={feedDragging}
                              onAction={() => { setSelectedFeed(feed); setShowFeedActions(true); }}
                            />
                          )}
                        </DraggableSection>
                      )}
                    </View>
                  );
                }}
              </DraggableSection>
            )}

            {/* Root feeds — draggable */}
            {rootFeeds.length > 0 && (
              <DraggableSection
                items={rootFeeds}
                onReorder={handleReorderRootFeeds}
                onDragActive={setIsDragging}
              >
                {(feed, panHandlers, dragging) => (
                  <EditFeedRow
                    feed={feed}
                    panHandlers={panHandlers}
                    dragging={dragging}
                    onAction={() => { setSelectedFeed(feed); setShowFeedActions(true); }}
                  />
                )}
              </DraggableSection>
            )}
          </View>
        ) : (
          /* ── Normal mode ── */
          <View>
            <ListItem
              left={<Icon name="layers-outline" size={18} color="secondary" />}
              center={<Text variant="labelLg">All Articles</Text>}
              right={showBadges && totalUnread > 0 ? <Badge count={totalUnread} /> : null}
              active={isActive({ type: 'all' })}
              onPress={() => { setFilter({ type: 'all' }); closeDrawer(); }}
              containerStyle={[styles.itemDivider, { borderColor: colors.drawerDivider }, isActive({ type: 'all' }) && { backgroundColor: colors.drawerDivider }]}
            />
            <ListItem
              left={<Icon name="bookmark-outline" size={18} color="secondary" />}
              center={<Text variant="labelLg">Bookmarks</Text>}
              right={showBadges && bookmarkCount > 0 ? <Badge count={bookmarkCount} /> : null}
              active={isActive({ type: 'bookmarks' })}
              onPress={() => { setFilter({ type: 'bookmarks' }); closeDrawer(); }}
              containerStyle={[styles.itemDivider, { borderColor: colors.drawerDivider }, isActive({ type: 'bookmarks' }) && { backgroundColor: colors.drawerDivider }]}
            />

            {folders.map(folder => {
              const isOpen       = normalOpenFolderIds.has(folder.id);
              const folderFeeds  = feeds.filter(f => f.folderId === folder.id);
              const folderUnread = unreadForFolder(folder.id);
              const folderActive = isActive({ type: 'folder', folderId: folder.id });
              return (
                <View key={folder.id}>
                  <ListItem
                    left={<Icon name={(folder.icon as any) || 'folder-outline'} size={18} color="secondary" />}
                    center={<Text variant="labelLg">{folder.name}</Text>}
                    right={
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        {showBadges && folderUnread > 0 && <Badge count={folderUnread} />}
                        <TouchableOpacity onPress={() => toggleNormalFolder(folder.id)} hitSlop={8}>
                          <Icon name={isOpen ? 'chevron-down' : 'chevron-forward'} size={14} color="secondary" />
                        </TouchableOpacity>
                      </View>
                    }
                    active={folderActive}
                    onPress={folderFeeds.length === 0 ? undefined : () => {
                      setNormalOpenFolderIds(prev => { const n = new Set(prev); n.add(folder.id); return n; });
                      setFilter({ type: 'folder', folderId: folder.id });
                      closeDrawer();
                    }}
                    onLongPress={() => setEditingFolder(folder)}
                    containerStyle={[!isOpen && styles.itemDivider, !isOpen && { borderColor: colors.drawerDivider }, folderActive && { backgroundColor: colors.drawerDivider }]}
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
                          onPress={() => { setFilter({ type: 'feed', feedId: feed.id }); closeDrawer(); }}
                          onLongPress={() => { setSelectedFeed(feed); setShowFeedActions(true); }}
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
                onPress={() => { setFilter({ type: 'feed', feedId: feed.id }); closeDrawer(); }}
                onLongPress={() => { setSelectedFeed(feed); setShowFeedActions(true); }}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {/* ── Bottom actions — always visible, Edit/Done is the last item ── */}
      <View>
        <View style={[styles.divider, { backgroundColor: colors.drawerDivider, marginTop: -1 }]} />
        {!isEditing && (
          <>
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
          </>
        )}
        <ListItem
          left={<Icon name={isEditing ? 'checkmark-outline' : 'pencil-outline'} size={18} color="secondary" />}
          center={<Text variant="labelMd" color="secondary">{isEditing ? 'Done' : 'Edit'}</Text>}
          onPress={() => setIsEditing(e => !e)}
        />
      </View>

      {/* Feed Actions Modal */}
      <Modal visible={showFeedActions} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setShowFeedActions(false)}>
        <SafeAreaView style={[styles.modal, { backgroundColor: colors.surface }]} edges={['top', 'bottom']}>
          <View style={[styles.modalHeader, { paddingHorizontal: spacing[4] }]}>
            <Text variant="headingMd" numberOfLines={1} style={{ flex: 1, marginRight: spacing[3] }}>{selectedFeed?.title}</Text>
            <TouchableOpacity onPress={() => setShowFeedActions(false)}>
              <Icon name="close-outline" size={24} color="secondary" />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: spacing[4], gap: spacing[3] }}>
            <Text variant="labelSm" color="tertiary" style={{ textTransform: 'uppercase' }}>Move to folder</Text>
            <View style={{ borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
              <TouchableOpacity
                style={[styles.folderOption, { paddingHorizontal: spacing[4], paddingVertical: spacing[3], backgroundColor: !selectedFeed?.folderId ? colors.accentMuted : colors.surface }]}
                onPress={async () => { if (selectedFeed) { await moveFeed(selectedFeed.id, undefined); setShowFeedActions(false); } }}
              >
                <Text variant="labelLg" style={{ color: !selectedFeed?.folderId ? colors.accent : colors.textPrimary }}>No Folder</Text>
                {!selectedFeed?.folderId && <Text variant="labelSm" style={{ marginLeft: 'auto', color: colors.accent }}>✓</Text>}
              </TouchableOpacity>
              {folders.map(folder => {
                const isCurrent = selectedFeed?.folderId === folder.id;
                return (
                  <View key={folder.id}>
                    <Divider />
                    <TouchableOpacity
                      style={[styles.folderOption, { paddingHorizontal: spacing[4], paddingVertical: spacing[3], backgroundColor: isCurrent ? colors.accentMuted : colors.surface }]}
                      onPress={async () => { if (selectedFeed) { await moveFeed(selectedFeed.id, folder.id); setShowFeedActions(false); } }}
                    >
                      <Text variant="labelLg" style={{ color: isCurrent ? colors.accent : colors.textPrimary }}>{folder.name}</Text>
                      {isCurrent && <Text variant="labelSm" style={{ marginLeft: 'auto', color: colors.accent }}>✓</Text>}
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
            <View style={{ marginTop: spacing[2] }}>
              <Button label="Remove Feed" variant="danger" fullWidth icon="trash-outline" onPress={() => selectedFeed && handleRemoveFeed(selectedFeed)} />
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <AddFeedModal visible={showAddFeed} folders={folders} onClose={() => setShowAddFeed(false)} onAdd={addFeed} />

      <Modal visible={showAddFolder} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowAddFolder(false)}>
        <SafeAreaView style={[styles.modal, { backgroundColor: colors.surface }]} edges={['top', 'bottom']}>
          <View style={[styles.modalHeader, { paddingHorizontal: spacing[4] }]}>
            <Text variant="headingMd">New Folder</Text>
            <TouchableOpacity onPress={() => setShowAddFolder(false)}>
              <Icon name="close-outline" size={24} color="secondary" />
            </TouchableOpacity>
          </View>
          <View style={{ paddingHorizontal: spacing[4], gap: spacing[3] }}>
            <TextInput
              style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.textPrimary, borderRadius: radius.lg, paddingHorizontal: spacing[4] }]}
              placeholder="Folder name" placeholderTextColor={colors.placeholder}
              value={folderName} onChangeText={setFolderName} autoFocus
            />
            <Button label="Create Folder" fullWidth onPress={handleAddFolder} />
          </View>
        </SafeAreaView>
      </Modal>

      <FolderEditModal
        folder={editingFolder}
        onClose={() => setEditingFolder(null)}
        onSave={async patch => { if (editingFolder) await updateFolder(editingFolder.id, patch); setEditingFolder(null); }}
        onDelete={async folder => { await handleDeleteFolder(folder); setEditingFolder(null); }}
      />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// DraggableSection
//
// Live-reorder approach: liveItems mirrors the order visually while dragging,
// so the item physically moves in the list instead of showing a drop indicator.
// Target index is always computed from the ORIGINAL start index + cumulative dy,
// then the dragged item is found in liveItems and moved there.
// ---------------------------------------------------------------------------

type DragItem = { id: string };

function DraggableSection<T extends DragItem>({
  items,
  onReorder,
  onDragActive,
  children,
}: {
  items: T[];
  onReorder: (next: T[]) => void;
  onDragActive: (v: boolean) => void;
  children: (item: T, panHandlers: Record<string, any>, dragging: boolean) => React.ReactNode;
}) {
  // liveItems is the locally-reordered copy during drag
  const [liveItems, setLiveItems] = useState<T[]>(items);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Keep liveItems in sync when the external list changes (e.g. after a delete)
  // but NOT while a drag is active (would reset mid-drag).
  const draggingRef = useRef(false);
  useEffect(() => {
    if (!draggingRef.current) setLiveItems(items);
  }, [items]);

  // Always-current refs for use inside PanResponder closures
  const liveRef      = useRef<T[]>(items);
  liveRef.current    = liveItems;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;
  const onDragRef    = useRef(onDragActive);
  onDragRef.current  = onDragActive;
  // Snapshot of items props — always current, used for stable Y-position computation
  const itemsRef = useRef<T[]>(items);
  itemsRef.current = items;

  // Index of each item in the ORIGINAL props.items (used for target computation)
  const origIndexMap = useRef<Record<string, number>>({});
  items.forEach((item, i) => { origIndexMap.current[item.id] = i; });

  // Per-item measured heights (groups can be taller than single rows)
  const itemHeightsRef = useRef<Record<string, number>>({});

  const startOrigIdxRef = useRef(0);

  // One PanResponder per item ID, created once, reads from refs
  const prMap = useRef<Record<string, ReturnType<typeof PanResponder.create>>>({});

  const getPR = useCallback((id: string) => {
    if (!prMap.current[id]) {
      prMap.current[id] = PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder:  () => true,
        onPanResponderGrant: () => {
          draggingRef.current = true;
          startOrigIdxRef.current = origIndexMap.current[id] ?? 0;
          setDraggingId(id);
          onDragRef.current(true);
        },
        onPanResponderMove: (_, gs) => {
          // Build cumulative Y positions from the ORIGINAL items order so the
          // target slot is stable even as liveItems shuffles during drag.
          const orig = itemsRef.current;
          let y = 0;
          const cumY: number[]  = [];
          const heights: number[] = [];
          for (const item of orig) {
            const h = itemHeightsRef.current[item.id] ?? 44;
            cumY.push(y);
            heights.push(h);
            y += h;
          }
          const si = startOrigIdxRef.current;
          const draggedCenter = (cumY[si] ?? 0) + (heights[si] ?? 44) / 2 + gs.dy;
          let target = si;
          let bestDist = Infinity;
          for (let i = 0; i < orig.length; i++) {
            const dist = Math.abs(cumY[i] + heights[i] / 2 - draggedCenter);
            if (dist < bestDist) { bestDist = dist; target = i; }
          }
          target = Math.max(0, Math.min(orig.length - 1, target));

          const curIdx = liveRef.current.findIndex(x => x.id === id);
          if (curIdx === target) return;
          const next = [...liveRef.current];
          const [moved] = next.splice(curIdx, 1);
          next.splice(target, 0, moved);
          liveRef.current = next;
          setLiveItems([...next]);
        },
        onPanResponderRelease: () => {
          draggingRef.current = false;
          setDraggingId(null);
          onDragRef.current(false);
          onReorderRef.current([...liveRef.current]);
        },
        onPanResponderTerminate: () => {
          draggingRef.current = false;
          setDraggingId(null);
          onDragRef.current(false);
          // Restore original order on cancel
          setLiveItems([...items]);
        },
      });
    }
    return prMap.current[id];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View>
      {liveItems.map((item) => (
        <View
          key={item.id}
          onLayout={e => { itemHeightsRef.current[item.id] = e.nativeEvent.layout.height || 44; }}
        >
          {children(item, getPR(item.id).panHandlers, draggingId === item.id)}
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// EditFolderRow — looks exactly like the normal folder ListItem
// + drag handle on the left, edit icon on the right
// ---------------------------------------------------------------------------

function EditFolderRow({
  folder, panHandlers, dragging, isOpen, onToggle, onEdit,
}: {
  folder: Folder;
  panHandlers: Record<string, any>;
  dragging: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const { colors, spacing } = useTheme();
  return (
    <View
      style={[
        styles.editRow,
        { borderColor: colors.drawerDivider },
        dragging && styles.dragging,
      ]}
    >
      {/* Drag handle */}
      <View
        {...panHandlers}
        collapsable={false}
        style={styles.handle}
      >
        <Icon name="menu-outline" size={18} color="secondary" />
      </View>

      {/* Tappable content — toggles open/close */}
      <TouchableOpacity
        onPress={onToggle}
        activeOpacity={0.6}
        style={[styles.rowContent, { paddingVertical: spacing[2.5] }]}
      >
        <View style={{ marginRight: 10 }}>
          <Icon name={(folder.icon as any) || 'folder-outline'} size={18} color="secondary" />
        </View>
        <Text variant="labelLg" numberOfLines={1} style={{ flex: 1, opacity: 0.45 }}>
          {folder.name}
        </Text>
        <Icon
          name={isOpen ? 'chevron-down' : 'chevron-forward'}
          size={14}
          color="secondary"
        />
      </TouchableOpacity>

      {/* Edit icon — opens FolderEditModal */}
      <TouchableOpacity onPress={onEdit} hitSlop={8} style={styles.actionBtn}>
        <Icon name="ellipsis-horizontal" size={20} color="secondary" />
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// EditFeedRow — looks exactly like the normal FeedRow
// + drag handle on the left, action (⋯) on the right
// ---------------------------------------------------------------------------

function EditFeedRow({
  feed, panHandlers, dragging, indent = false, onAction,
}: {
  feed: Feed;
  panHandlers: Record<string, any>;
  dragging: boolean;
  indent?: boolean;
  onAction: () => void;
}) {
  const { colors, spacing } = useTheme();
  const [faviconError, setFaviconError] = useState(false);

  return (
    <View
      style={[
        styles.editRow,
        { borderColor: colors.drawerDivider },
        indent && { paddingLeft: 24 },
        dragging && styles.dragging,
      ]}
    >
      {/* Drag handle */}
      <View
        {...panHandlers}
        collapsable={false}
        style={styles.handle}
      >
        <Icon name="menu-outline" size={18} color="secondary" />
      </View>

      {/* Same content as normal FeedRow */}
      <View style={[styles.rowContent, { paddingVertical: spacing[2.5] }]}>
        {feed.faviconUrl && !faviconError ? (
          <Image source={{ uri: feed.faviconUrl }} style={styles.favicon} onError={() => setFaviconError(true)} />
        ) : (
          <Icon name="radio-outline" size={16} color="secondary" />
        )}
        <Text variant="labelMd" numberOfLines={1} style={{ flex: 1, marginLeft: 10, opacity: 0.45 }}>
          {feed.title}
        </Text>
      </View>

      {/* Action icon — opens folder/delete sheet */}
      <TouchableOpacity onPress={onAction} hitSlop={8} style={styles.actionBtn}>
        <Icon name="ellipsis-horizontal" size={20} color="secondary" />
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Normal-mode FeedRow (unchanged)
// ---------------------------------------------------------------------------

function FeedRow({
  feed, unread, active, showBadges, onPress, onLongPress, indent = false, isLast = false,
}: {
  feed: Feed; unread: number; active: boolean; showBadges: boolean;
  onPress: () => void; onLongPress: () => void; indent?: boolean; isLast?: boolean;
}) {
  const { colors, spacing } = useTheme();
  const [faviconError, setFaviconError] = React.useState(false);

  return (
    <TouchableOpacity
      onPress={onPress} onLongPress={onLongPress} activeOpacity={0.5}
      style={[
        indent
          ? (active ? { backgroundColor: colors.drawerDivider } : undefined)
          : [styles.itemDivider, { borderColor: colors.drawerDivider }, active && { backgroundColor: colors.drawerDivider }],
        { position: 'relative' },
      ]}
    >
      {indent && (
        <View style={{ position: 'absolute', left: spacing[3], top: 0, bottom: 0, width: 24 }}>
          <View style={{ position: 'absolute', left: 7, top: 0, bottom: isLast ? '50%' : 0, width: 1, backgroundColor: colors.textTertiary }} />
          <View style={{ position: 'absolute', left: 7, right: 6, top: '50%', height: 1, backgroundColor: colors.textTertiary }} />
        </View>
      )}
      <View style={[styles.feedRow, { paddingVertical: spacing[2.5], paddingRight: spacing[3], paddingLeft: indent ? spacing[3] + 24 : spacing[3], opacity: active ? 1 : 0.45 }]}>
        {feed.faviconUrl && !faviconError
          ? <Image source={{ uri: feed.faviconUrl }} style={styles.favicon} onError={() => setFaviconError(true)} />
          : <Icon name="radio-outline" size={16} color="secondary" />
        }
        <Text variant="labelMd" numberOfLines={1} style={{ flex: 1, color: colors.textPrimary, marginLeft: 10 }}>
          {feed.title}
        </Text>
        {showBadges && unread > 0 && <Badge count={unread} />}
      </View>
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Add Feed Modal
// ---------------------------------------------------------------------------

interface FeedSearchResult {
  feedId: string; title: string; description?: string; subscribers?: number; iconUrl?: string;
}

function formatSubscribers(n?: number): string {
  if (!n) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M subscribers`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k subscribers`;
  return `${n} subscribers`;
}

function urlFromFeedId(id: string) { return id.startsWith('feed/') ? id.slice(5) : id; }
function looksLikeUrl(s: string)   { return s.startsWith('http://') || s.startsWith('https://') || s.startsWith('www.'); }

function ResultIcon({ uri }: { uri: string }) {
  const [error, setError] = useState(false);
  if (error) return <Icon name="radio-outline" size={18} color="secondary" />;
  return <Image source={{ uri }} style={styles.resultFavicon} onError={() => setError(true)} />;
}

function AddFeedModal({ visible, folders, onClose, onAdd }: {
  visible: boolean; folders: Folder[];
  onClose: () => void; onAdd: (url: string, folderId?: string) => Promise<void>;
}) {
  const { colors, spacing, radius } = useTheme();
  const [query, setQuery]         = useState('');
  const [results, setResults]     = useState<FeedSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingUrl, setAddingUrl] = useState<string | null>(null);
  const [folderId, setFolderId]   = useState<string | undefined>();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible) { setQuery(''); setResults([]); setSearching(false); setAddingUrl(null); setFolderId(undefined); }
  }, [visible]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q) { setResults([]); setSearching(false); return; }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res  = await fetch(`https://cloud.feedly.com/v3/search/feeds?query=${encodeURIComponent(q)}&count=20`);
        const data = await res.json();
        setResults(data.results ?? []);
      } catch { setResults([]); }
      finally  { setSearching(false); }
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const handleAdd = useCallback(async (url: string) => {
    setAddingUrl(url);
    try { await onAdd(url, folderId); onClose(); }
    catch { Alert.alert('Error', 'Could not load feed. Check the URL and try again.'); }
    finally { setAddingUrl(null); }
  }, [onAdd, folderId, onClose]);

  const directUrl = looksLikeUrl(query.trim())
    ? (query.trim().startsWith('www.') ? `https://${query.trim()}` : query.trim()) : null;

  const renderResult = useCallback(({ item }: { item: FeedSearchResult }) => {
    const url = urlFromFeedId(item.feedId);
    const isAdding = addingUrl === url;
    return (
      <TouchableOpacity onPress={() => handleAdd(url)} activeOpacity={0.6} disabled={addingUrl !== null}
        style={[styles.resultRow, { paddingHorizontal: spacing[4], paddingVertical: spacing[3] }]}>
        <View style={styles.resultIcon}>
          {item.iconUrl ? <ResultIcon uri={item.iconUrl} /> : <Icon name="radio-outline" size={18} color="secondary" />}
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="labelLg" numberOfLines={1}>{item.title}</Text>
          {item.description ? <Text variant="bodySm" color="secondary" numberOfLines={1} style={{ marginTop: 1 }}>{item.description}</Text> : null}
          {item.subscribers ? <Text variant="caption" color="tertiary" style={{ marginTop: 2 }}>{formatSubscribers(item.subscribers)}</Text> : null}
        </View>
        {isAdding ? <ActivityIndicator size="small" color={colors.textTertiary} /> : <Icon name="add-circle-outline" size={22} color="secondary" />}
      </TouchableOpacity>
    );
  }, [addingUrl, handleAdd, colors, spacing]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView style={[styles.modal, { backgroundColor: colors.surface }]} edges={['top', 'bottom']}>
        <View>
          <View style={[styles.modalHeader, { paddingHorizontal: spacing[4] }]}>
            <Text variant="headingMd">Add Feed</Text>
            <TouchableOpacity onPress={onClose}><Text variant="labelMd" color="secondary">Close</Text></TouchableOpacity>
          </View>
          <View style={{ paddingHorizontal: spacing[4], marginBottom: spacing[3] }}>
            <View style={[styles.searchBox, { backgroundColor: colors.background, borderColor: colors.border, borderRadius: radius.lg }]}>
              <Icon name="search-outline" size={18} color="secondary" />
              <TextInput
                style={[styles.searchInput, { color: colors.textPrimary }]}
                placeholder="Search or paste URL…" placeholderTextColor={colors.placeholder}
                value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false} returnKeyType="search" autoFocus
              />
              {searching && <ActivityIndicator size="small" color={colors.textTertiary} />}
              {!searching && query.length > 0 && (
                <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
                  <Icon name="close-circle" size={18} color="secondary" />
                </TouchableOpacity>
              )}
            </View>
          </View>
          {folders.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: spacing[4], gap: spacing[2] }} style={{ marginBottom: spacing[3] }}>
              <TouchableOpacity onPress={() => setFolderId(undefined)}
                style={[styles.chip, { backgroundColor: !folderId ? colors.accent : colors.background, borderColor: !folderId ? colors.accent : colors.border }]}>
                <Text variant="labelSm" style={{ color: !folderId ? colors.textInverse : colors.textPrimary }}>No folder</Text>
              </TouchableOpacity>
              {folders.map(f => (
                <TouchableOpacity key={f.id} onPress={() => setFolderId(f.id)}
                  style={[styles.chip, { backgroundColor: folderId === f.id ? colors.accent : colors.background, borderColor: folderId === f.id ? colors.accent : colors.border }]}>
                  <Text variant="labelSm" style={{ color: folderId === f.id ? colors.textInverse : colors.textPrimary }}>{f.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          <Divider />
          {directUrl && (
            <>
              <TouchableOpacity onPress={() => handleAdd(directUrl)} activeOpacity={0.6} disabled={addingUrl !== null}
                style={[styles.resultRow, { paddingHorizontal: spacing[4], paddingVertical: spacing[3] }]}>
                <View style={styles.resultIcon}><Icon name="link-outline" size={18} color="secondary" /></View>
                <View style={{ flex: 1 }}>
                  <Text variant="labelLg">Subscribe to URL</Text>
                  <Text variant="bodySm" color="tertiary" numberOfLines={1}>{directUrl}</Text>
                </View>
                {addingUrl === directUrl ? <ActivityIndicator size="small" color={colors.textTertiary} /> : <Icon name="add-circle-outline" size={22} color="secondary" />}
              </TouchableOpacity>
              {results.length > 0 && <Divider />}
            </>
          )}
        </View>
        <FlatList style={{ flex: 1 }} data={results} keyExtractor={r => r.feedId} renderItem={renderResult}
          ItemSeparatorComponent={Divider} keyboardShouldPersistTaps="handled"
          ListEmptyComponent={!searching && query.trim().length > 0 ? (
            <View style={{ alignItems: 'center', paddingTop: 48 }}>
              <Icon name="search-outline" size={36} color="secondary" />
              <Text variant="bodyMd" color="secondary" style={{ marginTop: spacing[3] }}>No feeds found</Text>
              <Text variant="bodySm" color="tertiary" style={{ marginTop: spacing[1] }}>Try a different term or paste a URL</Text>
            </View>
          ) : null}
        />
      </SafeAreaView>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Folder Edit Modal (rename + icon picker)
// ---------------------------------------------------------------------------

const FOLDER_ICONS = [
  'folder-outline','folder-open-outline','archive-outline','documents-outline',
  'document-text-outline','reader-outline','list-outline','apps-outline',
  'newspaper-outline','megaphone-outline','radio-outline','tv-outline',
  'mic-outline','library-outline','bookmark-outline','pricetag-outline',
  'briefcase-outline','business-outline','calculator-outline','calendar-outline',
  'mail-outline','clipboard-outline','wallet-outline','cash-outline','card-outline','receipt-outline',
  'code-slash-outline','terminal-outline','hardware-chip-outline','server-outline',
  'cloud-outline','cloud-download-outline','laptop-outline','desktop-outline',
  'phone-portrait-outline','tablet-portrait-outline','wifi-outline','bluetooth-outline',
  'cog-outline','construct-outline',
  'color-palette-outline','color-wand-outline','brush-outline','image-outline',
  'images-outline','camera-outline','videocam-outline','cut-outline',
  'football-outline','basketball-outline','baseball-outline','tennisball-outline',
  'american-football-outline','bicycle-outline','fitness-outline','walk-outline','barbell-outline','golf-outline',
  'restaurant-outline','pizza-outline','wine-outline','beer-outline',
  'cafe-outline','fast-food-outline','ice-cream-outline','nutrition-outline',
  'musical-notes-outline','musical-note-outline','headset-outline','film-outline',
  'game-controller-outline','ticket-outline','play-circle-outline',
  'school-outline','book-outline','glasses-outline','pencil-outline','language-outline',
  'airplane-outline','car-outline','train-outline','boat-outline','bus-outline',
  'rocket-outline','map-outline','earth-outline','compass-outline','navigate-outline','location-outline','globe-outline',
  'leaf-outline','flower-outline','paw-outline','fish-outline','planet-outline',
  'sunny-outline','partly-sunny-outline','moon-outline','cloudy-outline','water-outline','flame-outline','snow-outline','thunderstorm-outline',
  'people-outline','person-outline','chatbubble-outline','chatbubbles-outline','happy-outline','thumbs-up-outline',
  'trending-up-outline','trending-down-outline','stats-chart-outline','pie-chart-outline','bar-chart-outline','analytics-outline',
  'medkit-outline','pulse-outline','bandage-outline','heart-outline','medical-outline',
  'home-outline','bed-outline','storefront-outline','cart-outline','bag-outline','gift-outline','shirt-outline',
  'star-outline','flash-outline','sparkles-outline','rose-outline','eye-outline',
  'shield-outline','key-outline','lock-closed-outline','time-outline','alarm-outline','notifications-outline','paper-plane-outline',
] as const;

const ICON_COLS = 6;

function FolderEditModal({ folder, onClose, onSave, onDelete }: {
  folder: Folder | null;
  onClose: () => void;
  onSave: (patch: Partial<Folder>) => Promise<void> | void;
  onDelete: (folder: Folder) => Promise<void> | void;
}) {
  const { colors, spacing, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: SW } = useWindowDimensions();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('folder-outline');
  const GRID_GAP = 10;
  const cellSize = Math.floor((SW - spacing[4] * 2 - GRID_GAP * (ICON_COLS - 1)) / ICON_COLS);

  useEffect(() => {
    if (folder) { setName(folder.name); setIcon(folder.icon ?? 'folder-outline'); }
  }, [folder]);

  function handleSave() { const t = name.trim(); if (t) onSave({ name: t, icon }); }
  function handleDelete() {
    if (!folder) return;
    Alert.alert('Delete Folder', `Delete "${folder.name}" and all its feeds?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => onDelete(folder) },
    ]);
  }

  return (
    <Modal visible={folder !== null} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top }}>
        <View style={[styles.modalHeader, { paddingHorizontal: spacing[4] }]}>
          <Text variant="headingMd">Edit Folder</Text>
          <TouchableOpacity onPress={onClose}><Text variant="labelMd" color="secondary">Close</Text></TouchableOpacity>
        </View>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ paddingHorizontal: spacing[4], paddingBottom: spacing[6], gap: spacing[5] }} keyboardShouldPersistTaps="handled">
            <View style={{ gap: spacing[2] }}>
              <Text variant="labelSm" color="tertiary" style={{ textTransform: 'uppercase' }}>Name</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.textPrimary, borderRadius: radius.lg, paddingHorizontal: spacing[4] }]}
                value={name} onChangeText={setName} placeholder="Folder name" placeholderTextColor={colors.placeholder} autoCapitalize="words" returnKeyType="done"
              />
            </View>
            <View style={{ gap: spacing[2] }}>
              <Text variant="labelSm" color="tertiary" style={{ textTransform: 'uppercase' }}>Icon</Text>
              <View style={[styles.iconGrid, { gap: GRID_GAP }]}>
                {FOLDER_ICONS.map(opt => {
                  const selected = icon === opt;
                  return (
                    <TouchableOpacity key={opt} onPress={() => setIcon(opt)}
                      style={{ width: cellSize, height: cellSize, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: radius.md,
                        backgroundColor: selected ? colors.accentMuted : colors.background, borderColor: selected ? colors.accent : colors.border }}>
                      <Icon name={opt as any} size={Math.round(cellSize * 0.45)} color={selected ? 'accent' : 'primary'} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
        <View style={{ paddingHorizontal: spacing[4], paddingTop: spacing[3], paddingBottom: spacing[3] + insets.bottom, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border, flexDirection: 'row', gap: spacing[2] }}>
          <View style={{ flex: 1 }}><Button label="Delete" variant="danger" fullWidth icon="trash-outline" onPress={handleDelete} /></View>
          <View style={{ flex: 1 }}><Button label="Save" fullWidth onPress={handleSave} /></View>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 28,
    lineHeight: 28,
    fontWeight: '900',
    fontStyle: 'italic',
    letterSpacing: -1,
  },
  divider:     { height: 1 },
  itemDivider: { borderBottomWidth: 1 },
  feedRow:     { flexDirection: 'row', alignItems: 'center' },
  favicon:     { width: 16, height: 16, borderRadius: 3 },

  // Edit-mode rows
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
  },
  dragging: { opacity: 0.5 },
  // Drag handle — left column, same width as normal paddingHorizontal so content aligns
  handle: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Content area between handle and action button
  rowContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 4,
  },
  // Action button (edit or trash) — right column
  actionBtn: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  modal:       { flex: 1 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16, marginBottom: 8 },
  folderOption:{ flexDirection: 'row', alignItems: 'center' },
  input:       { height: 48, borderWidth: 1, fontSize: 15 },
  chip:        { paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderRadius: 20 },
  searchBox:   { flexDirection: 'row', alignItems: 'center', borderWidth: 1, paddingHorizontal: 12, gap: 8, height: 44 },
  searchInput: { flex: 1, fontSize: 15, height: '100%' },
  resultRow:   { flexDirection: 'row', alignItems: 'center', gap: 12 },
  resultIcon:  { width: 32, alignItems: 'center' },
  resultFavicon: { width: 22, height: 22, borderRadius: 4 },
  iconGrid:    { flexDirection: 'row', flexWrap: 'wrap' },
});
