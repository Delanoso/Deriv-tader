#!/usr/bin/env python3
import json
import asyncio
import subprocess
import sys

try:
    import websockets
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "websockets", "-q"])
    import websockets


async def main():
    uri = "wss://ws.derivws.com/websockets/v3?app_id=1089"
    async with websockets.connect(uri) as ws:
        await ws.send(json.dumps({"active_symbols": "brief", "product_type": "basic"}))
        resp = json.loads(await asyncio.wait_for(ws.recv(), timeout=15))
        symbols = resp.get("active_symbols") or []
        boom_crash = [
            s
            for s in symbols
            if "boom" in (s.get("display_name") or "").lower()
            or "crash" in (s.get("display_name") or "").lower()
            or "BOOM" in (s.get("symbol") or "")
            or "CRASH" in (s.get("symbol") or "")
        ]
        print("Found boom/crash symbols:")
        for s in boom_crash:
            print(f"  {s.get('symbol'):20} {s.get('display_name')}")

        candidates = ["BOOM1000", "CRASH1000", "BOOM1000N", "CRASH1000N"]
        for sym in candidates:
            await ws.send(
                json.dumps(
                    {
                        "ticks_history": sym,
                        "end": "latest",
                        "count": 5,
                        "style": "ticks",
                    }
                )
            )
            r = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
            err = r.get("error")
            if err:
                print(sym, "ERR", err.get("message") or err)
            else:
                hist = r.get("history") or {}
                prices = hist.get("prices") or []
                print(sym, "OK", "n=", len(prices), "last=", prices[-1] if prices else None)


asyncio.run(main())
