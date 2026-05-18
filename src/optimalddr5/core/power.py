from __future__ import annotations

from typing import Any

from .models import HeatLevel, MemoryProfile, PowerEstimate


def estimate_power(profile: MemoryProfile, die_profile: dict[str, Any] | float, power_config: dict) -> PowerEstimate:
    # DIMM heat is driven mostly by voltage, IC family, density, and module design.
    # Timings stay out of this model because their power effect is much smaller.
    voltages = profile.voltages
    weights = power_config.get("effective_voltage_weights", {"VDD": 0.6, "VDDQ": 0.4})
    floors = power_config.get("voltage_floors", {})
    fallback = float(power_config.get("reference_voltage", 1.35))
    weighted = 0.0
    total_weight = 0.0
    for key, weight in weights.items():
        value = voltages.get(key, floors.get(key))
        if value is not None:
            weighted += float(value) * float(weight)
            total_weight += float(weight)
    effective_voltage = weighted / total_weight if total_weight else fallback

    die_id = _die_id(die_profile)
    calibration = _die_calibration(die_id, power_config)
    reference_voltage = float(calibration.get("reference_voltage", power_config.get("reference_voltage", 1.35)))
    voltage_exponent = float(calibration.get("voltage_exponent", power_config.get("voltage_exponent", 2.0)))
    capacity_exponent = float(calibration.get("capacity_exponent", power_config.get("capacity_exponent", 0.7)))
    frequency_exponent = float(calibration.get("frequency_exponent", power_config.get("frequency_exponent", 0.0)))
    reference_mtps = float(calibration.get("reference_mtps", power_config.get("reference_mtps", profile.mtps)))
    reference_capacity = float(calibration.get("reference_capacity_gb_per_dimm", 16))
    base_peak = float(calibration.get("peak_watts_per_dimm", _base_power(profile, power_config)))
    thermal_multiplier = float(calibration.get("thermal_multiplier", _thermal_multiplier(die_profile)))

    per_dimm_capacity = profile.capacity_total_gb / profile.dimm_count
    voltage_multiplier = (effective_voltage / reference_voltage) ** voltage_exponent
    capacity_multiplier = max(0.25, per_dimm_capacity / reference_capacity) ** capacity_exponent
    frequency_multiplier = (float(profile.mtps) / reference_mtps) ** frequency_exponent if reference_mtps else 1.0
    estimated = base_peak * voltage_multiplier * capacity_multiplier * frequency_multiplier * thermal_multiplier
    total = estimated * profile.dimm_count
    heat_level = _heat_level(estimated, power_config.get("heat_thresholds_w_per_dimm", {}))
    return PowerEstimate(
        estimated_power_per_dimm_watts=round(estimated, 2),
        estimated_total_power_watts=round(total, 2),
        heat_level=heat_level,
        effective_voltage=round(effective_voltage, 3),
        heat_basis="single_dimm_peak",
        notes=[
            "Heat level is based on estimated peak watts for one DIMM.",
            "The model uses VDD/VDDQ, die family, and module capacity; timing effects are intentionally not modeled.",
        ],
    )


def _base_power(profile: MemoryProfile, power_config: dict) -> float:
    per_dimm_capacity = profile.capacity_total_gb / profile.dimm_count
    buckets = power_config.get("base_power_per_dimm_watts", {})
    best_key = "default"
    for key in buckets:
        if key == "default":
            continue
        try:
            if per_dimm_capacity <= float(key.replace("gb", "")):
                best_key = key
                break
        except ValueError:
            continue
    return float(buckets.get(best_key, buckets.get("default", 3.5)))


def _die_id(die_profile: dict[str, Any] | float) -> str:
    if isinstance(die_profile, dict):
        return str(die_profile.get("die_id") or "default")
    return "default"


def _die_calibration(die_id: str, power_config: dict) -> dict[str, Any]:
    profiles = power_config.get("die_power_profiles", {})
    return profiles.get(die_id) or profiles.get("default", {})


def _thermal_multiplier(die_profile: dict[str, Any] | float) -> float:
    if isinstance(die_profile, dict):
        return float(die_profile.get("thermal_factor", die_profile.get("efficiency_factor", 1.0)))
    return float(die_profile)


def _heat_level(watts_per_dimm: float, thresholds: dict) -> HeatLevel:
    if watts_per_dimm < float(thresholds.get("moderate_min", 3.0)):
        return HeatLevel.LOW
    if watts_per_dimm < float(thresholds.get("high_min", 5.0)):
        return HeatLevel.MODERATE
    if watts_per_dimm < float(thresholds.get("extreme_min", 7.0)):
        return HeatLevel.HIGH
    return HeatLevel.EXTREME
