import WebSocket from "ws";

const url = "wss://ws.derivws.com/websockets/v3?app_id=1089";
const ws = new WebSocket(url);

ws.on("open", () => {
  console.log("open");
  ws.send(
    JSON.stringify({
      active_symbols: "brief",
      product_type: "basic",
      req_id: 1,
    }),
  );
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.msg_type === "active_symbols") {
    const hits = (msg.active_symbols || []).filter((s) =>
      /boom|crash/i.test(`${s.symbol} ${s.display_name}`),
    );
    console.log(
      "boom/crash from active_symbols:",
      hits.map((s) => `${s.symbol}|${s.display_name}|${s.market}`),
    );
    for (const sym of ["BOOM1000", "CRASH1000", "BOOM1000N", "CRASH1000N"]) {
      ws.send(
        JSON.stringify({
          ticks_history: sym,
          end: "latest",
          count: 3,
          style: "ticks",
          req_id: sym.length,
        }),
      );
    }
  } else if (msg.error) {
    console.log("ERR", msg.echo_req, msg.error.message);
  } else if (msg.history) {
    console.log(
      "OK",
      msg.echo_req?.ticks_history,
      "n=",
      msg.history.prices?.length,
      "last=",
      msg.history.prices?.at(-1),
    );
  } else {
    console.log("other", msg.msg_type);
  }
});

setTimeout(() => process.exit(0), 8000);
