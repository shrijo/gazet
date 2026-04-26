import React, { useCallback, useRef, useEffect, useState } from 'react';
import {
  View,
  FlatList,
  Image,
  Animated,
  Easing,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  useWindowDimensions,
} from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useDrawer } from '../navigation/Drawer';
import { useSettingsDrawer } from '../navigation/SettingsDrawer';
import { useTheme } from '../theme';
import { Text, Icon, Card, Skeleton, Divider } from '../components';
import { useAppStore } from '../hooks/useAppStore';
import { Article, ViewMode } from '../types';
import { formatArticleDate } from '../utils/date';

const BAR_HEIGHT = 64;
const HEADER_HEIGHT = 56;

export function ArticlesScreen() {
  const { colors, spacing } = useTheme();
  const navigation = useNavigation();
  const drawer = useDrawer();
  const settingsDrawer = useSettingsDrawer();
  const { state, filteredArticles, refreshAll, markRead, updateSettings, setFilter } =
    useAppStore();
  const { settings, filter, loading, refreshing } = state;

  const viewMode = settings.viewMode;
  const isCard = viewMode === 'card';
  const isReel = viewMode === 'reel';

  const activeTab = React.useMemo(() => {
    if (filter.type === 'bookmarks') return 'bookmarks';
    return 'feed';
  }, [filter]);

  const filterLabel = React.useMemo(() => {
    if (filter.type === 'all') return 'All Articles';
    if (filter.type === 'bookmarks') return 'Bookmarks';
    if (filter.type === 'feed') {
      return state.feeds.find(f => f.id === filter.feedId)?.title ?? 'Feed';
    }
    if (filter.type === 'folder') {
      return state.folders.find(f => f.id === filter.folderId)?.name ?? 'Folder';
    }
    return '';
  }, [filter, state.feeds, state.folders]);

  const handleArticlePress = useCallback(
    (article: Article) => {
      markRead(article.id);
      (navigation as any).navigate('ArticleDetail', { article });
    },
    [markRead, navigation],
  );

  const cycleViewMode = useCallback(() => {
    const next: ViewMode = viewMode === 'card' ? 'list' : viewMode === 'list' ? 'reel' : 'card';
    updateSettings({ viewMode: next });
  }, [viewMode, updateSettings]);

  const renderCard = useCallback(
    ({ item }: { item: Article }) => (
      <ArticleCard article={item} onPress={() => handleArticlePress(item)} />
    ),
    [handleArticlePress],
  );

  const renderListItem = useCallback(
    ({ item }: { item: Article }) => (
      <ArticleListItem article={item} onPress={() => handleArticlePress(item)} />
    ),
    [handleArticlePress],
  );

  if (loading) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={['top']}
      >
        <Header title={filterLabel} viewMode={viewMode} onCycleView={cycleViewMode} />
        <View style={{ padding: spacing[4], gap: spacing[3] }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} height={isCard ? 220 : 72} />
          ))}
        </View>
        <BottomBar
          activeTab={activeTab}
          onMenu={drawer.open}
          onFeed={() => setFilter({ type: 'all' })}
          onSettings={() => settingsDrawer.open()}
        />
      </SafeAreaView>
    );
  }

  if (isReel) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={['top']}
      >
        <Header title={filterLabel} viewMode={viewMode} onCycleView={cycleViewMode} />
        <ReelList
          articles={filteredArticles}
          onPress={handleArticlePress}
          onRefresh={refreshAll}
          refreshing={refreshing}
        />
        <BottomBar
          activeTab={activeTab}
          onMenu={drawer.open}
          onFeed={() => setFilter({ type: 'all' })}
          onSettings={() => settingsDrawer.open()}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top']}
    >
      <Header title={filterLabel} viewMode={viewMode} onCycleView={cycleViewMode} />

      <FlatList
        data={filteredArticles}
        keyExtractor={a => a.id}
        renderItem={isCard ? renderCard : renderListItem}
        contentContainerStyle={
          isCard
            ? { padding: spacing[4], gap: spacing[3] }
            : { paddingTop: spacing[2] }
        }
        ItemSeparatorComponent={isCard ? undefined : () => <Divider inset={56} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refreshAll}
            tintColor={colors.accent}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon name="newspaper-outline" size={48} color="secondary" />
            <Text variant="headingMd" color="secondary" style={{ marginTop: spacing[3] }}>
              No articles
            </Text>
            <Text variant="bodyMd" color="tertiary" style={{ textAlign: 'center', marginTop: spacing[1] }}>
              Add feeds via the Menu
            </Text>
          </View>
        }
      />

      <BottomBar
        activeTab={activeTab}
        onMenu={drawer.open}
        onFeed={() => setFilter({ type: 'all' })}
        onSettings={() => settingsDrawer.open()}
      />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Reel list
