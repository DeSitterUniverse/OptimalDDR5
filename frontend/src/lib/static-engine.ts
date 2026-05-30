import type { ConfigData, Evaluation, MemoryProfile } from "./types";

type TimingDefinition = Record<string, any>;
type TimingResult = Record<string, any>;

const CONFIG_FILES = [
  "timing_definitions",
  "timing_aliases",
  "die_profiles",
  "platform_profiles",
  "voltage_profiles",
  "power_model",
  "example_profiles"
] as const;
const COMMON_DIE_IDS = new Set([
  "hynix_16g_m_die",
  "hynix_16g_a_die",
  "hynix_24g_m_die",
  "samsung_16g_early",
  "micron_16g_early",
  "jedec_generic"
]);

const DEFAULT_TIMINGS: Record<string, number> = {
  tCL: 36,
  tRCD: 36,
  tRCDRD: 36,
  tRCDWR: 36,
  tRP: 36,
  tRAS: 72,
  tRC: 108,
  tRFC: 560,
  tRFC2: 420,
  tRFCsb: 320,
  tREFI: 32768,
  tRRDS: 8,
  tRRDL: 12,
  tFAW: 32,
  tWR: 48,
  tWTRS: 8,
  tWTRL: 16,
  tRTP: 12,
  tCWL: 34,
  tCKE: 8,
  tMOD: 48,
  tXP: 8,
  tXS: 216,
  tXSDLL: 768,
  tWRRD: 12,
  tWRRDSG: 64,
  tWRRDDG: 48,
  tWRWR: 12,
  tWRWRSG: 12,
  tWRWRDG: 8,
  tRDRD: 12,
  tRDRDSG: 12,
  tRDRDDG: 8,
  tRDRDSD: 12,
  tRDRDDD: 16,
  tWRPRE: 96,
  tRDPRE: 12,
  tPPD: 0
};
const GENERAL_RANGE_REFERENCE_MTPS = 6000;

const GENERAL_DDR5_RANGES: Record<string, any> = {
  tCL: { tight: [28, 36], moderate: [38, 42], loose: [44, 52], confidence: "low" },
  tRCD: { tight: [34, 42], moderate: [44, 50], loose: [52, 64], confidence: "low" },
  tRCDRD: { tight: [34, 42], moderate: [44, 50], loose: [52, 64], confidence: "low" },
  tRCDWR: { tight: [30, 42], moderate: [44, 50], loose: [52, 64], confidence: "low" },
  tRP: { tight: [34, 42], moderate: [44, 50], loose: [52, 64], confidence: "low" },
  tRAS: { tight: [28, 80], moderate: [81, 104], loose: [105, 132], confidence: "low" },
  tRC: { tight: [64, 124], moderate: [125, 156], loose: [157, 192], confidence: "low" },
  tRFC: { tight: [420, 620], moderate: [621, 820], loose: [821, 1100], confidence: "low" },
  tRFC2: { tight: [300, 480], moderate: [481, 640], loose: [641, 900], confidence: "low" },
  tRFCsb: { tight: [220, 380], moderate: [381, 520], loose: [521, 760], confidence: "low" },
  tREFI: { tight: [50000, 65535], moderate: [32768, 49999], loose: [7800, 32767], confidence: "low" },
  tRRDS: { tight: [4, 8], moderate: [9, 12], loose: [13, 20], confidence: "low" },
  tRRDL: { tight: [8, 12], moderate: [13, 18], loose: [19, 28], confidence: "low" },
  tFAW: { tight: [16, 32], moderate: [33, 48], loose: [49, 64], confidence: "low" },
  tWR: { tight: [24, 56], moderate: [57, 72], loose: [73, 96], confidence: "low" },
  tWTRS: { tight: [4, 8], moderate: [9, 14], loose: [15, 24], confidence: "low" },
  tWTRL: { tight: [12, 24], moderate: [25, 36], loose: [37, 56], confidence: "low" },
  tRTP: { tight: [8, 16], moderate: [17, 24], loose: [25, 36], confidence: "low" },
  tCWL: { tight: [26, 36], moderate: [38, 44], loose: [46, 56], confidence: "low" },
  tCKE: { tight: [4, 8], moderate: [9, 12], loose: [13, 20], confidence: "low" },
  tMOD: { tight: [24, 48], moderate: [49, 64], loose: [65, 96], confidence: "low" },
  tXP: { tight: [4, 8], moderate: [9, 12], loose: [13, 20], confidence: "low" },
  tXS: { tight: [160, 260], moderate: [261, 380], loose: [381, 560], confidence: "low" },
  tXSDLL: { tight: [512, 768], moderate: [769, 1024], loose: [1025, 1536], confidence: "low" },
  tWRRD: { tight: [1, 16], moderate: [17, 48], loose: [49, 96], confidence: "low" },
  tWRRDSG: { tight: [48, 66], moderate: [67, 82], loose: [83, 110], confidence: "low" },
  tWRRDDG: { tight: [36, 52], moderate: [53, 70], loose: [71, 96], confidence: "low" },
  tWRWR: { tight: [4, 12], moderate: [13, 18], loose: [19, 28], confidence: "low" },
  tWRWRSG: { tight: [4, 14], moderate: [15, 20], loose: [21, 32], confidence: "low" },
  tWRWRDG: { tight: [4, 10], moderate: [11, 16], loose: [17, 28], confidence: "low" },
  tRDRD: { tight: [4, 12], moderate: [13, 18], loose: [19, 28], confidence: "low" },
  tRDRDSG: { tight: [4, 14], moderate: [15, 20], loose: [21, 32], confidence: "low" },
  tRDRDDG: { tight: [4, 10], moderate: [11, 16], loose: [17, 28], confidence: "low" },
  tRDRDSD: { tight: [1, 14], moderate: [15, 20], loose: [21, 32], confidence: "low" },
  tRDRDDD: { tight: [1, 16], moderate: [17, 24], loose: [25, 36], confidence: "low" },
  tWRPRE: { tight: [70, 110], moderate: [111, 140], loose: [141, 180], confidence: "low" },
  tRDPRE: { tight: [8, 14], moderate: [15, 20], loose: [21, 32], confidence: "low" },
  tPPD: { tight: [0, 1], moderate: [2, 4], loose: [5, 8], confidence: "low" }
};

