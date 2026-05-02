import { XMLParser } from 'fast-xml-parser';
import { Article, Feed } from '../types';
import { generateId } from '../utils/id';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['item', 'entry', 'enclosure', 'media:content', 'media:thumbnail'].includes(name),
  allowBooleanAttributes: true,
});

function getText(val: any): string {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'object') return val['#text'] ?? val['_'] ?? '';
  return String(val);
}

function toAbsoluteUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('//')) return 'https:' + url;
  if (!url.startsWith('http')) return undefined;
  return url;
}

function isVideoMedia(m: any): boolean {
  return m['@_medium'] === 'video' || String(m['@_type'] ?? '').startsWith('video/');
}

function getThumbnailUrl(node: any): string | undefined {
  if (!node) return undefined;
  const t = node['media:thumbnail'];
  return toAbsoluteUrl(
    (Array.isArray(t) ? t[0]?.['@_url'] : t?.['@_url']) ?? node['@_thumbnail'],
  );
}

function extractImage(item: any): string | undefined {
  // media:group (YouTube, podcast feeds) — thumbnail lives here
  const mediaGroup = item['media:group'];
  if (mediaGroup) {
    const groupThumb = mediaGroup['media:thumbnail'];
    const u = toAbsoluteUrl(
      Array.isArray(groupThumb) ? groupThumb[0]?.['@_url'] : groupThumb?.['@_url'],
    );
    if (u) return u;
    // also check image-typed media:content inside the group
    const groupContent = mediaGroup['media:content'];
    if (Array.isArray(groupContent)) {
      const img = groupContent.find((m: any) => !isVideoMedia(m));
      const cu = toAbsoluteUrl(img?.['@_url']);
      if (cu) return cu;
    }
  }

  // media:content — image items first, then thumbnail embedded on video items
  const mediaContent = item['media:content'];
  if (Array.isArray(mediaContent)) {
    const img = mediaContent.find((m: any) => !isVideoMedia(m));
    const u = toAbsoluteUrl(img?.['@_url']);
    if (u) return u;
    // video items sometimes carry a nested thumbnail
    for (const m of mediaContent) {
      const u2 = getThumbnailUrl(m);
      if (u2) return u2;
    }
  } else if (mediaContent && !isVideoMedia(mediaContent)) {
    const u = toAbsoluteUrl(mediaContent?.['@_url']);
    if (u) return u;
  }

  // standalone media:thumbnail
  const mediaThumbnail = item['media:thumbnail'];
  if (Array.isArray(mediaThumbnail) && mediaThumbnail.length > 0) {
    const u = toAbsoluteUrl(mediaThumbnail[0]?.['@_url']);
    if (u) return u;
  } else if (mediaThumbnail?.['@_url']) {
    const u = toAbsoluteUrl(mediaThumbnail['@_url']);
    if (u) return u;
  }

  // image enclosure
  const enclosures: any[] = Array.isArray(item.enclosure) ? item.enclosure : [];
  const imgEnclosure = enclosures.find((e: any) => e?.['@_type']?.startsWith('image/'));
  const encUrl = toAbsoluteUrl(imgEnclosure?.['@_url']);
  if (encUrl) return encUrl;

  // first <img> in content — matches quoted or unquoted src, absolute URLs only
  const html =
    getText(item['content:encoded']) ||
    getText(item.content) ||
    getText(item.description) ||
    getText(item.summary) ||
    '';
  const match = html.match(/<img[^>]+src=["']?(https?:\/\/[^"'\s>]+)["']?/i);
  if (match?.[1]) return match[1];

  return undefined;
}

