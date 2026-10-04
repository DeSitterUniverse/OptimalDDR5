import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from optimalddr5.api.main import app
from optimalddr5.core.evaluator import evaluate_profile
from optimalddr5.core.hwinfo_report_log import parse_hwinfo_log
from optimalddr5.core.models import MemoryProfile
from optimalddr5.data.loader import load_database


@pytest.mark.parametrize("channels,dimms,bandwidth", [(1, 1, 48), (1, 2, 48), (2, 2, 96), (2, 4, 96)])
def test_populated_channels_determine_bandwidth(channels, dimms, bandwidth):
    result = evaluate_profile(MemoryProfile(channel_count=channels, dimm_count=dimms), load_database())
    assert result.latency_estimates["theoretical_bandwidth_gbps"] == bandwidth


@pytest.mark.parametrize("patch", [
    {"mtps": 0}, {"mtps": 6000.5}, {"dimm_count": 0}, {"channel_count": 2, "dimm_count": 1},
    {"timings": {"tCL": -1}}, {"timings": {"tCL": 30.5}}, {"voltages": {"VDD": float("nan")}},
    {"voltages": {"VDD": float("inf")}}, {"profile_name": "  "},
])
def test_invalid_profile_inputs_are_rejected(patch):
    with pytest.raises(ValidationError):
        MemoryProfile(**patch)


def test_evaluation_does_not_modify_input_or_guess_missing_values():
    profile = MemoryProfile(timings={"tCL": 30})
    original = profile.model_dump()
    result = evaluate_profile(profile, load_database())
    assert profile.model_dump() == original
    assert result.profile.timings == {"tCL": 30}
    assert result.summary["die"] == "Unknown unconfirmed die"
    assert result.latency_estimates["trcd_ns"] is None
    assert result.category_headroom == {"primary": 0.05}


def test_hwinfo_import_bounds_current_section_and_discards_stale_timings(tmp_path: Path):
    report = tmp_path / "memory.log"
    report.write_text("""Memory --------------------
Current Memory Clock: 4200 MHz
Current Timing (tCAS-tRCD-tRP-tRAS): 40-50-50-100
Row: 1 [BANK 0]
SDRAM Manufacturer: Samsung
Module Density: 16384 Mb
[Intel Extreme Memory Profile (XMP)]
tCL: 32
tREFI: 65535
Sensors --------------------
tRFC: 999
""", encoding="utf-16")
    base = MemoryProfile(timings={"tRCDRD": 30, "tREFI": 12345}, voltages={"VDD": 1.35}, validation_status="passed")
    result = parse_hwinfo_log(report, base)
    assert result.mtps == 8400
    assert result.timings["tRCDRD"] == 50
    assert result.timings["tCL"] == 40
    assert "tREFI" not in result.timings
    assert "tRFC" not in result.timings
    assert result.platform_id == base.platform_id
    assert result.die_id == "unknown"
    assert result.voltages == base.voltages
    assert result.validation_status == "untested"
    assert base.validation_status == "passed"


def test_import_does_not_read_sensor_section(tmp_path: Path):
    report = tmp_path / "memory.log"
    report.write_text("---------- Memory ----------\ntCL: 30\n---------- Sensors ----------\ntRFC: 800\n", encoding="utf-8")
    assert parse_hwinfo_log(report).timings == {"tCL": 30}


def test_import_supported_secondary_fields_and_reject_fractional_cycles(tmp_path: Path):
    report = tmp_path / "memory.log"
    report.write_text("Memory ----------\ntREFI: 50000\ntRFC2: 400\ntRFC_sb: 300\ntCWL: 28\ntWRPRE: 90\nWrite to Write Delay (tWRWR_SD) Same DIMM: 12T\n", encoding="utf-8")
    profile = parse_hwinfo_log(report)
    assert profile.timings == {"tREFI": 50000, "tRFC2": 400, "tRFCsb": 300, "tCWL": 28, "tWRPRE": 90}
    evaluate_profile(profile, load_database())
    report.write_text("Memory ----------\ntCL: 30.5\n", encoding="utf-8")
    with pytest.raises(ValueError, match="whole cycle"):
        parse_hwinfo_log(report)


def test_timing_aliases_require_equivalent_values():
    db = load_database()
    assert evaluate_profile(MemoryProfile(timings={"CL": 30}), db).profile.timings == {"tCL": 30}
    with pytest.raises(ValueError, match="Conflicting"):
        evaluate_profile(MemoryProfile(timings={"CL": 30, "tCL": 36}), db)
    with pytest.raises(ValueError, match="Unrecognized"):
        evaluate_profile(MemoryProfile(timings={"tREFIx9": 1000}), db)


def test_invalid_import_and_unknown_platform_are_client_errors():
    client = TestClient(app)
    assert client.post("/api/import/hwinfo", files={"file": ("sensors.log", "CPU temperature: 55 C")}).status_code == 422
    assert client.post("/api/import/hwinfo", files={"file": ("report.log", "Memory ----------\ntCL: 30")}, data={"profile_json": "{"}).status_code == 422
    assert client.post("/api/evaluate", json=MemoryProfile(platform_id="missing").model_dump()).status_code == 422
    assert client.post("/api/evaluate", json=MemoryProfile(timings={"madeup": 30}).model_dump()).status_code == 422
    assert client.get("/api/config").json()["timing_reference_ranges"]["reference_mtps"] == 6000


def test_all_generated_data_matches_yaml():
    import yaml
    root = Path(__file__).resolve().parents[1]
    for source in (root / "config").glob("*.yaml"):
        generated = root / "frontend/public/data" / f"{source.stem}.json"
        assert json.loads(generated.read_text(encoding="utf-8")) == yaml.safe_load(source.read_text(encoding="utf-8"))