export async function loadStaticConfig(): Promise<ConfigData> {
  const loaded = await Promise.all(
    CONFIG_FILES.map(async (name) => {
      const res = await fetch(`/data/${name}.json`);
      if (!res.ok) throw new Error(`Failed to load ${name}.json`);
      return [name, await res.json()] as const;
    })
  );
  const raw = Object.fromEntries(loaded);
  return {
    timing_definitions: withIds(raw.timing_definitions.timings, "timing_id"),
    timing_aliases: raw.timing_aliases.aliases ?? {},
    die_profiles: withIds(commonDieProfiles(raw.die_profiles.die_profiles), "die_id"),
    platform_profiles: withIds(raw.platform_profiles.platform_profiles, "platform_id"),
    voltage_profiles: withIds(raw.voltage_profiles.voltages, "voltage_id"),
    power_model: raw.power_model,
    example_profiles: raw.example_profiles.profiles,
    files: CONFIG_FILES.map((name) => `frontend/public/data/${name}.json`)
  };
}

export function evaluateStaticProfile(input: MemoryProfile, config: ConfigData): Evaluation {
  const profile = structuredClone(input);
  profile.timings = normalizeTimingKeys(profile.timings ?? {}, config);
  profile.voltages = { ...(profile.voltages ?? {}) };
  const die = config.die_profiles[profile.die_id] ?? config.die_profiles.jedec_generic;
  const platform = config.platform_profiles[profile.platform_id] ?? Object.values(config.platform_profiles)[0];
  applyDefaults(profile, config, die);
  const timingResults = Object.entries(config.timing_definitions).map(([id, definition]) =>
    evaluateTiming(id, definition, profile.timings[id], profile.mtps, die)
  );
  applyTimingRuleNotes(timingResults, profile.timings);
  const voltageResults = Object.entries(config.voltage_profiles)
    .filter(([, def]) => def.platform_scope?.includes("all") || def.platform_scope?.includes(profile.platform_id))
    .map(([id, def]) => evaluateVoltage(id, def, profile.voltages[id], profile.platform_id));
  const power = estimatePower(profile, die, config);
  const platformNotes = platformCaveats(profile, platform.quirks ?? []);
  const categoryHeadroom = categoryScores(timingResults);
  const knownScores = timingResults.filter((r) => r.classification !== "unknown").map((r) => r.headroom_score);
  return {
    profile,
    summary: {
      platform: platform.display_name,
      die: `${die.vendor} ${die.generation_or_revision}`,
      mtps: profile.mtps,
      dimm_count: profile.dimm_count,
      capacity_total_gb: profile.capacity_total_gb,
      rank: profile.rank,
      command_rate: profile.command_rate,
      uclk_mclk_mode: profile.uclk_mclk_mode || inferUclkMode(profile)
    },
    timing_results: timingResults,
    latency_estimates: timingEstimates(profile.timings, profile.mtps),
    category_headroom: categoryHeadroom,
    overall_headroom_score: knownScores.length ? round(sum(knownScores) / knownScores.length, 2) : 0,
    voltage_results: voltageResults,
    voltage_pressure_score: round(sum(voltageResults.map((v) => (v.risk_level === "high" ? 1 : v.risk_level === "elevated" ? 0.55 : 0))) / Math.max(voltageResults.length, 1), 2),
    power_estimate: power,
    platform_notes: platformNotes,
    recommendations: [],
    bottleneck_categories: [],
    sources: []
  };
}

