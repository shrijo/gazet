import { XMLParser } from 'fast-xml-parser';
import { Article, Feed } from '../types';
import { generateId } from '../utils/id';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['item', 'entry', 'enclosure', 'media:content', 'media:thumbnail', 'media:group'].includes(name),
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

function attrWidth(node: any): number {
  return parseInt(node?.['@_width'] ?? '0', 10) || 0;
}

// Pick the thumbnail with the largest @_width attribute (falls back to first).
function bestThumbnail(thumbnails: any[]): string | undefined {
  if (!thumbnails?.length) return undefined;
  const best = thumbnails.reduce((a, b) => (attrWidth(b) > attrWidth(a) ? b : a));
  return toAbsoluteUrl(best?.['@_url']);
}

// Pick the media:content image item with the largest @_width (falls back to first non-video).
function bestImageContent(items: any[]): any | undefined {
  const imgs = items.filter((m: any) => !isVideoMedia(m));
  if (!imgs.length) return undefined;
  return imgs.reduce((a: any, b: any) => (attrWidth(b) > attrWidth(a) ? b : a));
}

function getThumbnailUrl(node: any): string | undefined {
  if (!node) return undefined;
  const t = node['media:thumbnail'];
  if (Array.isArray(t)) return bestThumbnail(t);
  return toAbsoluteUrl(t?.['@_url'] ?? node['@_thumbnail']);
}

// Resolve a possibly-relative URL against a base. Returns undefined if it can't.
function resolveUrl(url: string, baseUrl?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('//')) return 'https:' + url;
  if (/^https?:\/\//i.test(url)) return url;
  if (!baseUrl) return undefined;
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return undefined;
  }
}

