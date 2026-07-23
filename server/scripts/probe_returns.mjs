import WebSocket from "ws";

const ws = new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=1089");
const want = new Set(["BOOM1000", "CRASH1000"]);

ws.on("open", () => {
  for (const s of want) {
    ws.send(JSON.stringify({ ticks_history: s, end: "latest", count: 5000, style: "ticks", req_id: s.length }));
  }
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (!msg.history) return;
  const sym = msg.echo_req.ticks_history;
  const prices = msg.history.prices;
  const rets = [];
  for (let i = 1; i < prices.length; i++) {
    rets.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  const abs = rets.map(Math.abs);
  abs.sort((a, b) => a - b);
  const ranked = rets
    .map((r, i) => ({ i: i + 1, r, abs: Math.abs(r) }))
    .sort((a, b) => b.abs - a.abs)
    .slice(0, 15);
  console.log("\n", sym, "n=", prices.length);
  console.log(" max", abs[abs.length - 1], "p99.9", abs[Math.floor(abs.length * 0.999)], "p99", abs[Math.floor(abs.length * 0.99)], "median", abs[Math.floor(abs.length * 0.5)]);
  console.log(" top", ranked.map((x) => ({ i: x.i, pct: +(x.r * 100).toFixed(4), d: +(prices[x.i] - prices[x.i - 1]).toFixed(3) })));
  want.delete(sym);
  if (!want.size) {
    ws.close();
    process.exit(0);
  }
});

setTimeout(() => process.exit(1), 10000);
