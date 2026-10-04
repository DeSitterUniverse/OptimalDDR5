import { canonicalTimingKey, MAX_IMPORT_BYTES, profileErrors } from "./profiles";
import type { ConfigData, Evaluation, MemoryProfile } from "./types";

type TimingDefinition = Record<string, any>;
type TimingResult = Record<string, any>;

const CONFIG_FILES = [
  "timing_definitions",
  "timing_aliases",
  "timing_reference_ranges",
  "die_profiles",
  "platform_profiles",
  "voltage_profiles",
  "power_model",
  "example_profiles"
] as const;
export async function loadStaticConfig(): Promise<ConfigData> {
  const loaded = await Promise.all(
    CONFIG_FILES.map(async (name) => {
      const res = await fetch(`${import.meta.env.BASE_URL}data/${name}.json`);
      if (!res.ok) throw new Error(`Failed to load ${name}.json`);
      return [name, await res.json()] as const;
    })
  );
  const raw = Object.fromEntries(loaded);
  return {
    timing_definitions: withIds(raw.timing_definitions.timings, "timing_id"),
    timing_aliases: raw.timing_aliases.aliases ?? {},
    timing_reference_ranges: raw.timing_reference_ranges,
    die_profiles: withIds(raw.die_profiles.die_profiles, "die_id"),
    platform_profiles: withIds(raw.platform_profiles.platform_profiles, "platform_id"),
    voltage_profiles: withIds(raw.voltage_profiles.voltages, "voltage_id"),
    power_model: raw.power_model,
    example_profiles: raw.example_profiles.profiles,
    files: CONFIG_FILES.map((name) => `frontend/public/data/${name}.json`)
  };
}

export function evaluateStaticProfile(input: MemoryProfile, config: ConfigData): Evaluation {
  const errors = profileErrors(input, config);
  if (errors.length) throw new Error(errors.join(" "));
  const profile = structuredClone(input);
  profile.channel_count ??= Math.min(2, profile.dimm_count);
  profile.timings = normalizeTimingKeys(profile.timings ?? {}, config);
  profile.voltages = { ...(profile.voltages ?? {}) };
  const die = config.die_profiles[profile.die_id] ?? { die_id: "unknown", vendor: "Unknown", generation_or_revision: "unconfirmed die", timing_ranges: {}, sources: [] };
  const platform = config.platform_profiles[profile.platform_id];
  const timingResults = Object.entries(config.timing_definitions).map(([id, definition]) =>
    evaluateTiming(id, definition, profile.timings[id], profile.mtps, die, config)
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
      channel_count: profile.channel_count,
      capacity_total_gb: profile.capacity_total_gb,
      rank: profile.rank,
      command_rate: profile.command_rate,
      uclk_mclk_mode: profile.uclk_mclk_mode || inferUclkMode(profile)
    },
    timing_results: timingResults,
    latency_estimates: timingEstimates(profile.timings, profile.mtps, profile.channel_count),
    category_headroom: categoryHeadroom,
    overall_headroom_score: meanScore(knownScores),
    voltage_results: voltageResults,
    voltage_pressure_score: round(sum(voltageResults.map((v) => (v.risk_level === "high" ? 1 : v.risk_level === "elevated" ? 0.55 : 0))) / Math.max(voltageResults.length, 1), 2),
    power_estimate: power,
    platform_notes: platformNotes,
    recommendations: buildRecommendations(timingResults, voltageResults),
    bottleneck_categories: [],
    sources: [...(die.sources ?? []), ...(platform.sources ?? [])]
  };
}

