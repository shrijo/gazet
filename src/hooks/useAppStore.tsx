import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useRef,
  useCallback,
} from 'react';
import { AppState as RNAppState, AppStateStatus } from 'react-native';
import { Folder, Feed, Settings, FeedFilter, Article } from '../types';
import * as storage from '../services/storage';
import * as db from '../services/db';
import {
  fetchArticles,
  fetchFeedMeta,
  fetchOlderPage,
  enrichWithImages,
  PageCursor,
} from '../services/rss';
import { generateId, uuid } from '../utils/id';

const STALE_AFTER_MS = 15 * 60 * 1000; // 15 minutes

interface AppState {
  folders: Folder[];
  feeds: Feed[];
  settings: Settings;
  filter: FeedFilter;
  loading: boolean;
  refreshing: boolean;
  articleVersion: number;
}

type Action =
  | { type: 'LOAD'; payload: Omit<AppState, 'loading' | 'refreshing' | 'filter' | 'articleVersion'> }
  | { type: 'SET_LOADING';    payload: boolean }
  | { type: 'SET_REFRESHING'; payload: boolean }
  | { type: 'SET_FILTER';     payload: FeedFilter }
  | { type: 'SET_FOLDERS';    payload: Folder[] }
  | { type: 'SET_FEEDS';      payload: Feed[] }
  | { type: 'SET_SETTINGS';   payload: Settings }
  | { type: 'BUMP_VERSION' };

const DEFAULT_SETTINGS: Settings = {
  viewMode: 'card',
  themeMode: 'system',
  refreshIntervalMinutes: 30,
  notificationsEnabled: false,
  markReadOnScroll: true,
  showImages: true,
  showUnreadBadges: false,
  hideReadArticles: false,
};

const initialState: AppState = {
  folders: [],
  feeds: [],
  settings: DEFAULT_SETTINGS,
  filter: { type: 'all' },
  loading: true,
  refreshing: false,
  articleVersion: 0,
};

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'LOAD':
      return { ...state, ...action.payload, loading: false };
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_REFRESHING':
      return { ...state, refreshing: action.payload };
    case 'SET_FILTER':
      return { ...state, filter: action.payload };
    case 'SET_FOLDERS':
      return { ...state, folders: action.payload };
    case 'SET_FEEDS':
      return { ...state, feeds: action.payload };
    case 'SET_SETTINGS':
      return { ...state, settings: action.payload };
    case 'BUMP_VERSION':
      return { ...state, articleVersion: state.articleVersion + 1 };
    default:
      return state;
  }
}

interface AppContextValue {
  state: AppState;
  // Feeds
  addFeed:       (url: string, folderId?: string) => Promise<void>;
  removeFeed:    (feedId: string) => Promise<void>;
  moveFeed:      (feedId: string, folderId?: string) => Promise<void>;
  reorderFeeds:  (feeds: Feed[]) => Promise<void>;
  // Folders
  addFolder:     (name: string) => Promise<Folder>;
  updateFolder:  (folderId: string, patch: Partial<Folder>) => Promise<void>;
  removeFolder:  (folderId: string) => Promise<void>;
  reorderFolders:(folders: Folder[]) => Promise<void>;
  // Articles
  markRead:    (articleId: string) => Promise<void>;
  markAllRead: (feedId: string) => Promise<void>;
  toggleBookmark: (articleId: string) => Promise<boolean>;
  // Refresh
  refreshAll:  () => Promise<void>;
  refreshFeed: (feed: Feed) => Promise<void>;
  // Per-feed cursors threaded by the screen so each "load more" advances the
  // pagination state machine (URL-page → Wayback Machine → done).
  fetchOlderFromNetwork: (
    filter: FeedFilter,
    cursors: Record<string, PageCursor>,
  ) => Promise<{ articles: Article[]; cursors: Record<string, PageCursor>; allDone: boolean }>;
  // Filter
  setFilter: (filter: FeedFilter) => void;
  // Settings
  updateSettings: (partial: Partial<Settings>) => Promise<void>;
  // OPML
  importFeeds: (folders: Folder[], feeds: Feed[]) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Boot: init SQLite, run migrations, then load from storage
  useEffect(() => {
    (async () => {
      db.initDB();
      await storage.runMigrations();
      const [folders, feeds, settings] = await Promise.all([
        storage.getFolders(),
        storage.getFeeds(),
        storage.getSettings(),
      ]);
      dispatch({ type: 'LOAD', payload: { folders, feeds, settings } });
    })();
  }, []);

