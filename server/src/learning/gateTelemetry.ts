/** In-memory entry-gate counters for ops / learning UI. */

export interface GateTelemetrySnapshot {
  allowed: number;
  rejected: number;
  reasons: Record<string, number>;
  updatedAt: number;
}

const state: GateTelemetrySnapshot = {
  allowed: 0,
  rejected: 0,
  reasons: {},
  updatedAt: Date.now(),
};

/** Last reject fingerprint per symbol — avoid 1Hz poll spam. */
const lastRejectAt = new Map<string, number>();
const REJECT_COOLDOWN_MS = 60_000;

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

/** Collapse verbose reasons into short buckets. */
export function reasonBucket(reason: string): string {
  if (reason.startsWith("Confidence")) return "confidence";
  if (reason.startsWith("Timing")) return "timing";
  if (reason.startsWith("Stop")) return "stop";
  if (reason.startsWith("Need")) return "sample_spikes";
  if (reason.startsWith("Kill")) return "kill";
  if (reason.startsWith("Not a spike")) return "not_spike";
  if (reason.startsWith("Age regime")) return "regime";
  return "other";
}

export function recordGateAllow(): void {
  state.allowed += 1;
  state.updatedAt = Date.now();
}

export function recordGateReject(reasons: string[], symbol = "_"): void {
  const now = Date.now();
  const fingerprint = `${symbol}:${reasons.map(reasonBucket).sort().join(",")}`;
  const prev = lastRejectAt.get(fingerprint) ?? 0;
  if (now - prev < REJECT_COOLDOWN_MS) return;
  lastRejectAt.set(fingerprint, now);

  state.rejected += 1;
  for (const r of reasons) bump(state.reasons, reasonBucket(r));
  state.updatedAt = now;
}

export function getGateTelemetry(): GateTelemetrySnapshot {
  return {
    allowed: state.allowed,
    rejected: state.rejected,
    reasons: { ...state.reasons },
    updatedAt: state.updatedAt,
  };
}

/** Test helper. */
export function resetGateTelemetry(): void {
  state.allowed = 0;
  state.rejected = 0;
  state.reasons = {};
  state.updatedAt = Date.now();
  lastRejectAt.clear();
}
