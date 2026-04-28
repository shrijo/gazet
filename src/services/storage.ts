import AsyncStorage from '@react-native-async-storage/async-storage';
import { Folder, Feed, Article, Settings } from '../types';
import * as db from './db';

const KEYS = {
  FOLDERS:  '@kern/folders',
  FEEDS:    '@kern/feeds',
  SETTINGS: '@kern/settings',
} as const;

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

const MIGRATION_V4 = '@kern/migration_v4';
const MIGRATION_V5 = '@kern/migration_v5';

export async function runMigrations(): Promise<void> {
  // v4: move AsyncStorage articles → SQLite
  if (!await AsyncStorage.getItem(MIGRATION_V4)) {
    const raw = await AsyncStorage.getItem('@kern/articles');
    if (raw) {
      const articles: Article[] = JSON.parse(raw);
      const fixed = articles.map(a => {
        if (!a.imageUrl) return a;
        if (a.imageUrl.startsWith('http')) return a;
        return { ...a, imageUrl: undefined };
      });
      await db.upsertArticles(fixed);
      await AsyncStorage.removeItem('@kern/articles');
    }
    await AsyncStorage.setItem(MIGRATION_V4, '1');
  }

  // v5: clear articles that were stored with old 32-bit hash IDs to prevent
  // duplicate-key collisions after upgrading to 53-bit cyrb53 IDs.
  if (!await AsyncStorage.getItem(MIGRATION_V5)) {
    db.clearArticles();
    await AsyncStorage.setItem(MIGRATION_V5, '1');
  }
}

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
  await setJson(KEYS.FOLDERS, folders.filter(f => f.id !== folderId));
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
  await setJson(KEYS.FEEDS, feeds.filter(f => f.id !== feedId));
  await db.deleteArticlesByFeed(feedId);
}

// --- Settings ---

export async function getSettings(): Promise<Settings> {
  return getJson<Settings>(KEYS.SETTINGS, DEFAULT_SETTINGS);
}

export async function saveSettings(settings: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  await setJson(KEYS.SETTINGS, { ...current, ...settings });
}
