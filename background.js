// Sortera background service worker.
//
// The service worker can be suspended at any moment, so all state lives in
// chrome.storage.local:
//   queue        [{ id, notBefore, inFlight, titleWaits, recheck }]  bookmarks waiting to be classified;
//                recheck = it's already in a category folder and is being classified again
//   review       { [bookmarkId]: { id, title, url, category, confidence, reason, error, from, at } }
//                from = category folder it currently sits in (rechecks only)
//   ignoreMoves  { [bookmarkId]: expiresAt }  moves we made ourselves (don't react to them)
//   status       { error, paused }           last error shown in the UI; paused = stop calling the API

import { getSettings, getApiKey, PROVIDERS } from './lib/settings.js';
import { classify } from './lib/llm.js';
import { getPageText } from './lib/extract.js';
import { matchDomainRule } from './lib/urls.js';
import {
  getNode,
  isWatchedParent,
  categoryOfParent,
  listWatchedBookmarks,
  listSortedBookmarks,
  ensureCategoryFolder,
} from './lib/bookmarks.js';

const DEBOUNCE_MS = 6000; // wait after a bookmark appears; the title is often filled in a moment later
const TITLE_WAIT_MS = 5000; // extra wait (up to twice) if the title is still empty
const CONCURRENCY = 2; // parallel LLM requests
const PAUSE_BETWEEN_MS = 500; // small gap between requests per worker
const STALE_IN_FLIGHT_MS = 2 * 60_000; // an item "in flight" this long was interrupted; pick it up again
const DRAIN_ALARM = 'sortera-drain';

// ---------------------------------------------------------------------------
// Event listeners (registered at top level so they survive SW restarts)
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.runtime.openOptionsPage();
  updateBadge();
  drain();
});

chrome.runtime.onStartup.addListener(() => {
  updateBadge();
  drain();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === DRAIN_ALARM) drain();
});

chrome.bookmarks.onCreated.addListener(async (id, node) => {
  if (!node.url) return; // folders (including the category folders we create)
  const settings = await getSettings();
  if (settings.enabled && (await isWatchedParent(node.parentId, settings))) {
    await enqueue([id], DEBOUNCE_MS);
  }
});

chrome.bookmarks.onMoved.addListener(async (id, { parentId, oldParentId }) => {
  if (await consumeOwnMove(id)) return; // we moved it; ignore to avoid loops
  if (parentId === oldParentId) return; // just reordered

  const settings = await getSettings();
  const nowWatched = await isWatchedParent(parentId, settings);
  const wasWatched = await isWatchedParent(oldParentId, settings);

  if (!nowWatched) {
    // Moved out of the inbox by hand: forget about it.
    await removeFromReview([id]);
    await removeFromQueue(id);
    return;
  }
  if (!wasWatched && settings.enabled) {
    const node = await getNode(id);
    if (node?.url) await enqueue([id], DEBOUNCE_MS);
  }
});

chrome.bookmarks.onRemoved.addListener(async (id, { node }) => {
  const ids = collectIds(node);
  await removeFromReview(ids);
  for (const removed of ids) await removeFromQueue(removed);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.review || changes.status)) updateBadge();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg).then(
    (result) => sendResponse({ ok: true, ...result }),
    (err) => sendResponse({ ok: false, error: err.message }),
  );
  return true; // keep the channel open for the async response
});

// ---------------------------------------------------------------------------
// Messages from the popup and options page
// ---------------------------------------------------------------------------

async function handleMessage(msg) {
  switch (msg.type) {
    case 'accept': {
      const { review = {} } = await chrome.storage.local.get('review');
      const item = review[msg.id];
      if (!item?.category) throw new Error('No suggestion to accept.');
      await moveAndClear(msg.id, item.category);
      return {};
    }
    case 'move':
      await moveAndClear(msg.id, msg.category);
      return {};
    case 'keep':
      await removeFromReview([msg.id]);
      return {};
    case 'retry': {
      const { review = {} } = await chrome.storage.local.get('review');
      const recheck = !!review[msg.id]?.from;
      await removeFromReview([msg.id]);
      await resume();
      await enqueue([msg.id], 0, { recheck });
      return {};
    }
    case 'backlog':
      return { count: await queueBacklog() };
    case 'recheck':
      return { count: await queueRecheck(msg.folderId || null) };
    case 'clearQueue':
      await updateStored('queue', [], (queue) => queue.splice(0));
      chrome.alarms.clear(DRAIN_ALARM);
      return {};
    case 'resume':
    case 'settingsChanged':
      await resume();
      drain();
      return {};
    case 'test':
      return { result: await testConnection(msg.settings, msg.apiKey) };
    default:
      throw new Error(`Unknown message: ${msg.type}`);
  }
}

