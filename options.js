import {
  getSettings,
  saveSettings,
  getApiKey,
  setApiKey,
  PROVIDERS,
  FALLBACK_CATEGORY,
  DEFAULT_CATEGORIES,
  DEFAULT_DOMAIN_RULES,
  sameName,
} from './lib/settings.js';
import { normalizeDomain } from './lib/urls.js';

const MAX_RECOMMENDED_CATEGORIES = 14;

const $ = (id) => document.getElementById(id);

const CUSTOM_MODEL = '__custom__'; // the "Custom…" entry in the model dropdown

init();

async function init() {
  const [settings, apiKey, tree] = await Promise.all([getSettings(), getApiKey(), chrome.bookmarks.getTree()]);

  for (const [value, { label }] of Object.entries(PROVIDERS)) {
    $('provider').append(new Option(label, value));
  }
  buildFolderSelect(tree, settings.watchedFolderId);

  $('enabled').checked = settings.enabled;
  $('provider').value = settings.provider;
  $('baseUrl').value = settings.baseUrl;
  $('apiKey').value = apiKey;
  fillModelSelect(settings.provider, settings.model);
  $('watchSubfolders').checked = settings.watchSubfolders;
  $('threshold').value = settings.confidenceThreshold;
  $('sendPageContent').checked = settings.sendPageContent;
  renderCategories(settings.categories);
  renderRules(settings.domainRules);
  updateProviderFields();
  updateThresholdLabel();
  showStatusError();

  $('enabled').addEventListener('change', () => saveSettings({ enabled: $('enabled').checked }));
  $('provider').addEventListener('change', onProviderChange);
  $('modelSelect').addEventListener('change', onModelSelectChange);
  $('threshold').addEventListener('input', updateThresholdLabel);
  $('toggleKey').addEventListener('click', toggleKeyVisibility);
  $('addCategory').addEventListener('click', () => {
    addCategoryRow({ name: '', description: '' });
    onCategoriesEdited();
  });
  $('resetCategories').addEventListener('click', () => {
    renderCategories(DEFAULT_CATEGORIES);
    showResult('saveResult', 'Default categories restored. Click Save to apply.');
  });
  $('categories').addEventListener('input', onCategoriesEdited);
  $('addRule').addEventListener('click', () => addRuleRow({ domain: '', category: '' }));
  $('resetRules').addEventListener('click', () => {
    renderRules(DEFAULT_DOMAIN_RULES);
    showResult('saveResult', 'Default rules restored. Click Save to apply.');
  });
  $('save').addEventListener('click', onSave);
  $('test').addEventListener('click', onTest);
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.status) showStatusError();
  });
}

// ---------------------------------------------------------------------------
// Provider / key / model
// ---------------------------------------------------------------------------

function onProviderChange() {
  const next = $('provider').value;
  // Model ids don't carry across providers, so start from the new one's default.
  fillModelSelect(next, PROVIDERS[next].defaultModel);
  updateProviderFields();
}

// Dropdown of the provider's suggested models, plus "Custom…" for anything else.
function fillModelSelect(provider, model) {
  const select = $('modelSelect');
  const presets = PROVIDERS[provider].models;
  select.innerHTML = '';
  for (const m of presets) select.append(new Option(m.label, m.id));
  select.append(new Option('Custom…', CUSTOM_MODEL));
  const isPreset = presets.some((m) => m.id === model);
  select.value = isPreset ? model : CUSTOM_MODEL;
  $('model').value = isPreset ? '' : model || '';
  $('model').classList.toggle('hidden', isPreset);
}

function onModelSelectChange() {
  const custom = $('modelSelect').value === CUSTOM_MODEL;
  $('model').classList.toggle('hidden', !custom);
  if (custom) $('model').focus();
}

function readModel() {
  return $('modelSelect').value === CUSTOM_MODEL ? $('model').value.trim() : $('modelSelect').value;
}

function updateProviderFields() {
  const isCustom = $('provider').value === 'custom';
  $('baseUrlField').classList.toggle('hidden', !isCustom);
  $('keyOptional').classList.toggle('hidden', !isCustom);
}

function toggleKeyVisibility() {
  const input = $('apiKey');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  $('toggleKey').textContent = show ? 'Hide' : 'Show';
}

function updateThresholdLabel() {
  $('thresholdValue').textContent = Number($('threshold').value).toFixed(2);
}

