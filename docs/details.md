# Sortera: details

A Manifest V3 extension for Chromium browsers (Brave, Vivaldi, Chrome, Edge) that watches one
"inbox" bookmark folder and uses an LLM to sort new bookmarks into category subfolders.
Bring your own key: Anthropic, OpenAI, or any OpenAI-compatible endpoint (Ollama, LM Studio, …).

Plain JavaScript with native ES modules. No build step, no dependencies.

## Project structure

```
manifest.json      MV3 manifest
background.js      service worker: bookmark events, persistent queue, moving bookmarks, badge
lib/prompt.js      ← THE PROMPT. Edit this to change how things get classified
lib/llm.js         provider calls (Anthropic / OpenAI / custom), retries, JSON validation
lib/extract.js     fetch a page and extract a ~2000 char text snippet
lib/bookmarks.js   watched-folder logic, category folder lookup/creation
lib/urls.js        domain rules, and the "never fetch local/IP links" check
lib/settings.js    defaults, default categories and domain rules, storage helpers
options.html/js    settings page
popup.html/js      on/off, review list, backlog button
styles.css         shared styles (light/dark)
```

## Load it unpacked

**Brave:** open `brave://extensions` · **Vivaldi:** open `vivaldi://extensions` · **Chrome:** `chrome://extensions`

1. Turn on **Developer mode** (toggle in the top right).
2. Click **Load unpacked** and choose this folder (the one containing `manifest.json`).
3. The settings page opens automatically on first install. Otherwise right-click the
   Sortera icon → *Options*. Pin the icon to the toolbar so you can see the badge.
4. After editing code, click the reload ↻ icon on the extension card. To see logs, click
   *service worker* on the card to open its DevTools.

## Set up and test

1. In settings, pick a provider, paste your API key, keep the default model
   (`claude-haiku-4-5` / `gpt-4.1-mini`) and click **Test connection**.
2. Pick your inbox folder (e.g. `dropbox`) as the watched folder.
3. Leave "Fetch the page…" on if you want better results. When you click **Save**, the browser asks
   for permission to read all sites. Decline it and Sortera uses title + URL only.
4. Bookmark a recipe page into the inbox folder. After about 6 seconds it should move to `dropbox/recipes`.
5. Bookmark something ambiguous. It stays in the inbox and the badge shows a count.
   Open the popup to **Accept** the suggestion, **Move** it elsewhere, or **Keep** it where it is.
6. Bookmarks that were already in the inbox before you set it up are not touched automatically.
   Use **Classify everything currently in the watched folder** in the popup for those.

### Using Ollama (or another local model)

Pick *Custom (OpenAI-compatible)*, base URL `http://localhost:11434/v1`, model e.g. `llama3.2`,
no key needed. Ollama rejects requests from extension origins by default, so start it with:

```bash
OLLAMA_ORIGINS="chrome-extension://*" ollama serve
```

## Permissions and why

| Permission | Why |
|---|---|
| `bookmarks` | read, create folders in, and move bookmarks |
| `storage` | settings, API key, queue and review list (`chrome.storage.local`, never synced) |
| `alarms` | wakes the service worker once a minute while items are queued, in case it was suspended mid-batch |
| `https://api.anthropic.com/*`, `https://api.openai.com/*` | call the LLM APIs |
| `<all_urls>` (**optional**, asked at runtime) | fetch the bookmarked page to read a snippet, and reach a custom endpoint. Without it Sortera works from title and URL only |

## How it works (short version)

- **Domain rules** run first: if the bookmark's host matches a rule (e.g. `chatgpt.com` → `ai chats`,
  `instagram.com` → `social posts`), it moves straight there. No fetch, no LLM call, no key needed.
  Subdomains match too (`www.instagram.com`, `m.facebook.com`).
- **Local links are never fetched**: IP addresses (private or public, e.g. `192.168.1.1`, `95.217.x.x:8080`),
  `localhost`, single-word hosts like `nas`, and `.local` / `.lan` / `.internal` / `.home.arpa` hosts.
  The model still sees their title and URL.
- `onCreated` / `onMoved` into the watched folder add the bookmark id to a queue in `chrome.storage.local`,
  with a 6 s debounce. If the title is still empty after that, it waits up to two more times.
- Two workers take items from the queue, fetch the page (no cookies, 10 s timeout),
  call the LLM (4 attempts with backoff, honouring `Retry-After`) and validate the JSON.
- If confidence ≥ threshold, the bookmark moves to `<inbox>/<category>`. Otherwise it goes to the review list.
- **No loops:** category folders are never part of the watched area, and every move Sortera makes
  is recorded in storage so the `onMoved` it triggers is ignored.
- **Config errors** (401, 403, 404, 400, missing key) pause the queue and show a red `!` badge and a
  message, so a bad key doesn't burn requests. Saving settings or clicking *Retry now* resumes.
- Transient failures that survive all retries land in the review list with an error and a **Retry** button.

## Known limitations

- Page text extraction uses regexes, not a DOM parser (service workers don't have one). It works well for
  ordinary articles and product pages, but sites that render client-side (SPAs) often yield little text.
- Pages are fetched without your cookies, so anything behind a login is classified from title + URL only.
- Classification only happens for the watched folder and (optionally) its direct subfolders, never deeper.
  Moving a whole *folder* into the inbox doesn't classify what's inside it; use the backlog button.
- Renaming a category in settings doesn't rename its existing folder; a new folder is created.
- Changing the default categories or domain rules in code doesn't update settings you have already saved.
  Use **Restore default categories** / **Restore default rules** in settings, then Save.
- Domain rules match on domain only, not on path (so every `claude.ai` link counts as an AI chat).
- Past ~14 categories the model gets noticeably less consistent; the settings page warns you above that.
- The locks that prevent duplicate folders only work within one service-worker lifetime. That's fine
  in practice, but two browser profiles syncing the same bookmarks could each create a folder.
- If bookmark sync is on and another device runs Sortera too, both may try to sort the same bookmark.
- Model "confidence" is self-reported and not calibrated. Tune the threshold to taste.
- The API key sits unencrypted in extension storage, which any code running in the extension can read.
  That's the standard BYOK trade-off in extensions.
- No icons yet (the browser shows a letter placeholder).

## Sensible next steps

- Add icons (16/48/128 PNG) and a nicer popup.
- An "undo last move" / activity log in the popup.
- Per-category custom folder paths (e.g. sort `recipes` into a folder outside the inbox).
- An offscreen document with `DOMParser` (or Readability.js) for better text extraction.
- More categories worth trying if you trim elsewhere: `money` (budgeting, trading, crypto) and
  `learning` (courses like boot.dev, Scrimba, LetsDefend).
- Domain rules with path patterns (e.g. only `youtube.com/playlist` → `music`).
- Let the model *suggest* a new category in the review list, which you approve, instead of always using "other".
- Use the Anthropic structured outputs / tool-use mode for guaranteed JSON.
- A small unit test setup for `lib/llm.js` (`parseResult`) and `lib/extract.js` (`htmlToText`),
  which are pure functions and easy to test with `node --test`.

## License

[Lagom License](../LICENSE) (Version 2).
