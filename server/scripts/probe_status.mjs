import WebSocket from "ws";

const ws = new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=1089");
ws.on("open", () => {
  ws.send(JSON.stringify({ ticks_history: "R_100", end: "latest", count: 3, style: "ticks", req_id: 1 }));
  ws.send(JSON.stringify({ ticks_history: "BOOM1000", end: "latest", count: 3, style: "ticks", req_id: 2 }));
  ws.send(JSON.stringify({ website_status: 1, req_id: 3 }));
});
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.error) console.log("ERR", msg.echo_req?.req_id, msg.error.message);
  else if (msg.history) console.log("HIST", msg.echo_req?.ticks_history, msg.history.prices);
  else if (msg.website_status) console.log("STATUS", JSON.stringify(msg.website_status).slice(0, 400));
  else console.log(msg.msg_type);
});
setTimeout(() => process.exit(0), 5000);