// ---------------------------------------------------------------------------
// Folder picker
// ---------------------------------------------------------------------------

function buildFolderSelect(tree, selectedId) {
  const select = $('folder');
  select.append(new Option('— choose a folder —', ''));

  // The root node ("0") can't hold bookmarks, so start with its children.
  const walk = (nodes, depth) => {
    for (const node of nodes) {
      if (node.url) continue;
      const indent = '   '.repeat(depth);
      select.append(new Option(`${indent}${node.title || '(untitled)'}`, node.id));
      if (node.children) walk(node.children, depth + 1);
    }
  };
  walk(tree[0].children || [], 0);
  select.value = selectedId || '';
}

// ---------------------------------------------------------------------------
// Category editor
// ---------------------------------------------------------------------------

function renderCategories(categories) {
  $('categories').innerHTML = '';
  // Keep "other" last.
  const sorted = [
    ...categories.filter((c) => !sameName(c.name, FALLBACK_CATEGORY)),
    ...categories.filter((c) => sameName(c.name, FALLBACK_CATEGORY)),
  ];
  sorted.forEach(addCategoryRow);
  onCategoriesEdited();
}

// Keep the rule dropdowns and the count in sync with the category rows.
function onCategoriesEdited() {
  const count = currentCategoryNames().length;
  $('categoryCount').textContent =
    count > MAX_RECOMMENDED_CATEGORIES
      ? `${count} categories: consider trimming to ${MAX_RECOMMENDED_CATEGORIES} or fewer, the model gets less consistent.`
      : `${count} categories`;
  for (const select of document.querySelectorAll('.rule-category')) fillCategorySelect(select, select.value);
}

function currentCategoryNames() {
  return [...document.querySelectorAll('.cat-name')].map((i) => i.value.trim()).filter(Boolean);
}

function addCategoryRow({ name, description }) {
  const isFallback = sameName(name, FALLBACK_CATEGORY);
  const row = document.createElement('div');
  row.className = 'cat-row';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'name';
  nameInput.value = name;
  nameInput.className = 'cat-name';
  nameInput.readOnly = isFallback;

  const descInput = document.createElement('input');
  descInput.type = 'text';
  descInput.placeholder = 'what belongs here?';
  descInput.value = description || '';
  descInput.className = 'cat-desc';

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'small';
  remove.textContent = 'Remove';
  remove.disabled = isFallback;
  remove.addEventListener('click', () => {
    row.remove();
    onCategoriesEdited();
  });

  row.append(nameInput, descInput, remove);
  if (isFallback) $('categories').append(row);
  else {
    // Insert new rows above "other".
    const fallbackRow = [...$('categories').children].find((r) => r.querySelector('.cat-name').readOnly);
    $('categories').insertBefore(row, fallbackRow || null);
  }
  if (!name) nameInput.focus();
}

function readCategories() {
  const categories = [];
  for (const row of $('categories').children) {
    const name = row.querySelector('.cat-name').value.trim();
    const description = row.querySelector('.cat-desc').value.trim();
    if (!name && !description) continue; // ignore blank rows
    if (!name) throw new Error('Every category needs a name.');
    if (categories.some((c) => sameName(c.name, name))) throw new Error(`Duplicate category "${name}".`);
    categories.push({ name, description });
  }
  return categories;
}

// ---------------------------------------------------------------------------
// Domain rules editor
// ---------------------------------------------------------------------------

function renderRules(rules) {
  $('rules').innerHTML = '';
  (rules || []).forEach(addRuleRow);
}

function addRuleRow({ domain, category }) {
  const row = document.createElement('div');
  row.className = 'rule-row';

  const domainInput = document.createElement('input');
  domainInput.type = 'text';
  domainInput.placeholder = 'example.com';
  domainInput.value = domain;
  domainInput.className = 'rule-domain';
  domainInput.spellcheck = false;

  const select = document.createElement('select');
  select.className = 'rule-category';
  fillCategorySelect(select, category);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'small';
  remove.textContent = 'Remove';
  remove.addEventListener('click', () => row.remove());

  row.append(domainInput, select, remove);
  $('rules').append(row);
  if (!domain) domainInput.focus();
}

