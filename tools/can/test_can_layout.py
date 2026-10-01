"""
CAN layout tests: the DBC matches the gateway's encoder, edge values survive the round trip,
the bridge only forwards complete frames, and CAN quantisation does not change AI diagnoses.
Run: ai_venv/Scripts/python -m pytest tools/can -q
"""
import json
import sys
from pathlib import Path

import can
import cantools
import pandas as pd
import pytest

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT))
from can_bridge import CHANNELS, FrameAssembler  # noqa: E402

DB = cantools.database.load_file(str(HERE / "garudatwin_engine.dbc"))
ENGINE_FIELD = {"rpm": "rpm", "throttle": "throttlePct", "fuel_flow": "fuelFlowLph", "lambda": "lambda",
                "map_bar": "mapBar", "oil_pressure": "oilPressBar", "oil_temp": "oilTempC", "vibration": "vibrationGrms",
                "gen_voltage": "genVoltageV", "gen_current": "genCurrentA", "coolant_temp": "coolantTempC",
                "inj_pw_ms": "injPulseMs", "fuel_trim_pct": "fuelTrimPct", "battery_current_a": "batteryCurrentA",
                "battery_soc_pct": "batterySocPct", "ambient_pressure_bar": "ambientPressureBar", "oat_c": "oatC"}
SCALE = {s.name: s.scale for m in DB.messages for s in m.signals}


def engine_value(engine, name):
    if name[:3] in ("egt", "cht") and name[3:].isdigit():
        return engine[name[:3]][int(name[3:]) - 1]
    return engine[ENGINE_FIELD[name]]


def test_dbc_covers_every_model_channel_once():
    names = [s.name for m in DB.messages for s in m.signals]
    assert sorted(names) == sorted(CHANNELS)
    assert {m.frame_id for m in DB.messages} == {0x100, 0x200, 0x210, 0x300, 0x310, 0x320, 0x330}


def test_dbc_decodes_gateway_frames_within_half_lsb():
    frames = json.loads((HERE / "fixtures" / "gateway_frames.json").read_text())["frames"]
    assert frames
    for fr in frames:
        decoded = {}
        for c in fr["can"]:
            decoded.update(DB.decode_message(int(c["canId"], 16), bytes.fromhex(c["rawHex"])))
        for name in CHANNELS:
            err = abs(decoded[name] - engine_value(fr["engine"], name))
            assert err <= SCALE[name] / 2 + 1e-9, (name, decoded[name], engine_value(fr["engine"], name))


@pytest.mark.parametrize("values", [
    {"gen_voltage": 22.1, "gen_current": -12.34, "coolant_temp": -20.0},   # discharge current, cold soak
    {"gen_voltage": 28.4, "gen_current": 45.2, "coolant_temp": 88.5},
])
def test_signed_and_offset_signals_round_trip(values):
    m = DB.get_message_by_frame_id(0x310)
    out = m.decode(m.encode(values))
    for k, v in values.items():
        assert abs(out[k] - v) <= SCALE[k] / 2 + 1e-9
    lube = DB.get_message_by_frame_id(0x300)
    out = lube.decode(lube.encode({"map_bar": 0.8, "oil_pressure": 0.0, "oil_temp": -25.0, "vibration": 3.2}))
    assert abs(out["oil_temp"] + 25.0) < 0.006


def _msgs(row, ts):
    return [can.Message(arbitration_id=m.frame_id, data=m.encode({s.name: row[s.name] for s in m.signals}),
                        timestamp=ts, is_extended_id=False) for m in DB.messages]


NOMINAL = {"rpm": 4800, "throttle": 78.5, "egt1": 842, "egt2": 840, "egt3": 844, "egt4": 841, "cht1": 106, "cht2": 107,
           "cht3": 105, "cht4": 108, "map_bar": 1.42, "oil_pressure": 3.85, "oil_temp": 98.4, "vibration": 0.28,
           "fuel_flow": 26.4, "lambda": 0.94, "gen_voltage": 28.4, "gen_current": 45.2, "coolant_temp": 88.5,
           "inj_pw_ms": 14.35, "fuel_trim_pct": 0.0, "battery_current_a": 1.0, "battery_soc_pct": 98.0,
           "ambient_pressure_bar": 0.5834, "oat_c": -13.7}


def test_bridge_emits_only_complete_frames_with_increasing_time():
    asm = FrameAssembler(DB)
    msgs = _msgs(NOMINAL, 10.0)
    assert all(asm.feed(m) is None for m in msgs[:-1])          # incomplete -> nothing
    frame = asm.feed(msgs[-1])
    assert frame and frame["t_s"] == 10.0 and abs(frame["egt3"] - 844) < 0.06
    # a missing message in the next cycle blocks the frame (no mixing across cycles)
    nxt = _msgs({**NOMINAL, "egt3": 900}, 11.0)
    assert all(asm.feed(m) is None for m in nxt if m.arbitration_id != 0x200)
    assert asm.feed(nxt[1]) is not None                          # 0x200 completes it
    # unknown ids are counted, never decoded
    assert asm.feed(can.Message(arbitration_id=0x7FF, data=b"\0" * 8, timestamp=12.0)) is None
    assert asm.unknown == 1
    # equal timestamps are made strictly increasing (the gateway rejects non-increasing t_s)
    for m in _msgs(NOMINAL, 11.0)[:-1]:
        asm.feed(m)
    f2 = asm.feed(_msgs(NOMINAL, 11.0)[-1])
    assert f2["t_s"] > 11.0


def test_can_quantisation_does_not_change_diagnoses():
    """Score unseen fixture episodes with all channels, raw and after a DBC encode/decode.

    Measured with the current models: 4,836 / 4,838 diagnoses identical (99.96 %); the two that differ
    are consecutive samples just after a fault was cleared, where the model sits at its decision
    threshold. Required here: >= 99.5 % identical.
    """
    import warnings
    warnings.filterwarnings("ignore")
    from ai_health_rul.services.health_rul_service import HealthRulService
    df = pd.read_csv(ROOT / "ai_health_rul" / "tests" / "fixtures" / "sim_episodes.csv", low_memory=False)
    eps = [g.episode.iloc[0] for _, g in df.groupby("fault_class")][:8]
    signals = [s.name for m in DB.messages for s in m.signals]

    def payload(r, uav):
        p = {k: float(r[k]) for k in signals if k[:3] not in ("egt", "cht")}
        p["egt"] = [float(r[f"egt{i}"]) for i in range(1, 5)]
        p["cht"] = [float(r[f"cht{i}"]) for i in range(1, 5)]
        p["sim_time_s"], p["uav_id"] = float(r["t_s"]), uav
        return p

    svc = HealthRulService()
    n = same = 0
    for ep in eps:
        for _, r in df[df.episode == ep].iterrows():
            q = {}
            for m in DB.messages:
                q.update(m.decode(m.encode({s.name: float(r[s.name]) for s in m.signals})))
            q["t_s"] = r["t_s"]
            a = svc.predict(payload(r, f"raw{ep}")).health.diagnosed_fault
            b = svc.predict(payload(q, f"can{ep}")).health.diagnosed_fault
            n += 1
            same += a == b
    assert n > 300 and same / n >= 0.995, f"{same}/{n} identical"
