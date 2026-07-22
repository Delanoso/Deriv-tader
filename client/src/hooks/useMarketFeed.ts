import { useEffect, useRef, useState } from "react";
import type { LearningSummary, MarketSnapshot } from "../types";

const empty: MarketSnapshot = {
  connected: false,
  symbols: {},
  disclaimer: "",
};

export function useMarketFeed() {
  const [snapshot, setSnapshot] = useState<MarketSnapshot>(empty);
  const [learning, setLearning] = useState<LearningSummary | null>(null);
  const [status, setStatus] = useState("Connecting…");
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
          }
          if (msg.type === "learning") {
            setLearning(msg.data);
          }
          if (msg.type === "status") {
            setLive(Boolean(msg.data.connected));
            setStatus(msg.data.detail || (msg.data.connected ? "Live" : "Offline"));
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
      })
      .catch(() => undefined);

    fetch("/api/learning")
      .then((r) => r.json())
      .then((data) => setLearning(data))
      .catch(() => undefined);

    connect();

    return () => {
      closed = true;
      if (timer) window.clearTimeout(timer);
      ws?.close();
    };
  }, []);

  return { snapshot, learning, status, live };
}
