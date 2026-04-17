// Opus 4.7 ships a default 1M context window (no beta header required);
// Opus 4.6 (claude-opus-4-20250514) still needs context-1m-2025-08-07 to
// reach 1M. Other 4.x models default to 200K.
//
// The `opus` alias is intentionally left at 200K (Opus 4.6 semantics).
// Callers that know the resolved upstream model must pass it to
// getContextWindow via the `upstream` option so first-party sessions
// (which resolve to claude-opus-4-7) get their 1M window while
// Bedrock/Vertex sessions (where opus still resolves to 4.6) stay at
// 200K. This avoids the previous bug where all `opus` lookups were
// budgeted as 1M, over-estimating Bedrock/Vertex by ~5×.
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'sonnet': 200000,
  'opus': 200000,
  'haiku': 200000,
  'claude-sonnet-4-20250514': 200000,
  'claude-opus-4-20250514': 200000,
  'claude-opus-4-7': 1_000_000,
  'claude-haiku-4-5-20251001': 200000,
};

// Substring fallback keys ordered by length (longest first) so a vendor-
// prefixed or date-suffixed upstream name (e.g.
// 'us.anthropic.claude-opus-4-7-v1:0') hits 'claude-opus-4-7' before
// 'opus'. Without this, insertion order would make the short 'opus' alias
// (200K) win and strip the real 1M window.
const CONTEXT_LOOKUP_KEYS_BY_LENGTH = Object.keys(MODEL_CONTEXT_WINDOWS)
  .slice()
  .sort((a, b) => b.length - a.length);

export function getContextWindow(
  model: string,
  options?: { context1m?: boolean; upstream?: string },
): number | null {
  // Prefer the upstream model ID when known — it unambiguously selects
  // between alias variants (e.g. `opus` on first-party Anthropic is
  // claude-opus-4-7 but on Bedrock/Vertex it's Opus 4.6).
  const lookupKey = options?.upstream && MODEL_CONTEXT_WINDOWS[options.upstream] != null
    ? options.upstream
    : model;
  const base = MODEL_CONTEXT_WINDOWS[lookupKey]
    ?? MODEL_CONTEXT_WINDOWS[CONTEXT_LOOKUP_KEYS_BY_LENGTH.find(k => lookupKey.includes(k)) ?? '']
    ?? null;
  if (base === null) return null;
  // When 1M context beta is enabled, all supported models get 1M window.
  // (Opus 4.7 already defaults to 1M so the toggle is a no-op there.)
  if (options?.context1m) return 1_000_000;
  return base;
}