async function queueBacklog() {
  const settings = await getSettings();
  if (!settings.watchedFolderId) throw new Error('Pick a watched folder in settings first.');
  const { review = {} } = await chrome.storage.local.get('review');
  const ids = (await listWatchedBookmarks(settings))
    .map((n) => n.id)
    .filter((id) => !review[id]); // already has a suggestion waiting
  await resume();
  await enqueue(ids, 0);
  return ids.length;
}

// Classify bookmarks that were already sorted again (e.g. after editing the
// categories or switching models). They only move if the model is confident
// about a different category; unsure disagreements go to the review list.
async function queueRecheck(folderId) {
  const settings = await getSettings();
  if (!settings.watchedFolderId) throw new Error('Pick a watched folder in settings first.');
  const { review = {} } = await chrome.storage.local.get('review');
  const ids = (await listSortedBookmarks(settings, folderId))
    .map((n) => n.id)
    .filter((id) => !review[id]);
  await resume();
  await enqueue(ids, 0, { recheck: true });
  return ids.length;
}

async function testConnection(overrides, apiKeyOverride) {
  const settings = { ...(await getSettings()), ...overrides };
  const apiKey = apiKeyOverride ?? (await getApiKey());
  if (PROVIDERS[settings.provider]?.needsKey && !apiKey) throw new Error('No API key entered.');
  return classify({
    settings,
    apiKey,
    title: 'Chocolate chip cookies – the best recipe',
    url: 'https://example.com/recipes/chocolate-chip-cookies',
    pageText: 'Ingredients: butter, sugar, flour, eggs, chocolate chips. Bake at 180°C for 12 minutes.',
  });
}

// ---------------------------------------------------------------------------
// Queue processing
// ---------------------------------------------------------------------------

let draining = false;
let halted = false;

async function drain() {
  if (draining) return;
  const { status = {} } = await chrome.storage.local.get('status');
  if (status.paused) return;

  draining = true;
  halted = false;
  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  } finally {
    draining = false;
  }

  // Anything left is waiting on its debounce timer: come back for it.
  const { queue = [] } = await chrome.storage.local.get('queue');
  if (!queue.length || halted) {
    chrome.alarms.clear(DRAIN_ALARM);
  } else {
    const next = Math.min(...queue.map((i) => i.notBefore));
    scheduleDrain(next - Date.now());
  }
}

async function worker() {
  while (!halted) {
    const item = await takeNextReady();
    if (!item) return;
    try {
      await processItem(item);
    } catch (err) {
      console.warn('Sortera: failed to process bookmark', item.id, err.message);
      await removeFromQueue(item.id);
    }
    await sleep(PAUSE_BETWEEN_MS);
  }
}

async function processItem(item) {
  const settings = await getSettings();
  const bookmark = await getNode(item.id);
  // For a recheck: the category folder it's in now. null for inbox items.
  const current = item.recheck && bookmark ? await categoryOfParent(bookmark.parentId, settings) : null;

  // Deleted, a folder, or moved somewhere else while waiting: nothing to do.
  const inPlace = item.recheck ? !!current : await isWatchedParent(bookmark?.parentId, settings);
  if (!bookmark?.url || !inPlace) return removeFromQueue(item.id);

  // Domain rule match: no fetch, no LLM call, just move it.
  const ruleCategory = matchDomainRule(bookmark.url, settings);
  if (ruleCategory) {
    if (ruleCategory !== current) await moveToCategory(bookmark.id, ruleCategory, settings);
    await removeFromReview([bookmark.id]);
    return removeFromQueue(item.id);
  }

  // Title still empty? Give the browser a little more time to fill it in.
  if (!item.recheck && !bookmark.title && item.titleWaits < 2) {
    return requeue(item.id, TITLE_WAIT_MS, { titleWaits: item.titleWaits + 1 });
  }

  const apiKey = await getApiKey();
  if (PROVIDERS[settings.provider]?.needsKey && !apiKey) {
    await halt('No API key set. Add one in Sortera settings.');
    return requeue(item.id, 0);
  }

  const pageText = settings.sendPageContent ? await getPageText(bookmark.url) : null;

  let result;
  try {
    result = await classify({ settings, apiKey, title: bookmark.title, url: bookmark.url, pageText });
  } catch (err) {
    if (err.fatal) {
      await halt(err.message);
      return requeue(item.id, 0);
    }
    // Gave up after retries: park it in the review list so it isn't lost.
    await addToReview(bookmark, { error: err.message, from: current });
    await setStatus({ error: err.message });
    return removeFromQueue(item.id);
  }

  await setStatus({ error: null });
  if (result.category === current) {
    await removeFromReview([bookmark.id]); // recheck agrees with where it already is
  } else if (result.confidence >= settings.confidenceThreshold) {
    await moveToCategory(bookmark.id, result.category, settings);
    await removeFromReview([bookmark.id]);
  } else {
    await addToReview(bookmark, { ...result, from: current });
  }
  await removeFromQueue(item.id);
}