// ---------------------------------------------------------------------------

function ReelList({
  articles,
  onPress,
  onRefresh,
  refreshing,
}: {
  articles: Article[];
  onPress: (article: Article) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const { colors, spacing } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [activeIndex, setActiveIndex] = useState(0);

  const itemHeight = windowHeight - insets.top - HEADER_HEIGHT - BAR_HEIGHT - insets.bottom;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 });
  const onViewableItemsChanged = useCallback(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      setActiveIndex(viewableItems[0].index ?? 0);
    }
  }, []);

  const renderReel = useCallback(
    ({ item, index }: { item: Article; index: number }) => (
      <ArticleReelItem
        article={item}
        onPress={() => onPress(item)}
        height={itemHeight}
        isActive={index === activeIndex}
      />
    ),
    [onPress, itemHeight, activeIndex],
  );

  return (
    <FlatList
      data={articles}
      keyExtractor={a => a.id}
      renderItem={renderReel}
      pagingEnabled
      showsVerticalScrollIndicator={false}
      snapToInterval={itemHeight}
      snapToAlignment="start"
      decelerationRate="fast"
      getItemLayout={(_, index) => ({
        length: itemHeight,
        offset: itemHeight * index,
        index,
      })}
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={viewabilityConfig.current}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.accent}
        />
      }
      ListEmptyComponent={
        <View style={[styles.empty, { height: itemHeight }]}>
          <Icon name="newspaper-outline" size={48} color="secondary" />
          <Text variant="headingMd" color="secondary" style={{ marginTop: spacing[3] }}>
            No articles
          </Text>
          <Text variant="bodyMd" color="tertiary" style={{ textAlign: 'center', marginTop: spacing[1] }}>
            Add feeds via the Menu
          </Text>
        </View>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Reel item
// ---------------------------------------------------------------------------

function ArticleReelItem({
  article,
  onPress,
  height,
  isActive,
}: {
  article: Article;
  onPress: () => void;
  height: number;
  isActive: boolean;
}) {
  const { spacing } = useTheme();
  const hasVideo = (article.videoUrls?.length ?? 0) > 0;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.95}
      style={[styles.reelItem, { height, backgroundColor: '#111' }]}
    >
      <ReelMediaBackground article={article} isActive={isActive} />

      {/* gradient scrim — transparent at top, dark at bottom */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.15)', 'rgba(0,0,0,0.82)']}
        locations={[0.35, 0.6, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* bottom content */}
      <View style={[styles.reelContent, { padding: spacing[5] }]}>
        <View style={styles.reelMeta}>
          {!article.isRead && <View style={styles.unreadDotWhite} />}
          <Text variant="labelSm" style={styles.reelMetaText}>
            {article.feedTitle}
          </Text>
          <Text variant="caption" style={styles.reelMetaDim}>
            {' · '}{formatArticleDate(article.pubDate)}
          </Text>
          {article.isBookmarked && (
            <Icon name="bookmark" size={13} color="rgba(255,255,255,0.7)" />
          )}
          {hasVideo && (
            <Icon name="videocam-outline" size={13} color="rgba(255,255,255,0.6)" />
          )}
        </View>

        <Text
          variant="headingLg"
          numberOfLines={4}
          style={[styles.reelTitle, { opacity: article.isRead ? 0.6 : 1 }]}
        >
          {article.title}
        </Text>

        {article.summary ? (
          <Text
            variant="bodySm"
            numberOfLines={3}
            style={[styles.reelSummary, { marginTop: spacing[2] }]}
          >
            {article.summary}
          </Text>
        ) : null}

        {article.author ? (
          <Text variant="caption" style={[styles.reelAuthor, { marginTop: spacing[2] }]}>
            {article.author}
          </Text>
        ) : null}
      </View>

      {/* swipe hint */}
      <View style={styles.reelSwipeHint} pointerEvents="none">
        <Icon name="chevron-up-outline" size={18} color="rgba(255,255,255,0.4)" />
      </View>
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Media background — video or Ken Burns image
// ---------------------------------------------------------------------------

function ReelMediaBackground({
  article,
  isActive,
}: {
  article: Article;
  isActive: boolean;
}) {
  const videoUrl = article.videoUrls?.[0];

  if (videoUrl) {
    return (
      <ReelVideo
        uri={videoUrl}
        fallbackImageUri={article.imageUrl}
        isActive={isActive}
      />
    );
  }

  if (article.imageUrl) {
    return <KenBurnsImage uri={article.imageUrl} isActive={isActive} />;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Video player with mute toggle and image fallback
// ---------------------------------------------------------------------------

function ReelVideo({
  uri,
  fallbackImageUri,
  isActive,
}: {
  uri: string;
  fallbackImageUri?: string;
  isActive: boolean;
}) {
  const videoRef = useRef<Video>(null);
  const [muted, setMuted] = useState(true);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    if (!videoRef.current) return;
    if (isActive) {
      videoRef.current.playAsync().catch(() => {});
    } else {
      videoRef.current.pauseAsync().catch(() => {});
    }
  }, [isActive]);

  if (errored) {
    return fallbackImageUri
      ? <KenBurnsImage uri={fallbackImageUri} isActive={isActive} />
      : null;
  }

  return (
    <>
      <Video
        ref={videoRef}
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        resizeMode={ResizeMode.COVER}
        shouldPlay={isActive}
        isLooping
        isMuted={muted}
        onError={() => setErrored(true)}
      />
      <TouchableOpacity
        onPress={() => setMuted(m => !m)}
        style={styles.muteBtn}
        hitSlop={12}
      >
        <View style={styles.muteBtnBg}>
          <Icon
            name={muted ? 'volume-mute-outline' : 'volume-high-outline'}
            size={18}
            color="rgba(255,255,255,0.9)"
          />
        </View>
      </TouchableOpacity>
    </>
  );
}

// ---------------------------------------------------------------------------
// Ken Burns animated image
// ---------------------------------------------------------------------------

// Each article gets a deterministic pan direction so adjacent reels feel varied.
const KB_DIRECTIONS = [
  { tx: -20, ty: -12 },
  { tx: 20,  ty: -10 },
  { tx: -15, ty:  15 },
  { tx: 18,  ty:  10 },
] as const;

function KenBurnsImage({ uri, isActive }: { uri: string; isActive: boolean }) {
  const progress = useRef(new Animated.Value(0)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  // Pick a direction index from the URI string so it's stable per article.
  const dirIndex = uri.length % KB_DIRECTIONS.length;
  const { tx, ty } = KB_DIRECTIONS[dirIndex];

  useEffect(() => {
    if (isActive) {
      progress.setValue(0);
      animRef.current = Animated.loop(
        Animated.timing(progress, {
          toValue: 1,
          duration: 9000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      );
      animRef.current.start();
    } else {
      animRef.current?.stop();
      progress.setValue(0);
    }
    return () => animRef.current?.stop();
  }, [isActive]);

  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] });
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [0, tx] });
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [0, ty] });

  return (
    <Animated.Image
      source={{ uri }}
      style={[
        StyleSheet.absoluteFill,
        { transform: [{ scale }, { translateX }, { translateY }] },
      ]}
      resizeMode="cover"
    />
  );
}

