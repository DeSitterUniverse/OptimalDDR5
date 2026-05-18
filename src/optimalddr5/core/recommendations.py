from __future__ import annotations

from .models import Classification, TimingResult, VoltageResult


def category_scores(timing_results: list[TimingResult]) -> dict[str, float]:
    buckets: dict[str, list[float]] = {}
    for result in timing_results:
        buckets.setdefault(result.category, []).append(result.headroom_score)
    return {category: round(sum(values) / len(values), 2) for category, values in buckets.items() if values}


def likely_bottlenecks(
    timing_results: list[TimingResult],
    voltage_results: list[VoltageResult],
    platform_notes: list[str],
    power_heat_level: str,
) -> list[str]:
    categories = category_scores(timing_results)
    bottlenecks = [category for category, score in categories.items() if score >= 0.55]
    if any(v.risk_level in {"elevated", "high"} for v in voltage_results) or power_heat_level in {"high", "extreme"}:
        bottlenecks.append("voltage/heat risk")
    if platform_notes:
        bottlenecks.append("frequency/IMC/platform limit")
    order = ["primary", "refresh", "secondary", "tertiary", "frequency/IMC/platform limit", "voltage/heat risk"]
    return [item for item in order if item in bottlenecks]


def build_recommendations(
    timing_results: list[TimingResult],
    voltage_results: list[VoltageResult],
    platform_notes: list[str],
) -> list[str]:
    recommendations: list[str] = []
    loose = [
        t for t in timing_results if t.classification in {Classification.LOOSE, Classification.VERY_LOOSE}
    ]
    tight = [t for t in timing_results if t.classification == Classification.TIGHT]
    for result in sorted(loose, key=lambda r: r.headroom_score, reverse=True)[:5]:
        recommendations.append(
            f"{result.display_name} appears {result.classification.value} for this die/frequency class. "
            f"Investigate {result.category} timings before chasing unrelated settings."
        )
    if tight:
        names = ", ".join(t.display_name for t in tight[:4])
        recommendations.append(f"Already-tight timings: {names}. Expect limited obvious headroom there.")
    elevated = [v for v in voltage_results if v.risk_level in {"elevated", "high"}]
    for voltage in elevated[:3]:
        recommendations.append(
            f"{voltage.display_name} looks {voltage.risk_level}. Treat this as voltage pressure, not proof of danger."
        )
    for note in platform_notes[:3]:
        recommendations.append(note)
    if not recommendations:
        recommendations.append("No obvious loose timing range was found. Add more timings or refine die/platform data.")
    recommendations.append("Keep stability testing separate; this app only organizes timing math and peer-range context.")
    return recommendations
