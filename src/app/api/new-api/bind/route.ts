import { NextRequest, NextResponse } from 'next/server';
import { bindNewApiAccount, getNewApiLoginStatus } from '@/lib/new-api-client';
import { getModelsForProvider } from '@/lib/db';
import type { ErrorResponse } from '@/types';

function maskProvider<T extends { api_key?: string }>(provider: T): T {
  const apiKey = provider.api_key || '';
  if (apiKey.length <= 8) return provider;
  return { ...provider, api_key: `***${apiKey.slice(-8)}` };
}

export async function GET() {
  const status = getNewApiLoginStatus();
  const models = status.provider
    ? getModelsForProvider(status.provider.id).map((model) => model.model_id)
    : [];
  return NextResponse.json({
    ...status,
    models,
    groups: status.groups || [],
    provider: status.provider ? maskProvider(status.provider) : undefined,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await bindNewApiAccount({
      baseUrl: body?.baseUrl,
      username: body?.username,
      password: body?.password,
    });

    return NextResponse.json({
      provider: maskProvider(result.provider),
      models: result.models,
      groups: result.groups,
      username: result.username,
      loggedIn: true,
    });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to bind New API account' },
      { status: 400 },
    );
  }
}