export async function importHwinfoStatic(file: File, baseProfile: MemoryProfile, config: ConfigData) {
  const text = await file.text();
  const profile = parseHwinfoLog(text, structuredClone(baseProfile));
  return { profile, evaluation: evaluateStaticProfile(profile, config) };
}

function withIds(items: Record<string, any>, idKey: string) {
  return Object.fromEntries(Object.entries(items).map(([id, value]) => [id, { [idKey]: id, ...value }]));
}

function commonDieProfiles(items: Record<string, any>) {
  return Object.fromEntries(Object.entries(items).filter(([id]) => COMMON_DIE_IDS.has(id)));
}

function normalizeTimingKeys(timings: Record<string, number | undefined>, config: ConfigData) {
  const aliasMap = Object.fromEntries(Object.entries(config.timing_aliases).map(([k, v]) => [k.toLowerCase(), v]));
  const normalized: Record<string, number> = {};
  for (const [key, value] of Object.entries(timings)) {
    if (value === undefined || value === null) continue;
    normalized[aliasMap[key.toLowerCase()] ?? key] = value;
  }
  return normalized;
}

function applyDefaults(profile: MemoryProfile, config: ConfigData, die: any) {
  for (const [id, def] of Object.entries(config.voltage_profiles)) {
    if (!(id in profile.voltages) && (def as any).typical_stock_range) profile.voltages[id] = (def as any).typical_stock_range[0];
  }
  const missingTcwl = profile.timings.tCWL === undefined;
  const missingTrc = profile.timings.tRC === undefined;
  for (const [id, definition] of Object.entries(config.timing_definitions)) {
    if (profile.timings[id] !== undefined) continue;
    const dieRange = recommendedRangeForTiming(die, profile.mtps, id, definition.lower_is_better).range;
    const value = defaultTimingCycles(dieRange ?? ddr5FloorRange(id, profile.mtps, definition.lower_is_better), definition.lower_is_better);
    profile.timings[id] = value ?? DEFAULT_TIMINGS[id] ?? 0;
  }
  if (missingTcwl && profile.timings.tCL !== undefined) profile.timings.tCWL = Math.max(0, Number(profile.timings.tCL) - 2);
  if (missingTrc && profile.timings.tRAS !== undefined && profile.timings.tRP !== undefined) profile.timings.tRC = Number(profile.timings.tRAS) + Number(profile.timings.tRP);
}

