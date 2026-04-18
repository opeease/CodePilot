import { NextRequest, NextResponse } from 'next/server';
import { getAllProviders, createProvider, getSetting } from '@/lib/db';
import { getEffectiveProviderProtocol } from '@/lib/provider-catalog';
import type { ProviderResponse, ErrorResponse, CreateProviderRequest, ApiProvider } from '@/types';

function maskApiKey(provider: ApiProvider): ApiProvider {
  let maskedKey = provider.api_key;
  if (maskedKey && maskedKey.length > 8) {
    maskedKey = '***' + maskedKey.slice(-8);
  }
  return { ...provider, api_key: maskedKey };
}

/** Check which ANTHROPIC_* env vars are set in the server process environment */
function detectEnvVars(): Record<string, string> {
  const detected: Record<string, string> = {};
  const envKeys = [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
  ];
  for (const key of envKeys) {
    const val = process.env[key];
    if (val) {
      // Mask secrets, show base_url in full
      if (key.includes('URL')) {
        detected[key] = val;
      } else if (val.length > 8) {
        detected[key] = '***' + val.slice(-8);
      } else {
        detected[key] = '***';
      }
    }
  }
  return detected;
}

export async function GET() {
  try {
    const providers = getAllProviders().map(maskApiKey);
    const envDetected = detectEnvVars();
    return NextResponse.json({
      providers,
      env_detected: envDetected,
      default_provider_id: getSetting('default_provider_id') || '',
    });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to get providers' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateProviderRequest = await request.json();

    if (!body.name) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Missing required field: name' },
        { status: 400 }
      );
    }

    // Anthropic-protocol providers must declare a base URL. Empty base_url
    // has an ambiguous meaning (legacy "Default" providers migrated from
    // older settings vs third-party presets that forgot to fill the URL),
    // and the latter would silently get promoted to first-party catalog +
    // routed to api.anthropic.com by the native SDK. Require explicit URL
    // on the write path so third-party configurations don't leak there.
    // Users wanting official Anthropic must pass 'https://api.anthropic.com'.
    //
    // Use effective protocol (raw → inferred) because body.protocol is
    // optional; older clients or raw-API callers can post
    // { provider_type: 'anthropic', base_url: '' } without protocol and
    // still land in the same ambiguous state.
    const effectiveProtocol = getEffectiveProviderProtocol(
      body.provider_type ?? '',
      body.protocol,
      body.base_url ?? '',
    );
    if (effectiveProtocol === 'anthropic' && !body.base_url?.trim()) {
      return NextResponse.json<ErrorResponse>(
        {
          error: 'Anthropic-protocol providers must specify a base URL (use https://api.anthropic.com for the official API, or your third-party endpoint)',
          code: 'ANTHROPIC_BASE_URL_REQUIRED',
        },
        { status: 400 }
      );
    }

    const provider = createProvider(body);
    return NextResponse.json<ProviderResponse>(
      { provider: maskApiKey(provider) },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to create provider' },
      { status: 500 }
    );
  }
}
