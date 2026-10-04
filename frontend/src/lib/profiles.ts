import type { ConfigData, MemoryProfile } from "./types";

export const STORAGE_KEY = "optimalddr5.notebook.v1";
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export type SavedProfile = { id: string; saved_at: string; profile: MemoryProfile };
export type Notebook = { version: 1; draft: MemoryProfile; saved: SavedProfile[] };

export function blankProfile(platformId = "ryzen_am5_zen4"): MemoryProfile {
  return { profile_name: "My DDR5 profile", platform_id: platformId, die_id: "unknown", mtps: 6000,
    capacity_total_gb: 32, dimm_count: 2, channel_count: 2, timings: {}, voltages: {}, validation_status: "untested" };
}

export function canonicalTimingKey(key: string, config: ConfigData): string {
  const name = key.trim().toLowerCase();
  return Object.entries(config.timing_aliases).find(([alias]) => alias.toLowerCase() === name)?.[1]
    ?? Object.entries(config.timing_definitions).find(([id, def]) => id.toLowerCase() === name || def.aliases?.some((alias: string) => alias.toLowerCase() === name))?.[0]
    ?? key;
}

export function profileErrors(profile: MemoryProfile, config: ConfigData): string[] {
  const errors: string[] = [];
  if (!profile.profile_name.trim()) errors.push("Give the profile a name.");
  if (!Object.hasOwn(config.platform_profiles, profile.platform_id)) errors.push("Choose a supported platform.");
  if (profile.die_id !== "unknown" && !Object.hasOwn(config.die_profiles, profile.die_id)) errors.push("Choose a known die or Unknown / unconfirmed.");
  for (const [label, value, min, max] of [
    ["Data rate", profile.mtps, 1000, 20000], ["Capacity", profile.capacity_total_gb, 1, 2048],
    ["DIMM count", profile.dimm_count, 1, 4], ["Channel count", profile.channel_count ?? 2, 1, 2]
  ] as const) {
    if (!Number.isInteger(value) || value < min || value > max) errors.push(`${label} must be a whole number from ${min} to ${max}.`);
  }
  if ((profile.channel_count ?? 2) > profile.dimm_count) errors.push("Populated channels cannot exceed DIMM count.");
  const seenTimings = new Map<string, number | undefined>();
  for (const [key, value] of Object.entries(profile.timings)) {
    const canonical = canonicalTimingKey(key, config);
    if (value != null && seenTimings.has(canonical) && seenTimings.get(canonical) !== value) errors.push(`Conflicting values for ${canonical}.`);
    if (value != null) seenTimings.set(canonical, value);
    if (!Object.hasOwn(config.timing_definitions, canonical)) errors.push(`Unrecognized timing: ${key}.`);
    if (value != null && (!Number.isInteger(value) || value < 0 || value > 1000000)) errors.push(`${key} must be a whole cycle count from 0 to 1,000,000.`);
  }
  for (const [key, value] of Object.entries(profile.voltages)) {
    if (!Object.hasOwn(config.voltage_profiles, key)) errors.push(`Unrecognized voltage: ${key}.`);
    if (value != null && (!Number.isFinite(value) || value <= 0 || value > 5)) errors.push(`${key} must be above 0 and at most 5 V. This input limit is not a safe voltage range.`);
  }
  return errors;
}

export function readProfile(value: unknown, config: ConfigData): MemoryProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a DDR5 profile JSON object.");
  const raw = value as Record<string, unknown>;
  for (const key of ["profile_name", "platform_id", "die_id"]) if (typeof raw[key] !== "string") throw new Error(`Profile is missing ${key}.`);
  for (const key of ["mtps", "capacity_total_gb", "dimm_count"]) if (typeof raw[key] !== "number") throw new Error(`Profile is missing numeric ${key}.`);
  for (const key of ["timings", "voltages"]) if (!raw[key] || typeof raw[key] !== "object" || Array.isArray(raw[key])) throw new Error(`Profile ${key} must be an object.`);
  for (const key of ["bios_version", "rank", "command_rate", "uclk_mclk_mode", "notes", "validation_notes"]) if (raw[key] != null && typeof raw[key] !== "string") throw new Error(`${key} must be text.`);
  if (raw.validation_status != null && !["untested", "testing", "passed", "failed"].includes(String(raw.validation_status))) throw new Error("Unknown validation status.");
  const profile = structuredClone(raw) as MemoryProfile;
  profile.channel_count ??= Math.min(2, profile.dimm_count);
  const errors = profileErrors(profile, config);
  if (errors.length) throw new Error(errors.join(" "));
  profile.timings = Object.fromEntries(Object.entries(profile.timings).filter(([, value]) => value != null).map(([key, value]) => [canonicalTimingKey(key, config), value]));
  return profile;
}

export function readNotebook(text: string, config: ConfigData): Notebook {
  const raw = JSON.parse(text);
  if (raw?.version !== 1 || !Array.isArray(raw.saved) || raw.saved.length > 100) throw new Error("Unsupported or invalid notebook backup.");
  const ids = new Set<string>();
  const saved = raw.saved.map((entry: SavedProfile) => {
    if (typeof entry.id !== "string" || ids.has(entry.id) || typeof entry.saved_at !== "string" || !Number.isFinite(Date.parse(entry.saved_at))) throw new Error("Invalid saved profile entry.");
    ids.add(entry.id);
    return { id: entry.id, saved_at: entry.saved_at, profile: readProfile(entry.profile, config) };
  });
  return { version: 1, draft: readProfile(raw.draft, config), saved };
}

export function loadNotebook(config: ConfigData): { notebook: Notebook; notice: string; canPersist: boolean } {
  const fallback: Notebook = { version: 1, draft: blankProfile(), saved: [] };
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    return { notebook: text ? readNotebook(text, config) : fallback, notice: text ? "Restored your local notebook." : "Start with your settings or load an example.", canPersist: true };
  } catch {
    return { notebook: fallback, notice: "Local storage could not be read. Your previous data was not changed. Import a backup or continue and export your work.", canPersist: false };
  }
}

export function downloadJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename.replace(/[^a-z0-9_-]+/gi, "_") || "ddr5-profile"}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