function extractVideos(item: any): string[] {
  const enclosures: any[] = Array.isArray(item.enclosure) ? item.enclosure : [];
  const videos = enclosures
    .filter((e: any) => e?.['@_type']?.startsWith('video/') && e['@_url'])
    .map((e: any) => e['@_url'] as string);

  // media:content (top-level and inside media:group)
  const sources = [
    ...(Array.isArray(item['media:content']) ? item['media:content'] : []),
    ...(Array.isArray(item['media:group']?.['media:content']) ? item['media:group']['media:content'] : []),
  ];
  sources.forEach((m: any) => {
    if (isVideoMedia(m) && m['@_url']) videos.push(m['@_url']);
  });

  return [...new Set(videos)];
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function getFaviconUrl(siteUrl: string): string {
  try {
    const { hostname } = new URL(siteUrl);
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;
  } catch {
    return '';
  }
}

async function fetchOgImage(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(url, { headers: { Accept: 'text/html' } });
    if (!res.ok) return undefined;
    const text = await res.text();
    // Scan enough of the head to find og:image (typically within first 8kb)
    const head = text.slice(0, 8000);
    const match =
      head.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
      head.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ??
      head.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) ??
      head.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);
    let imgUrl = match?.[1];
    if (!imgUrl) return undefined;
    // normalize protocol-relative URLs
    if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl;
    // discard relative URLs (no base URL context available)
    if (!imgUrl.startsWith('http')) return undefined;
    return imgUrl;
  } catch {
    return undefined;
  }
}

// A real-browser-style User-Agent unblocks feeds behind Cloudflare/anti-bot
// protections that reject the default fetch UA.
const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  Accept:
    'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5',
  'Accept-Language': 'en-US,en;q=0.5',
};

async function fetchXml(url: string): Promise<any> {
  const res = await fetch(url, { headers: FETCH_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const text = await res.text();
  // Some hosts return HTML error pages with a 200 status. Sanity-check that
  // we got XML before handing it to the parser.
  if (!/<\?xml|<rss|<feed|<rdf:RDF/i.test(text.slice(0, 800))) {
    throw new Error(`Not an XML feed: ${url}`);
  }
  return parser.parse(text);
}

async function enrichWithImages(articles: Article[]): Promise<Article[]> {
  const missing = articles.filter(a => !a.imageUrl && a.link).slice(0, 10);
  if (missing.length > 0) {
    const results = await Promise.allSettled(missing.map(a => fetchOgImage(a.link)));
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value) missing[i].imageUrl = r.value;
    });
  }
  return articles;
}

function paginatedUrls(baseUrl: string, page: number): string[] {
  const urls = new Set<string>();
  try {
    // ?paged=N (WordPress)
    const u1 = new URL(baseUrl);
    u1.searchParams.set('paged', String(page));
    urls.add(u1.toString());
    // ?page=N (generic)
    const u2 = new URL(baseUrl);
    u2.searchParams.set('page', String(page));
    urls.add(u2.toString());
    // /page/N/ inserted before /feed (WordPress permalink)
    const u3 = new URL(baseUrl);
    if (/\/feed\/?$/i.test(u3.pathname)) {
      u3.pathname = u3.pathname.replace(/\/feed\/?$/i, `/page/${page}/feed/`);
      urls.add(u3.toString());
    } else {
      // Append /page/N/ at the end of the path
      const u4 = new URL(baseUrl);
      u4.pathname = u4.pathname.replace(/\/?$/, `/page/${page}/`);
      urls.add(u4.toString());
    }
  } catch { /* ignore */ }
  return [...urls];
}

function parseDoc(doc: any, feed: Feed, now: number): Article[] {
  if (doc?.rss?.channel)   return (doc.rss.channel.item ?? []).map((i: any) => parseRssItem(i, feed, now));
  if (doc?.feed?.entry)    return (doc.feed.entry ?? []).map((e: any) => parseAtomEntry(e, feed, now));
  if (doc?.['rdf:RDF'])    return (doc['rdf:RDF'].item ?? []).map((i: any) => parseRssItem(i, feed, now));
  return [];
}

// ---------------------------------------------------------------------------
// Pagination cursor — a state machine the screen threads back and forth so
// each "load more" tap advances through strategies without losing context.
// ---------------------------------------------------------------------------

export type PageCursor =
  | { kind: 'urlPage'; page: number }                                 // try /page/N variants
  | { kind: 'wbInit' }                                                // need to fetch the wayback timemap
  | { kind: 'wb'; snapshots: string[]; index: number }                // iterating wayback snapshots
  | { kind: 'done' };

