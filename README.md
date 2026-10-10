<p align="center">
  <img src="icons/icon-128.png" alt="" width="96">
</p>

<h1 align="center">Sortera</h1>

<p align="center">
  Drop a bookmark into an inbox folder. An AI model files it into the right category folder.<br>
  Bring your own key: Anthropic, OpenAI, or a local model through Ollama.
</p>

<p align="center">
  <img src="docs/popup.png" alt="Popup with a bookmark waiting for review and the recheck section" width="320">
  &nbsp;
  <img src="docs/settings.png" alt="Settings page: provider, inbox folder and categories" width="420">
</p>

## Install

**Chrome Web Store:** _link coming once the listing is approved_. Works in Chrome, Brave, Vivaldi, Edge
and other Chromium browsers.

Then, in the settings page that opens:

1. Pick a provider and paste your API key (or point it at a local model). Click **Test connection**.
2. Pick the bookmark folder to use as your inbox.
3. Click **Save**.

<details>
<summary>Install from source instead</summary>

1. Download or clone this repo.
2. Open `chrome://extensions` (or `brave://extensions`, `vivaldi://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and pick the folder that contains `manifest.json`.

</details>

## How it works

- **Save a bookmark into your inbox folder.** A few seconds later it's moved into a subfolder such as
  `recipes`, `read later`, `watch later` or `dev & projects`.
- **Unsure guesses wait for you.** When the model isn't confident, the bookmark stays in the inbox and the
  toolbar badge shows a count. Open the popup to accept the suggestion, pick another folder, or keep it.
- **Domain rules** send sites straight to a folder without asking the model, e.g. `chatgpt.com` → `ai chats`,
  `instagram.com` → `social posts`.
- **Classify everything currently in the watched folder** (popup) sorts bookmarks that were there
  before you installed Sortera.
- **Recheck sorted bookmarks** (popup) runs already sorted bookmarks through again, all of them or one
  folder. Handy after adding a category or switching models. A bookmark only moves when the model is
  confident it belongs somewhere else.
- **Your categories:** add, remove and describe them in settings. The descriptions go into the prompt.

## Privacy

- No account, no analytics, no servers of ours. Sortera only talks to the AI provider you choose.
- Your API key is stored on your device only and is never synced.
- Each classified bookmark's title and URL, plus a short text snippet of the page, go to your provider.
  Turn off page fetching in settings to send only the title and URL, or use a local model to keep
  everything on your machine.
- Pages are fetched without your cookies, and local addresses (localhost, IPs, `.local`/`.lan` hosts)
  are never fetched.

Full details: [privacy policy](PRIVACY.md).

## Cost

You pay your provider directly. The settings page lists the cheapest models for each provider with
their prices, and you can type in any other model id. With the defaults (`claude-haiku-5-5` and
`gpt-6-luna`, both $0.10 / $0.50 per million tokens), sorting a thousand bookmarks costs well under a dollar.
Domain-rule matches cost nothing.

## More

- [docs/details.md](docs/details.md): permissions, using Ollama, how the queue works, known limitations.
- The prompt lives in [lib/prompt.js](lib/prompt.js) if you want to tweak how things get classified.
- Bugs and ideas: [open an issue](https://github.com/klppl/sortera/issues).

## License

[Lagom License](LICENSE) (Version 2).