async function halt(message) {
  halted = true;
  await setStatus({ error: message, paused: true });
  chrome.alarms.clear(DRAIN_ALARM);
}

async function resume() {
  await setStatus({ error: null, paused: false });
}

function scheduleDrain(delayMs) {
  setTimeout(drain, Math.max(0, delayMs) + 50);
}

// ---------------------------------------------------------------------------
// Moving bookmarks
// ---------------------------------------------------------------------------

const folderLock = createLock(); // stops two workers creating the same folder twice

async function moveToCategory(id, category, settings) {
  const folderId = await folderLock(() => ensureCategoryFolder(settings, category));
  await markOwnMove(id);
  await chrome.bookmarks.move(id, { parentId: folderId });
}

async function moveAndClear(id, category) {
  const settings = await getSettings();
  if (!settings.categories.some((c) => c.name === category)) throw new Error(`Unknown category "${category}".`);
  if (!(await getNode(id))) {
    await removeFromReview([id]);
    throw new Error('That bookmark no longer exists.');
  }
  await moveToCategory(id, category, settings);
  await removeFromReview([id]);
}

async function markOwnMove(id) {
  await updateStored('ignoreMoves', {}, (moves) => {
    const now = Date.now();
    for (const key of Object.keys(moves)) if (moves[key] < now) delete moves[key];
    moves[id] = now + 30_000;
  });
}

async function consumeOwnMove(id) {
  return updateStored('ignoreMoves', {}, (moves) => {
    const mine = moves[id] && moves[id] > Date.now();
    delete moves[id];
    return !!mine;
  });
}

// ---------------------------------------------------------------------------
// Storage helpers (all read-modify-write goes through one lock)
// ---------------------------------------------------------------------------

const storageLock = createLock();

async function updateStored(key, fallback, mutate) {
  return storageLock(async () => {
    const data = await chrome.storage.local.get(key);
    const value = data[key] ?? fallback;
    const result = mutate(value);
    await chrome.storage.local.set({ [key]: value });
    return result;
  });
}

async function enqueue(ids, delayMs, { recheck = false } = {}) {
  if (!ids.length) return;
  const notBefore = Date.now() + delayMs;
  await updateStored('queue', [], (queue) => {
    for (const id of ids) {
      if (!queue.some((i) => i.id === id)) queue.push({ id, notBefore, inFlight: 0, titleWaits: 0, recheck });
    }
  });
  // Safety net in case the service worker is suspended before the timer fires.
  chrome.alarms.create(DRAIN_ALARM, { periodInMinutes: 1 });
  scheduleDrain(delayMs);
}

async function takeNextReady() {
  return updateStored('queue', [], (queue) => {
    const now = Date.now();
    const item = queue.find(
      (i) => i.notBefore <= now && (!i.inFlight || now - i.inFlight > STALE_IN_FLIGHT_MS),
    );
    if (!item) return null;
    item.inFlight = now;
    return { ...item };
  });
}

async function requeue(id, delayMs, patch = {}) {
  await updateStored('queue', [], (queue) => {
    const item = queue.find((i) => i.id === id);
    if (item) Object.assign(item, patch, { inFlight: 0, notBefore: Date.now() + delayMs });
  });
}

async function removeFromQueue(id) {
  await updateStored('queue', [], (queue) => {
    const index = queue.findIndex((i) => i.id === id);
    if (index !== -1) queue.splice(index, 1);
  });
}

async function addToReview(bookmark, { category = null, confidence = null, reason = '', error = null, from = null }) {
  await updateStored('review', {}, (review) => {
    review[bookmark.id] = {
      id: bookmark.id,
      title: bookmark.title,
      url: bookmark.url,
      category,
      confidence,
      reason,
      error,
      from,
      at: Date.now(),
    };
  });
}

async function removeFromReview(ids) {
  await updateStored('review', {}, (review) => {
    for (const id of ids) delete review[id];
  });
}

async function setStatus(patch) {
  await updateStored('status', {}, (status) => Object.assign(status, patch));
}

async function updateBadge() {
  const { review = {}, status = {} } = await chrome.storage.local.get(['review', 'status']);
  const count = Object.keys(review).length;
  if (status.paused) {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#c62828' });
  } else {
    chrome.action.setBadgeText({ text: count ? String(count) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#e08a00' });
  }
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

// Tiny promise-chain mutex. Only protects within one service worker lifetime,
// which is all we need: after a restart nothing is running concurrently anyway.
function createLock() {
  let chain = Promise.resolve();
  return (fn) => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };
}

function collectIds(node) {
  if (!node) return [];
  return [node.id, ...(node.children || []).flatMap(collectIds)];
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
