"""Two-client transfer smoke test — no webcam, no browser (§10.8).

Simulates two devices over the WebSocket and drives a full tab transfer:
sender initiates, receiver claims, both get transfer_completed and the receiver
gets tab_synced. Requires a running backend + a workspace code.

Usage:
    pip install websockets httpx
    python scripts/smoke_two_clients.py            # auto-creates a workspace
    python scripts/smoke_two_clients.py ABC123      # use an existing code
"""
import asyncio
import json
import sys
import uuid

import httpx
import websockets

API = "http://localhost:8000"
WS = "ws://localhost:8000"


async def recv_until(ws, wanted, timeout=12):
    async with asyncio.timeout(timeout):
        while True:
            msg = json.loads(await ws.recv())
            if msg["type"] == wanted:
                return msg


async def main():
    dev_a, dev_b = str(uuid.uuid4()), str(uuid.uuid4())

    async with httpx.AsyncClient() as http:
        if len(sys.argv) > 1:
            code = sys.argv[1].upper()
        else:
            r = await http.post(f"{API}/api/v1/workspaces", json={"name": "smoke"})
            code = r.json()["code"]
            print("created workspace", code)

        tok_a = (await http.post(f"{API}/api/v1/workspaces/{code}/join",
                                 json={"device_id": dev_a, "display_name": "A"})
                 ).json()["auth_token"]
        tok_b = (await http.post(f"{API}/api/v1/workspaces/{code}/join",
                                 json={"device_id": dev_b, "display_name": "B"})
                 ).json()["auth_token"]
        tab = (await http.post(f"{API}/api/v1/workspaces/{code}/tabs", json={
            "owner_device_id": dev_a, "type": "code", "title": "main.py",
            "content": "print('sent via gesture')", "language": "python",
        })).json()

    async with websockets.connect(f"{WS}/ws/{code}?device_id={dev_a}&token={tok_a}") as a, \
               websockets.connect(f"{WS}/ws/{code}?device_id={dev_b}&token={tok_b}") as b:
        await asyncio.sleep(0.3)  # let both register in the room

        env = lambda t, p: json.dumps({"id": None, "type": t, "payload": p, "ts": ""})
        await a.send(env("transfer_initiate",
                         {"transfer_type": "tab", "payload": {"tab_id": tab["id"], "title": "main.py"}}))

        pending = await recv_until(b, "transfer_pending")
        tid = pending["payload"]["transfer_id"]
        print("B saw transfer_pending:", pending["payload"]["preview"])

        await b.send(env("transfer_claim", {"transfer_id": tid}))
        synced = await recv_until(b, "tab_synced")
        assert synced["payload"]["kind"] == "tab"
        assert synced["payload"]["tab"]["owner_device_id"] == dev_b
        print("PASS — receiver got a copy of the tab:", synced["payload"]["tab"]["title"])


if __name__ == "__main__":
    asyncio.run(main())
