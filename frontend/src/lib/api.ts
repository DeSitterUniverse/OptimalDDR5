import type { ConfigData, Evaluation, MemoryProfile } from "./types";
import { evaluateStaticProfile, importHwinfoStatic, loadStaticConfig } from "./static-engine";

let configPromise: Promise<ConfigData> | null = null;

export async function fetchConfig(): Promise<ConfigData> {
  configPromise ??= loadStaticConfig();
  return configPromise;
}

export async function evaluateProfile(profile: MemoryProfile): Promise<Evaluation> {
  return evaluateStaticProfile(profile, await fetchConfig());
}

export async function importHwinfo(file: File, profile: MemoryProfile): Promise<{ profile: MemoryProfile; evaluation: Evaluation }> {
  return importHwinfoStatic(file, profile, await fetchConfig());
}
