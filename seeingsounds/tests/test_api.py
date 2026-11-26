"""Tests for the Cloud Run API (api/main.py).

The parity tests compare the Python engines with the TypeScript ones that the
desktop and iOS app run, using the built-in sample track. They need Node.js
and the npm dependencies (`npm install`).
"""
import io
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from api import main

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="module")
def client():
    return TestClient(main.app)


@pytest.fixture(scope="module")
def snapshot(tmp_path_factory):
    if not shutil.which("npx"):
        pytest.skip("Node.js is needed to build the TypeScript snapshot")
    out = tmp_path_factory.mktemp("snapshot")
    subprocess.run(["npx", "tsx", "scripts/engine-snapshot.ts", str(out)], cwd=ROOT, check=True)
    return {
        "wav": (out / "sample.wav").read_bytes(),
        "analysis": json.loads((out / "analysis.json").read_text()),
        "visual": json.loads((out / "visual.json").read_text()),
    }


def post_audio(client, path, body, **params):
    return client.post(path, content=body, params=params, headers={"Content-Type": "audio/wav"})


def test_health(client):
    assert client.get("/api/health").json() == {"ok": True, "service": "seeing-sounds", "runtime": "python"}


def test_analyze_matches_typescript_engine(client, snapshot):
    res = post_audio(client, "/api/analyze", snapshot["wav"], filename="sample.wav")
    assert res.status_code == 200, res.text
    py, ts = res.json(), snapshot["analysis"]
    assert py["track"] == ts["track"]
    for key in ("bpm", "onsets", "dominant_pitch"):
        assert py["verified_math"][key] == ts["verified_math"][key]
    for note, value in ts["verified_math"]["chroma"].items():
        assert py["verified_math"]["chroma"][note] == pytest.approx(value, abs=2e-3)
    assert py["detailed"]["key"]["label"] == ts["detailed"]["key"]["label"]
    assert py["detailed"]["beat_grid"]["beats"] == ts["detailed"]["beat_grid"]["beats"]
    assert py["integrity"]["passed"] is True
    assert "series" not in py


def test_analyze_include_series(client, snapshot):
    res = post_audio(client, "/api/analyze", snapshot["wav"], include_series="true")
    series = res.json()["series"]
    assert set(series) == {"times", "rms", "centroid", "onset_times", "beat_times", "downbeat_times", "tension"}
    assert len(series["times"]) == len(series["rms"]) == len(series["tension"])


def test_visual_matches_typescript_engine(client, snapshot):
    res = post_audio(client, "/api/visual", snapshot["wav"])
    assert res.status_code == 200, res.text
    py, ts = res.json(), snapshot["visual"]
    assert (py["fps"], py["nf"]) == (ts["fps"], ts["nf"])
    assert py["palette"] == ts["palette"]
    for group in ("signals", "frames"):
        for key, ts_values in ts[group].items():
            py_values = py[group][key]
            assert len(py_values) == len(ts_values), key
            if key == "color":
                worst = max(abs(a - b) for pa, ta in zip(py_values, ts_values) for a, b in zip(pa, ta))
                assert worst <= 2, f"{group}.{key} differs by {worst}"
            else:
                worst = max(abs(a - b) for a, b in zip(py_values, ts_values))
                assert worst <= 2e-3, f"{group}.{key} differs by {worst}"


def test_visual_is_deterministic(client, snapshot):
    first = post_audio(client, "/api/visual", snapshot["wav"], fps=60).json()
    second = post_audio(client, "/api/visual", snapshot["wav"], fps=60).json()
    assert first == second
    assert first["fps"] == 60
    frames = first["frames"]
    assert all(0.0 <= v <= 1.0 for v in frames["orb_x"] + frames["orb_y"])
    assert all(len(c) == 3 and all(0 <= x <= 255 for x in c) for c in frames["color"])


def test_rejects_unreadable_audio(client):
    res = post_audio(client, "/api/analyze", b"not audio at all")
    assert res.status_code == 400
    assert "Could not read" in res.json()["error"]


def test_rejects_empty_body(client):
    assert post_audio(client, "/api/visual", b"").status_code == 400


def test_rejects_oversized_body(client, monkeypatch):
    monkeypatch.setattr(main, "MAX_BODY_BYTES", 10)
    res = post_audio(client, "/api/analyze", b"x" * 11)
    assert res.status_code == 413
    assert "larger than this server allows (10 bytes)" in res.json()["error"]


def test_unknown_api_path_is_json_404(client):
    res = client.get("/api/nope")
    assert res.status_code == 404
    assert res.json() == {"error": "Not found."}


def test_analyze_include_visual_matches_visual_endpoint(client, snapshot):
    combined = post_audio(client, "/api/analyze", snapshot["wav"], include_visual="true").json()
    alone = post_audio(client, "/api/visual", snapshot["wav"]).json()
    assert combined["visual"] == alone
    assert combined["verified_math"]["bpm"] == snapshot["analysis"]["verified_math"]["bpm"]


def test_stereo_24bit_wav(client, snapshot):
    """A stereo 24-bit WAV with the sample in both channels analyzes like the mono sample."""
    mono, sr = sf.read(io.BytesIO(snapshot["wav"]), dtype="float64")
    buf = io.BytesIO()
    sf.write(buf, np.stack([mono, mono], axis=1), sr, format="WAV", subtype="PCM_24")
    res = post_audio(client, "/api/analyze", buf.getvalue(), filename="stereo24.wav", include_visual="true")
    assert res.status_code == 200, res.text
    body, ts = res.json(), snapshot["analysis"]
    assert body["track"] == {"file": "stereo24.wav", "sr": sr, "duration_sec": ts["track"]["duration_sec"]}
    for key in ("bpm", "onsets", "dominant_pitch"):
        assert body["verified_math"][key] == ts["verified_math"][key]
    assert body["visual"]["nf"] == snapshot["visual"]["nf"]


def test_no_upload_limit_by_default():
    assert main.MAX_BODY_BYTES == 0
