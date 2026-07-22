import WebSocket from "ws";

const cases = [
  { ticks_history: "BOOM1000", end: "latest", count: 50, style: "candles", granularity: 60, subscribe: 1 },
  { ticks_history: "R_100", end: "latest", count: 5, style: "ticks", subscribe: 1 },
  { ticks: "R_100", subscribe: 1 },
];

const ws = new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=1089");
let i = 0;
ws.on("open", () => {
  for (const c of cases) {
    i += 1;
    ws.send(JSON.stringify({ ...c, req_id: i }));
  }
});
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.error) console.log("ERR", msg.echo_req?.req_id, msg.error.message, Object.keys(msg.echo_req || {}));
  else console.log("OK", msg.msg_type, msg.echo_req?.req_id, msg.echo_req?.ticks_history || msg.echo_req?.ticks, msg.history?.prices?.length || msg.candles?.length || msg.tick?.quote);
});
setTimeout(() => process.exit(0), 6000);