// Find the best-quality <img> in HTML: widest explicit width wins; tracking pixels (≤2px) are skipped.
// Also checks data-src / data-lazy-src for lazy-loaded images common on modern sites.
// Root-relative paths like "/wp-content/foo.jpg" are resolved against baseUrl.
function getBestHtmlImage(html: string, baseUrl?: string): string | undefined {
  const imgTagRe = /<img[^>]+>/gi;
  // Match src, data-src, or data-lazy-src — accept any URL, resolve relative ones below
  const srcRe = /(?:data-lazy-src|data-src|src)=["']([^"']+)["']/i;
  const wRe = /\bwidth=["']?(\d+)["']?/i;
  const hRe = /\bheight=["']?(\d+)["']?/i;

  const candidates: { url: string; width: number }[] = [];
  let tag: RegExpExecArray | null;
  while ((tag = imgTagRe.exec(html)) !== null) {
    const srcMatch = tag[0].match(srcRe);
    const raw = srcMatch?.[1];
    if (!raw) continue;
    if (raw.startsWith('data:')) continue;
    const url = resolveUrl(raw, baseUrl);
    if (!url) continue;
    const w = parseInt((tag[0].match(wRe) ?? [])[1] ?? '0', 10) || 0;
    const h = parseInt((tag[0].match(hRe) ?? [])[1] ?? '0', 10) || 0;
    // Skip obvious tracking pixels
    if ((w > 0 && w <= 2) || (h > 0 && h <= 2)) continue;
    candidates.push({ url, width: w });
  }
  if (!candidates.length) return undefined;
  const withWidth = candidates.filter(c => c.width > 0);
  if (withWidth.length) return withWidth.reduce((a, b) => (b.width > a.width ? b : a)).url;
  return candidates[0].url;
}

function extractImage(item: any, baseUrl?: string): string | undefined {
  // media:group (YouTube, podcast feeds) — pick the highest-res thumbnail.
  // With isArray for media:group, multi-group feeds expose every group; we
  // walk them all and stop at the first one with a usable image.
  const groups: any[] = Array.isArray(item['media:group'])
    ? item['media:group']
    : item['media:group'] ? [item['media:group']] : [];
  for (const mediaGroup of groups) {
    const groupThumb = mediaGroup['media:thumbnail'];
    const u = Array.isArray(groupThumb)
      ? bestThumbnail(groupThumb)
      : toAbsoluteUrl(groupThumb?.['@_url']);
    if (u) return u;
    // also check image-typed media:content inside the group
    const groupContent = mediaGroup['media:content'];
    if (Array.isArray(groupContent)) {
      const img = bestImageContent(groupContent);
      const cu = toAbsoluteUrl(img?.['@_url']);
      if (cu) return cu;
    }
  }

  // media:content — highest-res image item first, then thumbnail embedded on video items
  const mediaContent = item['media:content'];
  if (Array.isArray(mediaContent)) {
    const img = bestImageContent(mediaContent);
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

  // standalone media:thumbnail — pick highest-res
  const mediaThumbnail = item['media:thumbnail'];
  if (Array.isArray(mediaThumbnail) && mediaThumbnail.length > 0) {
    const u = bestThumbnail(mediaThumbnail);
    if (u) return u;
  } else if (mediaThumbnail?.['@_url']) {
    const u = toAbsoluteUrl(mediaThumbnail['@_url']);
    if (u) return u;
  }

  // itunes:image per-item (common in podcast feeds for episode artwork)
  const itunesImage = toAbsoluteUrl(item['itunes:image']?.['@_href']);
  if (itunesImage) return itunesImage;

  // image enclosure
  const enclosures: any[] = Array.isArray(item.enclosure) ? item.enclosure : [];
  const imgEnclosure = enclosures.find((e: any) => e?.['@_type']?.startsWith('image/'));
  const encUrl = toAbsoluteUrl(imgEnclosure?.['@_url']);
  if (encUrl) return encUrl;

  // best <img> in content — widest explicit width wins; tracking pixels skipped
  const html =
    getText(item['content:encoded']) ||
    getText(item.content) ||
    getText(item.description) ||
    getText(item.summary) ||
    '';
  return getBestHtmlImage(html, baseUrl);
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

// Common HTML5 named entities found in feeds — keep this list aligned with
// db.ts decodeEntities so on-disk and freshly-parsed text agree.
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', sbquo: '‚', bdquo: '„',
  copy: '©', reg: '®', trade: '™', deg: '°', middot: '·', bull: '•',
  iexcl: '¡', iquest: '¿', euro: '€', pound: '£', yen: '¥', cent: '¢',
  times: '×', divide: '÷', plusmn: '±', frac12: '½', frac14: '¼', frac34: '¾',
};

function decodeNamedAndNumeric(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m);
}

function stripHtml(html: string): string {
  return decodeNamedAndNumeric(html.replace(/<[^>]+>/g, ' '))
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
    const res = await fetch(url, {
      headers: {
        Accept: 'text/html',
        // Many sites block requests without a browser UA; use a realistic mobile one
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      },
    });
    if (!res.ok) return undefined;
    const text = await res.text();
    // Scan enough of the head; some CMSes emit large inline scripts before <meta> tags
    // Modern CMSes (Substack, NYT, etc) emit large inline JSON before <meta>
    // tags — 64KB covers nearly all of them while keeping the parse cheap.
    const head = text.slice(0, 64000);
    const match =
      head.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
      head.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ??
      head.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) ??
      head.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);
    let imgUrl = match?.[1];
    if (!imgUrl) return undefined;
    if (imgUrl.startsWith('//')) return 'https:' + imgUrl;
    if (imgUrl.startsWith('http')) return imgUrl;
    // Reconstruct relative URLs from the article's origin
    try {
      const { origin } = new URL(url);
      return origin + (imgUrl.startsWith('/') ? imgUrl : '/' + imgUrl);
    } catch {
      return undefined;
    }
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

// Enrich every image-less article via OG-image scraping, with a fixed
// concurrency window so a 30-item load-more doesn't fan out into 30 parallel
// HTTP requests. No per-batch cap — older articles deserve images too.
async function enrichWithImages(articles: Article[]): Promise<Article[]> {
  const missing = articles.filter(a => !a.imageUrl && a.link);
  if (missing.length === 0) return articles;
  const CONCURRENCY = 6;
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= missing.length) return;
      try {
        const url = await fetchOgImage(missing[idx].link);
        if (url) missing[idx].imageUrl = url;
      } catch { /* swallow — best-effort enrichment */ }
    }
  };
  const workers = Array.from({ length: Math.min(CONCURRENCY, missing.length) }, worker);
  await Promise.all(workers);
  return articles;
}