// ---------------------------------------------------------------------------
// Shared chrome
// ---------------------------------------------------------------------------

function BottomBar({
  activeTab,
  onMenu,
  onFeed,
  onSettings,
}: {
  activeTab: 'feed' | 'bookmarks';
  onMenu: () => void;
  onFeed: () => void;
  onSettings: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: colors.surface,
          paddingBottom: insets.bottom,
          height: BAR_HEIGHT + insets.bottom,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
        },
      ]}
    >
      <BarButton icon="menu-outline" onPress={onMenu} />
      <BarButton label="Feed" onPress={onFeed} active={activeTab === 'feed'} />
      <BarButton icon="settings-outline" onPress={onSettings} />
    </View>
  );
}

function BarButton({
  label,
  icon,
  onPress,
  active,
}: {
  label?: string;
  icon?: string;
  onPress: () => void;
  active?: boolean;
}) {
  const { colors } = useTheme();
  const color = active ? colors.textPrimary : colors.textTertiary;

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.5} style={styles.barBtn}>
      {icon ? (
        <Icon name={icon} size={24} color={color} />
      ) : (
        <Text
          variant="labelSm"
          style={{ color, fontWeight: active ? '600' : '400' }}
        >
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
}

function Header({
  title,
  viewMode,
  onCycleView,
}: {
  title: string;
  viewMode: ViewMode;
  onCycleView: () => void;
}) {
  const { colors, spacing } = useTheme();

  const iconName =
    viewMode === 'card'  ? 'list-outline'  :
    viewMode === 'list'  ? 'film-outline'  :
    'grid-outline';

  return (
    <View
      style={[
        styles.header,
        {
          backgroundColor: colors.surface,
          paddingHorizontal: spacing[4],
        },
      ]}
    >
      <Text variant="headingMd" style={{ flex: 1 }} numberOfLines={1}>
        {title}
      </Text>
      <TouchableOpacity onPress={onCycleView} hitSlop={8}>
        <Icon name={iconName} size={22} color="secondary" />
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Card / List item views (unchanged)
// ---------------------------------------------------------------------------

function ArticleCard({
  article,
  onPress,
}: {
  article: Article;
  onPress: () => void;
}) {
  const { colors, spacing } = useTheme();

  return (
    <Card onPress={onPress} noPadding elevated>
      {article.imageUrl && (
        <Image
          source={{ uri: article.imageUrl }}
          style={styles.cardImage}
          resizeMode="cover"
        />
      )}
      <View style={{ paddingTop: spacing[3], paddingRight: spacing[4], paddingBottom: spacing[4] }}>
        <View style={styles.cardMeta}>
          <Text variant="labelSm" color="tertiary">{article.feedTitle}</Text>
          <Text variant="caption" color="tertiary">{formatArticleDate(article.pubDate)}</Text>
        </View>
        <Text
          variant="headingSm"
          numberOfLines={3}
          style={[styles.cardTitle, { opacity: article.isRead ? 0.5 : 1 }]}
        >
          {article.title}
        </Text>
        {article.summary ? (
          <Text
            variant="bodySm"
            color="secondary"
            numberOfLines={3}
            style={{ marginTop: spacing[1], opacity: article.isRead ? 0.5 : 1 }}
          >
            {article.summary}
          </Text>
        ) : null}
        <View style={[styles.cardFooter, { marginTop: spacing[3] }]}>
          {!article.isRead && (
            <View style={[styles.unreadDot, { backgroundColor: colors.unread }]} />
          )}
          {article.isBookmarked && (
            <Icon name="bookmark" size={14} color="bookmarked" />
          )}
          {article.author && (
            <Text variant="caption" color="tertiary" numberOfLines={1} style={{ flex: 1 }}>
              {article.author}
            </Text>
          )}
        </View>
      </View>
    </Card>
  );
}

function ArticleListItem({
  article,
  onPress,
}: {
  article: Article;
  onPress: () => void;
}) {
  const { colors, spacing } = useTheme();

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        styles.listItem,
        { paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
      ]}
    >
      <View style={styles.listItemContent}>
        {article.imageUrl && (
          <Image
            source={{ uri: article.imageUrl }}
            style={styles.listItemThumb}
            resizeMode="cover"
          />
        )}
        <View style={{ flex: 1 }}>
          <View style={styles.listItemMeta}>
            {!article.isRead && (
              <View style={[styles.unreadDot, { backgroundColor: colors.unread }]} />
            )}
            <Text variant="labelSm" color="tertiary">{article.feedTitle}</Text>
            <Text variant="caption" color="tertiary"> · {formatArticleDate(article.pubDate)}</Text>
            {article.isBookmarked && (
              <Icon name="bookmark" size={12} color="bookmarked" />
            )}
          </View>
          <Text
            variant="labelLg"
            numberOfLines={2}
            style={{ opacity: article.isRead ? 0.5 : 1, marginTop: 2 }}
          >
            {article.title}
          </Text>
          {article.summary && (
            <Text
              variant="bodySm"
              color="secondary"
              numberOfLines={1}
              style={{ marginTop: 2, opacity: article.isRead ? 0.5 : 1 }}
            >
              {article.summary}
            </Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    height: HEADER_HEIGHT,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  barBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: BAR_HEIGHT,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 32,
  },
  cardImage: {
    width: '100%',
    height: 180,
  },
  cardMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  cardTitle: {
    lineHeight: 22,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  listItem: {
    backgroundColor: 'transparent',
  },
  listItemContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  listItemMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    flexWrap: 'wrap',
  },
  listItemThumb: {
    width: 72,
    height: 72,
    flexShrink: 0,
    marginRight: 12,
  },
  // reel
  reelItem: {
    overflow: 'hidden',
  },
  reelContent: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  reelMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 8,
  },
  reelMetaText: {
    color: 'rgba(255,255,255,0.7)',
  },
  reelMetaDim: {
    color: 'rgba(255,255,255,0.45)',
  },
  reelTitle: {
    color: '#fff',
    lineHeight: 30,
  },
  reelSummary: {
    color: 'rgba(255,255,255,0.72)',
    lineHeight: 18,
  },
  reelAuthor: {
    color: 'rgba(255,255,255,0.45)',
  },
  reelSwipeHint: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
  },
  unreadDotWhite: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#fff',
  },
  muteBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
  },
  muteBtnBg: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 20,
    padding: 7,
  },
  modal: { flex: 1 },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    marginBottom: 8,
  },
  input: {
    height: 48,
    borderWidth: 1,
    fontSize: 15,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  addBtn: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
