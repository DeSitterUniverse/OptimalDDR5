from __future__ import annotations

from typing import Any

from optimalddr5.core.formulas import timing_estimates, timing_ns
from optimalddr5.core.models import (
    Classification,
    EvaluationResult,
    MemoryProfile,
    SourceRef,
    TimingDefinition,
    TimingResult,
    VoltageDefinition,
    VoltageResult,
)
from optimalddr5.core.power import estimate_power
from optimalddr5.core.recommendations import build_recommendations, category_scores, likely_bottlenecks


DEFAULT_TIMINGS: dict[str, float] = {
    "tCL": 36,
    "tRCD": 36,
    "tRCDRD": 36,
    "tRCDWR": 36,
    "tRP": 36,
    "tRAS": 72,
    "tRC": 108,
    "tRFC": 480,
    "tRFC2": 320,
    "tRFCsb": 260,
    "tREFI": 32768,
    "tRRDS": 4,
    "tRRDL": 8,
    "tFAW": 16,
    "tWR": 54,
    "tWTRS": 8,
    "tWTRL": 20,
    "tRTP": 14,
    "tCWL": 34,
    "tCKE": 8,
    "tMOD": 48,
    "tXP": 8,
    "tXS": 216,
    "tXSDLL": 768,
    "tWRRD": 48,
    "tWRRDSG": 64,
    "tWRRDDG": 48,
    "tWRWR": 14,
    "tWRWRSG": 14,
    "tWRWRDG": 8,
    "tRDRD": 14,
    "tRDRDSG": 14,
    "tRDRDDG": 8,
    "tRDRDSD": 14,
    "tRDRDDD": 16,
    "tWRPRE": 110,
    "tRDPRE": 12,
    "tPPD": 0,
}


def evaluate_profile(profile: MemoryProfile, db: dict[str, Any]) -> EvaluationResult:
    aliases = db["timing_aliases"]
    timings = normalize_timing_keys(profile.timings, aliases)
    profile.timings = timings

    die = db["die_profiles"].get(profile.die_id) or db["die_profiles"]["jedec_generic"]
    platform = db["platform_profiles"].get(profile.platform_id) or next(iter(db["platform_profiles"].values()))
    apply_profile_defaults(profile, db, die.timing_ranges)
    timing_results = [
        evaluate_timing(defn, profile.timings.get(timing_id), profile.mtps, die.timing_ranges)
        for timing_id, defn in db["timing_definitions"].items()
    ]
    apply_timing_rule_notes(timing_results, profile.timings)
    voltage_results = [
        evaluate_voltage(vdef, profile.voltages.get(voltage_id), platform.platform_id, die.voltage_ranges)
        for voltage_id, vdef in db["voltage_profiles"].items()
        if platform.platform_id in vdef.platform_scope or "all" in vdef.platform_scope
    ]
    power = estimate_power(profile, die.model_dump(), db["power_model"])
    platform_notes = platform_caveats(profile, platform.quirks)
    cat_scores = category_scores(timing_results)
    known_scores = [r.headroom_score for r in timing_results if r.classification != Classification.UNKNOWN]
    overall = round(sum(known_scores) / len(known_scores), 2) if known_scores else 0.0
    voltage_pressure = round(
        sum(1.0 if v.risk_level == "high" else 0.55 if v.risk_level == "elevated" else 0.0 for v in voltage_results)
        / max(len(voltage_results), 1),
        2,
    )
    recommendations = build_recommendations(timing_results, voltage_results, platform_notes)
    bottlenecks = likely_bottlenecks(timing_results, voltage_results, platform_notes, power.heat_level.value)
    sources = dedupe_sources([*die.sources, *platform.sources, *[s for v in db["voltage_profiles"].values() for s in v.sources]])
    return EvaluationResult(
        profile=profile,
        summary={
            "platform": platform.display_name,
            "die": f"{die.vendor} {die.generation_or_revision}",
            "mtps": profile.mtps,
            "dimm_count": profile.dimm_count,
            "capacity_total_gb": profile.capacity_total_gb,
            "rank": profile.rank,
            "command_rate": profile.command_rate,
            "uclk_mclk_mode": profile.uclk_mclk_mode or infer_uclk_mode(profile),
        },
        timing_results=timing_results,
        latency_estimates=timing_estimates(timings, profile.mtps),
        category_headroom=cat_scores,
        overall_headroom_score=overall,
        voltage_results=voltage_results,
        voltage_pressure_score=voltage_pressure,
        power_estimate=power,
        platform_notes=platform_notes,
        recommendations=recommendations,
        bottleneck_categories=bottlenecks,
        sources=sources,
    )


