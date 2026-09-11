import type { PendingOperation } from "./console-state";
/** A recovered/unknown request is NOT evidence of an active network call. */
export function operationFeedback(
  busy: string,
  pending: PendingOperation | null,
  startedAt: number | null,
  now: number,
) {
  if (!busy) return null;
  const elapsed = startedAt === null ? 0 : Math.max(0, now - startedAt);
  return {
    label: busy,
    wallet: pending?.phase === "wallet",
    elapsed,
    slow: elapsed >= 20,
  };
}
