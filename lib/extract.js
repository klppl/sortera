// Fetches a page and pulls out a short plain-text snippet for the prompt.
// Service workers have no DOMParser, so this uses simple regexes. That's
// fine for a ~2000 character "what is this page about" snippet.
// Returns null whenever we can't get useful text (caller falls back to title + URL).

import { isLocalOrIpUrl } from './urls.js';

const MAX_CHARS = 2000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_HTML_CHARS = 1_000_000;
const LOGIN_PATH = /(log-?in|sign-?in|auth|sso|session|account\/verify)/i;

export async function getPageText(url) {
  if (!/^https?:\/\//i.test(url)) return null;
  if (isLocalOrIpUrl(url)) return null; // never poke at internal services or bare IPs

  // Page fetching needs the optional <all_urls> permission (granted in settings).
  const allowed = await chrome.permissions.contains({ origins: ['<all_urls>'] });
  if (!allowed) return null;

  try {
    const res = await fetch(url, {
      credentials: 'omit', // never send your cookies to the page
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    if (!(res.headers.get('content-type') || '').includes('html')) return null;
    if (res.redirected && LOGIN_PATH.test(new URL(res.url).pathname)) return null;

    const html = (await res.text()).slice(0, MAX_HTML_CHARS);
    const text = htmlToText(html);
    return text || null;
  } catch {
    return null;
  }
}

export function htmlToText(html) {
  const title = clean(firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i));
  const description = clean(metaContent(html, 'description') || metaContent(html, 'og:description'));

  // Prefer the main content area if the page marks one up.
  const main = firstMatch(html, /<main\b[^>]*>([\s\S]*?)<\/main>/i)
    || firstMatch(html, /<article\b[^>]*>([\s\S]*?)<\/article>/i)
    || firstMatch(html, /<body\b[^>]*>([\s\S]*)/i)
    || html;

  const body = clean(
    main
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|svg|template|iframe|nav|footer|header|form)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  );

  const parts = [];
  if (title) parts.push(`Page title: ${title}`);
  if (description) parts.push(`Description: ${description}`);
  if (body) parts.push(body);
  return parts.join('\n').slice(0, MAX_CHARS).trim();
}

function firstMatch(text, regex) {
  const m = text.match(regex);
  return m ? m[1] : '';
}

function metaContent(html, name) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const key = firstMatch(tag, /(?:name|property)\s*=\s*["']([^"']+)["']/i);
    if (key.toLowerCase() === name) return firstMatch(tag, /content\s*=\s*["']([^"']*)["']/i);
  }
  return '';
}

function clean(text) {
  return decodeEntities(text || '').replace(/\s+/g, ' ').trim();
}

function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (whole, code) => {
    const lower = code.toLowerCase();
    if (named[lower]) return named[lower];
    if (lower.startsWith('#x')) return safeChar(parseInt(lower.slice(2), 16), whole);
    if (lower.startsWith('#')) return safeChar(parseInt(lower.slice(1), 10), whole);
    return whole;
  });
}

function safeChar(code, fallback) {
  try {
    return String.fromCodePoint(code);
  } catch {
    return fallback;
  }
}