function evaluateTiming(id: string, definition: TimingDefinition, cycles: number | undefined, mtps: number, die: any): TimingResult {
  const dieRecommendation = recommendedRangeForTiming(die, mtps, id, definition.lower_is_better);
  const floorRange = ddr5FloorRange(id, mtps, definition.lower_is_better);
  const rangeData = dieRecommendation.range ?? floorRange;
  const floorTarget = targetFromRange(floorRange, definition.lower_is_better);
  const recommendedTarget = targetFromRange(rangeData, definition.lower_is_better);
  const notes = [...(definition.dependency_notes ?? []), ...(definition.platform_notes ?? [])];
  if (cycles === undefined || cycles === null) {
    return {
      timing_id: id,
      display_name: definition.display_name,
      aliases: definition.aliases ?? [],
      category: definition.category,
      cycles: null,
      ns: null,
      definition: definition.definition,
      importance: definition.importance ?? "medium",
      classification: "unknown",
      headroom_score: 0,
      target_cycles: recommendedTarget,
      floor_cycles: floorTarget,
      recommended_cycles: recommendedTarget,
      headroom_cycles: null,
      notes: ["Missing timing; not scored.", ...notes],
      source_confidence: "unknown"
    };
  }
  const [classification, score, target, headroom] = classifyValue(Number(cycles), rangeData, definition.lower_is_better);
  const fallback = !dieRecommendation.range;
  const rangeNotes = [dieRecommendation.note, fallback ? "No die-specific range; using the DDR5 floor." : null].filter(Boolean) as string[];
  return {
    timing_id: id,
    display_name: definition.display_name,
    aliases: definition.aliases ?? [],
    category: definition.category,
    cycles: Number(cycles),
    ns: definition.convertible_to_ns === false ? null : round(Number(timingNs(Number(cycles), mtps)), 3),
    definition: definition.definition,
    importance: definition.importance ?? "medium",
    classification,
    headroom_score: score,
    target_cycles: target ?? DEFAULT_TIMINGS[id] ?? null,
    floor_cycles: floorTarget,
    recommended_cycles: recommendedTarget ?? target ?? DEFAULT_TIMINGS[id] ?? null,
    headroom_cycles: headroom ?? headroomFromTarget(Number(cycles), DEFAULT_TIMINGS[id], definition.lower_is_better),
    notes: [...rangeNotes, ...notes],
    source_confidence: rangeData?.confidence ?? "low"
  };
}

function evaluateVoltage(id: string, def: any, value: number | undefined, platformId: string) {
  if (value === undefined || value === null) return { voltage_id: id, display_name: def.display_name, value: null, classification: "unknown", risk_level: "unknown", notes: ["Not entered."] };
  const ranges = platformVoltageRanges(def, platformId);
  const low = ranges.low ?? def.typical_stock_range;
  const average = ranges.average ?? def.typical_daily_tuned_range;
  const elevated = ranges.elevated ?? def.aggressive_range;
  if (low && value < low[0]) return voltageResult(id, def, value, "unknown", "low", ["Below the comparison floor for this field.", ...(def.danger_notes ?? [])]);
  if (low && between(value, low)) return voltageResult(id, def, value, "tight", "low", def.danger_notes ?? []);
  if (average && between(value, average)) return voltageResult(id, def, value, "moderate", "average", def.danger_notes ?? []);
  if (elevated && between(value, elevated)) return voltageResult(id, def, value, "loose", "elevated", def.danger_notes ?? []);
  if (elevated && value > elevated[1]) return voltageResult(id, def, value, "very loose", "high", def.danger_notes ?? []);
  return voltageResult(id, def, value, "unknown", "unknown", def.danger_notes ?? []);
}

function voltageResult(id: string, def: any, value: number, classification: string, risk: string, notes: string[]) {
  return { voltage_id: id, display_name: def.display_name, value, classification, risk_level: risk, notes };
}

