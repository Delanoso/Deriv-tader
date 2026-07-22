import WebSocket from "ws";

const url = "wss://ws.derivws.com/websockets/v3?app_id=1089";
const ws = new WebSocket(url);

ws.on("open", () => {
  console.log("open");
  // Same payload as production client
  for (const symbol of ["BOOM1000", "CRASH1000"]) {
    ws.send(
      JSON.stringify({
        ticks_history: symbol,
        adjust_start_time: 1,
        count: 5000,
        end: "latest",
        style: "ticks",
        subscribe: 1,
        req_id: symbol === "BOOM1000" ? 1 : 2,
      }),
    );
  }
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.error) {
    console.log("ERR", JSON.stringify(msg.error), JSON.stringify(msg.echo_req));
  } else if (msg.history) {
    console.log(
      "HISTORY",
      msg.echo_req?.ticks_history,
      "n=",
      msg.history.prices?.length,
      "sub=",
      msg.subscription?.id,
    );
  } else if (msg.tick) {
    console.log("TICK", msg.tick.symbol, msg.tick.quote);
  } else {
    console.log("other", msg.msg_type);
  }
});

setTimeout(() => process.exit(0), 6000);
