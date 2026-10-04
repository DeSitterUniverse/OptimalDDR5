from __future__ import annotations

import json
import argparse
import sys
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]
CONFIG_DIR = ROOT / "config"
PUBLIC_DATA_DIR = ROOT / "frontend" / "public" / "data"

CONFIG_FILES = (
    "timing_definitions",
    "timing_aliases",
    "timing_reference_ranges",
    "die_profiles",
    "platform_profiles",
    "voltage_profiles",
    "power_model",
    "example_profiles",
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate the browser database from YAML.")
    parser.add_argument("--check", action="store_true", help="Fail if committed JSON is stale.")
    args = parser.parse_args()
    sys.path.insert(0, str(ROOT / "src"))
    from optimalddr5.data.loader import load_database
    load_database()  # Validate the database before writing any output.
    PUBLIC_DATA_DIR.mkdir(parents=True, exist_ok=True)
    stale = []
    for name in CONFIG_FILES:
        source = CONFIG_DIR / f"{name}.yaml"
        target = PUBLIC_DATA_DIR / f"{name}.json"
        with source.open("r", encoding="utf-8") as handle:
            data = yaml.safe_load(handle) or {}
        rendered = json.dumps(data, separators=(",", ":"))
        if args.check:
            if not target.exists() or target.read_text(encoding="utf-8") != rendered:
                stale.append(str(target.relative_to(ROOT)))
            continue
        target.write_text(rendered, encoding="utf-8")
        print(f"wrote {target.relative_to(ROOT)}")
    if stale:
        parser.exit(1, "Stale generated data: " + ", ".join(stale) + "\nRun python scripts/build_static_data.py\n")


if __name__ == "__main__":
    main()
