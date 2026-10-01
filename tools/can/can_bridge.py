"""
GarudaTwin CAN bridge: CAN bus -> DBC decode -> gateway live ingest (POST /api/ingest/frames).

The same code reads a real adapter or python-can's software "virtual" bus:

  # Real hardware (examples; needs the adapter's driver):
  python tools/can/can_bridge.py --interface pcan --channel PCAN_USBBUS1 --bitrate 500000
  python tools/can/can_bridge.py --interface socketcan --channel can0

  # No hardware: a virtual engine rig replays a CSV as CAN frames onto a virtual bus in this process
  python tools/can/can_bridge.py --interface virtual --demo-csv ai_health_rul/tests/fixtures/sim_episodes.csv --episode 47

Before starting, switch the gateway to the LIVE source (the bridge does this with --set-live).
Frames are only forwarded when every engine message (0x100-0x330, 7 messages) has arrived
since the previous frame, so channels from different engine cycles are never mixed. If a message
stops arriving, no frames are sent and the gateway reports NO_DATA after 2 s.
"""
import argparse
import csv
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import can
import cantools

ROOT = Path(__file__).resolve().parents[2]
DBC_DEFAULT = Path(__file__).with_name("garudatwin_engine.dbc")
CHANNELS = ["rpm", "throttle", "egt1", "egt2", "egt3", "egt4", "cht1", "cht2", "cht3", "cht4",
            "map_bar", "oil_pressure", "oil_temp", "vibration", "fuel_flow", "lambda",
            "gen_voltage", "gen_current", "coolant_temp",
            "inj_pw_ms", "fuel_trim_pct", "battery_current_a", "battery_soc_pct", "ambient_pressure_bar", "oat_c"]


def ingest_key(cli_key):
    if cli_key:
        return cli_key
    if os.environ.get("GCS_INGEST_KEY"):
        return os.environ["GCS_INGEST_KEY"]
    f = ROOT / "data" / "service.json"
    if f.exists():
        return json.loads(f.read_text(encoding="utf-8")).get("ingestKey")
    sys.exit("No ingest key: pass --key, set GCS_INGEST_KEY, or start the gateway once so data/service.json exists")


def post_json(url, body, key=None):
    headers = {"Content-Type": "application/json"}
    if key:
        headers["X-Ingest-Key"] = key
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


class FrameAssembler:
    """Collects decoded signals; emits a complete engine frame once every message has been seen."""

    def __init__(self, db):
        self.db = db
        self.ids = {m.frame_id for m in db.messages}
        self.values, self.seen, self.last_ts = {}, set(), None
        self.unknown = 0

    def feed(self, msg):
        if msg.arbitration_id not in self.ids:
            self.unknown += 1
            return None
        self.values.update(self.db.decode_message(msg.arbitration_id, msg.data))
        self.seen.add(msg.arbitration_id)
        if self.seen != self.ids:
            return None
        self.seen = set()
        ts = msg.timestamp
        if self.last_ts is not None and ts <= self.last_ts:
            ts = self.last_ts + 1e-3          # keep the time base strictly increasing
        self.last_ts = ts
        return {"t_s": round(ts, 6), **{c: float(self.values[c]) for c in CHANNELS}}


def virtual_rig(bus, db, csv_path, episode, stop):
    """Plays CSV rows as CAN frames at their recorded spacing (a stand-in for an engine ECU)."""
    with open(csv_path, newline="", encoding="utf-8") as fh:
        rows = [r for r in csv.DictReader(fh) if episode is None or r.get("episode") == str(episode)]
    if not rows:
        print(f"[rig] no rows (episode {episode})", flush=True)
        stop.set()
        return
    print(f"[rig] sending {len(rows)} rows from {csv_path}" + (f" episode {episode}" if episode is not None else ""), flush=True)
    t_prev = None
    for r in rows:
        if stop.is_set():
            return
        t = float(r["t_s"])
        if t_prev is not None and t > t_prev:
            time.sleep(min(5.0, t - t_prev))
        t_prev = t
        for m in db.messages:
            data = m.encode({s.name: float(r[s.name]) for s in m.signals})
            bus.send(can.Message(arbitration_id=m.frame_id, data=data, is_extended_id=False))
    print("[rig] finished", flush=True)
    time.sleep(1.0)
    stop.set()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--interface", default="virtual", help="python-can interface: virtual, pcan, kvaser, socketcan, ...")
    ap.add_argument("--channel", default="garudatwin", help="adapter channel (e.g. PCAN_USBBUS1, can0)")
    ap.add_argument("--bitrate", type=int, default=None)
    ap.add_argument("--dbc", default=str(DBC_DEFAULT))
    ap.add_argument("--gateway", default="http://127.0.0.1:5002")
    ap.add_argument("--key", default=None, help="ingest key (default: GCS_INGEST_KEY or data/service.json)")
    ap.add_argument("--batch-s", type=float, default=0.5, help="post accumulated frames every N seconds")
    ap.add_argument("--set-live", action="store_true", help="switch the gateway data source to LIVE first")
    ap.add_argument("--demo-csv", default=None, help="virtual engine rig: replay this CSV as CAN frames")
    ap.add_argument("--episode", default=None, help="with --demo-csv: only this episode")
    args = ap.parse_args()

    db = cantools.database.load_file(args.dbc)
    key = ingest_key(args.key)
    if args.set_live:
        st, body = post_json(f"{args.gateway}/api/source", {"mode": "LIVE"})
        print(f"[bridge] gateway source -> {body.get('mode', body)} (HTTP {st})", flush=True)

    kw = {"interface": args.interface, "channel": args.channel}
    if args.bitrate:
        kw["bitrate"] = args.bitrate
    rx = can.Bus(**kw, receive_own_messages=False) if args.interface == "virtual" else can.Bus(**kw)
    stop = threading.Event()
    tx = None
    if args.demo_csv:
        if args.interface != "virtual":
            sys.exit("--demo-csv only runs on the virtual interface (it must not transmit onto a real bus)")
        tx = can.Bus(interface="virtual", channel=args.channel)
        threading.Thread(target=virtual_rig, args=(tx, db, args.demo_csv, args.episode, stop), daemon=True).start()

    asm, batch, last_post = FrameAssembler(db), [], time.monotonic()
    sent = rejected = 0
    print(f"[bridge] listening on {args.interface}:{args.channel} -> {args.gateway}/api/ingest/frames", flush=True)
    try:
        while not stop.is_set():
            msg = rx.recv(timeout=0.1)
            if msg is not None:
                frame = asm.feed(msg)
                if frame:
                    batch.append(frame)
            if batch and (time.monotonic() - last_post >= args.batch_s or len(batch) >= 50):
                st, body = post_json(f"{args.gateway}/api/ingest/frames", {"frames": batch[:50]}, key)
                sent += body.get("accepted", 0)
                rejected += body.get("rejected", 0)
                if st != 200 or body.get("rejected"):
                    print(f"[bridge] HTTP {st}: {body}", flush=True)
                batch, last_post = batch[50:], time.monotonic()
    except KeyboardInterrupt:
        pass
    finally:
        if batch:
            st, body = post_json(f"{args.gateway}/api/ingest/frames", {"frames": batch[:50]}, key)
            sent += body.get("accepted", 0)
        rx.shutdown()
        if tx is not None:
            tx.shutdown()
        print(f"[bridge] frames accepted by gateway: {sent}, rejected: {rejected}, unknown CAN ids: {asm.unknown}", flush=True)


if __name__ == "__main__":
    main()