function fillCategorySelect(select, selected) {
  const names = currentCategoryNames();
  select.innerHTML = '';
  for (const name of names) select.append(new Option(name, name));
  // Keep a rule's category visible even if it was renamed/removed, so save can flag it.
  if (selected && !names.some((n) => sameName(n, selected))) {
    select.append(new Option(`${selected} (missing)`, selected));
  }
  const match = names.find((n) => sameName(n, selected));
  select.value = match || selected || names[0] || '';
}

function readRules(categories) {
  const rules = [];
  for (const row of $('rules').children) {
    const raw = row.querySelector('.rule-domain').value.trim();
    const category = row.querySelector('.rule-category').value;
    if (!raw) continue; // ignore blank rows
    const domain = normalizeDomain(raw);
    if (!domain) throw new Error(`"${raw}" is not a valid domain.`);
    if (!categories.some((c) => sameName(c.name, category))) {
      throw new Error(`Domain rule for ${domain} points to a missing category "${category}".`);
    }
    rules.push({ domain, category });
  }
  return rules;
}

// ---------------------------------------------------------------------------
// Save / test
// ---------------------------------------------------------------------------

// Reads the form synchronously so the permission request below still counts
// as part of the click (Chrome requires a user gesture for it).
function readForm() {
  const provider = $('provider').value;
  const baseUrl = $('baseUrl').value.trim();
  const model = readModel();
  if (!model) throw new Error('Enter a model name.');
  if (provider === 'custom') {
    try {
      new URL(baseUrl);
    } catch {
      throw new Error('Enter a valid base URL for the custom endpoint.');
    }
  }
  const categories = readCategories();
  return {
    settings: {
      enabled: $('enabled').checked,
      provider,
      model,
      baseUrl,
      watchedFolderId: $('folder').value || null,
      watchSubfolders: $('watchSubfolders').checked,
      sendPageContent: $('sendPageContent').checked,
      confidenceThreshold: Number($('threshold').value),
      categories,
      domainRules: readRules(categories),
    },
    apiKey: $('apiKey').value.trim(),
  };
}

function neededOrigins(settings) {
  if (settings.sendPageContent) return ['<all_urls>']; // also covers a custom endpoint
  if (settings.provider === 'custom') return [`${new URL(settings.baseUrl).origin}/*`];
  return [];
}

function onSave() {
  let form;
  try {
    form = readForm();
  } catch (err) {
    return showResult('saveResult', err.message, 'error');
  }

  const origins = neededOrigins(form.settings);
  const permission = origins.length
    ? chrome.permissions.request({ origins }).catch(() => false)
    : Promise.resolve(true);

  permission.then(async (granted) => {
    await saveSettings(form.settings);
    await setApiKey(form.apiKey);
    await chrome.runtime.sendMessage({ type: 'settingsChanged' });

    if (!granted) {
      showResult(
        'saveResult',
        form.settings.sendPageContent
          ? 'Saved, but site access was declined: only title + URL will be sent.'
          : 'Saved, but access to the custom endpoint was declined, so requests to it may fail.',
        'error',
      );
    } else if (!form.settings.watchedFolderId) {
      showResult('saveResult', 'Saved. Pick a watched folder to start sorting.', 'error');
    } else {
      showResult('saveResult', 'Saved.', 'ok');
    }
  });
}

async function onTest() {
  let form;
  try {
    form = readForm();
  } catch (err) {
    return showResult('testResult', err.message, 'error');
  }
  $('test').disabled = true;
  showResult('testResult', 'Testing…');
  try {
    const res = await chrome.runtime.sendMessage({ type: 'test', settings: form.settings, apiKey: form.apiKey });
    if (!res?.ok) throw new Error(res?.error || 'No response from background.');
    const { category, confidence, reason } = res.result;
    showResult('testResult', `OK → "${category}" (${Math.round(confidence * 100)}%) ${reason}`, 'ok');
  } catch (err) {
    showResult('testResult', err.message, 'error');
  } finally {
    $('test').disabled = false;
  }
}

function showResult(id, text, kind = '') {
  const el = $(id);
  el.textContent = text;
  el.className = kind ? `banner ${kind}` : 'muted';
  el.style.display = 'inline-block';
  el.style.margin = '0';
}

async function showStatusError() {
  const { status = {} } = await chrome.storage.local.get('status');
  const el = $('statusError');
  el.textContent = status.error ? `Last error: ${status.error}` : '';
  el.classList.toggle('hidden', !status.error);
}
