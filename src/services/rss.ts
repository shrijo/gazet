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

// Find the best-quality <img> in HTML: widest explicit width wins; tracking pixels (≤2px) are skipped.
// Also checks data-src / data-lazy-src for lazy-loaded images common on modern sites.
function getBestHtmlImage(html: string): string | undefined {
  const imgTagRe = /<img[^>]+>/gi;
  // Match src, data-src, or data-lazy-src — whichever holds an absolute URL
  const srcRe = /(?:data-lazy-src|data-src|src)=["']?(https?:\/\/[^"'\s>]+)["']?/i;
  const wRe = /\bwidth=["']?(\d+)["']?/i;
  const hRe = /\bheight=["']?(\d+)["']?/i;

  const candidates: { url: string; width: number }[] = [];
  let tag: RegExpExecArray | null;
  while ((tag = imgTagRe.exec(html)) !== null) {
    const srcMatch = tag[0].match(srcRe);
    if (!srcMatch?.[1]) continue;
    const w = parseInt((tag[0].match(wRe) ?? [])[1] ?? '0', 10) || 0;
    const h = parseInt((tag[0].match(hRe) ?? [])[1] ?? '0', 10) || 0;
    // Skip obvious tracking pixels
    if ((w > 0 && w <= 2) || (h > 0 && h <= 2)) continue;
    candidates.push({ url: srcMatch[1], width: w });
  }
  if (!candidates.length) return undefined;
  const withWidth = candidates.filter(c => c.width > 0);
  if (withWidth.length) return withWidth.reduce((a, b) => (b.width > a.width ? b : a)).url;
  return candidates[0].url;
}

function extractImage(item: any): string | undefined {
  // media:group (YouTube, podcast feeds) — pick the highest-res thumbnail
  const mediaGroup = item['media:group'];
  if (mediaGroup) {
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
  return getBestHtmlImage(html);
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
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
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
    const head = text.slice(0, 16000);
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

async function fetchXml(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { Accept: 'application/rss+xml, application/atom+xml, text/xml, */*' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
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
  try {
    const seen = new Set<string>();
    const urls: string[] = [];
    const add = (u: URL) => { const s = u.toString(); if (!seen.has(s)) { seen.add(s); urls.push(s); } };

    // WordPress path-based: /feed/ → /feed/page/N/  (most common on self-hosted WP)
    const u0 = new URL(baseUrl);
    u0.pathname = u0.pathname.replace(/\/?$/, `/page/${page}/`);
    add(u0);

    // WordPress query var: ?paged=N
    const u1 = new URL(baseUrl);
    u1.searchParams.set('paged', String(page));
    add(u1);

    // Generic: ?page=N  (Jekyll, Hugo, many other platforms)
    const u2 = new URL(baseUrl);
    u2.searchParams.set('page', String(page));
    add(u2);

    return urls;
  } catch {
    return [];
  }
}

// Returns new articles plus the next-page URL if the feed advertises one (Atom paging).
export async function fetchOlderArticles(
  feed: Feed,
  page: number,
  existingIds: Set<string>,
): Promise<{ articles: Article[]; nextPageUrl?: string }> {
  const now = Date.now();

  // If the feed has a stored Atom next link, try it first; otherwise guess from page number.
  const candidates = feed.nextPageUrl
    ? [feed.nextPageUrl, ...paginatedUrls(feed.url, page)]
    : paginatedUrls(feed.url, page);

  // Deduplicate while preserving order
  const seen = new Set<string>();
  const urls = candidates.filter(u => !seen.has(u) && seen.add(u));

  for (const url of urls) {
    try {
      const doc = await fetchXml(url);
      let articles: Article[] = [];
      if (doc?.rss?.channel) {
        articles = (doc.rss.channel.item ?? []).map((i: any) => parseRssItem(i, feed, now));
      } else if (doc?.feed?.entry) {
        articles = (doc.feed.entry ?? []).map((e: any) => parseAtomEntry(e, feed, now));
      }
      const fresh = articles.filter(a => !existingIds.has(a.id));
      if (fresh.length > 0) {
        return { articles: fresh, nextPageUrl: getAtomNextLink(doc) };
      }
    } catch { /* try next variant */ }
  }

  return { articles: [] };
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
  articles = await enrichWithImages(articles);

  return { articles, faviconUrl, nextPageUrl };
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
