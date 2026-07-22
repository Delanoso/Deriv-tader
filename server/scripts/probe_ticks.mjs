import WebSocket from "ws";

const ws = new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=1089");
let ticks = 0;

ws.on("open", () => {
  ws.send(JSON.stringify({ ticks: "BOOM1000", subscribe: 1, req_id: 1 }));
  ws.send(JSON.stringify({ ticks: "CRASH1000", subscribe: 1, req_id: 2 }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.error) console.log("ERR", msg.error.message, msg.echo_req);
  if (msg.tick) {
    ticks += 1;
    console.log("TICK", msg.tick.symbol, msg.tick.quote);
    if (ticks >= 4) {
      ws.close();
      process.exit(0);
    }
  }
});

setTimeout(() => {
  console.log("timeout ticks=", ticks);
  process.exit(1);
}, 8000);
