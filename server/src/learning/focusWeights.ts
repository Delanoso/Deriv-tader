import type { KindStats, SymbolId } from "../types.js";
import type { AgeRegime } from "./regimes.js";

export interface FocusWeight {
  key: string;
  label: string;
  n: number;
  expectancyNetPct: number | null;
  /** Soft confidence multiplier (≈0.55–1.15). */
  weight: number;
  /** True when live samples say stand aside / heavily dampen. */
  deprioritize: boolean;
  note: string;
}

export interface FocusMap {
  bySymbol: Partial<Record<SymbolId, FocusWeight>>;
  byAgeRegime: Partial<Record<SymbolId, Partial<Record<AgeRegime, FocusWeight>>>>;
  /** Flattened rows for UI. */
  rows: FocusWeight[];
}

function decidedN(st: KindStats | undefined): number {
  if (!st) return 0;
  return st.winsAfterCost + st.lossesAfterCost;
}

function expOf(st: KindStats | undefined): number | null {
  if (!st) return null;
  return st.decayExpectancyNetPct ?? st.expectancyNetPct;
}

function weightFromExp(exp: number | null, n: number, minN: number): number {
  if (n < minN || exp == null) return 1;
  // Map expectancy (%) into soft weight; clamp.
  const w = 1 + Math.tanh(exp * 12) * 0.35;
  return Number(Math.max(0.55, Math.min(1.15, w)).toFixed(3));
}

/**
 * Live-only focus weights: upweight symbols/regimes with positive expectancy,
 * soft-dampen (and optionally hard-block via entry gate) losers.
 */
export function buildFocusMap(input: {
  symbols: SymbolId[];
  liveBySymbol: Partial<
    Record<SymbolId, { byKind?: Partial<Record<string, KindStats>>; overall?: KindStats }>
  >;
  liveRegimes: Partial<
    Record<SymbolId, Array<{ key: string; stats: KindStats }>>
  >;
  minN?: number;
}): FocusMap {
  const minN = input.minN ?? Number(process.env.FOCUS_MIN_N || 8);
  const bySymbol: FocusMap["bySymbol"] = {};
  const byAgeRegime: FocusMap["byAgeRegime"] = {};
  const rows: FocusWeight[] = [];

  for (const symbol of input.symbols) {
    const st =
      input.liveBySymbol[symbol]?.byKind?.spike_watch ??
      input.liveBySymbol[symbol]?.overall;
    const n = decidedN(st);
    const exp = expOf(st);
    const weight = weightFromExp(exp, n, minN);
    const deprioritize = n >= minN && exp != null && exp < 0;
    const fw: FocusWeight = {
      key: symbol,
      label: symbol,
      n,
      expectancyNetPct: exp,
      weight,
      deprioritize,
      note:
        n < minN
          ? `Need ≥${minN} live decisions before focus weighting`
          : deprioritize
            ? `Deprioritize — live exp ${exp!.toFixed(3)}% on n=${n}`
            : `Focus weight ×${weight} (exp ${exp!.toFixed(3)}%, n=${n})`,
    };
    bySymbol[symbol] = fw;
    rows.push(fw);

    const ageMap: Partial<Record<AgeRegime, FocusWeight>> = {};
    for (const bucket of input.liveRegimes[symbol] ?? []) {
      const age = bucket.key as AgeRegime;
      const bn = decidedN(bucket.stats);
      const be = expOf(bucket.stats);
      const bw = weightFromExp(be, bn, Math.max(5, Math.floor(minN * 0.75)));
      const dep = bn >= 5 && be != null && be < 0;
      ageMap[age] = {
        key: `${symbol}:${age}`,
        label: `${symbol} ${age}`,
        n: bn,
        expectancyNetPct: be,
        weight: bw,
        deprioritize: dep,
        note:
          bn < 5
            ? "Warming age-regime focus"
            : dep
              ? `Avoid ${age} on ${symbol} (exp ${be!.toFixed(3)}%)`
              : `${age} weight ×${bw}`,
      };
      if (bn >= 5) rows.push(ageMap[age]!);
    }
    byAgeRegime[symbol] = ageMap;
  }

  rows.sort((a, b) => (a.expectancyNetPct ?? -99) - (b.expectancyNetPct ?? -99));
  return { bySymbol, byAgeRegime, rows: rows.slice(0, 24) };
}

export function combineFocusWeight(
  symbolWeight: FocusWeight | undefined,
  regimeWeight: FocusWeight | undefined,
): { weight: number; deprioritize: boolean; note: string | null } {
  const sw = symbolWeight?.weight ?? 1;
  const rw = regimeWeight?.weight ?? 1;
  const weight = Number(Math.max(0.5, Math.min(1.2, sw * rw)).toFixed(3));
  const deprioritize = Boolean(
    symbolWeight?.deprioritize || regimeWeight?.deprioritize,
  );
  const notes = [symbolWeight?.note, regimeWeight?.note].filter(
    (n) => n && !n.startsWith("Need") && !n.startsWith("Warming"),
  );
  return {
    weight,
    deprioritize,
    note: notes.length ? notes.join(" · ") : null,
  };
}