function estimatePower(profile: MemoryProfile, die: any, config: ConfigData) {
  const model = config.power_model;
  const weights = model.effective_voltage_weights ?? { VDD: 0.6, VDDQ: 0.4 };
  const floors = model.voltage_floors ?? {};
  let weighted = 0;
  let totalWeight = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const value = profile.voltages[key] ?? floors[key];
    if (value !== undefined) {
      weighted += Number(value) * Number(weight);
      totalWeight += Number(weight);
    }
  }
  const effectiveVoltage = totalWeight ? weighted / totalWeight : Number(model.reference_voltage ?? 1.35);
  const calibration = model.die_power_profiles?.[die.die_id] ?? model.die_power_profiles?.default ?? {};
  const basePeak = Number(calibration.peak_watts_per_dimm ?? 4.4);
  const referenceVoltage = Number(calibration.reference_voltage ?? model.reference_voltage ?? 1.35);
  const referenceCapacity = Number(calibration.reference_capacity_gb_per_dimm ?? 16);
  const voltageExponent = Number(calibration.voltage_exponent ?? model.voltage_exponent ?? 2);
  const capacityExponent = Number(calibration.capacity_exponent ?? model.capacity_exponent ?? 0.7);
  const perDimmCapacity = profile.capacity_total_gb / profile.dimm_count;
  const watts = basePeak * (effectiveVoltage / referenceVoltage) ** voltageExponent * Math.max(0.25, perDimmCapacity / referenceCapacity) ** capacityExponent * Number(calibration.thermal_multiplier ?? 1);
  return {
    estimated_power_per_dimm_watts: round(watts, 2),
    estimated_total_power_watts: round(watts * profile.dimm_count, 2),
    heat_level: heatLevel(watts, model.heat_thresholds_w_per_dimm ?? {}),
    effective_voltage: round(effectiveVoltage, 3),
    heat_basis: "single_dimm_peak",
    notes: ["Heat level is based on estimated peak watts for one DIMM.", "The model uses VDD/VDDQ, die family, and module capacity; timing effects are intentionally not modeled."]
  };
}

function parseHwinfoLog(text: string, base: MemoryProfile): MemoryProfile {
  const memoryText = memorySection(text);
  const timings = { ...(base.timings ?? {}) };
  for (const [id, patterns] of Object.entries(TIMING_PATTERNS)) {
    const value = firstNumber(memoryText, patterns);
    if (value !== null) timings[id] = value;
  }
  const tuple = /Current Timing\s*\(tCAS-tRCD-tRP-tRAS\):\s*(\d+)-(\d+)-(\d+)-(\d+)/i.exec(memoryText);
  if (tuple) {
    const trcd = Number(tuple[2]);
    Object.assign(timings, {
      tCL: Number(tuple[1]),
      tRCD: trcd,
      tRCDRD: timings.tRCDRD ?? trcd,
      tRCDWR: timings.tRCDWR ?? trcd,
      tRP: Number(tuple[3]),
      tRAS: Number(tuple[4])
    });
  }
  const clock = firstNumber(memoryText, [/\bCurrent Memory Clock\b.*?(\d+(?:\.\d+)?)\s*MHz/i, /\bMemory Clock\b.*?(\d+(?:\.\d+)?)\s*MHz/i]);
  if (clock && clock < 4000) base.mtps = Math.round(clock * 2);
  const dimms = firstNumber(memoryText, [/\bNumber Of Memory Modules\b.*?(\d+)/i]);
  if (dimms) base.dimm_count = dimms;
  const capacity = firstNumber(memoryText, [/\bTotal Memory Size\b.*?(\d+)\s*G/i, /\bMemory Size\b.*?(\d+)\s*G/i]);
  if (capacity) base.capacity_total_gb = capacity;
  const cr = /Command Rate \(CR\):\s*([12]T)/i.exec(memoryText);
  if (cr) base.command_rate = cr[1].toUpperCase();
  const die = predictDie(memoryText);
  if (die) base.die_id = die;
  if (memoryText.includes("Intel Extreme Memory Profile") && base.platform_id === "ryzen_am5_zen4") base.platform_id = "raptor_lake_ddr5";
  base.profile_name = "Imported HWiNFO memory profile";
  base.timings = timings;
  return base;
}

