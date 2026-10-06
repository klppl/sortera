// URL helpers: domain rules and "don't touch local stuff" checks.

import { sameName } from './settings.js';

const INTERNAL_SUFFIXES = ['.local', '.lan', '.internal', '.home', '.home.arpa', '.localhost', '.test', '.intranet', '.corp'];

export function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return '';
  }
}

// "https://www.Claude.ai/chats" -> "claude.ai". Returns '' if it isn't a usable domain.
export function normalizeDomain(input) {
  const text = String(input || '').trim();
  if (!text) return '';
  const host = hostnameOf(text.includes('://') ? text : `https://${text}`);
  return host.replace(/^www\./, '');
}

// Returns the category name forced by a domain rule, or null.
// Rules pointing at a category that no longer exists are ignored.
export function matchDomainRule(url, settings) {
  const host = hostnameOf(url);
  if (!host) return null;
  for (const rule of settings.domainRules || []) {
    const domain = normalizeDomain(rule.domain);
    if (!domain || (host !== domain && !host.endsWith(`.${domain}`))) continue;
    const category = settings.categories.find((c) => sameName(c.name, rule.category));
    if (category) return category.name;
  }
  return null;
}

// True for links we should never fetch: IP addresses (private or public, e.g.
// 192.168.1.10 or 95.217.1.2:8080), localhost, single-label hosts like "nas",
// and internal-only suffixes like .local / .lan.
export function isLocalOrIpUrl(url) {
  const host = hostnameOf(url);
  if (!host) return true;
  if (host === 'localhost') return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true; // IPv4 literal
  if (host.includes(':')) return true; // IPv6 literal
  if (!host.includes('.')) return true; // single-label intranet name
  return INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix));
}
