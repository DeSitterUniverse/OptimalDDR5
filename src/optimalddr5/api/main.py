from __future__ import annotations

import tempfile
from pathlib import Path

import json

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from optimalddr5.core.evaluator import evaluate_profile
from optimalddr5.core.hwinfo_report_log import parse_hwinfo_log
from optimalddr5.core.models import MemoryProfile
from optimalddr5.data.loader import ConfigError, load_database, reload_database


app = FastAPI(title="OptimalDDR5 API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/config")
def config() -> dict:
    try:
        db = load_database()
    except ConfigError as exc:
        raise HTTPException(status_code=500, detail={"file": exc.file.name, "message": exc.message}) from exc
    return {
        "timing_definitions": {k: v.model_dump() for k, v in db["timing_definitions"].items()},
        "die_profiles": {k: v.model_dump() for k, v in db["die_profiles"].items()},
        "platform_profiles": {k: v.model_dump() for k, v in db["platform_profiles"].items()},
        "voltage_profiles": {k: v.model_dump() for k, v in db["voltage_profiles"].items()},
        "example_profiles": db["example_profiles"],
        "files": [
            "config/timing_definitions.yaml",
            "config/timing_aliases.yaml",
            "config/die_profiles.yaml",
            "config/platform_profiles.yaml",
            "config/voltage_profiles.yaml",
            "config/power_model.yaml",
            "config/example_profiles.yaml",
        ],
    }


@app.post("/api/reload-config")
def reload_config() -> dict:
    reload_database()
    return {"ok": True}


@app.post("/api/evaluate")
def evaluate(profile: MemoryProfile) -> dict:
    try:
        return evaluate_profile(profile, load_database()).model_dump()
    except ConfigError as exc:
        raise HTTPException(status_code=500, detail={"file": exc.file.name, "message": exc.message}) from exc


@app.post("/api/import/hwinfo")
async def import_hwinfo(file: UploadFile = File(...), profile_json: str | None = Form(default=None)) -> dict:
    content = await file.read()
    suffix = Path(file.filename or "memory.log").suffix or ".log"
    handle = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    path = Path(handle.name)
    handle.write(content)
    handle.close()
    try:
        base_profile = MemoryProfile(**json.loads(profile_json)) if profile_json else None
        profile = parse_hwinfo_log(path, base_profile=base_profile)
        result = evaluate_profile(profile, load_database())
        return {"profile": profile.model_dump(), "evaluation": result.model_dump()}
    finally:
        path.unlink(missing_ok=True)