const TIMING_PATTERNS: Record<string, RegExp[]> = {
  tCL: [/\bCAS Latency\b.*?(\d+(?:\.\d+)?)/i, /\btCL\b.*?(\d+(?:\.\d+)?)/i],
  tRCD: [/\btRCD\b.*?(\d+(?:\.\d+)?)/i],
  tRCDRD: [/\btRCDRD\b.*?(\d+(?:\.\d+)?)/i, /\btRCD Read\b.*?(\d+(?:\.\d+)?)/i],
  tRCDWR: [/\btRCDWR\b.*?(\d+(?:\.\d+)?)/i, /\btRCD Write\b.*?(\d+(?:\.\d+)?)/i],
  tRP: [/\btRP\b.*?(\d+(?:\.\d+)?)/i],
  tRAS: [/\btRAS\b.*?(\d+(?:\.\d+)?)/i],
  tRC: [/\btRC\b.*?(\d+(?:\.\d+)?)/i, /Row Cycle Time \(tRC\):\s*(\d+)T/i],
  tRFC: [/\btRFC\b.*?(\d+(?:\.\d+)?)/i, /Refresh Cycle Time \(tRFC\):\s*(\d+)T/i],
  tRDRDSG: [/Read to Read Delay \(tRDRD_SG\/.*?Same Bank Group:\s*(\d+)T/i],
  tRDRDDG: [/Read to Read Delay \(tRDRD_DG\/.*?Different Bank Group:\s*(\d+)T/i],
  tRDRDSD: [/Read to Read Delay \(tRDRD_SD\).*?Same DIMM:\s*(\d+)T/i],
  tRDRDDD: [/Read to Read Delay \(tRDRD_DD\).*?Different DIMM:\s*(\d+)T/i],
  tWRWRSG: [/Write to Write Delay \(tWRWR_SG\/.*?Same Bank Group:\s*(\d+)T/i],
  tWRWRDG: [/Write to Write Delay \(tWRWR_DG\/.*?Different Bank Group:\s*(\d+)T/i],
  tWRRDSG: [/Write to Read Delay \(tWRRD_SG\/.*?Same Bank Group:\s*(\d+)T/i],
  tWRRDDG: [/Write to Read Delay \(tWRRD_DG\/.*?Different Bank Group:\s*(\d+)T/i],
  tRTP: [/Read to Precharge Delay \(tRTP\):\s*(\d+)T/i],
  tWR: [/Write Recovery Time \(tWR\):\s*(\d+)T/i],
  tRRDL: [/RAS# to RAS# Delay \(tRRD_L\):\s*(\d+)T/i],
  tRRDS: [/RAS# to RAS# Delay \(tRRD_S\):\s*(\d+)T/i],
  tFAW: [/Four Activate Window \(tFAW\):\s*(\d+)T/i]
};

function memorySection(text: string) {
  const header = /^Memory\s+-{5,}\s*$/im.exec(text);
  if (header) return text.slice(header.index + header[0].length);
  return text;
}

function firstNumber(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return Number(match[1]);
  }
  return null;
}

function predictDie(text: string) {
  const manufacturer = /SDRAM Manufacturer:\s*([A-Za-z0-9 _-]+)/i.exec(text)?.[1]?.toLowerCase();
  const density = firstNumber(text, [/Module Density:\s*(\d+)\s*Mb/i]);
  if (!manufacturer) return null;
  if (manufacturer.includes("samsung") && density === 16384) return "samsung_16g_early";
  if (manufacturer.includes("samsung")) return "samsung_16g_early";
  if (manufacturer.includes("hynix") && density === 24576) return "hynix_24g_m_die";
  if (manufacturer.includes("hynix")) return "hynix_16g_m_die";
  if (manufacturer.includes("micron")) return "micron_16g_early";
  return null;
}

function recommendedRangeForTiming(die: any, mtps: number, timingId: string, lowerIsBetter: boolean | string) {
  const buckets = die.timing_ranges?.by_frequency ?? {};
  const available = Object.keys(buckets)
    .map(Number)
    .filter((frequency) => buckets[String(frequency)]?.[timingId])
    .sort((a, b) => a - b);
  if (!available.length) return { range: null, note: null };
  if (available.includes(mtps)) return { range: buckets[String(mtps)][timingId], note: null };

  const lower = [...available].reverse().find((frequency) => frequency < mtps);
  const higher = available.find((frequency) => frequency > mtps);
  if (lower && higher) {
    return {
      range: interpolateRange(buckets[String(lower)][timingId], buckets[String(higher)][timingId], lower, higher, mtps, lowerIsBetter),
      note: `Die recommendation interpolated between ${lower} and ${higher} MT/s.`
    };
  }

  const nearest = available.reduce((best, frequency) => Math.abs(frequency - mtps) < Math.abs(best - mtps) ? frequency : best, available[0]);
  return {
    range: scaledRange(buckets[String(nearest)][timingId], nearest, mtps, lowerIsBetter),
    note: nearest === mtps ? null : `Die recommendation scaled from ${nearest} MT/s.`
  };
}

function ddr5FloorRange(timingId: string, mtps: number, lowerIsBetter: boolean | string) {
  return scaledRange(GENERAL_DDR5_RANGES[timingId], GENERAL_RANGE_REFERENCE_MTPS, mtps, lowerIsBetter);
}

function interpolateRange(lowRange: any, highRange: any, lowMtps: number, highMtps: number, mtps: number, lowerIsBetter: boolean | string) {
  if (lowerIsBetter === false) return copyRange(mtps - lowMtps <= highMtps - mtps ? lowRange : highRange);
  const ratio = (mtps - lowMtps) / (highMtps - lowMtps);
  const result = copyRange(lowRange);
  for (const band of ["tight", "moderate", "loose", "very_loose"]) {
    if (!lowRange?.[band] || !highRange?.[band]) continue;
    result[band] = lowRange[band].map((value: number, index: number) => Math.round(value + (Number(highRange[band][index]) - value) * ratio));
  }
  result.confidence = lowerConfidence(lowRange?.confidence, highRange?.confidence);
  return result;
}

function scaledRange(rangeData: any, sourceMtps: number, targetMtps: number, lowerIsBetter: boolean | string) {
  if (!rangeData) return null;
  if (lowerIsBetter === false || sourceMtps === targetMtps) return copyRange(rangeData);
  const ratio = targetMtps / sourceMtps;
  const result = copyRange(rangeData);
  for (const band of ["tight", "moderate", "loose", "very_loose"]) {
    if (!rangeData[band]) continue;
    result[band] = rangeData[band].map((value: number) => Math.max(0, Math.round(Number(value) * ratio)));
  }
  return result;
}

function copyRange(rangeData: any) {
  const copy = { ...rangeData };
  for (const band of ["tight", "moderate", "loose", "very_loose"]) {
    if (rangeData?.[band]) copy[band] = [...rangeData[band]];
  }
  return copy;
}

function lowerConfidence(a?: string, b?: string) {
  const rank: Record<string, number> = { high: 3, medium: 2, low: 1 };
  return (rank[a ?? "low"] ?? 1) <= (rank[b ?? "low"] ?? 1) ? a ?? "low" : b ?? "low";
}

function defaultTimingCycles(rangeData: any, lowerIsBetter: boolean | string) {
  if (!rangeData) return null;
  if (rangeData.moderate) return Number(rangeData.moderate[0]);
  if (rangeData.tight) return Number(lowerIsBetter === false ? rangeData.tight[1] : rangeData.tight[0]);
  return null;
}

function classifyValue(value: number, rangeData: any, lowerIsBetter: boolean | string): [string, number, number | null, number | null] {
  if (!rangeData) return ["unknown", 0, null, null];
  const target = targetFromRange(rangeData, lowerIsBetter);
  const headroom = headroomFromTarget(value, target, lowerIsBetter);
  const scores: Record<string, number> = { tight: 0.05, moderate: 0.3, loose: 0.65, very_loose: 0.9 };
  for (const band of ["tight", "moderate", "loose", "very_loose"]) {
    const bounds = rangeData[band];
    if (bounds && between(value, bounds)) return [band.replace("_", " "), scores[band] ?? 0, target, headroom];
  }
  if (lowerIsBetter === false) return value < (rangeData.moderate?.[0] ?? value) ? ["loose", 0.6, target, headroom] : ["unknown", 0, target, headroom];
  if (value < (rangeData.tight?.[0] ?? value)) return ["tight", 0.05, target, headroom];
  if (value > (rangeData.loose?.[1] ?? rangeData.moderate?.[1] ?? value)) return ["very loose", 0.9, target, headroom];
  return ["unknown", 0, target, headroom];
}

function targetFromRange(rangeData: any, lowerIsBetter: boolean | string) {
  if (!rangeData?.tight) return null;
  return Number(lowerIsBetter === false ? rangeData.tight[1] : rangeData.tight[0]);
}

function headroomFromTarget(value: number, target: number | null | undefined, lowerIsBetter: boolean | string) {
  if (target === null || target === undefined) return null;
  return lowerIsBetter === false ? Math.max(0, target - value) : Math.max(0, value - target);
}

function applyTimingRuleNotes(results: TimingResult[], timings: Record<string, number | undefined>) {
  const byId = Object.fromEntries(results.map((r) => [r.timing_id, r]));
  if (timings.tCL !== undefined && timings.tCWL !== undefined && byId.tCWL) {
    const expected = Math.max(0, timings.tCL - 2);
    byId.tCWL.notes.unshift(timings.tCWL === expected ? "Matches the common DDR5 starting point: tCWL = tCL - 2." : `Common starting point is tCWL = tCL - 2 (${expected}).`);
  }
  if (timings.tRAS !== undefined && timings.tRP !== undefined && timings.tRC !== undefined && byId.tRC) {
    const expected = timings.tRAS + timings.tRP;
    byId.tRC.notes.unshift(timings.tRC === expected ? "Matches tRAS + tRP." : `tRAS + tRP is ${expected}; compare tRC against that floor.`);
  }
}

function timingEstimates(timings: Record<string, number | undefined>, mtps: number) {
  return {
    real_clock_mhz: mtps / 2,
    cycle_time_ns: cycleTimeNs(mtps),
    cl_ns: timingNs(timings.tCL, mtps),
    trcd_ns: timingNs(timings.tRCDRD ?? timings.tRCD, mtps),
    trp_ns: timingNs(timings.tRP, mtps),
    tras_ns: timingNs(timings.tRAS, mtps),
    trc_ns: timingNs(timings.tRC, mtps),
    trfc_ns: timingNs(timings.tRFC, mtps),
    trefi_interval_ns: timingNs(timings.tREFI, mtps),
    activate_to_read_ns: timingNs(timings.tRCDRD ?? timings.tRCD, mtps),
    precharge_ns: timingNs(timings.tRP, mtps),
    theoretical_dual_channel_bandwidth_gbps: (mtps * 2 * 8) / 1000
  };
}

function cycleTimeNs(mtps: number) {
  return 1000 / (mtps / 2);
}

function timingNs(cycles: number | undefined, mtps: number) {
  return cycles === undefined ? null : cycles * cycleTimeNs(mtps);
}

function platformVoltageRanges(def: any, platformId: string) {
  if (def.platform_ranges?.[platformId]) return def.platform_ranges[platformId];
  if (platformId.includes("am5")) return def.platform_ranges?.amd_am5 ?? {};
  if (["alder", "raptor", "arrow"].some((token) => platformId.includes(token))) return def.platform_ranges?.intel_ddr5 ?? {};
  return {};
}

function platformCaveats(profile: MemoryProfile, quirks: string[]) {
  const notes = [...quirks];
  if (profile.platform_id.includes("am5") && profile.mtps > 6400) notes.unshift("AM5 above 6400 MT/s commonly needs checking whether UCLK stayed 1:1 or moved to 1:2.");
  if (profile.dimm_count >= 4) notes.unshift("Four-DIMM layouts usually reduce frequency and timing expectations versus one-DIMM-per-channel kits.");
  if (profile.capacity_total_gb >= 96) notes.unshift("High-capacity kits often need looser refresh, secondary, or training-related timings than 2x16 GB kits.");
  return notes;
}

function inferUclkMode(profile: MemoryProfile) {
  if (!profile.platform_id.includes("am5")) return "N/A";
  return profile.mtps <= 6400 ? "likely 1:1" : "likely 1:2 or board-dependent";
}

function categoryScores(rows: TimingResult[]) {
  const buckets: Record<string, number[]> = {};
  for (const row of rows) {
    if (row.classification === "unknown") continue;
    (buckets[row.category] ||= []).push(row.headroom_score);
  }
  return Object.fromEntries(Object.entries(buckets).map(([key, values]) => [key, round(sum(values) / values.length, 2)]));
}

function between(value: number, bounds: number[]) {
  return value >= Number(bounds[0]) && value <= Number(bounds[1]);
}

function heatLevel(watts: number, thresholds: Record<string, number>) {
  if (watts >= Number(thresholds.extreme_min ?? 8)) return "extreme";
  if (watts >= Number(thresholds.high_min ?? 6)) return "high";
  if (watts >= Number(thresholds.moderate_min ?? 4)) return "moderate";
  return "low";
}

function sum(values: number[]) {
  return values.reduce((a, b) => a + b, 0);
}

function round(value: number, places: number) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
