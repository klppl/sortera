# Sortera privacy policy

_Last updated: October 10, 2026_

Sortera is a browser extension that sorts bookmarks into folders using an AI model you choose. This policy explains what data it handles and where that data goes.

## The short version
- The developer of Sortera does not run any servers and does not receive, collect, store, sell or share any of your data.
- Sortera has no analytics, tracking, ads or accounts.
- The only data that leaves your device goes to the AI provider **you** configure, using **your own** API key, to classify your bookmarks.

## What Sortera handles

**Bookmarks in your inbox folder.** When you save a bookmark into the folder you chose as Sortera's inbox (or when you ask Sortera to classify or recheck bookmarks), Sortera reads its title and URL.

**Page text (optional).** If "Fetch the page and send a short text snippet" is on, Sortera downloads the bookmarked page without your cookies and extracts about 2000 characters of text. It never fetches local addresses (localhost, IP addresses, .local/.lan and similar hosts).

**Settings and API key.** Your settings, your API key, the queue of bookmarks waiting to be sorted and the list waiting for your review are stored in the browser's local extension storage on your device. They are never synced and never sent to the developer.

## Where data is sent

For each bookmark it classifies, Sortera sends the bookmark's title, URL and (if enabled) the page snippet to the AI provider you selected:

- **Anthropic** (api.anthropic.com), governed by Anthropic's privacy policy, or
- **OpenAI** (api.openai.com), governed by OpenAI's privacy policy, or
- **A custom endpoint you enter**, such as Ollama or LM Studio on your own computer. With a local model, nothing leaves your machine.

Your API key is sent only to that provider, as part of the request. Bookmarks matched by a domain rule are moved without contacting any provider.

Sortera does not send your data anywhere else, does not use it for any purpose other than sorting your bookmarks, and does not use it for advertising or creditworthiness.

## Your control
- Turn Sortera off with the switch in the popup or settings.
- Turn off page fetching so only titles and URLs are sent.
- Use a local model so nothing leaves your computer.
- Remove your API key in settings, or uninstall the extension to delete all its stored data.

## Changes
If this policy changes, the new version will be published at this same address with a new date.

## Contact
Questions or concerns: open an issue at https://github.com/klppl/sortera/issues.
