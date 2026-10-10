// Talks to the LLM provider and turns its reply into a validated result:
//   { category, confidence, reason }
// The API key is only ever placed in request headers. Never log it.

import { buildPrompt } from './prompt.js';
import { FALLBACK_CATEGORY, sameName } from './settings.js';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 4;

// Newer models think/reason before answering, and that counts toward the
// output cap. These ask them to keep it short; older models reject the
// parameter, so it's only sent where it's supported.
const CLAUDE_WITH_EFFORT = /^claude-[a-z]+-([5-9]|\d{2})/; // claude-haiku-5-5, claude-sonnet-5, ...
const OPENAI_REASONING = /^(gpt-([5-9]|\d{2})|o\d)/; // gpt-5*, gpt-6-luna, o3, ...

// `fatal` errors are configuration problems (bad key, wrong model, ...).
// Retrying won't help, so the queue pauses until settings change.
export class LlmError extends Error {
  constructor(message, { fatal = false, retryAfterMs = null } = {}) {
    super(message);
    this.fatal = fatal;
    this.retryAfterMs = retryAfterMs;
  }
}

export async function classify({ settings, apiKey, title, url, pageText }) {
  const { system, user } = buildPrompt({ title, url, pageText, categories: settings.categories });
  const text = await withRetry(() => callProvider(settings, apiKey, system, user));
  return parseResult(text, settings.categories);
}

function callProvider(settings, apiKey, system, user) {
  if (settings.provider === 'anthropic') return callAnthropic(settings, apiKey, system, user);
  return callOpenAICompatible(settings, apiKey, system, user);
}

async function callAnthropic(settings, apiKey, system, user) {
  const data = await postJson(
    'https://api.anthropic.com/v1/messages',
    {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Required for calling the Anthropic API directly from a browser context.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    {
      model: settings.model,
      max_tokens: 1024, // room for thinking plus the short JSON answer
      ...(CLAUDE_WITH_EFFORT.test(settings.model) && { output_config: { effort: 'low' } }),
      system,
      messages: [{ role: 'user', content: user }],
    },
  );
  return (data.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

async function callOpenAICompatible(settings, apiKey, system, user) {
  const isOpenAI = settings.provider === 'openai';
  const baseUrl = isOpenAI ? 'https://api.openai.com/v1' : settings.baseUrl.replace(/\/+$/, '');
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

  const body = {
    model: settings.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };
  if (isOpenAI) {
    // max_completion_tokens works for both classic and reasoning models.
    body.max_completion_tokens = 2000;
    body.response_format = { type: 'json_object' };
    if (OPENAI_REASONING.test(settings.model)) body.reasoning_effort = 'low';
  } else {
    // Most OpenAI-compatible servers (Ollama, LM Studio, vLLM) understand these.
    body.max_tokens = 300;
    body.temperature = 0;
  }

  const data = await postJson(`${baseUrl}/chat/completions`, headers, body);
  return data.choices?.[0]?.message?.content || '';
}

async function postJson(url, headers, body) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? 'timed out' : 'could not connect';
    throw new LlmError(`Request to ${new URL(url).host} ${reason}.`);
  }

  if (res.ok) return res.json();

  const detail = await readErrorDetail(res);
  const status = res.status;
  if (status === 401) throw new LlmError(`API key was rejected (401). Check it in Sortera settings. ${detail}`, { fatal: true });
  if (status === 403) throw new LlmError(`Access denied (403). ${detail}`, { fatal: true });
  if (status === 404) throw new LlmError(`Endpoint or model not found (404). Check model name / base URL. ${detail}`, { fatal: true });
  if (status === 400) throw new LlmError(`Request rejected (400). Check the model name. ${detail}`, { fatal: true });
  if (status === 429 || status >= 500) {
    const retryAfter = Number(res.headers.get('retry-after'));
    throw new LlmError(`Provider busy or rate limited (${status}). ${detail}`, {
      retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null,
    });
  }
  throw new LlmError(`Request failed (${status}). ${detail}`, { fatal: true });
}

async function readErrorDetail(res) {
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      return String(json.error?.message || json.error || json.message || '').slice(0, 200);
    } catch {
      return text.slice(0, 200);
    }
  } catch {
    return '';
  }
}

// Retries rate limits, server errors and network hiccups with exponential backoff.
async function withRetry(fn) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof LlmError) || err.fatal || attempt >= MAX_ATTEMPTS) throw err;
      const delay = err.retryAfterMs ?? Math.min(2000 * 2 ** (attempt - 1), 30_000);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// Validate the model's reply. Anything off-list becomes "other" with zero
// confidence, which puts it in the review list instead of moving it.
export function parseResult(text, categories) {
  const match = String(text).match(/\{[\s\S]*\}/);
  let obj;
  try {
    obj = match ? JSON.parse(match[0]) : null;
  } catch {
    obj = null;
  }
  if (!obj || typeof obj !== 'object') {
    return { category: FALLBACK_CATEGORY, confidence: 0, reason: 'Model did not return valid JSON.' };
  }

  const category = categories.find((c) => sameName(c.name, obj.category ?? ''));
  let confidence = Number(obj.confidence);
  confidence = Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0;
  const reason = String(obj.reason ?? '').slice(0, 200);

  if (!category) {
    return {
      category: FALLBACK_CATEGORY,
      confidence: 0,
      reason: `Model suggested unknown category "${String(obj.category).slice(0, 40)}".`,
    };
  }
  return { category: category.name, confidence, reason };
}
