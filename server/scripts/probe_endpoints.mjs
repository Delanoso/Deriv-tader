import WebSocket from "ws";

const endpoints = [
  "wss://ws.derivws.com/websockets/v3?app_id=1089",
  "wss://ws.binaryws.com/websockets/v3?app_id=1089",
  "wss://green.binaryws.com/websockets/v3?app_id=1089",
];

for (const url of endpoints) {
  await new Promise((resolve) => {
    const ws = new WebSocket(url);
    const t = setTimeout(() => {
      console.log(url, "timeout");
      ws.close();
      resolve();
    }, 4000);
    ws.on("open", () => {
      ws.send(JSON.stringify({ ticks: "R_100", subscribe: 1, req_id: 1 }));
    });
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      clearTimeout(t);
      if (msg.error) console.log(url, "ERR", msg.error.message);
      else if (msg.tick) console.log(url, "TICK OK", msg.tick.quote);
      else console.log(url, msg.msg_type);
      ws.close();
      resolve();
    });
    ws.on("error", (e) => {
      clearTimeout(t);
      console.log(url, "socket-err", e.message);
      resolve();
    });
  });
}