export const initialPageCursor: PageCursor = { kind: 'urlPage', page: 2 };

interface PageResult {
  articles: Article[];
  cursor: PageCursor;
}

// Fetch the next batch of older articles for a single feed using the cursor.
// Returns an empty array + cursor 'done' when no further history is reachable.
export async function fetchOlderPage(
  feed: Feed,
  cursor: PageCursor,
  existingIds: Set<string>,
): Promise<PageResult> {
  const now = Date.now();

  if (cursor.kind === 'urlPage') {
    for (const url of paginatedUrls(feed.url, cursor.page)) {
      try {
        const doc = await fetchXml(url);
        const fresh = parseDoc(doc, feed, now).filter(a => !existingIds.has(a.id));
        if (fresh.length > 0) {
          return { articles: fresh, cursor: { kind: 'urlPage', page: cursor.page + 1 } };
        }
      } catch { /* try next variant */ }
    }
    // URL pagination exhausted for this feed — try the Wayback Machine next.
    return fetchOlderPage(feed, { kind: 'wbInit' }, existingIds);
  }

  if (cursor.kind === 'wbInit') {
    const snapshots = await fetchWaybackSnapshots(feed.url);
    if (snapshots.length === 0) return { articles: [], cursor: { kind: 'done' } };
    return fetchOlderPage(feed, { kind: 'wb', snapshots, index: 0 }, existingIds);
  }

  if (cursor.kind === 'wb') {
    const { snapshots, index } = cursor;
    if (index >= snapshots.length) return { articles: [], cursor: { kind: 'done' } };
    try {
      const doc = await fetchXml(snapshots[index]);
      const fresh = parseDoc(doc, feed, now).filter(a => !existingIds.has(a.id));
      const next: PageCursor = { kind: 'wb', snapshots, index: index + 1 };
      if (fresh.length > 0) return { articles: fresh, cursor: next };
      // Empty snapshot — recurse to try the next one without spinning the UI.
      return fetchOlderPage(feed, next, existingIds);
    } catch {
      return fetchOlderPage(feed, { kind: 'wb', snapshots, index: index + 1 }, existingIds);
    }
  }

  return { articles: [], cursor: { kind: 'done' } };
}

// Internet Archive CDX API — newest snapshots first, deduped by digest so we
// don't waste round-trips on identical snapshots. Returns a list of
// "raw" snapshot URLs (the `id_` flag avoids WBM's HTML toolbar injection so
// we get the original RSS/Atom content back).
async function fetchWaybackSnapshots(feedUrl: string): Promise<string[]> {
  try {
    const cdxUrl =
      `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(feedUrl)}` +
      `&output=json&limit=80&filter=statuscode:200&collapse=digest`;
    const res = await fetch(cdxUrl, { headers: FETCH_HEADERS });
    if (!res.ok) return [];
    const rows = (await res.json()) as string[][];
    if (!Array.isArray(rows) || rows.length < 2) return [];
    // First row is the column header.
    const header = rows[0];
    const tsIdx       = header.indexOf('timestamp');
    const originalIdx = header.indexOf('original');
    if (tsIdx < 0 || originalIdx < 0) return [];

    return rows
      .slice(1)
      .map(r => `https://web.archive.org/web/${r[tsIdx]}id_/${r[originalIdx]}`)
      .reverse(); // newest snapshots first
  } catch {
    return [];
  }
}

// Backwards-compatible wrapper used by the older call site (deprecated path).
export async function fetchOlderArticles(
  feed: Feed,
  page: number,
  existingIds: Set<string>,
): Promise<Article[]> {
  const { articles } = await fetchOlderPage(feed, { kind: 'urlPage', page }, existingIds);
  return articles;
}

export { enrichWithImages };

