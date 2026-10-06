import { getSettings, saveSettings } from './lib/settings.js';

const $ = (id) => document.getElementById(id);

$('enabled').addEventListener('change', async () => {
  await saveSettings({ enabled: $('enabled').checked });
  render();
});
$('backlog').addEventListener('click', onBacklog);
$('resume').addEventListener('click', () => send({ type: 'resume' }));
$('openOptions').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local') render();
});

render();

async function render() {
  const settings = await getSettings();
  const { review = {}, queue = [], status = {} } = await chrome.storage.local.get(['review', 'queue', 'status']);
  const items = Object.values(review).sort((a, b) => b.at - a.at);

  $('enabled').checked = settings.enabled;
  $('enabledLabel').textContent = settings.enabled ? 'On' : 'Off';

  $('error').classList.toggle('hidden', !status.error);
  $('errorText').textContent = status.error || '';
  $('resume').classList.toggle('hidden', !status.paused);
  $('setup').classList.toggle('hidden', !!settings.watchedFolderId);
  $('backlog').disabled = !settings.watchedFolderId;

  $('counts').textContent = `${queue.length} queued · ${items.length} need review`;
  $('reviewHeading').classList.toggle('hidden', !items.length);

  const list = $('review');
  list.innerHTML = '';
  for (const item of items) list.append(renderItem(item, settings.categories));
}

function renderItem(item, categories) {
  const el = document.createElement('div');
  el.className = 'item';

  const title = document.createElement('a');
  title.className = 'title';
  title.href = item.url;
  title.target = '_blank';
  title.textContent = item.title || item.url;
  title.title = item.url;
  el.append(title);

  if (item.error) {
    const err = document.createElement('div');
    err.className = 'error';
    err.textContent = `Error: ${item.error}`;
    el.append(err);
  } else if (item.category) {
    const meta = document.createElement('div');
    meta.className = 'muted meta';
    meta.textContent = `Suggested: ${item.category} (${Math.round(item.confidence * 100)}%)${item.reason ? ` · ${item.reason}` : ''}`;
    el.append(meta);
  }

  const controls = document.createElement('div');
  controls.className = 'controls';

  if (item.category && !item.error) {
    controls.append(button(`Accept "${item.category}"`, () => send({ type: 'accept', id: item.id }), 'primary'));
  }

  const select = document.createElement('select');
  for (const c of categories) select.append(new Option(c.name, c.name));
  select.value = item.category || categories[0]?.name;
  controls.append(select);
  controls.append(button('Move', () => send({ type: 'move', id: item.id, category: select.value })));

  if (item.error) controls.append(button('Retry', () => send({ type: 'retry', id: item.id })));
  controls.append(button('Keep', () => send({ type: 'keep', id: item.id })));

  el.append(controls);
  return el;
}

function button(label, onClick, extraClass = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `small ${extraClass}`.trim();
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

async function onBacklog() {
  $('backlog').disabled = true;
  const res = await send({ type: 'backlog' });
  if (res?.ok) {
    $('notice').textContent = res.count
      ? `Queued ${res.count} bookmark${res.count === 1 ? '' : 's'}.`
      : 'Nothing new to classify in the watched folder.';
  }
  $('backlog').disabled = false;
}

async function send(msg) {
  try {
    const res = await chrome.runtime.sendMessage(msg);
    if (!res?.ok) throw new Error(res?.error || 'No response from background.');
    $('notice').textContent = '';
    return res;
  } catch (err) {
    $('notice').textContent = err.message;
    return null;
  }
}
