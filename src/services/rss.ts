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

function extractImage(item: any): string | undefined {
  // media:content
  const mediaContent = item['media:content'];
  if (Array.isArray(mediaContent)) {
    const img = mediaContent.find((m: any) => !m['@_medium'] || m['@_medium'] === 'image');
    if (img?.['@_url']) return img['@_url'];
  } else if (mediaContent?.['@_url']) {
    return mediaContent['@_url'];
  }

  // media:thumbnail
  const mediaThumbnail = item['media:thumbnail'];
  if (Array.isArray(mediaThumbnail)) {
    if (mediaThumbnail[0]?.['@_url']) return mediaThumbnail[0]['@_url'];
  } else if (mediaThumbnail?.['@_url']) {
    return mediaThumbnail['@_url'];
  }

  // image enclosure
  const enclosures: any[] = Array.isArray(item.enclosure) ? item.enclosure : [];
  const imgEnclosure = enclosures.find((e: any) => e?.['@_type']?.startsWith('image/'));
  if (imgEnclosure?.['@_url']) return imgEnclosure['@_url'];

  // first <img> in content — matches quoted or unquoted src
  const html =
    getText(item['content:encoded']) ||
    getText(item.content) ||
    getText(item.description) ||
    getText(item.summary) ||
    '';
  const match = html.match(/<img[^>]+src=["']?([^"'\s>]+)["']?/i);
  if (match?.[1]) return match[1];

  return undefined;
}

function extractVideos(item: any): string[] {
  const enclosures: any[] = Array.isArray(item.enclosure) ? item.enclosure : [];
  const videos = enclosures
    .filter((e: any) => e?.['@_type']?.startsWith('video/') && e['@_url'])
    .map((e: any) => e['@_url'] as string);

  // also check media:content for video medium
  const mediaContent = item['media:content'];
  if (Array.isArray(mediaContent)) {
    mediaContent.forEach((m: any) => {
      if (m['@_medium'] === 'video' && m['@_url']) videos.push(m['@_url']);
    });
  }

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
    return match?.[1];
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

export async function fetchFeedMeta(url: string): Promise<Partial<Feed>> {
  const doc = await fetchXml(url);
  const channel = doc?.rss?.channel ?? doc?.feed ?? {};
  const title = getText(channel.title) || url;
  const description = getText(channel.description) ?? getText(channel.subtitle);

  // Prefer the channel's own website link over the feed URL for favicon lookup,
  // so feeds hosted on third-party domains (e.g. FeedBurner) resolve the right site.
  const channelLink = getText(channel.link) || url;
  const faviconUrl =
    channel.image?.url ??
    channel['itunes:image']?.['@_href'] ??
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
    channel.image?.url ??
    channel['itunes:image']?.['@_href'] ??
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

  // For articles missing an image, fetch og:image from the article page (up to 10).
  const missing = articles.filter(a => !a.imageUrl && a.link).slice(0, 10);
  if (missing.length > 0) {
    const results = await Promise.allSettled(missing.map(a => fetchOgImage(a.link)));
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value) missing[i].imageUrl = r.value;
    });
  }

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
