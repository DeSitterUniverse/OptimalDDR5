from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class Classification(StrEnum):
    TIGHT = "tight"
    MODERATE = "moderate"
    LOOSE = "loose"
    VERY_LOOSE = "very loose"
    UNKNOWN = "unknown"


class HeatLevel(StrEnum):
    LOW = "low"
    MODERATE = "moderate"
    HIGH = "high"
    EXTREME = "extreme"


class SourceRef(BaseModel):
    url: str
    source_name: str
    source_tier: int = Field(ge=1, le=3)
    confidence: str
    notes: str = ""
    date_checked: str


class RangeBand(BaseModel):
    tight: tuple[float, float] | None = None
    moderate: tuple[float, float] | None = None
    loose: tuple[float, float] | None = None
    very_loose: tuple[float, float] | None = None


class TimingDefinition(BaseModel):
    timing_id: str
    display_name: str
    aliases: list[str] = Field(default_factory=list)
    category: str
    unit_input: str = "cycles"
    convertible_to_ns: bool = True
    definition: str
    performance_relevance: str = ""
    stability_relevance: str = ""
    importance: str = "medium"
    lower_is_better: bool | str = True
    safe_notes: list[str] = Field(default_factory=list)
    dependency_notes: list[str] = Field(default_factory=list)
    platform_notes: list[str] = Field(default_factory=list)
    bios_aliases: list[str] = Field(default_factory=list)
    related_timings: list[str] = Field(default_factory=list)


class DieProfile(BaseModel):
    die_id: str
    vendor: str
    generation_or_revision: str
    density_gbit: int | None = None
    common_module_capacities: list[str] = Field(default_factory=list)
    typical_strengths: list[str] = Field(default_factory=list)
    typical_weaknesses: list[str] = Field(default_factory=list)
    frequency_behavior: str = ""
    timing_behavior: str = ""
    voltage_behavior: str = ""
    thermal_behavior: str = ""
    efficiency_factor: float = 1.0
    thermal_factor: float = 1.0
    confidence: str = "medium"
    timing_ranges: dict[str, Any] = Field(default_factory=dict)
    voltage_ranges: dict[str, Any] = Field(default_factory=dict)
    sources: list[SourceRef] = Field(default_factory=list)


class PlatformProfile(BaseModel):
    platform_id: str
    display_name: str
    vendor: str
    supported_notes: list[str] = Field(default_factory=list)
    known_memory_modes: list[str] = Field(default_factory=list)
    common_frequency_zones: list[str] = Field(default_factory=list)
    imc_limit_notes: list[str] = Field(default_factory=list)
    voltage_controls: list[str] = Field(default_factory=list)
    quirks: list[str] = Field(default_factory=list)
    timing_alias_behavior: list[str] = Field(default_factory=list)
    recommended_testing_notes: list[str] = Field(default_factory=list)
    sources: list[SourceRef] = Field(default_factory=list)


class VoltageDefinition(BaseModel):
    voltage_id: str
    display_name: str
    aliases: list[str] = Field(default_factory=list)
    platform_scope: list[str] = Field(default_factory=list)
    description: str = ""
    affects: list[str] = Field(default_factory=list)
    typical_stock_range: tuple[float, float] | None = None
    typical_daily_tuned_range: tuple[float, float] | None = None
    aggressive_range: tuple[float, float] | None = None
    platform_ranges: dict[str, dict[str, tuple[float, float]]] = Field(default_factory=dict)
    danger_notes: list[str] = Field(default_factory=list)
    heat_impact: str = "medium"
    confidence: str = "medium"
    sources: list[SourceRef] = Field(default_factory=list)


class MemoryProfile(BaseModel):
    model_config = ConfigDict(extra="allow")

    profile_name: str = "Manual profile"
    platform_id: str = "ryzen_am5_zen4"
    bios_version: str | None = None
    die_id: str = "jedec_generic"
    mtps: int = Field(gt=0, default=6000)
    uclk_mclk_mode: str | None = None
    capacity_total_gb: int = Field(gt=0, default=32)
    dimm_count: int = Field(gt=0, default=2)
    rank: str | None = None
    command_rate: str | None = None
    voltages: dict[str, float | None] = Field(default_factory=dict)
    timings: dict[str, int | float | None] = Field(default_factory=dict)

    @field_validator("timings", "voltages")
    @classmethod
    def normalize_keys(cls, value: dict[str, Any]) -> dict[str, Any]:
        return {str(k).strip(): v for k, v in value.items() if v not in ("", None)}


class TimingResult(BaseModel):
    timing_id: str
    display_name: str
    aliases: list[str]
    category: str
    cycles: float | None
    ns: float | None
    definition: str
    importance: str
    classification: Classification
    headroom_score: float
    target_cycles: float | None = None
    headroom_cycles: float | None = None
    notes: list[str] = Field(default_factory=list)
    source_confidence: str = "unknown"


class VoltageResult(BaseModel):
    voltage_id: str
    display_name: str
    value: float | None
    classification: Classification
    risk_level: str
    notes: list[str] = Field(default_factory=list)


class PowerEstimate(BaseModel):
    estimated_power_per_dimm_watts: float
    estimated_total_power_watts: float
    heat_level: HeatLevel
    effective_voltage: float
    heat_basis: str = "single_dimm_peak"
    notes: list[str]


class EvaluationResult(BaseModel):
    profile: MemoryProfile
    summary: dict[str, Any]
    timing_results: list[TimingResult]
    latency_estimates: dict[str, float | None]
    category_headroom: dict[str, float]
    overall_headroom_score: float
    voltage_results: list[VoltageResult]
    voltage_pressure_score: float
    power_estimate: PowerEstimate
    platform_notes: list[str]
    recommendations: list[str]
    bottleneck_categories: list[str]
    sources: list[SourceRef]