export async function importHwinfoStatic(file: File, baseProfile: MemoryProfile, config: ConfigData) {
  if (file.size > MAX_IMPORT_BYTES) throw new Error("Import files must be 5 MB or smaller.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = decodeHwinfo(bytes);
  const { profile, warnings } = parseHwinfoLog(text, baseProfile);
  return { profile, warnings, evaluation: evaluateStaticProfile(profile, config) };
}

function withIds(items: Record<string, any>, idKey: string) {
  return Object.fromEntries(Object.entries(items).map(([id, value]) => [id, { [idKey]: id, ...value }]));
}

function normalizeTimingKeys(timings: Record<string, number | undefined>, config: ConfigData) {
  const normalized: Record<string, number> = {};
  for (const [key, value] of Object.entries(timings)) {
    if (value === undefined || value === null) continue;
    normalized[canonicalTimingKey(key, config)] = value;
  }
  return normalized;
}

function evaluateTiming(id: string, definition: TimingDefinition, cycles: number | undefined, mtps: number, die: any, config: ConfigData): TimingResult {
  const dieRecommendation = recommendedRangeForTiming(die, mtps, id, definition.lower_is_better);
  const floorRange = referenceRange(id, mtps, definition.lower_is_better, config);
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
  const rangeNotes = [dieRecommendation.note, fallback ? "No die-specific range; using a low-confidence community comparison, not a JEDEC floor." : null].filter(Boolean) as string[];
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
    target_cycles: target,
    floor_cycles: floorTarget,
    recommended_cycles: recommendedTarget ?? target,
    headroom_cycles: headroom,
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
    notes: ["Unvalidated comparative model; watts and load bands are not sensor measurements.", ...(["VDD", "VDDQ"].some((key) => profile.voltages[key] == null) ? ["Missing VDD/VDDQ uses 1.10 V assumptions."] : [])]
  };
}

export function parseHwinfoLog(text: string, input: MemoryProfile): { profile: MemoryProfile; warnings: string[] } {
  const base = structuredClone(input);
  const memoryText = memorySection(text);
  const timings: Record<string, number> = {};
  const warnings = ["Only report timings were imported. Voltages, platform, and die selection were preserved; verify them manually.", "Missing report timings are left blank. Any earlier validation result was cleared."];
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
  if (clock) base.mtps = Math.round(clock * 2);
  const dimms = firstNumber(memoryText, [/\bNumber Of Memory Modules\b.*?(\d+)/i]);
  if (dimms) base.dimm_count = dimms;
  const capacity = firstNumber(memoryText, [/\bTotal Memory Size\b.*?(\d+)\s*G/i, /\bMemory Size\b.*?(\d+)\s*G/i]);
  if (capacity) base.capacity_total_gb = capacity;
  const cr = /Command Rate \(CR\):\s*([12]T)/i.exec(memoryText);
  if (cr) base.command_rate = cr[1].toUpperCase();
  const die = predictDie(text);
  if (die) warnings.push(`Manufacturer/density suggests ${die}, but does not identify the die revision. Confirm before selecting it.`);
  if (!Object.keys(timings).length && !clock) throw new Error("No current memory timings or memory clock found. Choose a HWiNFO text report .LOG, not a sensor CSV.");
  if (base.dimm_count === 1) base.channel_count = 1;
  base.validation_status = "untested";
  base.validation_notes = "";
  base.profile_name = "Imported HWiNFO memory profile";
  base.timings = timings;
  return { profile: base, warnings };
}

