// Settings and defaults. Everything is stored in chrome.storage.local
// (never sync), so the API key stays on this device.

export const FALLBACK_CATEGORY = 'other';

export const PROVIDERS = {
  anthropic: { label: 'Anthropic', defaultModel: 'claude-haiku-4-5', needsKey: true },
  openai: { label: 'OpenAI', defaultModel: 'gpt-4.1-mini', needsKey: true },
  custom: { label: 'Custom (OpenAI-compatible, e.g. Ollama)', defaultModel: 'llama3.2', needsKey: false },
};

// Keep this list to ~14 or fewer: models get less consistent as it grows.
export const DEFAULT_CATEGORIES = [
  { name: 'shopping', description: 'a product, service or deal I might want to buy' },
  { name: 'todo', description: 'something that needs my attention or action (a form, bill, signup, task)' },
  { name: 'read later', description: 'an article, blog post, essay or long read' },
  { name: 'watch later', description: 'a video, talk, podcast or stream' },
  { name: 'reference', description: 'documentation, manuals and how-to guides' },
  { name: 'recipes', description: 'a recipe or cooking-related page' },
  { name: 'ai chats', description: 'a link to a past ChatGPT, Gemini or Claude conversation I want to revisit' },
  { name: 'social posts', description: 'a saved Instagram reel, Threads post, X post or Facebook page' },
  { name: '3d print', description: 'a 3D model or printable design (Printables, Thingiverse, MakerWorld)' },
  { name: 'fitness', description: 'training, nutrition, supplements or health information, not products to buy' },
  { name: 'outings', description: 'a place to visit, trip idea, event or thing to do' },
  { name: 'music', description: 'a playlist, mix, artist or track' },
  { name: 'dev & projects', description: 'a GitHub repo, self-hosted tool, dev resource or design inspiration for my own projects' },
  { name: FALLBACK_CATEGORY, description: 'anything that does not clearly fit another category' },
];

// Domain rules skip the page fetch and the LLM entirely: if the bookmark's
// host is the domain (or a subdomain of it), it goes straight to the category.
// Useful for sites that are behind a login anyway.
export const DEFAULT_DOMAIN_RULES = [
  { domain: 'chatgpt.com', category: 'ai chats' },
  { domain: 'chat.openai.com', category: 'ai chats' },
  { domain: 'claude.ai', category: 'ai chats' },
  { domain: 'gemini.google.com', category: 'ai chats' },
  { domain: 'instagram.com', category: 'social posts' },
  { domain: 'threads.com', category: 'social posts' },
  { domain: 'threads.net', category: 'social posts' },
  { domain: 'x.com', category: 'social posts' },
  { domain: 'twitter.com', category: 'social posts' },
  { domain: 'facebook.com', category: 'social posts' },
];

export const DEFAULT_SETTINGS = {
  enabled: true,
  provider: 'anthropic',
  model: PROVIDERS.anthropic.defaultModel,
  baseUrl: 'http://localhost:11434/v1',
  watchedFolderId: null,
  watchSubfolders: false,
  sendPageContent: true,
  confidenceThreshold: 0.6,
  categories: DEFAULT_CATEGORIES,
  domainRules: DEFAULT_DOMAIN_RULES,
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  merged.categories = withFallback(merged.categories);
  return merged;
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  next.categories = withFallback(next.categories);
  await chrome.storage.local.set({ settings: next });
  return next;
}

export async function getApiKey() {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  return apiKey || '';
}

export async function setApiKey(apiKey) {
  if (apiKey) await chrome.storage.local.set({ apiKey });
  else await chrome.storage.local.remove('apiKey');
}

// Make sure the "other" fallback category always exists.
export function withFallback(categories) {
  const list = (categories || []).filter((c) => c && c.name);
  if (!list.some((c) => sameName(c.name, FALLBACK_CATEGORY))) {
    list.push(DEFAULT_CATEGORIES.find((c) => c.name === FALLBACK_CATEGORY));
  }
  return list;
}

export function sameName(a, b) {
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}
