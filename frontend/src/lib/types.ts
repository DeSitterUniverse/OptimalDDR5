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
  die_profiles: Record<string, any>;
  platform_profiles: Record<string, any>;
  voltage_profiles: Record<string, any>;
  example_profiles: MemoryProfile[];
  files: string[];
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
