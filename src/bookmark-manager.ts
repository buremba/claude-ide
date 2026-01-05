import * as fs from "fs";
import * as path from "path";

export interface Bookmark {
  name: string;
  url: string;
}

interface ChromeBookmarkNode {
  date_added: string;
  date_last_used: string;
  guid: string;
  id: string;
  name: string;
  type: "url" | "folder";
  url?: string;
  children?: ChromeBookmarkNode[];
}

interface ChromeBookmarksFile {
  checksum: string;
  roots: {
    bookmark_bar: ChromeBookmarkNode;
    other: ChromeBookmarkNode;
    synced: ChromeBookmarkNode;
  };
  version: number;
}

/**
 * Generate a random GUID for bookmark entries
 */
function generateGuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Get Chrome timestamp (microseconds since Jan 1, 1601)
 */
function getChromeTimestamp(): string {
  // Chrome uses microseconds since Jan 1, 1601
  // JavaScript uses milliseconds since Jan 1, 1970
  // Difference is 11644473600000 milliseconds
  const chromeEpochOffset = 11644473600000n;
  const nowMs = BigInt(Date.now());
  const chromeMicroseconds = (nowMs + chromeEpochOffset) * 1000n;
  return chromeMicroseconds.toString();
}

/**
 * Create a Chrome bookmark node from our simple bookmark format
 */
function createBookmarkNode(bookmark: Bookmark, id: number): ChromeBookmarkNode {
  const timestamp = getChromeTimestamp();
  return {
    date_added: timestamp,
    date_last_used: "0",
    guid: generateGuid(),
    id: id.toString(),
    name: bookmark.name,
    type: "url",
    url: bookmark.url,
  };
}

/**
 * Enable the bookmarks bar in Chrome preferences
 */
export function enableBookmarksBar(userDataDir: string): void {
  // Chrome uses a "Default" subdirectory for the profile
  const defaultDir = path.join(userDataDir, "Default");
  fs.mkdirSync(defaultDir, { recursive: true });
  const prefsPath = path.join(defaultDir, "Preferences");

  let prefs: Record<string, unknown> = {};
  if (fs.existsSync(prefsPath)) {
    try {
      prefs = JSON.parse(fs.readFileSync(prefsPath, "utf-8"));
    } catch {
      // Ignore parse errors
    }
  }

  // Set bookmark bar to always show (try multiple keys for compatibility)
  if (!prefs.bookmark_bar) {
    prefs.bookmark_bar = {};
  }
  (prefs.bookmark_bar as Record<string, unknown>).show_on_all_tabs = true;
  (prefs.bookmark_bar as Record<string, unknown>).show_only_on_ntp = false;

  // Also set browser-level preference
  if (!prefs.browser) {
    prefs.browser = {};
  }
  (prefs.browser as Record<string, unknown>).show_bookmark_bar = true;

  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2));
  console.error("[BookmarkManager] Enabled bookmarks bar in preferences");
}

/**
 * Write bookmarks to Chrome's Bookmarks file format
 */
export function writeBookmarks(userDataDir: string, bookmarks: Bookmark[]): void {
  if (!bookmarks || bookmarks.length === 0) {
    return;
  }

  // Enable bookmarks bar visibility
  enableBookmarksBar(userDataDir);

  // Chrome uses a "Default" subdirectory for the profile
  const defaultDir = path.join(userDataDir, "Default");
  fs.mkdirSync(defaultDir, { recursive: true });
  const bookmarksPath = path.join(defaultDir, "Bookmarks");
  const timestamp = getChromeTimestamp();

  // Check if bookmarks file already exists and read it
  let existingBookmarks: ChromeBookmarksFile | null = null;
  if (fs.existsSync(bookmarksPath)) {
    try {
      existingBookmarks = JSON.parse(fs.readFileSync(bookmarksPath, "utf-8"));
    } catch {
      // Ignore parse errors, we'll create a new file
    }
  }

  // Start ID counter (Chrome uses incrementing IDs)
  let nextId = 1;

  // Create bookmark nodes for the bookmark bar
  const bookmarkNodes: ChromeBookmarkNode[] = bookmarks.map((b) =>
    createBookmarkNode(b, nextId++)
  );

  // If we have existing bookmarks, merge them
  if (existingBookmarks?.roots?.bookmark_bar?.children) {
    // Find the highest existing ID
    const findMaxId = (nodes: ChromeBookmarkNode[]): number => {
      let max = 0;
      for (const node of nodes) {
        const id = parseInt(node.id, 10);
        if (id > max) max = id;
        if (node.children) {
          const childMax = findMaxId(node.children);
          if (childMax > max) max = childMax;
        }
      }
      return max;
    };
    nextId = findMaxId(existingBookmarks.roots.bookmark_bar.children) + 1;

    // Check if our bookmarks already exist (by URL)
    // Normalize URLs by removing trailing slashes for comparison
    const normalizeUrl = (url: string) => url.replace(/\/+$/, "");
    const existingUrls = new Set<string>();
    const collectUrls = (nodes: ChromeBookmarkNode[]) => {
      for (const node of nodes) {
        if (node.url) existingUrls.add(normalizeUrl(node.url));
        if (node.children) collectUrls(node.children);
      }
    };
    collectUrls(existingBookmarks.roots.bookmark_bar.children);

    // Only add bookmarks that don't already exist
    const newBookmarks = bookmarks.filter((b) => !existingUrls.has(normalizeUrl(b.url)));
    if (newBookmarks.length === 0) {
      console.error("[BookmarkManager] All bookmarks already exist, skipping");
      return;
    }

    // Add new bookmarks to existing ones
    const newNodes = newBookmarks.map((b) => createBookmarkNode(b, nextId++));
    existingBookmarks.roots.bookmark_bar.children.push(...newNodes);

    fs.writeFileSync(bookmarksPath, JSON.stringify(existingBookmarks, null, 2));
    console.error(`[BookmarkManager] Added ${newNodes.length} bookmarks`);
    return;
  }

  // Create new bookmarks file
  const bookmarksFile: ChromeBookmarksFile = {
    checksum: "", // Chrome will recalculate this
    roots: {
      bookmark_bar: {
        children: bookmarkNodes,
        date_added: timestamp,
        date_last_used: "0",
        date_modified: timestamp,
        guid: generateGuid(),
        id: (nextId++).toString(),
        name: "Bookmarks bar",
        type: "folder",
      } as ChromeBookmarkNode,
      other: {
        children: [],
        date_added: timestamp,
        date_last_used: "0",
        date_modified: "0",
        guid: generateGuid(),
        id: (nextId++).toString(),
        name: "Other bookmarks",
        type: "folder",
      } as ChromeBookmarkNode,
      synced: {
        children: [],
        date_added: timestamp,
        date_last_used: "0",
        date_modified: "0",
        guid: generateGuid(),
        id: (nextId++).toString(),
        name: "Mobile bookmarks",
        type: "folder",
      } as ChromeBookmarkNode,
    },
    version: 1,
  };

  // Ensure directory exists (defaultDir was already created above)
  fs.writeFileSync(bookmarksPath, JSON.stringify(bookmarksFile, null, 2));
  console.error(`[BookmarkManager] Created bookmarks file with ${bookmarks.length} bookmarks`);
}
