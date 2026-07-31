/**
 * The model provider throttled us.
 *
 * Exists so callers can tell "we were rate limited" from "no element matched",
 * which were previously indistinguishable — both surfaced as a null selection.
 * That conflation is expensive in two ways: a ladder that escalates to a more
 * capable model on "not found" ends up paying for the expensive model purely
 * because it was throttled, and a caller that falls back to a
 * description-derived selector silently produces a worse test instead of a
 * visible, retryable failure.
 */
export class RateLimitError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}
