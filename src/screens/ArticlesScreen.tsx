import React, { useCallback, useRef, useEffect, useState } from 'react';
import {
  View,
  FlatList,
  Animated,
  Easing,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';

const AnimatedExpoImage = Animated.createAnimatedComponent(ExpoImage);
import { VideoView, useVideoPlayer } from 'expo-video';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useDrawer } from '../navigation/Drawer';
import { useSettingsDrawer } from '../navigation/SettingsDrawer';
import { useTheme } from '../theme';
import { Text, Icon, Card, Divider } from '../components';
import { useAppStore } from '../hooks/useAppStore';
import { queryArticles, QueryOptions } from '../services/db';
import type { PageCursor } from '../services/rss';
import { Article, Feed, FeedFilter, ViewMode } from '../types';
import { formatArticleDate } from '../utils/date';

const BAR_HEIGHT = 64;
const HEADER_HEIGHT = 56;
const PAGE_SIZE = 30;

function buildQueryOpts(
  filter: FeedFilter,
  feeds: Feed[],
  hideRead: boolean,
  offset: number,
): QueryOptions {
  const feedIds =
    filter.type === 'feed'   ? [filter.feedId] :
    filter.type === 'folder' ? feeds.filter(f => f.folderId === filter.folderId).map(f => f.id) :
    undefined;

  return {
    feedIds,
    bookmarksOnly: filter.type === 'bookmarks',
    hideRead,
    limit: PAGE_SIZE,
    offset,
  };
}

