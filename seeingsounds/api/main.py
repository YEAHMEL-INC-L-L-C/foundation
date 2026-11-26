"""Seeing Sounds web server for Google Cloud Run.

GET  /             the React app (built into dist/ by `npm run build`)
POST /api/analyze  math_engine.py report for the uploaded audio
POST /api/visual   visual_engine.py color and motion frames for the uploaded audio
GET  /api/health   liveness check

Audio is sent as the raw request body (WAV, FLAC, OGG or MP3), of any size.
The upload is written to a temporary file, read once as mono audio, and the
file is deleted before the math runs. Nothing is kept after the response.

Cloud Run caps HTTP/1 request bodies at 32 MiB, so deploy with --use-http2
(the container serves HTTP/2 cleartext through Hypercorn). See docs/cloud-run.md.
"""
import os
import sys
import tempfile
from pathlib import Path

from fastapi import FastAPI, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import math_engine  # noqa: E402
import visual_engine  # noqa: E402

# Optional upload cap in bytes; 0 (the default) means no limit.
MAX_BODY_BYTES = int(os.environ.get("MAX_BODY_BYTES", "0"))
DIST_DIR = Path(os.environ.get("DIST_DIR", ROOT / "dist"))

app = FastAPI(title="Seeing Sounds", docs_url="/api/docs", openapi_url="/api/openapi.json")


def _error(status, message):
    return JSONResponse({"error": message}, status_code=status)


def _too_large():
    return _error(413, f"This file is larger than this server allows ({MAX_BODY_BYTES:,} bytes).")


async def _read_mono(request: Request):
    """Stream the body to a temporary file, then read it as mono audio.

    Returns ((mono, sample_rate), None) or (None, error_response).
    """
    declared = request.headers.get("content-length")
    if MAX_BODY_BYTES and declared and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        return None, _too_large()
    with tempfile.NamedTemporaryFile(suffix=".audio") as tmp:
        size = 0
        async for chunk in request.stream():
            size += len(chunk)
            if MAX_BODY_BYTES and size > MAX_BODY_BYTES:
                return None, _too_large()
            tmp.write(chunk)
        if not size:
            return None, _error(400, "Send the audio file as the request body.")
        tmp.flush()
        try:
            audio = await run_in_threadpool(math_engine.read_mono, tmp.name)
        except Exception as exc:  # soundfile raises several types for unreadable audio
            return None, _error(400, f"Could not read this audio: {exc}")
    return audio, None


@app.get("/api/health")
def health():
    return {"ok": True, "service": "seeing-sounds", "runtime": "python"}


@app.post("/api/analyze")
async def analyze(
    request: Request,
    filename: str = Query("uploaded.wav", max_length=255),
    hop_ms: float = Query(50, gt=5, le=500),
    include_series: bool = False,
    include_visual: bool = Query(False, description="Also return the /api/visual frames, so one upload does both."),
    fps: int = Query(visual_engine.DEFAULT_FPS, ge=10, le=60),
):
    audio, err = await _read_mono(request)
    if err:
        return err
    mono, sr = audio

    def work():
        report = math_engine.analyze_samples(mono, sr, filename, hop_ms, include_series)
        if include_visual:
            report["visual"] = visual_engine.visual_report(mono, sr, fps)
        return report

    return await run_in_threadpool(work)


@app.post("/api/visual")
async def visual(request: Request, fps: int = Query(visual_engine.DEFAULT_FPS, ge=10, le=60)):
    audio, err = await _read_mono(request)
    if err:
        return err
    mono, sr = audio
    return await run_in_threadpool(visual_engine.visual_report, mono, sr, fps)


@app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
def api_not_found(rest: str):
    return _error(404, "Not found.")


if DIST_DIR.is_dir():
    app.mount("/", StaticFiles(directory=DIST_DIR, html=True), name="app")