  // Foreground-resume refresh: re-fetch feeds that haven't been updated in 15+ minutes
  const appStateRef = useRef<AppStateStatus>(RNAppState.currentState);
  const feedsRef = useRef<Feed[]>(state.feeds);
  useEffect(() => { feedsRef.current = state.feeds; }, [state.feeds]);

  useEffect(() => {
    const sub = RNAppState.addEventListener('change', (nextState: AppStateStatus) => {
      const wasBackground = appStateRef.current !== 'active';
      appStateRef.current = nextState;
      if (nextState === 'active' && wasBackground) {
        const stale = feedsRef.current.filter(
          f => !f.lastFetched || Date.now() - f.lastFetched > STALE_AFTER_MS,
        );
        if (stale.length > 0) {
          dispatch({ type: 'SET_REFRESHING', payload: true });
          Promise.allSettled(stale.map(f => refreshFeed(f))).then(() => {
            dispatch({ type: 'SET_REFRESHING', payload: false });
          });
        }
      }
    });
    return () => sub.remove();
  // refreshFeed is stable (no deps), feedsRef avoids re-subscribing on every feed change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshFeed = useCallback(async (feed: Feed) => {
    try {
      const { articles, faviconUrl, nextPageUrl } = await fetchArticles(feed);
      await db.upsertArticles(articles);
      const unreadCount = articles.filter(a => !a.isRead).length;
      const updated = { ...feed, lastFetched: Date.now(), unreadCount, faviconUrl: faviconUrl ?? feed.faviconUrl, nextPageUrl };
      await storage.saveFeed(updated);
      const allFeeds = await storage.getFeeds();
      dispatch({ type: 'SET_FEEDS', payload: allFeeds });
      dispatch({ type: 'BUMP_VERSION' });
      // Enrich images async — only for articles that have no image from the feed
      const needsEnrich = articles.filter(a => !a.imageUrl);
      if (needsEnrich.length > 0) {
        enrichWithImages(articles).then(async () => {
          const gained = needsEnrich.filter(a => a.imageUrl);
          if (gained.length > 0) {
            await db.upsertArticles(articles);
            dispatch({ type: 'BUMP_VERSION' });
          }
        }).catch(e => console.warn('Image enrichment error', e));
      }
    } catch (e) {
      console.warn('Feed fetch error', feed.url, e);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    dispatch({ type: 'SET_REFRESHING', payload: true });
    await Promise.allSettled(state.feeds.map(refreshFeed));
    dispatch({ type: 'SET_REFRESHING', payload: false });
  }, [state.feeds, refreshFeed]);

  const fetchOlderFromNetwork = useCallback(async (
    filter: FeedFilter,
    cursors: Record<string, PageCursor>,
  ): Promise<{ articles: Article[]; cursors: Record<string, PageCursor>; allDone: boolean }> => {
    if (filter.type === 'bookmarks') {
      return { articles: [], cursors, allDone: true };
    }

    let feedsToFetch: Feed[];
    if (filter.type === 'feed') {
      feedsToFetch = state.feeds.filter(f => f.id === filter.feedId);
    } else if (filter.type === 'folder') {
      feedsToFetch = state.feeds.filter(f => f.folderId === filter.folderId);
    } else {
      feedsToFetch = state.feeds;
    }

    const existingIds = await db.getAllArticleIds();
    const nextCursors: Record<string, PageCursor> = { ...cursors };

    const results = await Promise.allSettled(
      feedsToFetch
        .filter(f => (cursors[f.id]?.kind ?? 'urlPage') !== 'done')
        .map(async feed => {
          const cur = cursors[feed.id] ?? ({ kind: 'urlPage', page: 2 } as PageCursor);
          const { articles, cursor } = await fetchOlderPage(feed, cur, existingIds);
          nextCursors[feed.id] = cursor;
          return articles;
        }),
    );

    const fresh: Article[] = [];
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      fresh.push(...r.value);
    }
    if (fresh.length > 0) {
      await db.upsertArticles(fresh);
      const needsEnrich = fresh.filter(a => !a.imageUrl);
      if (needsEnrich.length > 0) {
        enrichWithImages(fresh).then(async () => {
          const gained = needsEnrich.filter(a => a.imageUrl);
          if (gained.length > 0) {
            await db.upsertArticles(fresh);
            dispatch({ type: 'BUMP_VERSION' });
          }
        }).catch(e => console.warn('Image enrichment error', e));
      }
    }

    const allDone = feedsToFetch.every(f => (nextCursors[f.id]?.kind ?? 'urlPage') === 'done');
    return { articles: fresh, cursors: nextCursors, allDone };
  }, [state.feeds]);

