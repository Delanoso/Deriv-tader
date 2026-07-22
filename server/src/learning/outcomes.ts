export type OutcomeKey = "spike" | "target" | "stopout" | "expired";

type OutcomeSignal = {
  status: "pending" | "win" | "loss" | "expired";
  outcome?: OutcomeKey | "open";
};

export interface OutcomeBreakdown {
  spike: number;
  target: number;
  stopout: number;
  expired: number;
  other: number;
  /** Resolved rows counted. */
  total: number;
  /** Dominant loss mode when losses exist. */
  dominantLoss: OutcomeKey | null;
  note: string | null;
}

export function emptyOutcomes(): OutcomeBreakdown {
  return {
    spike: 0,
    target: 0,
    stopout: 0,
    expired: 0,
    other: 0,
    total: 0,
    dominantLoss: null,
    note: null,
  };
}

export function buildOutcomeBreakdown(signals: OutcomeSignal[]): OutcomeBreakdown {
  const out = emptyOutcomes();
  const decided = signals.filter(
    (s) => s.status === "win" || s.status === "loss" || s.status === "expired",
  );
  out.total = decided.length;
  if (!decided.length) return out;

  for (const s of decided) {
    const o = s.outcome;
    if (o === "spike") out.spike += 1;
    else if (o === "target") out.target += 1;
    else if (o === "stopout") out.stopout += 1;
    else if (o === "expired") out.expired += 1;
    else out.other += 1;
  }

  const losses = decided.filter((s) => s.status === "loss" || s.outcome === "expired");
  if (losses.length >= 3) {
    const counts: Record<OutcomeKey, number> = {
      spike: 0,
      target: 0,
      stopout: 0,
      expired: 0,
    };
    for (const s of losses) {
      if (s.outcome === "stopout") counts.stopout += 1;
      else if (s.outcome === "expired") counts.expired += 1;
      else if (s.outcome === "target") counts.target += 1;
      else if (s.outcome === "spike") counts.spike += 1;
    }
    const ranked = (Object.keys(counts) as OutcomeKey[]).sort(
      (a, b) => counts[b] - counts[a],
    );
    out.dominantLoss = ranked[0];
    if (out.dominantLoss === "expired" && counts.expired >= counts.stopout) {
      out.note = "Most losses expire — enter later or widen horizon.";
    } else if (out.dominantLoss === "stopout") {
      out.note = "Most losses are stopouts — widen stop or skip noisy regimes.";
    }
  }

  return out;
}
