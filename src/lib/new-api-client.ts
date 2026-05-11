import { createProvider, deleteProviderModel, getAllProviders, getModelsForProvider, getSetting, setDefaultProviderId, setSetting, updateProvider, upsertProviderModel } from '@/lib/db';
import type { ApiProvider } from '@/types';

export interface BindNewApiInput {
  baseUrl?: string;
  username?: string;
  password?: string;
}

export interface RegisterNewApiInput extends BindNewApiInput {
  email?: string;
  verificationCode?: string;
  affCode?: string;
}

export interface BindNewApiResult {
  provider: ApiProvider;
  models: string[];
  username: string;
  groups: NewApiUserGroup[];
}

export interface NewApiLoginStatus {
  baseUrl: string;
  loggedIn: boolean;
  username?: string;
  provider?: ApiProvider;
  groups?: NewApiUserGroup[];
}

export interface NewApiUserGroup {
  value: string;
  desc: string;
  ratio: number | string;
}

const DEFAULT_NEW_API_BASE_URL = process.env.NEW_API_BASE_URL || 'https://api.opeease.com';
const NEW_API_LOGIN_USERNAME_KEY = 'delaoke:new-api:username';
const NEW_API_LOGIN_AT_KEY = 'delaoke:new-api:login-at';
const NEW_API_GROUPS_KEY = 'delaoke:new-api:groups';
const NEW_API_TOKEN_NAME = 'delaoke';
const NEW_API_LEGACY_TOKEN_PREFIX = 'delaoke-';

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
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!value || typeof value !== 'object') return undefined;
  const data = (value as Record<string, unknown>).data;
  if (typeof data === 'string' && data.trim()) return data.trim();
  return extractStringByKeys(value, new Set([
    'key',
    'token',
    'api_key',
    'apiKey',
    'value',
  ].map((k) => k.toLowerCase())));
}

interface NewApiSession {
  cookie: string;
  userId: number;
}

interface NewApiToken {
  id?: number;
  name?: string;
  status?: number;
  expired_time?: number;
}

async function login(baseUrl: string, username: string, password: string): Promise<NewApiSession> {
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
  const userId = Number((body as { data?: { id?: unknown } })?.data?.id);
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new Error('New API login did not return a user id');
  }
  return { cookie, userId };
}

async function register(baseUrl: string, input: {
  username: string;
  password: string;
  email?: string;
  verificationCode?: string;
  affCode?: string;
}): Promise<void> {
  const res = await fetch(`${baseUrl}/api/user/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: input.username,
      password: input.password,
      ...(input.email ? { email: input.email } : {}),
      ...(input.verificationCode ? { verification_code: input.verificationCode } : {}),
      ...(input.affCode ? { aff_code: input.affCode } : {}),
    }),
  });
  const body = await readJson(res);
  if (!res.ok) {
    const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    throw new Error(String(record.message || record.error || `New API registration failed (${res.status})`));
  }
  assertNewApiSuccess(body, 'New API registration failed');
}

function isReusableDelaokeToken(token: NewApiToken): boolean {
  const name = token.name || '';
  const isDelaokeToken = name === NEW_API_TOKEN_NAME || name.startsWith(NEW_API_LEGACY_TOKEN_PREFIX);
  const isEnabled = token.status === undefined || token.status === 1;
  const isNotExpired = token.expired_time === undefined || token.expired_time === -1 || token.expired_time > Math.floor(Date.now() / 1000);
  return !!token.id && isDelaokeToken && isEnabled && isNotExpired;
}

async function listUserTokens(baseUrl: string, session: NewApiSession): Promise<NewApiToken[]> {
  const listRes = await fetch(`${baseUrl}/api/token/?p=0&page_size=100`, {
    headers: {
      Cookie: session.cookie,
      'New-Api-User': String(session.userId),
    },
  });
  const listJson = await readJson(listRes);
  if (!listRes.ok) {
    throw new Error(`New API token lookup failed (${listRes.status})`);
  }
  assertNewApiSuccess(listJson, 'New API token lookup failed');
  return (listJson as { data?: { items?: NewApiToken[] } })?.data?.items || [];
}

async function fetchTokenKey(baseUrl: string, session: NewApiSession, tokenId: number): Promise<string | undefined> {
  const keyRes = await fetch(`${baseUrl}/api/token/${tokenId}/key`, {
    method: 'POST',
    headers: {
      Cookie: session.cookie,
      'New-Api-User': String(session.userId),
    },
  });
  const keyJson = await readJson(keyRes);
  if (!keyRes.ok) {
    throw new Error(`New API token key fetch failed (${keyRes.status})`);
  }
  assertNewApiSuccess(keyJson, 'New API token key fetch failed');
  return extractApiKey(keyJson);
}

async function fetchReusableUserApiKey(baseUrl: string, session: NewApiSession): Promise<string | undefined> {
  const reusableToken = (await listUserTokens(baseUrl, session)).find(isReusableDelaokeToken);
  if (!reusableToken?.id) return undefined;
  return fetchTokenKey(baseUrl, session, reusableToken.id);
}

async function createUserApiKey(baseUrl: string, session: NewApiSession): Promise<string> {
  const body = {
    name: NEW_API_TOKEN_NAME,
    remain_quota: 500000,
    unlimited_quota: false,
    expired_time: -1,
  };

  const res = await fetch(`${baseUrl}/api/token/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: session.cookie,
      'New-Api-User': String(session.userId),
    },
    body: JSON.stringify(body),
  });
  const json = await readJson(res);
  if (!res.ok) {
    throw new Error(`New API token creation failed (${res.status})`);
  }
  assertNewApiSuccess(json, 'New API token creation failed');
  let apiKey = extractApiKey(json);
  if (!apiKey || apiKey.includes('*')) {
    apiKey = await fetchReusableUserApiKey(baseUrl, session);
  }
  if (!apiKey) {
    throw new Error('New API token response did not include an API key');
  }
  return apiKey;
}

