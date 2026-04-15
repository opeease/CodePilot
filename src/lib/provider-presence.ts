/**
 * provider-presence.ts — Single-source-of-truth: "does CodePilot itself have
 * a usable provider to talk to a model with?"
 *
 * Scope (intentionally narrow, by user requirement 2026-04-15):
 *   - DB provider records (any row with api_key / Bedrock / Vertex)
 *   - process.env.ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN
 *   - Legacy DB setting `anthropic_auth_token`
 *
 * Out of scope (intentionally NOT checked):
 *   - ~/.claude/settings.json env block (cc-switch, hand-edit) — that file
 *     lives under the Claude Code CLI's ownership; CodePilot treats CLI login
 *     state as "not our business". A user with only settings.json and no
 *     CodePilot-level provider will be intercepted and asked to add one.
 *   - CLI login state (`claude login` OAuth tokens) — same reason.
 *
 * This is the precheck used by the Chat API entry to decide whether to let the
 * request proceed. runtime/registry.ts's auto mode no longer does credential
 * inference; missing credentials are caught here with a structured response
 * the frontend can turn into a "open SetupCenter" action.
 */

import { getSetting, getAllProviders } from '@/lib/db';

/**
 * True when CodePilot has at least one provider the backend can dispatch to.
 *
 * fail-open on DB errors: if the DB read throws (e.g. not initialized yet in
 * a cold worker), we return `true` and let downstream resolver produce the
 * real error. Rationale: blocking the user on a transient DB glitch is worse
 * than letting the request surface an accurate upstream error.
 */
export function hasCodePilotProvider(): boolean {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
    return true;
  }

  try {
    if (getSetting('anthropic_auth_token')) return true;
  } catch {
    // getSetting failing is severe enough to fail-open
    return true;
  }

  try {
    for (const p of getAllProviders()) {
      if (p.api_key) return true;
      if (p.extra_env?.includes('CLAUDE_CODE_USE_BEDROCK')) return true;
      if (p.extra_env?.includes('CLAUDE_CODE_USE_VERTEX')) return true;
    }
  } catch {
    return true;
  }

  return false;
}
