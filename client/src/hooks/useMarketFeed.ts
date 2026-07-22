import { useEffect, useRef, useState } from "react";
import type {
  LearningSummary,
  MarketSnapshot,
  VolLearningSummary,
  VolSnapshot,
} from "../types";

const empty: MarketSnapshot = {
  connected: false,
  symbols: {},
  disclaimer: "",
};

const emptyVolStats = {
  total: 0,
  wins: 0,
  losses: 0,
  pending: 0,
  winRate: null,
  avgReturnPct: null,
  winsAfterCost: 0,
  lossesAfterCost: 0,
  winRateAfterCost: null,
  avgReturnNetPct: null,
  expectancyNetPct: null,
  avgMfePct: null,
  avgMaePct: null,
  targetHitRate: null,
  decayWinRateAfterCost: null,
  decayExpectancyNetPct: null,
  decayEffectiveN: 0,
};

const emptyOutcomes = {
  spike: 0,
  target: 0,
  stopout: 0,
  expired: 0,
  other: 0,
  total: 0,
  dominantLoss: null,
  note: null,
};

const emptyVol: VolSnapshot = {
  connected: false,
  analysis: null,
  learning: {
    totalSignals: 0,
    pending: 0,
    resolved: 0,
    overallWinRate: null,
    targetHitRate: null,
    costPctAssumed: 0.02,
    byBias: {
      up: { ...emptyVolStats },
      down: { ...emptyVolStats },
    },
    outcomes: { ...emptyOutcomes },
    outcomesByBias: { up: { ...emptyOutcomes }, down: { ...emptyOutcomes } },
    insights: [],
    focus: { byBias: {}, rows: [], preferred: null },
    recent: [],
    calibrated: {},
    updatedAt: 0,
  },
};

export function useMarketFeed() {
  const [snapshot, setSnapshot] = useState<MarketSnapshot>(empty);
  const [learning, setLearning] = useState<LearningSummary | null>(null);
  const [vol, setVol] = useState<VolSnapshot>(emptyVol);
  const [volLearning, setVolLearning] = useState<VolLearningSummary | null>(null);
  const [status, setStatus] = useState("Connecting…");
  const [volStatus, setVolStatus] = useState("Vol connecting…");
  const [live, setLive] = useState(false);
  const retryRef = useRef(0);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let timer: number | undefined;

    const connect = () => {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${window.location.host}/ws`);

      ws.onopen = () => {
        retryRef.current = 0;
        setLive(true);
        setStatus("Live");
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "snapshot") {
            setSnapshot(msg.data);
            if (msg.data.learning) setLearning(msg.data.learning);
            if (msg.data.vol) {
              setVol(msg.data.vol);
              if (msg.data.vol.learning) setVolLearning(msg.data.vol.learning);
            }
          }
          if (msg.type === "learning") {
            setLearning(msg.data);
          }
          if (msg.type === "vol") {
            setVol(msg.data);
            if (msg.data.learning) setVolLearning(msg.data.learning);
          }
          if (msg.type === "vol_learning") {
            setVolLearning(msg.data);
          }
          if (msg.type === "status") {
            setLive(Boolean(msg.data.connected));
            setStatus(msg.data.detail || (msg.data.connected ? "Live" : "Offline"));
          }
          if (msg.type === "vol_status") {
            setVolStatus(
              msg.data.detail || (msg.data.connected ? "Vol live" : "Vol offline"),
            );
          }
        } catch {
          // ignore
        }
      };

      ws.onclose = () => {
        setLive(false);
        setStatus("Reconnecting…");
        if (closed) return;
        const delay = Math.min(8000, 800 * 2 ** retryRef.current);
        retryRef.current += 1;
        timer = window.setTimeout(connect, delay);
      };
    };

    fetch("/api/snapshot")
      .then((r) => r.json())
      .then((data) => {
        setSnapshot(data);
        if (data.learning) setLearning(data.learning);
        if (data.vol) {
          setVol(data.vol);
          if (data.vol.learning) setVolLearning(data.vol.learning);
        }
      })
      .catch(() => undefined);

    fetch("/api/learning")
      .then((r) => r.json())
      .then((data) => setLearning(data))
      .catch(() => undefined);

    fetch("/api/vol")
      .then((r) => r.json())
      .then((data) => {
        setVol(data);
        if (data.learning) setVolLearning(data.learning);
      })
      .catch(() => undefined);

    connect();

    return () => {
      closed = true;
      if (timer) window.clearTimeout(timer);
      ws?.close();
    };
  }, []);

  return { snapshot, learning, vol, volLearning, status, volStatus, live };
}