def normalize_timing_keys(timings: dict[str, int | float | None], aliases: dict[str, str]) -> dict[str, int | float]:
    normalized: dict[str, int | float] = {}
    alias_map = {k.lower(): v for k, v in aliases.items()}
    for key, value in timings.items():
        if value is None:
            continue
        canonical = alias_map.get(key.lower(), key)
        normalized[canonical] = value
    return normalized


def evaluate_timing(
    definition: TimingDefinition,
    cycles: int | float | None,
    mtps: int,
    die_ranges: dict[str, Any],
) -> TimingResult:
    source_confidence = "unknown"
    notes = [*definition.dependency_notes, *definition.platform_notes]
    if cycles is None:
        return TimingResult(
            timing_id=definition.timing_id,
            display_name=definition.display_name,
            aliases=definition.aliases,
            category=definition.category,
            cycles=None,
            ns=None,
            definition=definition.definition,
            importance=definition.importance,
            classification=Classification.UNKNOWN,
            headroom_score=0.0,
            target_cycles=None,
            headroom_cycles=None,
            notes=["Missing timing; not scored.", *notes],
            source_confidence=source_confidence,
        )
    range_data = nearest_frequency_ranges(die_ranges, mtps).get(definition.timing_id)
    classification, score, target_cycles, headroom_cycles = classify_value(float(cycles), range_data, definition.lower_is_better)
    if range_data:
        source_confidence = range_data.get("confidence", "medium")
    else:
        notes.insert(0, "No die/frequency range in database; value converted but not scored.")
    target_cycles = target_cycles if target_cycles is not None else DEFAULT_TIMINGS.get(definition.timing_id)
    headroom_cycles = (
        headroom_cycles
        if headroom_cycles is not None
        else headroom_from_target(float(cycles), target_cycles, definition.lower_is_better)
    )
    return TimingResult(
        timing_id=definition.timing_id,
        display_name=definition.display_name,
        aliases=definition.aliases,
        category=definition.category,
        cycles=float(cycles),
        ns=None if not definition.convertible_to_ns else round(timing_ns(cycles, mtps) or 0.0, 3),
        definition=definition.definition,
        importance=definition.importance,
        classification=classification,
        headroom_score=score,
        target_cycles=target_cycles,
        headroom_cycles=headroom_cycles,
        notes=notes,
        source_confidence=source_confidence,
    )


def nearest_frequency_ranges(die_ranges: dict[str, Any], mtps: int) -> dict[str, Any]:
    buckets = die_ranges.get("by_frequency", {})
    if not buckets:
        return {}
    nearest = min(buckets.keys(), key=lambda key: abs(int(key) - int(mtps)))
    return buckets.get(nearest, {})


def classify_value(
    value: float,
    range_data: dict[str, Any] | None,
    lower_is_better: bool | str,
) -> tuple[Classification, float, float | None, float | None]:
    if not range_data:
        return Classification.UNKNOWN, 0.0, None, None
    target = target_from_range(range_data, lower_is_better)
    headroom = headroom_from_target(value, target, lower_is_better)
    bands = ["tight", "moderate", "loose", "very_loose"]
    for band in bands:
        bounds = range_data.get(band)
        if bounds and float(bounds[0]) <= value <= float(bounds[1]):
            return (
                Classification(band.replace("_", " ")),
                {"tight": 0.05, "moderate": 0.3, "loose": 0.65, "very_loose": 0.9}[band],
                target,
                headroom,
            )
    if lower_is_better is False:
        if value < float(range_data.get("moderate", [value, value])[0]):
            return Classification.LOOSE, 0.6, target, headroom
        return Classification.UNKNOWN, 0.0, target, headroom
    lowest = range_data.get("tight", [value, value])[0]
    highest = range_data.get("loose", range_data.get("moderate", [value, value]))[1]
    if value < float(lowest):
        return Classification.TIGHT, 0.05, target, headroom
    if value > float(highest):
        return Classification.VERY_LOOSE, 0.9, target, headroom
    return Classification.UNKNOWN, 0.0, target, headroom