export function ArticlesScreen() {
  const { colors, spacing } = useTheme();
  const navigation = useNavigation();
  const drawer = useDrawer();
  const settingsDrawer = useSettingsDrawer();
  const {
    state,
    refreshAll,
    fetchOlderFromNetwork,
    markRead,
    updateSettings,
    setFilter,
  } = useAppStore();
  const { settings, filter, feeds, loading, refreshing, articleVersion } = state;

  const viewMode = settings.viewMode;
  const isCard = viewMode === 'card';
  const isReel = viewMode === 'reel';

  // Local article list — screen owns pagination
  const [articles, setArticles] = useState<Article[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const noMoreRef      = useRef(false);
  // Per-feed pagination cursors (URL-page → Wayback Machine → done).
  const cursorsRef     = useRef<Record<string, PageCursor>>({});

  // ---- Scroll-position preservation across view-mode switches ----
  // Always-current snapshot of `articles` for use inside callbacks/effects.
  const articlesRef = useRef<Article[]>([]);
  useEffect(() => { articlesRef.current = articles; }, [articles]);
  // ID of the topmost visible article — updated by all three views.
  const visibleArticleIdRef = useRef<string | null>(null);
  // Ref to the card/list FlatList so we can scroll it after a mode switch.
  const flatListRef = useRef<FlatList<Article>>(null);
  // Initial reel index: computed before the mode switch so the FlatList
  // already has the right value when it first renders.
  const [reelInitialIndex, setReelInitialIndex] = useState(0);

  // Viewability config + handler shared by the card and list FlatList.
  const listViewabilityConfig = useRef({ itemVisiblePercentThreshold: 30 });
  const onListViewableItemsChanged = useCallback(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      visibleArticleIdRef.current = viewableItems[0].item.id;
    }
  }, []);

  // After a mode switch to card/list, restore scroll position.
  // Reel uses initialScrollIndex (set synchronously in cycleViewMode).
  useEffect(() => {
    if (isReel) return;
    const targetId = visibleArticleIdRef.current;
    if (!targetId) return;
    const idx = articlesRef.current.findIndex(a => a.id === targetId);
    if (idx <= 0) return; // already at top
    // Small delay so the FlatList completes its layout pass before we scroll.
    const t = setTimeout(() => {
      flatListRef.current?.scrollToIndex({
        index: idx,
        animated: false,
        viewPosition: 0,
      });
    }, 80);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  const filterKey =
    filter.type === 'feed'   ? `feed:${filter.feedId}` :
    filter.type === 'folder' ? `folder:${filter.folderId}` :
    filter.type;

  // Reset and load first page whenever filter or read-hiding changes
  useEffect(() => {
    if (loading) return;
    noMoreRef.current      = false;
    loadingMoreRef.current = false;
    cursorsRef.current     = {};
    setLoadingMore(false);
    queryArticles(buildQueryOpts(filter, feeds, settings.hideReadArticles, 0))
      .then(setArticles);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, settings.hideReadArticles, loading]);

  // On articleVersion bump (refresh / markAllRead / toggleBookmark):
  // reload the same number of articles from offset 0 so the list stays in place.
  const articleCountRef = useRef(0);
  useEffect(() => { articleCountRef.current = articles.length; }, [articles.length]);

  useEffect(() => {
    if (loading || articleVersion === 0) return;
    // A refresh may have brought in new articles — allow pagination to retry
    noMoreRef.current = false;
    const count = Math.max(articleCountRef.current, PAGE_SIZE);
    queryArticles({ ...buildQueryOpts(filter, feeds, settings.hideReadArticles, 0), limit: count })
      .then(setArticles);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleVersion]);

  const doLoadMore = useCallback(async (withSpinner: boolean) => {
    if (loadingMoreRef.current || noMoreRef.current) {
      if (__DEV__) console.log('[loadMore] skip', { loading: loadingMoreRef.current, noMore: noMoreRef.current });
      return;
    }
    loadingMoreRef.current = true;
    if (withSpinner) setLoadingMore(true);
    try {
      // Use the live ref so an articleVersion bump mid-await can't desync
      // the cursor we pass to the next query. Capture by id+pubDate (a value)
      // rather than the array index so re-renders don't invalidate it.
      const lastBefore = articlesRef.current[articlesRef.current.length - 1];
      const cursorBefore = lastBefore
        ? { pubDate: lastBefore.pubDate, id: lastBefore.id }
        : undefined;
      if (__DEV__) console.log('[loadMore] start', { count: articlesRef.current.length, cursor: lastBefore?.title });

      // First: next page from local SQLite via cursor pagination so the offset
      // doesn't drift when articles get marked read during scrolling.
      const fresh = await queryArticles({
        ...buildQueryOpts(filter, feeds, settings.hideReadArticles, 0),
        cursor: cursorBefore,
      });
      if (__DEV__) console.log('[loadMore] sqlite returned', fresh.length);
      if (fresh.length > 0) {
        const knownIds = new Set(articlesRef.current.map(a => a.id));
        const additions = fresh.filter(a => !knownIds.has(a.id));
        if (__DEV__) console.log('[loadMore] sqlite additions', additions.length);
        if (additions.length > 0) setArticles(prev => [...prev, ...additions]);
        return;
      }

      if (filter.type === 'bookmarks') {
        noMoreRef.current = true;
        return;
      }

      // SQLite exhausted — pull from the network. With Wayback bounded per
      // call (rss.ts), a single fetchOlderFromNetwork returns quickly even
      // when slow feeds need many calls to walk their history. Two attempts
      // is enough to hop past one all-empty round.
      const MAX_NET_ATTEMPTS = 2;
      let netArticles: Article[] = [];
      for (let attempt = 0; attempt < MAX_NET_ATTEMPTS; attempt++) {
        if (__DEV__) console.log('[loadMore] network attempt', attempt + 1, 'cursors', cursorsRef.current);
        const { articles: fromNet, cursors, allDone } =
          await fetchOlderFromNetwork(filter, cursorsRef.current);
        cursorsRef.current = cursors;
        netArticles = fromNet;
        if (__DEV__) console.log('[loadMore] network returned', fromNet.length, 'allDone', allDone);
        if (fromNet.length > 0) break;
        if (allDone) {
          noMoreRef.current = true;
          return;
        }
      }
      if (netArticles.length === 0) return;

      // Re-query from SQLite using the cursor captured BEFORE any awaits so
      // we don't double-append items that the articleVersion effect may have
      // already pulled in via a parallel reload.
      const merged = await queryArticles({
        ...buildQueryOpts(filter, feeds, settings.hideReadArticles, 0),
        cursor: cursorBefore,
        limit: PAGE_SIZE * 2,
      });
      if (merged.length === 0) return;
      const knownIds = new Set(articlesRef.current.map(a => a.id));
      const additions = merged.filter(a => !knownIds.has(a.id));
      if (additions.length > 0) setArticles(prev => [...prev, ...additions]);
    } finally {
      loadingMoreRef.current = false;
      if (withSpinner) setLoadingMore(false);
    }
  }, [filter, feeds, settings.hideReadArticles, fetchOlderFromNetwork]);

  const handleLoadMore = useCallback(() => doLoadMore(true), [doLoadMore]);
  const handleLoadMoreSilent = useCallback(() => doLoadMore(false), [doLoadMore]);

  const activeTab = React.useMemo(() => {
    if (filter.type === 'bookmarks') return 'bookmarks';
    return 'feed';
  }, [filter]);

  const filterLabel = React.useMemo(() => {
    if (filter.type === 'all')       return 'All Articles';
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
      setArticles(prev =>
        prev.map(a => a.id === article.id ? { ...a, isRead: true } : a),
      );
      (navigation as any).navigate('ArticleDetail', { article });
    },
    [markRead, navigation],
  );

  const cycleViewMode = useCallback(() => {
    const next: ViewMode = viewMode === 'card' ? 'list' : viewMode === 'list' ? 'reel' : 'card';
    // If we're about to enter reel mode, pre-compute the initial scroll index
    // so the FlatList receives it on first render (before the mode state lands).
    if (next === 'reel') {
      const targetId = visibleArticleIdRef.current;
      const idx = targetId ? articlesRef.current.findIndex(a => a.id === targetId) : -1;
      setReelInitialIndex(Math.max(0, idx));
    }
    updateSettings({ viewMode: next });
  }, [viewMode, updateSettings]);

  const renderCard = useCallback(
    ({ item }: { item: Article }) => (
      <ArticleCard article={item} onPress={handleArticlePress} />
    ),
    [handleArticlePress],
  );

  const renderListItem = useCallback(
    ({ item }: { item: Article }) => (
      <ArticleListItem article={item} onPress={handleArticlePress} />
    ),
    [handleArticlePress],
  );

  if (isReel) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={['top']}
      >
        <Header title={filterLabel} viewMode={viewMode} onCycleView={cycleViewMode} />
        <ReelList
          articles={articles}
          onPress={handleArticlePress}
          onRefresh={refreshAll}
          refreshing={refreshing}
          onEndReached={handleLoadMore}
          loadingMore={loadingMore}
          initialScrollIndex={reelInitialIndex}
          onVisibleIdChange={id => { visibleArticleIdRef.current = id; }}
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
        ref={flatListRef}
        data={articles}
        keyExtractor={a => a.id}
        renderItem={isCard ? renderCard : renderListItem}
        contentContainerStyle={
          isCard
            ? { padding: spacing[4], gap: spacing[3] }
            : { paddingTop: spacing[2] }
        }
        ItemSeparatorComponent={isCard ? undefined : () => <Divider inset={56} />}
        onEndReached={articles.length > 0 ? handleLoadMore : undefined}
        onEndReachedThreshold={0.5}
        onViewableItemsChanged={onListViewableItemsChanged}
        viewabilityConfig={listViewabilityConfig.current}
        onScrollToIndexFailed={info => {
          // Fallback for variable-height lists: scroll to the approximate offset.
          const wait = new Promise(resolve => setTimeout(resolve, 80));
          wait.then(() => {
            flatListRef.current?.scrollToIndex({
              index: info.index,
              animated: false,
              viewPosition: 0,
            });
          });
        }}
        windowSize={5}
        maxToRenderPerBatch={6}
        initialNumToRender={6}
        removeClippedSubviews
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refreshAll}
            tintColor={colors.accent}
          />
        }
        ListFooterComponent={
          articles.length > 0 ? <EndFooter loading={loadingMore} /> : null
        }
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Icon name="newspaper-outline" size={48} color="secondary" />
              <Text variant="headingMd" color="secondary" style={{ marginTop: spacing[3] }}>
                No articles
              </Text>
              <Text variant="bodyMd" color="tertiary" style={{ textAlign: 'center', marginTop: spacing[1] }}>
                Add feeds via the Menu
              </Text>
            </View>
          ) : null
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
  onEndReached,
  loadingMore,
  initialScrollIndex = 0,
  onVisibleIdChange,
}: {
  articles: Article[];
  onPress: (article: Article) => void;
  onRefresh: () => void;
  refreshing: boolean;
  onEndReached: () => void;
  loadingMore: boolean;
  initialScrollIndex?: number;
  onVisibleIdChange?: (id: string) => void;
}) {
  const { colors, spacing } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [activeIndex, setActiveIndex] = useState(initialScrollIndex);

  const itemHeight = windowHeight - insets.top - HEADER_HEIGHT - BAR_HEIGHT - insets.bottom;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 });
  const onViewableItemsChanged = useCallback(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      const idx = viewableItems[0].index ?? 0;
      setActiveIndex(idx);
      onVisibleIdChange?.(viewableItems[0].item.id);
    }
  }, [onVisibleIdChange]);

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
      showsVerticalScrollIndicator={false}
      snapToInterval={itemHeight}
      snapToAlignment="start"
      decelerationRate="fast"
      bounces={false}
      overScrollMode="never"
      onEndReached={articles.length > 0 ? onEndReached : undefined}
      onEndReachedThreshold={1.5}
      getItemLayout={(_, index) => ({
        length: itemHeight,
        offset: itemHeight * index,
        index,
      })}
      initialScrollIndex={initialScrollIndex > 0 && initialScrollIndex < articles.length ? initialScrollIndex : undefined}
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={viewabilityConfig.current}
      ListFooterComponent={
        articles.length > 0 ? <EndFooter loading={loadingMore} /> : null
      }
      windowSize={3}
      maxToRenderPerBatch={2}
      initialNumToRender={2}
      removeClippedSubviews
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.accent}
        />
      }
      ListEmptyComponent={
        articles.length === 0 && !loadingMore ? (
          <View style={[styles.empty, { height: itemHeight }]}>
            <Icon name="newspaper-outline" size={48} color="secondary" />
            <Text variant="headingMd" color="secondary" style={{ marginTop: spacing[3] }}>
              No articles
            </Text>
            <Text variant="bodyMd" color="tertiary" style={{ textAlign: 'center', marginTop: spacing[1] }}>
              Add feeds via the Menu
            </Text>
          </View>
        ) : null
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

      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.15)', 'rgba(0,0,0,0.82)']}
        locations={[0.35, 0.6, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

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
  const [muted, setMuted] = useState(true);
  const [errored, setErrored] = useState(false);

  const player = useVideoPlayer(uri, p => {
    p.loop = true;
    p.muted = true;
  });

  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'error') setErrored(true);
    });
    return () => sub.remove();
  }, [player]);

  useEffect(() => {
    if (isActive) player.play();
    else player.pause();
  }, [isActive, player]);

  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);

  if (errored) {
    return fallbackImageUri
      ? <KenBurnsImage uri={fallbackImageUri} isActive={isActive} />
      : null;
  }

  return (
    <>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
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

// Subtle pan directions, picked deterministically per image so each article
// has a stable "feel" rather than a random one each render.
const KB_DIRECTIONS = [
  { tx: -20, ty: -12 },
  { tx:  20, ty: -10 },
  { tx: -15, ty:  15 },
  { tx:  18, ty:  10 },
] as const;

function KenBurnsImage({ uri, isActive }: { uri: string; isActive: boolean }) {
  const progress = useRef(new Animated.Value(0)).current;
  const animRef  = useRef<Animated.CompositeAnimation | null>(null);

  const dirIndex = uri.length % KB_DIRECTIONS.length;
  const { tx, ty } = KB_DIRECTIONS[dirIndex];

  useEffect(() => {
    if (isActive) {
      progress.setValue(0);
      // Yoyo loop (0→1→0) so the motion reverses smoothly instead of snapping
      // back at the end of each cycle.
      animRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(progress, {
            toValue: 1,
            duration: 9000,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(progress, {
            toValue: 0,
            duration: 9000,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      );
      animRef.current.start();
    } else {
      animRef.current?.stop();
      progress.setValue(0);
    }
    return () => animRef.current?.stop();
  }, [isActive]);

  const scale      = progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] });
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [0, tx] });
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [0, ty] });

  return (
    <AnimatedExpoImage
      source={{ uri }}
      style={[
        StyleSheet.absoluteFill,
        { transform: [{ scale }, { translateX }, { translateY }] },
      ]}
      contentFit="cover"
      cachePolicy="disk"
    />
  );
}