export async function fetchFeedMeta(url: string): Promise<Partial<Feed>> {
  const doc = await fetchXml(url);
  const channel = doc?.rss?.channel ?? doc?.feed ?? {};
  const title = getText(channel.title) || url;
  const description = getText(channel.description) ?? getText(channel.subtitle);

  // Prefer the channel's own website link over the feed URL for favicon lookup,
  // so feeds hosted on third-party domains (e.g. FeedBurner) resolve the right site.
  const channelLink = getText(channel.link) || url;
  const faviconUrl =
    toAbsoluteUrl(getText(channel.image?.url) || channel.image?.url) ??
    toAbsoluteUrl(channel['itunes:image']?.['@_href']) ??
    getFaviconUrl(channelLink);

  return { title, description, faviconUrl };
}

export async function fetchArticles(feed: Feed): Promise<{ articles: Article[]; faviconUrl?: string }> {
  const doc = await fetchXml(feed.url);
  const now = Date.now();

  // Extract updated favicon from the same doc we already fetched
  const channel = doc?.rss?.channel ?? doc?.feed ?? {};
  const channelLink = getText(channel.link) || feed.url;
  const faviconUrl =
    toAbsoluteUrl(getText(channel.image?.url) || channel.image?.url) ??
    toAbsoluteUrl(channel['itunes:image']?.['@_href']) ??
    getFaviconUrl(channelLink);

  let articles: Article[] = [];

  if (doc?.rss?.channel) {
    const items: any[] = doc.rss.channel.item ?? [];
    articles = items.map(item => parseRssItem(item, feed, now));
  } else if (doc?.feed?.entry) {
    const entries: any[] = doc.feed.entry ?? [];
    articles = entries.map(entry => parseAtomEntry(entry, feed, now));
  } else if (doc?.['rdf:RDF']) {
    const items: any[] = doc['rdf:RDF'].item ?? [];
    articles = items.map(item => parseRssItem(item, feed, now));
  }

  articles = await enrichWithImages(articles);

  return { articles, faviconUrl };
}

function parseRssItem(item: any, feed: Feed, now: number): Article {
  const guid = getText(item.guid) || getText(item.link) || getText(item.title) || String(now);
  const id = generateId(feed.id + guid);
  const pubDate = item.pubDate ? new Date(getText(item.pubDate)).getTime() : now;
  const rawContent = getText(item['content:encoded']) || getText(item.content) || '';
  const rawSummary = getText(item.description) || rawContent;
  return {
    id,
    feedId: feed.id,
    feedTitle: feed.title,
    title: stripHtml(getText(item.title)) || 'Untitled',
    summary: stripHtml(rawSummary).slice(0, 300),
    content: rawContent || getText(item.description),
    link: getText(item.link) || '',
    imageUrl: extractImage(item),
    videoUrls: extractVideos(item),
    author: getText(item['dc:creator']) || getText(item.author),
    pubDate,
    isRead: false,
    isBookmarked: false,
    fetchedAt: now,
  };
}

function parseAtomEntry(entry: any, feed: Feed, now: number): Article {
  const id = generateId(feed.id + (getText(entry.id) || getText(entry.title) || String(now)));
  const published = entry.published ?? entry.updated;
  const pubDate = published ? new Date(getText(published)).getTime() : now;

  const links: any[] = Array.isArray(entry.link) ? entry.link : [entry.link].filter(Boolean);
  const link =
    links.find((l: any) => l?.['@_rel'] === 'alternate')?.['@_href'] ??
    links[0]?.['@_href'] ??
    getText(entry.link) ??
    '';

  const rawContent = getText(entry.content) || getText(entry.summary) || '';

  return {
    id,
    feedId: feed.id,
    feedTitle: feed.title,
    title: stripHtml(getText(entry.title)) || 'Untitled',
    summary: stripHtml(getText(entry.summary) || rawContent).slice(0, 300),
    content: rawContent,
    link,
    imageUrl: extractImage(entry),
    videoUrls: extractVideos(entry),
    author: entry.author?.name ? getText(entry.author.name) : '',
    pubDate,
    isRead: false,
    isBookmarked: false,
    fetchedAt: now,
  };
}
