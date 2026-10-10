<p align="center">
  <img src="icons/icon-128.png" alt="" width="96">
</p>

<h1 align="center">Sortera</h1>

<p align="center">
  <b>Your bookmark pile, sorted.</b><br>
  Keep saving links to one folder. Sortera files each one where it belongs.
</p>

<p align="center">
  <img src="docs/popup.png" alt="Popup with a bookmark waiting for review and the recheck section" width="320">
  &nbsp;
  <img src="docs/settings.png" alt="Settings page: provider, inbox folder and categories" width="420">
</p>

## Why

Saving a link "for later" takes one click. Getting back to it is the hard part. Mine all went into a
"todo" folder, which grew into hundreds of recipes, articles, videos, shopping tabs and GitHub repos mixed
together. Too long to scroll, so I stopped opening it.

Sortera fixes the pile, not the habit. Keep bookmarking into one inbox folder like you already do. An AI
model reads each new bookmark and moves it into a short, focused folder: `recipes`, `read later`,
`watch later`, `shopping`, `dev & projects` and so on. When it's unsure, it asks you instead of guessing.
Already have a backlog? One click sorts the whole folder.

Bring your own key: Anthropic, OpenAI, or a free local model through Ollama. Sorting a thousand
bookmarks costs about ten cents.

## Install

**Chrome Web Store:** _link coming once the listing is approved_. Works in Chrome, Brave, Vivaldi, Edge
and other Chromium browsers.

**Manual install:** download [sortera-latest.zip](https://github.com/klppl/sortera/releases/download/latest/sortera-latest.zip)
and unzip it. Open `chrome://extensions` (or `brave://extensions`, `vivaldi://extensions`), turn on
**Developer mode**, click **Load unpacked** and pick the `sortera` folder. To update, download the zip
again, replace the folder, and click reload ↻ on the extension card.

Then, in the settings page that opens:

1. Pick a provider and paste your API key (or point it at a local model). Click **Test connection**.
2. Pick the bookmark folder to use as your inbox.
3. Click **Save**.

<details>
<summary>Install from source</summary>

Clone this repo and use **Load unpacked** on the folder that contains `manifest.json`.

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
`gpt-6-luna`, both $0.10 / $0.50 per million tokens), a bookmark costs about $0.0001, so a thousand cost
around ten cents.
Domain-rule matches cost nothing.

## More

- [docs/details.md](docs/details.md): permissions, using Ollama, how the queue works, known limitations.
- The prompt lives in [lib/prompt.js](lib/prompt.js) if you want to tweak how things get classified.
- Bugs and ideas: [open an issue](https://github.com/klppl/sortera/issues).

## License

[Lagom License](LICENSE) (Version 2).