  const addFeed = useCallback(async (url: string, folderId?: string) => {
    const meta = await fetchFeedMeta(url);
    const id = generateId(url);
    const feed: Feed = {
      id,
      folderId,
      title: meta.title ?? url,
      url,
      faviconUrl: meta.faviconUrl,
      description: meta.description,
      unreadCount: 0,
      createdAt: Date.now(),
    };
    await storage.saveFeed(feed);
    await refreshFeed(feed);
    const feeds = await storage.getFeeds();
    dispatch({ type: 'SET_FEEDS', payload: feeds });
  }, [refreshFeed]);

  const removeFeed = useCallback(async (feedId: string) => {
    await storage.deleteFeed(feedId);
    const feeds = await storage.getFeeds();
    dispatch({ type: 'SET_FEEDS', payload: feeds });
    dispatch({ type: 'BUMP_VERSION' });
  }, []);

  const moveFeed = useCallback(async (feedId: string, folderId?: string) => {
    const feed = state.feeds.find(f => f.id === feedId);
    if (!feed) return;
    await storage.saveFeed({ ...feed, folderId });
    const feeds = await storage.getFeeds();
    dispatch({ type: 'SET_FEEDS', payload: feeds });
    dispatch({ type: 'BUMP_VERSION' });
  }, [state.feeds]);

  const reorderFolders = useCallback(async (reordered: Folder[]) => {
    await storage.saveFolders(reordered);
    dispatch({ type: 'SET_FOLDERS', payload: reordered });
  }, []);

  const reorderFeeds = useCallback(async (reordered: Feed[]) => {
    await storage.saveFeeds(reordered);
    dispatch({ type: 'SET_FEEDS', payload: reordered });
  }, []);

  const addFolder = useCallback(async (name: string): Promise<Folder> => {
    const folder: Folder = { id: uuid(), name, createdAt: Date.now() };
    await storage.saveFolder(folder);
    const folders = await storage.getFolders();
    dispatch({ type: 'SET_FOLDERS', payload: folders });
    return folder;
  }, []);

  const updateFolder = useCallback(async (folderId: string, patch: Partial<Folder>) => {
    const folder = state.folders.find(f => f.id === folderId);
    if (!folder) return;
    await storage.saveFolder({ ...folder, ...patch, id: folder.id });
    const folders = await storage.getFolders();
    dispatch({ type: 'SET_FOLDERS', payload: folders });
  }, [state.folders]);

  const removeFolder = useCallback(async (folderId: string) => {
    await storage.deleteFolder(folderId);
    const [folders, feeds] = await Promise.all([
      storage.getFolders(),
      storage.getFeeds(),
    ]);
    dispatch({ type: 'SET_FOLDERS', payload: folders });
    dispatch({ type: 'SET_FEEDS', payload: feeds });
  }, []);

  const markRead = useCallback(async (articleId: string) => {
    await db.markArticleRead(articleId, true);
  }, []);

  const markAllRead = useCallback(async (feedId: string) => {
    await db.markFeedAllRead(feedId);
    dispatch({ type: 'BUMP_VERSION' });
  }, []);

  const toggleBookmark = useCallback(async (articleId: string): Promise<boolean> => {
    const next = await db.toggleBookmark(articleId);
    dispatch({ type: 'BUMP_VERSION' });
    return next;
  }, []);

  const setFilter = useCallback((filter: FeedFilter) => {
    dispatch({ type: 'SET_FILTER', payload: filter });
  }, []);

  const updateSettings = useCallback(async (partial: Partial<Settings>) => {
    await storage.saveSettings(partial);
    const settings = await storage.getSettings();
    dispatch({ type: 'SET_SETTINGS', payload: settings });
  }, []);

  const importFeeds = useCallback(async (folders: Folder[], feeds: Feed[]) => {
    for (const folder of folders) await storage.saveFolder(folder);
    for (const feed of feeds) await storage.saveFeed(feed);
    const [allFolders, allFeeds] = await Promise.all([
      storage.getFolders(),
      storage.getFeeds(),
    ]);
    dispatch({ type: 'SET_FOLDERS', payload: allFolders });
    dispatch({ type: 'SET_FEEDS', payload: allFeeds });
    await Promise.allSettled(feeds.map(refreshFeed));
  }, [refreshFeed]);

  const value: AppContextValue = {
    state,
    addFeed,
    removeFeed,
    moveFeed,
    reorderFeeds,
    addFolder,
    updateFolder,
    removeFolder,
    reorderFolders,
    markRead,
    markAllRead,
    toggleBookmark,
    refreshAll,
    refreshFeed,
    fetchOlderFromNetwork,
    setFilter,
    updateSettings,
    importFeeds,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppStore(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppStore must be used within AppProvider');
  return ctx;
}
