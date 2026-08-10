export type MemoryProfile = {
  profile_name: string;
  platform_id: string;
  bios_version?: string;
  die_id: string;
  mtps: number;
  uclk_mclk_mode?: string;
  capacity_total_gb: number;
  dimm_count: number;
  rank?: string;
  command_rate?: string;
  voltages: Record<string, number | undefined>;
  timings: Record<string, number | undefined>;
};

export type ConfigData = {
  timing_definitions: Record<string, any>;
  timing_aliases: Record<string, string>;
  die_profiles: Record<string, DieProfile>;
  platform_profiles: Record<string, any>;
  voltage_profiles: Record<string, any>;
  power_model: Record<string, any>;
  example_profiles: MemoryProfile[];
  files: string[];
};

export type OverclockingLimits = {
  research_status: string;
  evidence_quality: string;
  retail_profile_max_mtps?: number;
  documented_stable_max_mtps?: number;
  documented_benchmark_max_mtps?: number;
  daily_range_intel_mtps?: [number, number];
  daily_range_am5_mtps?: [number, number];
  tested_vdd_vddq_range?: [number, number];
  voltage_scaling: string;
  limit_basis: string;
  community_consensus: string;
  community_experiences: string[];
  caveats: string[];
  last_researched: string;
};

export type DieResearchSource = {
  url: string;
  source_name: string;
  source_tier: number;
  confidence: string;
  notes: string;
  date_checked: string;
};

export type DieProfile = {
  vendor: string;
  generation_or_revision: string;
  overclocking_limits: OverclockingLimits;
  sources: DieResearchSource[];
  [key: string]: any;
};

export type Evaluation = {
  profile: MemoryProfile;
  summary: Record<string, any>;
  timing_results: Array<Record<string, any>>;
  latency_estimates: Record<string, number | null>;
  category_headroom: Record<string, number>;
  overall_headroom_score: number;
  voltage_results: Array<Record<string, any>>;
  voltage_pressure_score: number;
  power_estimate: Record<string, any>;
  platform_notes: string[];
  recommendations: string[];
  bottleneck_categories: string[];
  sources: Array<Record<string, any>>;
};
