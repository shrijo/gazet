import * as SQLite from 'expo-sqlite';
import { Article } from '../types';

const db = SQLite.openDatabaseSync('kern.db');

// Serialise all writes through a single promise chain so concurrent
// refreshFeed calls never try to open overlapping transactions.
let writeQueue: Promise<void> = Promise.resolve();
function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(fn);
  // Keep the queue moving even if fn throws
  writeQueue = next.then(() => {}, () => {});
  return next;
}

export function initDB(): void {
  // WAL mode: concurrent reads during background writes, no SQLITE_BUSY errors
  db.execSync(`PRAGMA journal_mode = WAL`);
  db.execSync(`PRAGMA synchronous = NORMAL`);
  db.execSync(`PRAGMA busy_timeout = 2000`);
  db.execSync(`
    CREATE TABLE IF NOT EXISTS articles (
      id            TEXT    PRIMARY KEY,
      feed_id       TEXT    NOT NULL,
      feed_title    TEXT    NOT NULL,
      title         TEXT    NOT NULL,
      summary       TEXT,
      content       TEXT,
      link          TEXT    NOT NULL,
      image_url     TEXT,
      video_urls    TEXT,
      author        TEXT,
      pub_date      INTEGER NOT NULL,
      is_read       INTEGER NOT NULL DEFAULT 0,
      is_bookmarked INTEGER NOT NULL DEFAULT 0,
      fetched_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_art_pub    ON articles(pub_date DESC);
    CREATE INDEX IF NOT EXISTS idx_art_feed   ON articles(feed_id, pub_date DESC);
    CREATE INDEX IF NOT EXISTS idx_art_bkm    ON articles(is_bookmarked, pub_date DESC);
    CREATE INDEX IF NOT EXISTS idx_art_unread ON articles(is_read, pub_date DESC);
  `);
}

function rowToArticle(row: any): Article {
  return {
    id:           row.id,
    feedId:       row.feed_id,
    feedTitle:    row.feed_title,
    title:        row.title,
    summary:      row.summary   ?? undefined,
    content:      row.content   ?? undefined,
    link:         row.link,
    imageUrl:     row.image_url ?? undefined,
    videoUrls:    row.video_urls ? JSON.parse(row.video_urls) : undefined,
    author:       row.author    ?? undefined,
    pubDate:      row.pub_date,
    isRead:       row.is_read       === 1,
    isBookmarked: row.is_bookmarked === 1,
    fetchedAt:    row.fetched_at,
  };
}

export function upsertArticles(articles: Article[]): Promise<void> {
  if (articles.length === 0) return Promise.resolve();
  return enqueueWrite(async () => {
    db.execSync('BEGIN');
    try {
      for (const a of articles) {
        db.runSync(
          `INSERT INTO articles
             (id, feed_id, feed_title, title, summary, content, link, image_url,
              video_urls, author, pub_date, is_read, is_bookmarked, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
           ON CONFLICT(id) DO UPDATE SET
             feed_title = excluded.feed_title,
             title      = excluded.title,
             summary    = excluded.summary,
             content    = excluded.content,
             link       = excluded.link,
             image_url  = COALESCE(excluded.image_url, image_url),
             video_urls = excluded.video_urls,
             author     = excluded.author,
             pub_date   = excluded.pub_date,
             fetched_at = excluded.fetched_at`,
          a.id, a.feedId, a.feedTitle, a.title,
          a.summary ?? null, a.content ?? null, a.link,
          a.imageUrl ?? null,
          a.videoUrls?.length ? JSON.stringify(a.videoUrls) : null,
          a.author ?? null, a.pubDate, a.fetchedAt,
        );
      }
      db.execSync('COMMIT');
    } catch (e) {
      db.execSync('ROLLBACK');
      throw e;
    }
  });
}

export interface QueryOptions {
  feedIds?: string[];
  bookmarksOnly?: boolean;
  hideRead?: boolean;
  limit: number;
  // Either offset OR cursor; cursor wins if both are set.
  // Cursor pagination is stable when rows get filtered out mid-scroll
  // (e.g. articles being marked read while hideRead is on).
  offset?: number;
  cursor?: { pubDate: number; id: string };
}

export async function queryArticles(opts: QueryOptions): Promise<Article[]> {
  const conditions: string[] = [];
  const params: any[] = [];

  if (opts.bookmarksOnly) conditions.push('is_bookmarked = 1');
  if (opts.hideRead)      conditions.push('is_read = 0');

  if (opts.feedIds && opts.feedIds.length > 0) {
    const ph = opts.feedIds.map(() => '?').join(',');
    conditions.push(`feed_id IN (${ph})`);
    params.push(...opts.feedIds);
  }

  if (opts.cursor) {
    // Strictly older than the cursor row in (pub_date DESC, id DESC) order
    conditions.push('(pub_date < ? OR (pub_date = ? AND id < ?))');
    params.push(opts.cursor.pubDate, opts.cursor.pubDate, opts.cursor.id);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  let sql: string;
  if (opts.cursor) {
    params.push(opts.limit);
    sql = `SELECT * FROM articles ${where} ORDER BY pub_date DESC, id DESC LIMIT ?`;
  } else {
    params.push(opts.limit, opts.offset ?? 0);
    sql = `SELECT * FROM articles ${where} ORDER BY pub_date DESC, id DESC LIMIT ? OFFSET ?`;
  }

  const rows = await db.getAllAsync(sql, params) as any[];
  return rows.map(rowToArticle);
}

export async function getAllArticleIds(): Promise<Set<string>> {
  const rows = await db.getAllAsync('SELECT id FROM articles') as any[];
  return new Set(rows.map(r => r.id));
}

export async function markArticleRead(articleId: string, isRead: boolean): Promise<void> {
  await db.runAsync('UPDATE articles SET is_read = ? WHERE id = ?', isRead ? 1 : 0, articleId);
}

export async function markFeedAllRead(feedId: string): Promise<void> {
  await db.runAsync('UPDATE articles SET is_read = 1 WHERE feed_id = ?', feedId);
}

export async function toggleBookmark(articleId: string): Promise<boolean> {
  await db.runAsync(
    'UPDATE articles SET is_bookmarked = CASE WHEN is_bookmarked = 1 THEN 0 ELSE 1 END WHERE id = ?',
    articleId,
  );
  const row = await db.getFirstAsync(
    'SELECT is_bookmarked FROM articles WHERE id = ?',
    articleId,
  ) as any;
  return row?.is_bookmarked === 1;
}

export async function deleteArticlesByFeed(feedId: string): Promise<void> {
  await db.runAsync('DELETE FROM articles WHERE feed_id = ?', feedId);
}

export function clearArticles(): void {
  db.execSync('DELETE FROM articles');
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

export async function fixStoredEntities(): Promise<void> {
  const rows = await db.getAllAsync(
    `SELECT id, title, summary FROM articles WHERE title LIKE '%&#%' OR summary LIKE '%&#%'`,
  ) as { id: string; title: string; summary: string | null }[];
  if (rows.length === 0) return;
  return enqueueWrite(async () => {
    db.execSync('BEGIN');
    try {
      for (const row of rows) {
        db.runSync(
          'UPDATE articles SET title = ?, summary = ? WHERE id = ?',
          decodeEntities(row.title),
          row.summary ? decodeEntities(row.summary) : null,
          row.id,
        );
      }
      db.execSync('COMMIT');
    } catch (e) {
      db.execSync('ROLLBACK');
      throw e;
    }
  });
}
