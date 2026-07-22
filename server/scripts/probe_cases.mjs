import WebSocket from "ws";

const cases = [
  { name: "plain-100", ticks_history: "BOOM1000", end: "latest", count: 100, style: "ticks" },
  { name: "count-5000", ticks_history: "BOOM1000", end: "latest", count: 5000, style: "ticks" },
  { name: "adjust", ticks_history: "BOOM1000", end: "latest", count: 100, style: "ticks", adjust_start_time: 1 },
  { name: "sub", ticks_history: "BOOM1000", end: "latest", count: 100, style: "ticks", subscribe: 1 },
  { name: "sub-adjust", ticks_history: "BOOM1000", end: "latest", count: 500, style: "ticks", subscribe: 1, adjust_start_time: 1 },
];

async function runCase(payload) {
  return new Promise((resolve) => {
    const ws = new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=1089");
    const timer = setTimeout(() => {
      ws.close();
      resolve("timeout");
    }, 5000);
    ws.on("open", () => ws.send(JSON.stringify({ ...payload, req_id: 1 })));
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      clearTimeout(timer);
      if (msg.error) resolve(`ERR ${msg.error.message}`);
      else if (msg.history) resolve(`OK n=${msg.history.prices?.length}`);
      else if (msg.tick) resolve(`TICK ${msg.tick.quote}`);
      else resolve(`other ${msg.msg_type}`);
      ws.close();
    });
  });
}

for (const c of cases) {
  const { name, ...payload } = c;
  const result = await runCase(payload);
  console.log(name, result);
}
