export interface Folder {
  id: string;
  name: string;
  createdAt: number;
}

export interface Feed {
  id: string;
  folderId?: string;
  title: string;
  url: string;
  faviconUrl?: string;
  description?: string;
  lastFetched?: number;
  unreadCount: number;
  createdAt: number;
  nextPageUrl?: string; // Atom RFC 5005 <link rel="next"> — URL for loading older articles
}

export interface Article {
  id: string;
  feedId: string;
  feedTitle: string;
  title: string;
  summary?: string;
  content?: string;
  link: string;
  imageUrl?: string;
  videoUrls?: string[];
  author?: string;
  pubDate: number;
  isRead: boolean;
  isBookmarked: boolean;
  fetchedAt: number;
}

export type ViewMode = 'card' | 'list' | 'reel';

export type ThemeMode = 'system' | 'light' | 'dark';

export interface Settings {
  viewMode: ViewMode;
  themeMode: ThemeMode;
  refreshIntervalMinutes: number;
  notificationsEnabled: boolean;
  markReadOnScroll: boolean;
  showImages: boolean;
  showUnreadBadges: boolean;
  hideReadArticles: boolean;
}

export type FeedFilter =
  | { type: 'all' }
  | { type: 'bookmarks' }
  | { type: 'feed'; feedId: string }
  | { type: 'folder'; folderId: string };
