import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import { Folder, Feed, Article, Settings, FeedFilter, ViewMode } from '../types';
import * as storage from '../services/storage';
import { fetchArticles, fetchFeedMeta } from '../services/rss';
import { upsertArticles } from '../services/storage';
import { generateId, uuid } from '../utils/id';

interface AppState {
  folders: Folder[];
  feeds: Feed[];
  articles: Article[];
  settings: Settings;
  filter: FeedFilter;
  loading: boolean;
  refreshing: boolean;
}

type Action =
  | { type: 'LOAD'; payload: Omit<AppState, 'loading' | 'refreshing' | 'filter'> }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_REFRESHING'; payload: boolean }
  | { type: 'SET_FILTER'; payload: FeedFilter }
  | { type: 'SET_FOLDERS'; payload: Folder[] }
  | { type: 'SET_FEEDS'; payload: Feed[] }
  | { type: 'SET_ARTICLES'; payload: Article[] }
  | { type: 'UPDATE_ARTICLE'; payload: Article }
  | { type: 'SET_SETTINGS'; payload: Settings };

const DEFAULT_SETTINGS: Settings = {
  viewMode: 'card',
  themeMode: 'system',
  refreshIntervalMinutes: 30,
  notificationsEnabled: false,
  markReadOnScroll: true,
  showImages: true,
};

const initialState: AppState = {
  folders: [],
  feeds: [],
  articles: [],
  settings: DEFAULT_SETTINGS,
  filter: { type: 'all' },
  loading: true,
  refreshing: false,
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
    case 'SET_ARTICLES':
      return { ...state, articles: action.payload };
    case 'UPDATE_ARTICLE':
      return {
        ...state,
        articles: state.articles.map(a =>
          a.id === action.payload.id ? action.payload : a,
        ),
      };
    case 'SET_SETTINGS':
      return { ...state, settings: action.payload };
    default:
      return state;
  }
}

interface AppContextValue {
  state: AppState;
  filteredArticles: Article[];
  // Feeds
  addFeed: (url: string, folderId?: string) => Promise<void>;
  removeFeed: (feedId: string) => Promise<void>;
  moveFeed: (feedId: string, folderId?: string) => Promise<void>;
  // Folders
  addFolder: (name: string) => Promise<Folder>;
  renameFolder: (folderId: string, name: string) => Promise<void>;
  removeFolder: (folderId: string) => Promise<void>;
  // Articles
  markRead: (articleId: string) => Promise<void>;
  markAllRead: (feedId: string) => Promise<void>;
  toggleBookmark: (articleId: string) => Promise<void>;
  // Refresh
  refreshAll: () => Promise<void>;
  refreshFeed: (feed: Feed) => Promise<void>;
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

  // Boot: load from storage
  useEffect(() => {
    (async () => {
      const [folders, feeds, articles, settings] = await Promise.all([
        storage.getFolders(),
        storage.getFeeds(),
        storage.getArticles(),
        storage.getSettings(),
      ]);
      dispatch({ type: 'LOAD', payload: { folders, feeds, articles, settings } });
    })();
  }, []);

  // Derived: articles filtered by current filter, sorted newest first
  const filteredArticles = React.useMemo(() => {
    const { filter, articles, feeds } = state;
    let result = articles;

    if (filter.type === 'bookmarks') {
      result = articles.filter(a => a.isBookmarked);
    } else if (filter.type === 'feed') {
      result = articles.filter(a => a.feedId === filter.feedId);
    } else if (filter.type === 'folder') {
      const folderFeedIds = new Set(
        feeds.filter(f => f.folderId === filter.folderId).map(f => f.id),
      );
      result = articles.filter(a => folderFeedIds.has(a.feedId));
    }

    return [...result].sort((a, b) => b.pubDate - a.pubDate);
  }, [state]);

  const refreshFeed = useCallback(async (feed: Feed) => {
    try {
      const { articles, faviconUrl } = await fetchArticles(feed);
      await upsertArticles(articles);
      const unreadCount = articles.filter(a => !a.isRead).length;
      const updated = { ...feed, lastFetched: Date.now(), unreadCount, faviconUrl: faviconUrl ?? feed.faviconUrl };
      await storage.saveFeed(updated);
      const allArticles = await storage.getArticles();
      const allFeeds = await storage.getFeeds();
      dispatch({ type: 'SET_ARTICLES', payload: allArticles });
      dispatch({ type: 'SET_FEEDS', payload: allFeeds });
    } catch (e) {
      console.warn('Feed fetch error', feed.url, e);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    dispatch({ type: 'SET_REFRESHING', payload: true });
    await Promise.allSettled(state.feeds.map(refreshFeed));
    dispatch({ type: 'SET_REFRESHING', payload: false });
  }, [state.feeds, refreshFeed]);

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
    const [feeds, articles] = await Promise.all([
      storage.getFeeds(),
      storage.getArticles(),
    ]);
    dispatch({ type: 'SET_FEEDS', payload: feeds });
    dispatch({ type: 'SET_ARTICLES', payload: articles });
  }, []);

  const moveFeed = useCallback(async (feedId: string, folderId?: string) => {
    const feed = state.feeds.find(f => f.id === feedId);
    if (!feed) return;
    const updated = { ...feed, folderId };
    await storage.saveFeed(updated);
    const feeds = await storage.getFeeds();
    dispatch({ type: 'SET_FEEDS', payload: feeds });
  }, [state.feeds]);

  const addFolder = useCallback(async (name: string): Promise<Folder> => {
    const folder: Folder = { id: uuid(), name, createdAt: Date.now() };
    await storage.saveFolder(folder);
    const folders = await storage.getFolders();
    dispatch({ type: 'SET_FOLDERS', payload: folders });
    return folder;
  }, []);

  const renameFolder = useCallback(async (folderId: string, name: string) => {
    const folder = state.folders.find(f => f.id === folderId);
    if (!folder) return;
    await storage.saveFolder({ ...folder, name });
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
    await storage.markArticleRead(articleId, true);
    const articles = await storage.getArticles();
    dispatch({ type: 'SET_ARTICLES', payload: articles });
  }, []);

  const markAllRead = useCallback(async (feedId: string) => {
    await storage.markFeedAllRead(feedId);
    const articles = await storage.getArticles();
    dispatch({ type: 'SET_ARTICLES', payload: articles });
  }, []);

  const toggleBookmark = useCallback(async (articleId: string) => {
    await storage.toggleBookmark(articleId);
    const articles = await storage.getArticles();
    dispatch({ type: 'SET_ARTICLES', payload: articles });
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
    filteredArticles,
    addFeed,
    removeFeed,
    moveFeed,
    addFolder,
    renameFolder,
    removeFolder,
    markRead,
    markAllRead,
    toggleBookmark,
    refreshAll,
    refreshFeed,
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