// ---------------------------------------------------------------------------
// End-of-list footer
// ---------------------------------------------------------------------------

function EndFooter({ loading }: { loading: boolean }) {
  const { colors, spacing } = useTheme();
  return (
    <View style={{ height: spacing[12], alignItems: 'center', justifyContent: 'center' }}>
      {loading && <ActivityIndicator color={colors.textTertiary} />}
    </View>
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
        <Icon name={icon as any} size={24} color={color} />
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
    viewMode === 'card' ? 'list-outline'  :
    viewMode === 'list' ? 'film-outline'  :
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
// FadeImage — fixed-size placeholder that fades to the loaded image
// ---------------------------------------------------------------------------

const FadeImage = React.memo(function FadeImage({ uri, style }: { uri: string; style: any }) {
  const { colors } = useTheme();
  return (
    <View style={[style, { backgroundColor: colors.skeleton, overflow: 'hidden' }]}>
      <ExpoImage
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="disk"
        transition={250}
      />
    </View>
  );
});

// ---------------------------------------------------------------------------
// Card / List item views
// ---------------------------------------------------------------------------

const ArticleCard = React.memo(function ArticleCard({
  article,
  onPress,
}: {
  article: Article;
  onPress: (article: Article) => void;
}) {
  const { colors, spacing } = useTheme();
  const handlePress = useCallback(() => onPress(article), [onPress, article]);

  return (
    <Card onPress={handlePress} noPadding elevated>
      {article.imageUrl ? (
        <FadeImage uri={article.imageUrl} style={styles.cardImage} />
      ) : null}
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
});

const ArticleListItem = React.memo(function ArticleListItem({
  article,
  onPress,
}: {
  article: Article;
  onPress: (article: Article) => void;
}) {
  const { colors, spacing } = useTheme();
  const handlePress = useCallback(() => onPress(article), [onPress, article]);

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.7}
      style={[
        styles.listItem,
        { paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
      ]}
    >
      <View style={styles.listItemContent}>
        {article.imageUrl ? (
          <FadeImage uri={article.imageUrl} style={styles.listItemThumb} />
        ) : null}
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
});

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
