from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from optimalddr5.core.models import DieProfile, PlatformProfile, TimingDefinition, VoltageDefinition


ROOT = Path(__file__).resolve().parents[3]
CONFIG_DIR = ROOT / "config"


class ConfigError(RuntimeError):
    def __init__(self, file: Path, message: str) -> None:
        super().__init__(f"{file.name}: {message}")
        self.file = file
        self.message = message


def read_yaml(path: Path) -> dict[str, Any]:
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        raise ConfigError(path, str(exc)) from exc
    if not isinstance(data, dict):
        raise ConfigError(path, "YAML root must be a mapping")
    return data


@lru_cache(maxsize=1)
def load_database() -> dict[str, Any]:
    # Keep tuning knowledge in YAML so range edits do not require code changes.
    timing_defs_raw = read_yaml(CONFIG_DIR / "timing_definitions.yaml").get("timings", {})
    die_raw = read_yaml(CONFIG_DIR / "die_profiles.yaml").get("die_profiles", {})
    platform_raw = read_yaml(CONFIG_DIR / "platform_profiles.yaml").get("platform_profiles", {})
    voltage_raw = read_yaml(CONFIG_DIR / "voltage_profiles.yaml").get("voltages", {})
    aliases = read_yaml(CONFIG_DIR / "timing_aliases.yaml").get("aliases", {})
    power_model = read_yaml(CONFIG_DIR / "power_model.yaml")
    examples = read_yaml(CONFIG_DIR / "example_profiles.yaml").get("profiles", [])

    try:
        timing_definitions = {
            key: TimingDefinition(timing_id=key, **value) for key, value in timing_defs_raw.items()
        }
        die_profiles = {key: DieProfile(die_id=key, **value) for key, value in die_raw.items()}
        platform_profiles = {
            key: PlatformProfile(platform_id=key, **value) for key, value in platform_raw.items()
        }
        voltage_profiles = {
            key: VoltageDefinition(voltage_id=key, **value) for key, value in voltage_raw.items()
        }
    except Exception as exc:  # noqa: BLE001
        raise ConfigError(CONFIG_DIR, str(exc)) from exc

    return {
        "timing_definitions": timing_definitions,
        "die_profiles": die_profiles,
        "platform_profiles": platform_profiles,
        "voltage_profiles": voltage_profiles,
        "timing_aliases": aliases,
        "power_model": power_model,
        "example_profiles": examples,
    }


def reload_database() -> dict[str, Any]:
    load_database.cache_clear()
    return load_database()
