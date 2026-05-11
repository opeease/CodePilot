import { NextRequest, NextResponse } from 'next/server';
import { registerNewApiAccount } from '@/lib/new-api-client';
import type { ErrorResponse } from '@/types';

function maskProvider<T extends { api_key?: string }>(provider: T): T {
  const apiKey = provider.api_key || '';
  if (apiKey.length <= 8) return provider;
  return { ...provider, api_key: `***${apiKey.slice(-8)}` };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await registerNewApiAccount({
      baseUrl: body?.baseUrl,
      username: body?.username,
      password: body?.password,
      email: body?.email,
      verificationCode: body?.verificationCode,
      affCode: body?.affCode,
    });

    return NextResponse.json({
      provider: maskProvider(result.provider),
      models: result.models,
      username: result.username,
      loggedIn: true,
    });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to register New API account' },
      { status: 400 },
    );
  }
}