const TIMING_PATTERNS: Record<string, RegExp[]> = {
  tCL: [/\bCAS Latency\b.*?(\d+(?:\.\d+)?)/i, /\btCL\b.*?(\d+(?:\.\d+)?)/i],
  tRCD: [/\btRCD\b.*?(\d+(?:\.\d+)?)/i],
  tRCDRD: [/\btRCDRD\b.*?(\d+(?:\.\d+)?)/i, /\btRCD Read\b.*?(\d+(?:\.\d+)?)/i],
  tRCDWR: [/\btRCDWR\b.*?(\d+(?:\.\d+)?)/i, /\btRCD Write\b.*?(\d+(?:\.\d+)?)/i],
  tRP: [/\btRP\b.*?(\d+(?:\.\d+)?)/i],
  tRAS: [/\btRAS\b.*?(\d+(?:\.\d+)?)/i],
  tREFI: [/\btREFI\b.*?(\d+(?:\.\d+)?)/i],
  tRFC2: [/\btRFC2\b.*?(\d+(?:\.\d+)?)/i],
  tRFCsb: [/\btRFC(?:sb|_sb|pb)\b.*?(\d+(?:\.\d+)?)/i],
  tCWL: [/\btCWL\b.*?(\d+(?:\.\d+)?)/i],
  tWRPRE: [/\btWRPRE\b.*?(\d+(?:\.\d+)?)/i],
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
  text = text.replace(/\r\n?/g, "\n");
  const header = /^(?:Memory[ \t]+-{5,}|-{5,}[ \t]*Memory[ \t]*-+)[ \t]*$/im.exec(text);
  if (!header) throw new Error("No Memory section found. Export a HWiNFO text report .LOG.");
  const section = text.slice(header.index + header[0].length);
  const stop = /^(?:Row:[ \t]*\d+|[^\r\n]+[ \t]+-{5,}|-{5,}[ \t]*[^-\r\n]+[ \t]*-+|[ \t]*\[(?:Intel Extreme Memory Profile|AMD EXPO|JEDEC))/im.exec(section);
  return stop ? section.slice(0, stop.index) : section;
}

export function decodeHwinfo(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  return new TextDecoder("utf-8").decode(bytes);
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
  if (manufacturer.includes("samsung") && density === 32768) return "samsung_32g_m_die";
  if (manufacturer.includes("samsung") && density === 16384) return "samsung_16g_b_die";
  if (manufacturer.includes("hynix") && density === 24576) return "hynix_24g_m_die";
  if (manufacturer.includes("hynix") && density === 32768) return "hynix_32g_m_die";
  if (manufacturer.includes("hynix") && density === 16384) return "hynix_16g_m_die";
  if (manufacturer.includes("micron") && density === 24576) return "micron_24g_b_die";
  if (manufacturer.includes("micron") && density === 32768) return "micron_32g_b_die";
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

function referenceRange(timingId: string, mtps: number, lowerIsBetter: boolean | string, config: ConfigData) {
  return scaledRange(config.timing_reference_ranges.ranges[timingId], config.timing_reference_ranges.reference_mtps, mtps, lowerIsBetter);
}

function interpolateRange(lowRange: any, highRange: any, lowMtps: number, highMtps: number, mtps: number, lowerIsBetter: boolean | string) {
  if (lowerIsBetter === false) return copyRange(mtps - lowMtps <= highMtps - mtps ? lowRange : highRange);
  const ratio = (mtps - lowMtps) / (highMtps - lowMtps);
  const result = copyRange(lowRange);
  for (const band of ["tight", "moderate", "loose", "very_loose"]) {
    if (!lowRange?.[band] || !highRange?.[band]) continue;
    result[band] = lowRange[band].map((value: number, index: number) => Math.round(value + (Number(highRange[band][index]) - value) * ratio));
  }
  result.confidence = lowerConfidence("medium", lowerConfidence(lowRange?.confidence, highRange?.confidence));
  return result;
}

function scaledRange(rangeData: any, sourceMtps: number, targetMtps: number, lowerIsBetter: boolean | string) {
  if (!rangeData) return null;
  if (lowerIsBetter === false || sourceMtps === targetMtps) return copyRange(rangeData);
  const ratio = targetMtps / sourceMtps;
  const result = copyRange(rangeData);
  result.confidence = "low";
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

function timingEstimates(timings: Record<string, number | undefined>, mtps: number, channels = 2) {
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
    theoretical_bandwidth_gbps: (mtps * channels * 8) / 1000,
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
  return "Unknown; verify after training";
}

function categoryScores(rows: TimingResult[]) {
  const buckets: Record<string, number[]> = {};
  for (const row of rows) {
    if (row.classification === "unknown") continue;
    (buckets[row.category] ||= []).push(row.headroom_score);
  }
  return Object.fromEntries(Object.entries(buckets).map(([key, values]) => [key, meanScore(values)]));
}

function meanScore(values: number[]) {
  return values.length ? Math.round(sum(values.map((value) => Math.round(value * 100))) / values.length) / 100 : 0;
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

function buildRecommendations(timings: TimingResult[], voltages: Array<Record<string, any>>) {
  const notes: string[] = [];
  for (const row of timings.filter((row) => ["loose", "very loose"].includes(row.classification)).slice(0, 3)) notes.push(`${row.timing_id} is ${row.classification} against the reference range. Review its notes and evidence before changing it.`);
  if (voltages.some((row) => ["high", "elevated"].includes(row.risk_level))) notes.push("Review elevated voltage fields against your CPU, DIMM, and board documentation; comparison bands are not safe limits.");
  return notes;
}
