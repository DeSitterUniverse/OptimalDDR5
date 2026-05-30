from __future__ import annotations

import json
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]
CONFIG_DIR = ROOT / "config"
PUBLIC_DATA_DIR = ROOT / "frontend" / "public" / "data"

CONFIG_FILES = (
    "timing_definitions",
    "timing_aliases",
    "die_profiles",
    "platform_profiles",
    "voltage_profiles",
    "power_model",
    "example_profiles",
)


def main() -> None:
    PUBLIC_DATA_DIR.mkdir(parents=True, exist_ok=True)
    for name in CONFIG_FILES:
        source = CONFIG_DIR / f"{name}.yaml"
        target = PUBLIC_DATA_DIR / f"{name}.json"
        with source.open("r", encoding="utf-8") as handle:
            data = yaml.safe_load(handle) or {}
        target.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
        print(f"wrote {target.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
