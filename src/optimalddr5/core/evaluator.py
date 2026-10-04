from __future__ import annotations

from typing import Any
import math

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
from optimalddr5.core.recommendations import build_recommendations, category_scores, likely_bottlenecks, mean_score


def evaluate_profile(profile: MemoryProfile, db: dict[str, Any]) -> EvaluationResult:
    profile = profile.model_copy(deep=True)
    aliases = {**{alias: key for key, definition in db["timing_definitions"].items() for alias in [key, *definition.aliases]}, **db["timing_aliases"]}
    timings = normalize_timing_keys(profile.timings, aliases)
    profile.timings = timings

    die = db["die_profiles"].get(profile.die_id)
    platform = db["platform_profiles"].get(profile.platform_id)
    if platform is None or (die is None and profile.die_id != "unknown"):
        raise ValueError("Unknown platform or die; select a supported platform and known or unknown die")
    if any(key not in db["timing_definitions"] for key in timings):
        raise ValueError("Unrecognized timing field")
    if any(key not in db["voltage_profiles"] for key in profile.voltages):
        raise ValueError("Unrecognized voltage field")
    timing_results = [
        evaluate_timing(defn, profile.timings.get(timing_id), profile.mtps, die.timing_ranges if die else {}, db["timing_reference_ranges"])
        for timing_id, defn in db["timing_definitions"].items()
    ]
    apply_timing_rule_notes(timing_results, profile.timings)
    voltage_results = [
        evaluate_voltage(vdef, profile.voltages.get(voltage_id), platform.platform_id, {})
        for voltage_id, vdef in db["voltage_profiles"].items()
        if platform.platform_id in vdef.platform_scope or "all" in vdef.platform_scope
    ]
    power = estimate_power(profile, die.model_dump() if die else {"die_id": "unknown"}, db["power_model"])
    platform_notes = platform_caveats(profile, platform.quirks)
    cat_scores = category_scores(timing_results)
    known_scores = [r.headroom_score for r in timing_results if r.classification != Classification.UNKNOWN]
    overall = mean_score(known_scores)
    voltage_pressure = round(
        sum(1.0 if v.risk_level == "high" else 0.55 if v.risk_level == "elevated" else 0.0 for v in voltage_results)
        / max(len(voltage_results), 1),
        2,
    )
    recommendations = build_recommendations(timing_results, voltage_results, platform_notes)
    bottlenecks = likely_bottlenecks(timing_results, voltage_results, platform_notes, power.heat_level.value)
    sources = dedupe_sources([*(die.sources if die else []), *platform.sources, *[s for v in db["voltage_profiles"].values() for s in v.sources]])
    return EvaluationResult(
        profile=profile,
        summary={
            "platform": platform.display_name,
            "die": f"{die.vendor} {die.generation_or_revision}" if die else "Unknown unconfirmed die",
            "mtps": profile.mtps,
            "dimm_count": profile.dimm_count,
            "channel_count": profile.channel_count,
            "capacity_total_gb": profile.capacity_total_gb,
            "rank": profile.rank,
            "command_rate": profile.command_rate,
            "uclk_mclk_mode": profile.uclk_mclk_mode or infer_uclk_mode(profile),
        },
        timing_results=timing_results,
        latency_estimates=timing_estimates(timings, profile.mtps, profile.channel_count),
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
        canonical = alias_map.get(key.strip().lower(), key)
        if canonical in normalized and normalized[canonical] != value:
            raise ValueError(f"Conflicting values for {canonical}")
        normalized[canonical] = value
    return normalized


def evaluate_timing(
    definition: TimingDefinition,
    cycles: int | float | None,
    mtps: int,
    die_ranges: dict[str, Any],
    reference_ranges: dict[str, Any],
) -> TimingResult:
    source_confidence = "unknown"
    notes = [*definition.dependency_notes, *definition.platform_notes]
    range_data, range_note = recommended_range(die_ranges, mtps, definition.timing_id, definition.lower_is_better)
    floor_range = scaled_range(reference_ranges["ranges"].get(definition.timing_id), reference_ranges["reference_mtps"], mtps, definition.lower_is_better)
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
            target_cycles=target_from_range(range_data or floor_range, definition.lower_is_better) if (range_data or floor_range) else None,
            floor_cycles=target_from_range(floor_range, definition.lower_is_better) if floor_range else None,
            recommended_cycles=target_from_range(range_data or floor_range, definition.lower_is_better) if (range_data or floor_range) else None,
            headroom_cycles=None,
            notes=["Missing timing; not scored.", *notes],
            source_confidence=source_confidence,
        )
    if range_note:
        notes.insert(0, range_note)
    if not range_data:
        notes.insert(0, "No die-specific range; using a low-confidence community comparison, not a JEDEC floor.")
    range_data = range_data or floor_range
    classification, score, target_cycles, headroom_cycles = classify_value(float(cycles), range_data, definition.lower_is_better)
    if range_data:
        source_confidence = range_data.get("confidence", "medium")
    else:
        notes.insert(0, "No die/frequency range in database; value converted but not scored.")
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
        floor_cycles=target_from_range(floor_range, definition.lower_is_better) if floor_range else None,
        recommended_cycles=target_cycles,
        headroom_cycles=headroom_cycles,
        notes=notes,
        source_confidence=source_confidence,
    )


def scaled_range(data: dict | None, source: int, target: int, lower_is_better: bool | str) -> dict | None:
    if data is None:
        return None
    result = dict(data)
    if lower_is_better is not False and source != target:
        result["confidence"] = "low"
        for band in ("tight", "moderate", "loose", "very_loose"):
            if data.get(band):
                result[band] = [max(0, math.floor(float(v) * target / source + 0.5)) for v in data[band]]
    return result


def recommended_range(die_ranges: dict, mtps: int, timing_id: str, lower_is_better: bool | str) -> tuple[dict | None, str | None]:
    buckets = {int(key): value for key, value in die_ranges.get("by_frequency", {}).items()}
    available = sorted(key for key, value in buckets.items() if timing_id in value)
    if not available:
        return None, None
    if mtps in available:
        return buckets[mtps][timing_id], None
    lower = max((key for key in available if key < mtps), default=None)
    higher = min((key for key in available if key > mtps), default=None)
    if lower is not None and higher is not None:
        low, high = buckets[lower][timing_id], buckets[higher][timing_id]
        if lower_is_better is False:
            result = dict(low if mtps - lower <= higher - mtps else high)
        else:
            result = dict(low)
            ratio = (mtps - lower) / (higher - lower)
            for band in ("tight", "moderate", "loose", "very_loose"):
                if low.get(band) and high.get(band):
                    result[band] = [math.floor(float(v) + (float(high[band][i]) - float(v)) * ratio + 0.5) for i, v in enumerate(low[band])]
            ranks = {"high": 3, "medium": 2, "low": 1}
            result["confidence"] = min(("medium", low.get("confidence", "low"), high.get("confidence", "low")), key=lambda key: ranks.get(key, 1))
        return result, f"Die recommendation interpolated between {lower} and {higher} MT/s."
    nearest = min(available, key=lambda key: abs(key - mtps))
    return scaled_range(buckets[nearest][timing_id], nearest, mtps, lower_is_better), f"Die recommendation scaled from {nearest} MT/s."


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
    return "Unknown; verify after training"


def dedupe_sources(sources: list[SourceRef]) -> list[SourceRef]:
    seen = set()
    result = []
    for source in sources:
        if source.url not in seen:
            seen.add(source.url)
            result.append(source)
    return result
