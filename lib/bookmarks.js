// Small helpers around chrome.bookmarks.

import { sameName } from './settings.js';

export async function getNode(id) {
  try {
    const [node] = await chrome.bookmarks.get(id);
    return node || null;
  } catch {
    return null; // deleted
  }
}

export function isCategoryName(settings, title) {
  return settings.categories.some((c) => sameName(c.name, title));
}

// Is a bookmark living in `parentId` inside the area we watch?
// That's the watched folder itself, plus (optionally) its direct subfolders,
// except the category folders we sort into. Excluding those is what keeps
// our own moves from being picked up again.
export async function isWatchedParent(parentId, settings) {
  const watched = settings.watchedFolderId;
  if (!watched || !parentId) return false;
  if (parentId === watched) return true;
  if (!settings.watchSubfolders) return false;

  const parent = await getNode(parentId);
  return !!parent && parent.parentId === watched && !isCategoryName(settings, parent.title);
}

// All bookmarks currently waiting in the watched area (for the backlog button).
export async function listWatchedBookmarks(settings) {
  if (!settings.watchedFolderId) return [];
  const children = await chrome.bookmarks.getChildren(settings.watchedFolderId);
  const result = children.filter((n) => n.url);

  if (settings.watchSubfolders) {
    for (const folder of children.filter((n) => !n.url && !isCategoryName(settings, n.title))) {
      const inner = await chrome.bookmarks.getChildren(folder.id);
      result.push(...inner.filter((n) => n.url));
    }
  }
  return result;
}

// Find (or create) the "<watched folder>/<category>" folder and return its id.
export async function ensureCategoryFolder(settings, category) {
  const children = await chrome.bookmarks.getChildren(settings.watchedFolderId);
  const existing = children.find((n) => !n.url && sameName(n.title, category));
  if (existing) return existing.id;
  const created = await chrome.bookmarks.create({ parentId: settings.watchedFolderId, title: category });
  return created.id;
}
