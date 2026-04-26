import { File } from 'expo-file-system';
import { Feed, Folder } from '../types';
import { generateId } from '../utils/id';
import { fetchFeedMeta } from './rss';

interface ParsedOutline {
  title?: string;
  xmlUrl?: string;
  children?: ParsedOutline[];
}

function parseXml(xml: string): ParsedOutline[] {
  const outlines: ParsedOutline[] = [];

  // Simple regex-based OPML parser (avoids native XML parser dependency)
  const bodyMatch = xml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) return outlines;

  const body = bodyMatch[1];

  function parseOutlines(str: string, depth = 0): ParsedOutline[] {
    const result: ParsedOutline[] = [];
    const outlineRegex = /<outline([^>]*?)(?:\/>|>([\s\S]*?)<\/outline>)/gi;
    let match;

    while ((match = outlineRegex.exec(str)) !== null) {
      const attrs = match[1];
      const inner = match[2] ?? '';

      const title =
        attrs.match(/(?:text|title)=["']([^"']+)["']/i)?.[1] ?? undefined;
      const xmlUrl = attrs.match(/xmlUrl=["']([^"']+)["']/i)?.[1] ?? undefined;

      const outline: ParsedOutline = { title, xmlUrl };
      if (inner) {
        outline.children = parseOutlines(inner, depth + 1);
      }
      result.push(outline);
    }

    return result;
  }

  return parseOutlines(body);
}

export interface OPMLImportResult {
  folders: Folder[];
  feeds: Feed[];
  errors: string[];
}

export async function importOPML(filePath: string): Promise<OPMLImportResult> {
  const xml = await new File(filePath).text();
  const outlines = parseXml(xml);

  const folders: Folder[] = [];
  const feeds: Feed[] = [];
  const errors: string[] = [];
  const now = Date.now();

  async function processOutline(
    outline: ParsedOutline,
    folderId?: string,
  ): Promise<void> {
    if (outline.xmlUrl) {
      // It's a feed
      try {
        const meta = await fetchFeedMeta(outline.xmlUrl);
        const id = generateId(outline.xmlUrl);
        feeds.push({
          id,
          folderId,
          title: outline.title ?? meta.title ?? outline.xmlUrl,
          url: outline.xmlUrl,
          faviconUrl: meta.faviconUrl,
          description: meta.description,
          unreadCount: 0,
          createdAt: now,
        });
      } catch {
        errors.push(`Failed to load: ${outline.xmlUrl}`);
      }
    } else if (outline.children?.length) {
      // It's a folder
      const id = generateId(`folder-${outline.title}-${now}`);
      folders.push({
        id,
        name: outline.title ?? 'Unnamed Folder',
        createdAt: now,
      });
      for (const child of outline.children) {
        await processOutline(child, id);
      }
    }
  }

  for (const outline of outlines) {
    await processOutline(outline);
  }

  return { folders, feeds, errors };
}

export function exportOPML(folders: Folder[], feeds: Feed[]): string {
  function escAttr(s: string) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  const rootFeeds = feeds.filter(f => !f.folderId);
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head><title>Kern Subscriptions</title></head>',
    '  <body>',
  ];

  for (const feed of rootFeeds) {
    lines.push(
      `    <outline type="rss" text="${escAttr(feed.title)}" xmlUrl="${escAttr(feed.url)}" />`,
    );
  }

  for (const folder of folders) {
    lines.push(`    <outline text="${escAttr(folder.name)}">`);
    const folderFeeds = feeds.filter(f => f.folderId === folder.id);
    for (const feed of folderFeeds) {
      lines.push(
        `      <outline type="rss" text="${escAttr(feed.title)}" xmlUrl="${escAttr(feed.url)}" />`,
      );
    }
    lines.push('    </outline>');
  }

  lines.push('  </body>', '</opml>');
  return lines.join('\n');
}