def target_from_range(range_data: dict[str, Any], lower_is_better: bool | str) -> float | None:
    tight = range_data.get("tight")
    if not tight:
        return None
    if lower_is_better is False:
        return float(tight[1])
    return float(tight[0])


def headroom_from_target(value: float, target: float | None, lower_is_better: bool | str) -> float | None:
    if target is None:
        return None
    if lower_is_better is False:
        return max(0.0, target - value)
    return max(0.0, value - target)


def apply_profile_defaults(profile: MemoryProfile, db: dict[str, Any], die_ranges: dict[str, Any]) -> None:
    for voltage_id, definition in db["voltage_profiles"].items():
        if voltage_id not in profile.voltages and definition.typical_stock_range:
            profile.voltages[voltage_id] = float(definition.typical_stock_range[0])
    ranges = nearest_frequency_ranges(die_ranges, profile.mtps)
    missing_tcwl = "tCWL" not in profile.timings
    missing_trc = "tRC" not in profile.timings
    for timing_id, definition in db["timing_definitions"].items():
        if timing_id in profile.timings:
            continue
        value = default_timing_cycles(ranges.get(timing_id), definition.lower_is_better)
        profile.timings[timing_id] = value if value is not None else DEFAULT_TIMINGS.get(timing_id, 0)
    apply_default_timing_rules(profile.timings, missing_tcwl=missing_tcwl, missing_trc=missing_trc)


def apply_default_timing_rules(timings: dict[str, int | float], *, missing_tcwl: bool, missing_trc: bool) -> None:
    tcl = timings.get("tCL")
    if tcl is not None and missing_tcwl:
        timings["tCWL"] = max(0, float(tcl) - 2)
    tras = timings.get("tRAS")
    trp = timings.get("tRP")
    if tras is not None and trp is not None and missing_trc:
        timings["tRC"] = float(tras) + float(trp)


def default_timing_cycles(range_data: dict[str, Any] | None, lower_is_better: bool | str) -> float | None:
    if not range_data:
        return None
    if range_data.get("moderate"):
        return float(range_data["moderate"][0])
    if range_data.get("tight"):
        return float(range_data["tight"][1] if lower_is_better is False else range_data["tight"][0])
    return None


def evaluate_voltage(
    definition: VoltageDefinition,
    value: float | None,
    platform_id: str,
    die_voltage_ranges: dict[str, Any],
) -> VoltageResult:
    if value is None:
        return VoltageResult(
            voltage_id=definition.voltage_id,
            display_name=definition.display_name,
            value=None,
            classification=Classification.UNKNOWN,
            risk_level="unknown",
            notes=["Not entered."],
        )
    ranges = _platform_voltage_ranges(definition, platform_id)
    stock = ranges.get("low") or definition.typical_stock_range
    daily = ranges.get("average") or _die_or_default_range(definition.voltage_id, die_voltage_ranges, "daily_typical") or definition.typical_daily_tuned_range
    aggressive = ranges.get("elevated") or _die_or_default_range(definition.voltage_id, die_voltage_ranges, "aggressive") or definition.aggressive_range
    notes = [*definition.danger_notes]
    if stock and value < stock[0]:
        return _voltage_result(definition, value, Classification.UNKNOWN, "low", ["Below the comparison floor for this field.", *notes])
    if stock and stock[0] <= value <= stock[1]:
        return _voltage_result(definition, value, Classification.TIGHT, "low", notes)
    if daily and daily[0] <= value <= daily[1]:
        return _voltage_result(definition, value, Classification.MODERATE, "average", notes)
    if aggressive and aggressive[0] <= value <= aggressive[1]:
        return _voltage_result(definition, value, Classification.LOOSE, "elevated", notes)
    if aggressive and value > aggressive[1]:
        return _voltage_result(definition, value, Classification.VERY_LOOSE, "high", notes)
    return _voltage_result(definition, value, Classification.UNKNOWN, "unknown", notes)


