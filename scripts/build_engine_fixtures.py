"""Generate calculation fixtures for the browser/Python parity tests."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from optimalddr5.core.evaluator import evaluate_profile
from optimalddr5.core.models import MemoryProfile
from optimalddr5.data.loader import load_database


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    db = load_database()
    profiles = [MemoryProfile(**raw) for raw in db["example_profiles"]]
    profiles.append(MemoryProfile(profile_name="Unknown single-DIMM blank", dimm_count=1))
    for index, die_id in enumerate(db["die_profiles"]):
        profiles.append(MemoryProfile(
            profile_name=f"Parity {die_id}", die_id=die_id,
            platform_id="raptor_lake_ddr5" if index % 2 else "ryzen_am5_zen4",
            mtps=7200 if index % 2 else 5600,
            timings={"tCL": 34, "tRCDRD": 42, "tRP": 42, "tRAS": 80, "tRC": 122,
                     "tCWL": 32, "tRFC": 700, "tREFI": 32768, "tWRRD": 20, "tPPD": 0},
            voltages={"VDD": 1.45, "VDDQ": 1.42, "SoC": 1.3, "CPU_VDDQ": 1.4},
        ))
    fields = ("timing_id", "cycles", "ns", "classification", "headroom_score", "target_cycles", "floor_cycles", "recommended_cycles", "headroom_cycles", "source_confidence")
    fixtures = []
    for profile in profiles:
        result = evaluate_profile(profile, db).model_dump(mode="json")
        fixtures.append({"input": profile.model_dump(mode="json"), "expected": {
            "timing_results": [{key: row[key] for key in fields} for row in result["timing_results"]],
            "latency_estimates": result["latency_estimates"],
            "category_headroom": result["category_headroom"],
            "overall_headroom_score": result["overall_headroom_score"],
            "voltage_results": [{key: row[key] for key in ("voltage_id", "value", "classification", "risk_level")} for row in result["voltage_results"]],
            "power_estimate": {key: value for key, value in result["power_estimate"].items() if key != "notes"},
        }})
    target = ROOT / "frontend/src/lib/engine-fixtures.json"
    rendered = json.dumps(fixtures, separators=(",", ":")) + "\n"
    if args.check:
        if not target.exists() or target.read_text(encoding="utf-8") != rendered:
            parser.exit(1, "Engine fixtures are stale. Run python scripts/build_engine_fixtures.py\n")
    else:
        target.write_text(rendered, encoding="utf-8")
        print(f"Wrote {len(fixtures)} engine parity cases")


if __name__ == "__main__":
    main()