async function getOrCreateUserApiKey(baseUrl: string, session: NewApiSession): Promise<string> {
  const existingApiKey = await fetchReusableUserApiKey(baseUrl, session);
  if (existingApiKey) return existingApiKey;
  return createUserApiKey(baseUrl, session);
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

async function fetchUserModels(baseUrl: string, session: NewApiSession): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl}/api/user/models`, {
      headers: {
        Cookie: session.cookie,
        'New-Api-User': String(session.userId),
      },
    });
    if (!res.ok) return [];
    const json = await readJson(res);
    assertNewApiSuccess(json, 'New API user models lookup failed');
    const data = (json as { data?: unknown }).data;
    if (!Array.isArray(data)) return [];
    return data.filter((model): model is string => typeof model === 'string' && model.trim().length > 0);
  } catch {
    return [];
  }
}

async function fetchUserGroups(baseUrl: string, session: NewApiSession): Promise<NewApiUserGroup[]> {
  try {
    const res = await fetch(`${baseUrl}/api/user/self/groups`, {
      headers: {
        Cookie: session.cookie,
        'New-Api-User': String(session.userId),
      },
    });
    if (!res.ok) return [];
    const json = await readJson(res);
    assertNewApiSuccess(json, 'New API user groups lookup failed');
    const data = (json as { data?: unknown }).data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
    return Object.entries(data as Record<string, { desc?: unknown; ratio?: unknown }>).map(([value, info]) => ({
      value,
      desc: typeof info.desc === 'string' ? info.desc : value,
      ratio: typeof info.ratio === 'number' || typeof info.ratio === 'string' ? info.ratio : 1,
    }));
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

  const existing = getAllProviders().find((provider) => provider.base_url === openAiBaseUrl);

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

  if (models.length > 0) {
    const nextModelIds = new Set(models);
    getModelsForProvider(provider.id).forEach((model) => {
      if (!nextModelIds.has(model.model_id)) {
        deleteProviderModel(provider.id, model.model_id);
      }
    });
  }

  models.forEach((model, index) => {
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

  const session = await login(baseUrl, username, password);
  const apiKey = await getOrCreateUserApiKey(baseUrl, session);
  const openAiBaseUrl = `${baseUrl}/v1`;
  const userModels = await fetchUserModels(baseUrl, session);
  const models = userModels.length > 0 ? userModels : await fetchModels(openAiBaseUrl, apiKey);
  const groups = await fetchUserGroups(baseUrl, session);
  const provider = upsertNewApiProvider(baseUrl, apiKey, models);
  setSetting(NEW_API_LOGIN_USERNAME_KEY, username);
  setSetting(NEW_API_LOGIN_AT_KEY, new Date().toISOString());
  setSetting(NEW_API_GROUPS_KEY, JSON.stringify(groups));
  return { provider, models, username, groups };
}

export async function registerNewApiAccount(input: RegisterNewApiInput): Promise<BindNewApiResult> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const username = input.username?.trim();
  const password = input.password || '';
  if (!username || !password) {
    throw new Error('New API username and password are required');
  }

  await register(baseUrl, {
    username,
    password,
    email: input.email?.trim(),
    verificationCode: input.verificationCode?.trim(),
    affCode: input.affCode?.trim(),
  });
  return bindNewApiAccount({ baseUrl, username, password });
}

export function getDefaultNewApiBaseUrl(): string {
  return DEFAULT_NEW_API_BASE_URL;
}

export function getNewApiLoginStatus(baseUrl?: string): NewApiLoginStatus {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const provider = getAllProviders().find((item) => item.base_url === `${normalizedBaseUrl}/v1`);
  const username = getSetting(NEW_API_LOGIN_USERNAME_KEY);
  const groups = (() => {
    try {
      const parsed = JSON.parse(getSetting(NEW_API_GROUPS_KEY) || '[]') as NewApiUserGroup[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();
  return {
    baseUrl: normalizedBaseUrl,
    loggedIn: !!(username && provider?.api_key),
    ...(username ? { username } : {}),
    ...(groups.length > 0 ? { groups } : {}),
    ...(provider ? { provider } : {}),
  };
}
