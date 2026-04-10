/**
 * runtime/sdk-runtime.ts — Claude Code SDK Agent Runtime.
 *
 * Wraps the existing SDK path in claude-client.ts behind the AgentRuntime interface.
 * Delegates to streamClaudeSdk() which contains the original SDK query() logic.
 *
 * Strategy: Rather than copy 500+ lines of SDK code here, we keep the SDK logic
 * in claude-client.ts (exported as streamClaudeSdk) and this file is a thin adapter.
 * When Phase 8 completes, we can optionally move the code here.
 */

import type { AgentRuntime, RuntimeStreamOptions } from './types';
import type { ClaudeStreamOptions } from '@/types';
import { findClaudeBinary } from '../platform';
import { getConversation } from '../conversation-registry';
import { getSetting, getActiveProvider } from '../db';

export const sdkRuntime: AgentRuntime = {
  id: 'claude-code-sdk',
  displayName: 'Claude Code',
  description: 'Claude Code CLI agent with built-in tools, MCP, and permissions.',

  stream(options: RuntimeStreamOptions): ReadableStream<string> {
    // Lazy import to avoid loading SDK when not needed
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { streamClaudeSdk } = require('../claude-client') as {
      streamClaudeSdk: (options: ClaudeStreamOptions) => ReadableStream<string>;
    };

    // Convert RuntimeStreamOptions → ClaudeStreamOptions
    const ro = options.runtimeOptions || {};
    const sdkOptions: ClaudeStreamOptions = {
      prompt: options.prompt,
      sessionId: options.sessionId,
      model: options.model,
      systemPrompt: options.systemPrompt,
      workingDirectory: options.workingDirectory,
      abortController: options.abortController,
      permissionMode: options.permissionMode,
      mcpServers: options.mcpServers,
      thinking: options.thinking,
      effort: options.effort,
      context1m: options.context1m,
      autoTrigger: options.autoTrigger,
      bypassPermissions: options.bypassPermissions,
      onRuntimeStatusChange: options.onRuntimeStatusChange,
      providerId: options.providerId,
      sessionProviderId: options.sessionProviderId,

      // SDK-specific fields from runtimeOptions
      sdkSessionId: ro.sdkSessionId as string | undefined,
      files: ro.files as ClaudeStreamOptions['files'],
      conversationHistory: ro.conversationHistory as ClaudeStreamOptions['conversationHistory'],
      sessionSummary: ro.sessionSummary as string | undefined,
      fallbackTokenBudget: ro.fallbackTokenBudget as number | undefined,
      imageAgentMode: ro.imageAgentMode as boolean | undefined,
      toolTimeoutSeconds: ro.toolTimeoutSeconds as number | undefined,
      outputFormat: ro.outputFormat as ClaudeStreamOptions['outputFormat'],
      agents: ro.agents as ClaudeStreamOptions['agents'],
      agent: ro.agent as string | undefined,
      enableFileCheckpointing: ro.enableFileCheckpointing as boolean | undefined,
      generativeUI: ro.generativeUI as boolean | undefined,
      provider: ro.provider as ClaudeStreamOptions['provider'],
    };

    return streamClaudeSdk(sdkOptions);
  },

  interrupt(sessionId: string): void {
    const conversation = getConversation(sessionId);
    if (conversation) {
      conversation.interrupt();
    }
  },

  isAvailable(): boolean {
    // SDK requires both CLI binary AND Anthropic-compatible credentials.
    // Without creds, auto mode falls through to native runtime (#456).
    // Credentials can come from: env vars, legacy DB setting, OR a configured
    // Anthropic provider in api_providers (injected via toClaudeCodeEnv).
    if (!findClaudeBinary()) return false;

    // Check env vars + legacy setting
    if (
      process.env.ANTHROPIC_API_KEY ||
      process.env.ANTHROPIC_AUTH_TOKEN ||
      getSetting('anthropic_auth_token')
    ) return true;

    // Check DB providers — any active provider with an API key works
    // (toClaudeCodeEnv injects its key as ANTHROPIC_API_KEY/AUTH_TOKEN)
    try {
      const provider = getActiveProvider();
      if (provider?.api_key) return true;
    } catch { /* DB not ready */ }

    return false;
  },

  dispose(): void {
    // SDK manages its own subprocess lifecycle
  },
};
