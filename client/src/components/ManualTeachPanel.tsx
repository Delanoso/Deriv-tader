import { useEffect, useMemo, useState } from "react";
import type { JournalSignal, SymbolAnalysis, SymbolId } from "../types";

interface Props {
  analysis: SymbolAnalysis | null;
  symbol: SymbolId;
  onRecorded?: () => void;
}

export function ManualTeachPanel({ analysis, symbol, onRecorded }: Props) {
  const isBoom = symbol.startsWith("BOOM");
  const defaultBias = isBoom ? "bullish" : "bearish";
  const plan = analysis?.spikePlan;
  const quote = analysis?.lastQuote ?? null;

  const defaults = useMemo(() => {
    const entry = quote ?? 0;
    const target =
      plan?.spikeTarget ??
      (entry
        ? isBoom
          ? entry * 1.0015
          : entry * 0.9985
        : 0);
    const stop =
      plan?.invalidation ??
      (entry && target
        ? isBoom
          ? entry - Math.abs(target - entry) / 3
          : entry + Math.abs(target - entry) / 3
        : 0);
    return {
      entry: entry ? entry.toFixed(3) : "",
      target: target ? Number(target).toFixed(3) : "",
      stop: stop ? Number(stop).toFixed(3) : "",
      confidence: "55",
      note: "",
    };
  }, [quote, plan?.spikeTarget, plan?.invalidation, isBoom, analysis?.updatedAt]);

  const [entry, setEntry] = useState(defaults.entry);
  const [target, setTarget] = useState(defaults.target);
  const [stop, setStop] = useState(defaults.stop);
  const [confidence, setConfidence] = useState(defaults.confidence);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEntry(defaults.entry);
    setTarget(defaults.target);
    setStop(defaults.stop);
    setConfidence(defaults.confidence);
    setMessage(null);
    setError(null);
  }, [defaults, symbol]);

  // Keep 1:3 when target changes and stop was still on auto ratio.
  // Also keep stop beyond the spike base / crash ceiling when present.
  function onTargetChange(value: string) {
    setTarget(value);
    const e = Number(entry);
    const t = Number(value);
    if (!Number.isFinite(e) || !Number.isFinite(t) || e <= 0) return;
    const dist = Math.abs(t - e) / 3;
    let next = isBoom ? e - dist : e + dist;
    const shelf =
      analysis?.opportunity.confluence?.shelfPrice ??
      analysis?.opportunity.confluence?.hits?.find((h) => h.shelfPrice != null)
        ?.shelfPrice;
    if (shelf != null && Number.isFinite(shelf)) {
      next = isBoom ? Math.min(next, shelf) : Math.max(next, shelf);
      // Small pad past the shelf so a wick through the base doesn't stop first.
      const pad = e * 0.00015;
      next = isBoom ? next - pad : next + pad;
    }
    setStop(next.toFixed(3));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/learning/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          bias: defaultBias,
          entryPrice: Number(entry),
          target: Number(target),
          invalidation: Number(stop),
          confidence: Number(confidence) / 100,
          note: note.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Could not record trade");
      }
      const row = data.signal as JournalSignal;
      setMessage(
        `Teach trade open · entry ${row.entryPrice} · target ${row.target} · stop ${row.invalidation}`,
      );
      setNote("");
      onRecorded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="teach-panel">
      <div className="teach-head">
        <h3>Teach desk</h3>
        <p>
          Enter a paper trade yourself so SpikeScope can learn from your read of
          the chart. It resolves on stop or target like the auto journal.
        </p>
      </div>

      <form className="teach-form" onSubmit={submit}>
        <label>
          <span>Entry</span>
          <input
            value={entry}
            onChange={(ev) => setEntry(ev.target.value)}
            inputMode="decimal"
            required
          />
        </label>
        <label>
          <span>Target</span>
          <input
            value={target}
            onChange={(ev) => onTargetChange(ev.target.value)}
            inputMode="decimal"
            required
          />
        </label>
        <label>
          <span>Stop</span>
          <input
            value={stop}
            onChange={(ev) => setStop(ev.target.value)}
            inputMode="decimal"
            required
          />
        </label>
        <label>
          <span>Confidence %</span>
          <input
            value={confidence}
            onChange={(ev) => setConfidence(ev.target.value)}
            inputMode="numeric"
            min={10}
            max={95}
            required
          />
        </label>
        <label className="teach-note">
          <span>Note</span>
          <input
            value={note}
            onChange={(ev) => setNote(ev.target.value)}
            placeholder="Why this trade? e.g. ceiling retest W"
          />
        </label>
        <button type="submit" className="teach-submit" disabled={busy || !quote}>
          {busy ? "Recording…" : `Paper ${isBoom ? "BUY" : "SELL"} to teach`}
        </button>
      </form>

      {message && <p className="teach-ok">{message}</p>}
      {error && <p className="teach-err">{error}</p>}
    </section>
  );
}
