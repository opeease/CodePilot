import { createProvider, getAllProviders, setDefaultProviderId, updateProvider, upsertProviderModel } from '@/lib/db';
import type { ApiProvider } from '@/types';

export interface BindNewApiInput {
  baseUrl?: string;
  username?: string;
  password?: string;
}

export interface BindNewApiResult {
  provider: ApiProvider;
  models: string[];
}

const DEFAULT_NEW_API_BASE_URL = process.env.NEW_API_BASE_URL || 'https://server.opeease.com:3000';

function normalizeBaseUrl(baseUrl?: string): string {
  const value = (baseUrl || DEFAULT_NEW_API_BASE_URL).trim().replace(/\/+$/, '');
  if (!value) throw new Error('New API base URL is required');
  const parsed = new URL(value);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('New API base URL must start with http:// or https://');
  }
  return parsed.toString().replace(/\/+$/, '');
}

function joinCookies(headers: Headers): string {
  const anyHeaders = headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = typeof anyHeaders.getSetCookie === 'function'
    ? anyHeaders.getSetCookie()
    : [];
  const fallback = headers.get('set-cookie');
  const raw = setCookies.length > 0 ? setCookies : (fallback ? [fallback] : []);
  return raw
    .flatMap((cookie) => cookie.split(/,(?=[^;,]+=)/g))
    .map((cookie) => cookie.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ');
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function assertNewApiSuccess(body: unknown, fallback: string): void {
  if (!body || typeof body !== 'object') return;
  const record = body as Record<string, unknown>;
  if (record.success === false) {
    throw new Error(String(record.message || record.error || fallback));
  }
  if (record.status === false) {
    throw new Error(String(record.message || record.error || fallback));
  }
}

function extractStringByKeys(value: unknown, keys: Set<string>): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractStringByKeys(item, keys);
      if (found) return found;
    }
    return undefined;
  }
  for (const [key, item] of Object.entries(value)) {
    if (keys.has(key.toLowerCase()) && typeof item === 'string' && item.trim()) {
      return item.trim();
    }
    const nested = extractStringByKeys(item, keys);
    if (nested) return nested;
  }
  return undefined;
}

function extractApiKey(value: unknown): string | undefined {
  return extractStringByKeys(value, new Set([
    'key',
    'token',
    'api_key',
    'apiKey',
    'value',
  ].map((k) => k.toLowerCase())));
}

async function login(baseUrl: string, username: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/user/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
    redirect: 'manual',
  });
  const body = await readJson(res);
  if (!res.ok) {
    throw new Error(`New API login failed (${res.status})`);
  }
  assertNewApiSuccess(body, 'New API login failed');
  const cookie = joinCookies(res.headers);
  if (!cookie) {
    throw new Error('New API login did not return a session cookie');
  }
  return cookie;
}

async function createUserApiKey(baseUrl: string, cookie: string): Promise<string> {
  const tokenName = `delaoke-${new Date().toISOString().slice(0, 10)}`;
  const body = {
    name: tokenName,
    remain_quota: 500000,
    unlimited_quota: false,
    expired_time: -1,
  };

  const res = await fetch(`${baseUrl}/api/token/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify(body),
  });
  const json = await readJson(res);
  if (!res.ok) {
    throw new Error(`New API token creation failed (${res.status})`);
  }
  assertNewApiSuccess(json, 'New API token creation failed');
  const apiKey = extractApiKey(json);
  if (!apiKey) {
    throw new Error('New API token response did not include an API key');
  }
  return apiKey;
}

async function fetchModels(openAiBaseUrl: string, apiKey: string): Promise<string[]> {
  try {
    const res = await fetch(`${openAiBaseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return [];
    const json = await readJson(res);
    const data = (json as { data?: Array<{ id?: string }> }).data;
    if (!Array.isArray(data)) return [];
    return data.map((m) => m.id).filter((id): id is string => !!id);
  } catch {
    return [];
  }
}

function upsertNewApiProvider(baseUrl: string, apiKey: string, models: string[]): ApiProvider {
  const openAiBaseUrl = `${baseUrl}/v1`;
  const firstModel = models[0] || 'gpt-4o-mini';
  const roleModels = {
    default: firstModel,
    reasoning: firstModel,
    small: firstModel,
  };

  const existing = getAllProviders().find((provider) =>
    provider.name === '德劳克 New API' || provider.base_url === openAiBaseUrl
  );

  const payload = {
    name: '德劳克 New API',
    provider_type: 'custom',
    protocol: 'openai-compatible',
    base_url: openAiBaseUrl,
    api_key: apiKey,
    role_models_json: JSON.stringify(roleModels),
    notes: 'Bound from New API account login.',
  };

  const provider = existing
    ? updateProvider(existing.id, payload)!
    : createProvider(payload);

  models.slice(0, 50).forEach((model, index) => {
    upsertProviderModel({
      provider_id: provider.id,
      model_id: model,
      upstream_model_id: model,
      display_name: model,
      sort_order: index,
      enabled: 1,
    });
  });
  if (models.length === 0) {
    upsertProviderModel({
      provider_id: provider.id,
      model_id: firstModel,
      upstream_model_id: firstModel,
      display_name: firstModel,
      sort_order: 0,
      enabled: 1,
    });
  }

  setDefaultProviderId(provider.id);
  return provider;
}

export async function bindNewApiAccount(input: BindNewApiInput): Promise<BindNewApiResult> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const username = input.username?.trim();
  const password = input.password || '';
  if (!username || !password) {
    throw new Error('New API username and password are required');
  }

  const cookie = await login(baseUrl, username, password);
  const apiKey = await createUserApiKey(baseUrl, cookie);
  const openAiBaseUrl = `${baseUrl}/v1`;
  const models = await fetchModels(openAiBaseUrl, apiKey);
  const provider = upsertNewApiProvider(baseUrl, apiKey, models);
  return { provider, models };
}

export function getDefaultNewApiBaseUrl(): string {
  return DEFAULT_NEW_API_BASE_URL;
}