def _voltage_result(
    definition: VoltageDefinition,
    value: float,
    classification: Classification,
    risk_level: str,
    notes: list[str],
) -> VoltageResult:
    return VoltageResult(
        voltage_id=definition.voltage_id,
        display_name=definition.display_name,
        value=value,
        classification=classification,
        risk_level=risk_level,
        notes=notes,
    )


def _die_or_default_range(voltage_id: str, ranges: dict[str, Any], bucket: str) -> tuple[float, float] | None:
    values = ranges.get(bucket, {}).get(voltage_id)
    return tuple(values) if values else None


def _platform_voltage_ranges(definition: VoltageDefinition, platform_id: str) -> dict[str, tuple[float, float]]:
    ranges = definition.platform_ranges.get(platform_id)
    if ranges:
        return ranges
    if "am5" in platform_id:
        return definition.platform_ranges.get("amd_am5", {})
    if any(token in platform_id for token in ("alder", "raptor", "arrow")):
        return definition.platform_ranges.get("intel_ddr5", {})
    return {}


def apply_timing_rule_notes(results: list[TimingResult], timings: dict[str, int | float]) -> None:
    # These are common DDR5 consistency checks, not hard stability claims.
    by_id = {row.timing_id: row for row in results}
    tcl = timings.get("tCL")
    tcwl = timings.get("tCWL")
    if tcl is not None and tcwl is not None and "tCWL" in by_id:
        expected = max(0, float(tcl) - 2)
        delta = float(tcwl) - expected
        if delta == 0:
            by_id["tCWL"].notes.insert(0, "Matches the common DDR5 starting point: tCWL = tCL - 2.")
        elif delta > 0:
            by_id["tCWL"].notes.insert(0, f"Common starting point is tCWL = tCL - 2 ({expected:g}); this value is {delta:g} cycles higher.")
        else:
            by_id["tCWL"].notes.insert(0, f"This is below the common tCL - 2 starting point ({expected:g}); treat as stability-sensitive.")

    tras = timings.get("tRAS")
    trp = timings.get("tRP")
    trc = timings.get("tRC")
    if tras is not None and trp is not None and trc is not None and "tRC" in by_id:
        expected = float(tras) + float(trp)
        delta = float(trc) - expected
        if delta == 0:
            by_id["tRC"].notes.insert(0, "Matches tRAS + tRP.")
        elif delta > 0:
            by_id["tRC"].notes.insert(0, f"tRAS + tRP is {expected:g}; tRC is {delta:g} cycles above that floor.")
        else:
            by_id["tRC"].notes.insert(0, f"tRC is below tRAS + tRP ({expected:g}); verify how the board reports or derives it.")


def platform_caveats(profile: MemoryProfile, quirks: list[str]) -> list[str]:
    notes = list(quirks)
    if "am5" in profile.platform_id and profile.mtps > 6400:
        notes.insert(0, "AM5 above 6400 MT/s commonly needs checking whether UCLK stayed 1:1 or moved to 1:2.")
    if profile.dimm_count >= 4:
        notes.insert(0, "Four-DIMM layouts usually reduce frequency and timing expectations versus one-DIMM-per-channel kits.")
    if profile.capacity_total_gb >= 96:
        notes.insert(0, "High-capacity kits often need looser refresh, secondary, or training-related timings than 2x16 GB kits.")
    return notes


def infer_uclk_mode(profile: MemoryProfile) -> str:
    if "am5" not in profile.platform_id:
        return "not applicable / platform-specific"
    return "likely 1:1" if profile.mtps <= 6400 else "likely 1:2 or board-dependent"


def dedupe_sources(sources: list[SourceRef]) -> list[SourceRef]:
    seen = set()
    result = []
    for source in sources:
        if source.url not in seen:
            seen.add(source.url)
            result.append(source)
    return result
