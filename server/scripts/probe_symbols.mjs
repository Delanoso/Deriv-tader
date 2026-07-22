import WebSocket from "ws";

const ws = new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=1089");

ws.on("open", () => {
  // Try several product / landing variants
  ws.send(JSON.stringify({ active_symbols: "brief", product_type: "basic", req_id: 1 }));
  ws.send(JSON.stringify({ active_symbols: "full", product_type: "basic", req_id: 2 }));
  ws.send(JSON.stringify({ trading_times: `${new Date().toISOString().slice(0, 10)}`, req_id: 3 }));
});

const seen = new Set();
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.active_symbols) {
    for (const s of msg.active_symbols) {
      const blob = `${s.symbol} ${s.display_name} ${s.market} ${s.submarket}`;
      if (/boom|crash|synthetic/i.test(blob)) {
        const key = s.symbol;
        if (!seen.has(key)) {
          seen.add(key);
          console.log("SYM", s.symbol, "|", s.display_name, "|", s.market, s.submarket, s.exchange_is_open);
        }
      }
    }
    console.log("total symbols in payload", msg.active_symbols.length, "req", msg.echo_req?.req_id);
  } else if (msg.trading_times) {
    const markets = msg.trading_times.markets || [];
    for (const m of markets) {
      for (const sub of m.submarkets || []) {
        for (const sym of sub.symbols || []) {
          if (/boom|crash/i.test(`${sym.symbol} ${sym.name}`)) {
            console.log("TT", sym.symbol, sym.name);
          }
        }
      }
    }
  } else if (msg.error) {
    console.log("ERR", msg.error.message);
  }
});

setTimeout(() => process.exit(0), 8000);
