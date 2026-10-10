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

// Is `parentId` one of the "<watched folder>/<category>" folders? Returns the
// category name, or null.
export async function categoryOfParent(parentId, settings) {
  if (!settings.watchedFolderId || !parentId) return null;
  const parent = await getNode(parentId);
  if (!parent || parent.url || parent.parentId !== settings.watchedFolderId) return null;
  return settings.categories.find((c) => sameName(c.name, parent.title))?.name ?? null;
}

// The category folders that exist right now, with their category name and
// how many bookmarks sit directly inside each (for the recheck picker).
export async function listCategoryFolders(settings) {
  if (!settings.watchedFolderId) return [];
  const children = await chrome.bookmarks.getChildren(settings.watchedFolderId);
  const folders = [];
  for (const node of children) {
    if (node.url) continue;
    const category = settings.categories.find((c) => sameName(c.name, node.title));
    if (!category) continue;
    const inner = await chrome.bookmarks.getChildren(node.id);
    folders.push({ id: node.id, category: category.name, count: inner.filter((n) => n.url).length });
  }
  return folders;
}

// Bookmarks already sorted into category folders (all of them, or just one folder).
export async function listSortedBookmarks(settings, folderId = null) {
  const folders = (await listCategoryFolders(settings)).filter((f) => !folderId || f.id === folderId);
  const result = [];
  for (const folder of folders) {
    const inner = await chrome.bookmarks.getChildren(folder.id);
    result.push(...inner.filter((n) => n.url));
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
