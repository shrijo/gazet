import AsyncStorage from '@react-native-async-storage/async-storage';
import { Folder, Feed, Article, Settings } from '../types';

const KEYS = {
  FOLDERS: '@kern/folders',
  FEEDS: '@kern/feeds',
  ARTICLES: '@kern/articles',
  SETTINGS: '@kern/settings',
} as const;

const DEFAULT_SETTINGS: Settings = {
  viewMode: 'card',
  themeMode: 'system',
  refreshIntervalMinutes: 30,
  notificationsEnabled: false,
  markReadOnScroll: true,
  showImages: true,
};

// --- Generic helpers ---

async function getJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return fallback;
  return JSON.parse(raw) as T;
}

async function setJson<T>(key: string, value: T): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

// --- Folders ---

export async function getFolders(): Promise<Folder[]> {
  return getJson<Folder[]>(KEYS.FOLDERS, []);
}

export async function saveFolder(folder: Folder): Promise<void> {
  const folders = await getFolders();
  const idx = folders.findIndex(f => f.id === folder.id);
  if (idx >= 0) folders[idx] = folder;
  else folders.push(folder);
  await setJson(KEYS.FOLDERS, folders);
}

export async function deleteFolder(folderId: string): Promise<void> {
  const folders = await getFolders();
  await setJson(
    KEYS.FOLDERS,
    folders.filter(f => f.id !== folderId),
  );
  // Move feeds in folder to root
  const feeds = await getFeeds();
  const updated = feeds.map(f =>
    f.folderId === folderId ? { ...f, folderId: undefined } : f,
  );
  await setJson(KEYS.FEEDS, updated);
}

// --- Feeds ---

export async function getFeeds(): Promise<Feed[]> {
  return getJson<Feed[]>(KEYS.FEEDS, []);
}

export async function saveFeed(feed: Feed): Promise<void> {
  const feeds = await getFeeds();
  const idx = feeds.findIndex(f => f.id === feed.id);
  if (idx >= 0) feeds[idx] = feed;
  else feeds.push(feed);
  await setJson(KEYS.FEEDS, feeds);
}

export async function deleteFeed(feedId: string): Promise<void> {
  const feeds = await getFeeds();
  await setJson(
    KEYS.FEEDS,
    feeds.filter(f => f.id !== feedId),
  );
  // Remove articles for this feed
  const articles = await getArticles();
  await setJson(
    KEYS.ARTICLES,
    articles.filter(a => a.feedId !== feedId),
  );
}

// --- Articles ---

export async function getArticles(): Promise<Article[]> {
  return getJson<Article[]>(KEYS.ARTICLES, []);
}

export async function upsertArticles(incoming: Article[]): Promise<void> {
  const existing = await getArticles();
  const map = new Map(existing.map(a => [a.id, a]));
  for (const article of incoming) {
    const prev = map.get(article.id);
    if (prev) {
      // Preserve user state
      map.set(article.id, {
        ...article,
        isRead: prev.isRead,
        isBookmarked: prev.isBookmarked,
      });
    } else {
      map.set(article.id, article);
    }
  }
  await setJson(KEYS.ARTICLES, Array.from(map.values()));
}

export async function markArticleRead(articleId: string, isRead: boolean): Promise<void> {
  const articles = await getArticles();
  const updated = articles.map(a =>
    a.id === articleId ? { ...a, isRead } : a,
  );
  await setJson(KEYS.ARTICLES, updated);
}

export async function markFeedAllRead(feedId: string): Promise<void> {
  const articles = await getArticles();
  const updated = articles.map(a =>
    a.feedId === feedId ? { ...a, isRead: true } : a,
  );
  await setJson(KEYS.ARTICLES, updated);
}

export async function toggleBookmark(articleId: string): Promise<boolean> {
  const articles = await getArticles();
  let next = false;
  const updated = articles.map(a => {
    if (a.id === articleId) {
      next = !a.isBookmarked;
      return { ...a, isBookmarked: next };
    }
    return a;
  });
  await setJson(KEYS.ARTICLES, updated);
  return next;
}

// --- Settings ---

export async function getSettings(): Promise<Settings> {
  return getJson<Settings>(KEYS.SETTINGS, DEFAULT_SETTINGS);
}

export async function saveSettings(settings: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  await setJson(KEYS.SETTINGS, { ...current, ...settings });
}