// Extract Atom RFC 5005 <link rel="next"> from a parsed feed document.
// Works for Atom feeds and RSS 2.0 feeds that use the atom:link extension.
function getAtomNextLink(doc: any): string | undefined {
  const feedLinks = doc?.feed?.link;
  if (feedLinks) {
    const arr = Array.isArray(feedLinks) ? feedLinks : [feedLinks];
    const href = arr.find((l: any) => l?.['@_rel'] === 'next')?.['@_href'];
    if (href) return toAbsoluteUrl(href);
  }
  const channelLinks = doc?.rss?.channel?.['atom:link'];
  if (channelLinks) {
    const arr = Array.isArray(channelLinks) ? channelLinks : [channelLinks];
    const href = arr.find((l: any) => l?.['@_rel'] === 'next')?.['@_href'];
    if (href) return toAbsoluteUrl(href);
  }
  return undefined;
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
  | { kind: 'nextUrl'; url: string }                                  // RFC 5005 Atom rel=next chain
  | { kind: 'urlPage'; page: number }                                 // try /page/N variants
  | { kind: 'wbInit' }                                                // need to fetch the wayback timemap
  | { kind: 'wb'; snapshots: string[]; index: number }                // iterating wayback snapshots
  | { kind: 'done' };

export const initialPageCursor: PageCursor = { kind: 'urlPage', page: 2 };

// Build the starting cursor for a feed: prefer the publisher's own
// rel=next link (RFC 5005) if we captured one on the last refresh.
export function initialCursorForFeed(feed: Feed): PageCursor {
  if (feed.nextPageUrl) return { kind: 'nextUrl', url: feed.nextPageUrl };
  return { kind: 'urlPage', page: 2 };
}

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

  if (cursor.kind === 'nextUrl') {
    try {
      const doc = await fetchXml(cursor.url);
      const fresh = parseDoc(doc, feed, now).filter(a => !existingIds.has(a.id));
      const nextHref = getAtomNextLink(doc);
      const next: PageCursor = nextHref
        ? { kind: 'nextUrl', url: nextHref }
        : { kind: 'urlPage', page: 2 };
      if (fresh.length > 0) return { articles: fresh, cursor: next };
      // Empty page but the publisher gave us a next link — follow it.
      if (nextHref && nextHref !== cursor.url) {
        return fetchOlderPage(feed, next, existingIds);
      }
      return fetchOlderPage(feed, { kind: 'urlPage', page: 2 }, existingIds);
    } catch {
      return fetchOlderPage(feed, { kind: 'urlPage', page: 2 }, existingIds);
    }
  }

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

export async function fetchArticles(feed: Feed): Promise<{ articles: Article[]; faviconUrl?: string; nextPageUrl?: string }> {
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

  const nextPageUrl = getAtomNextLink(doc);
  // Image enrichment is async and orchestrated by the caller (refreshFeed)
  // so the initial render doesn't block on OG-image scraping.
  return { articles, faviconUrl, nextPageUrl };
}

function parseRssItem(item: any, feed: Feed, now: number): Article {
  const guid = getText(item.guid) || getText(item.link) || getText(item.title) || String(now);
  const id = generateId(feed.id + guid);
  const pubDate = item.pubDate ? new Date(getText(item.pubDate)).getTime() : now;
  const rawContent = getText(item['content:encoded']) || getText(item.content) || '';
  const rawSummary = getText(item.description) || rawContent;
  const link = getText(item.link) || '';
  return {
    id,
    feedId: feed.id,
    feedTitle: feed.title,
    title: stripHtml(getText(item.title)) || 'Untitled',
    summary: stripHtml(rawSummary).slice(0, 300),
    content: rawContent || getText(item.description),
    link,
    imageUrl: extractImage(item, link || feed.url),
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
    imageUrl: extractImage(entry, link || feed.url),
    videoUrls: extractVideos(entry),
    author: entry.author?.name ? getText(entry.author.name) : '',
    pubDate,
    isRead: false,
    isBookmarked: false,
    fetchedAt: now,
  };
}
