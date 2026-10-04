import type { ConfigData } from "./types";
import timingDefinitions from "../../public/data/timing_definitions.json";
import timingAliases from "../../public/data/timing_aliases.json";
import referenceRanges from "../../public/data/timing_reference_ranges.json";
import dieProfiles from "../../public/data/die_profiles.json";
import platformProfiles from "../../public/data/platform_profiles.json";
import voltageProfiles from "../../public/data/voltage_profiles.json";
import powerModel from "../../public/data/power_model.json";
import examples from "../../public/data/example_profiles.json";

export function testConfig(): ConfigData {
  const ids = (data: Record<string, any>, key: string): Record<string, any> => Object.fromEntries(Object.entries(data).map(([id, value]) => [id, { [key]: id, ...value }]));
  return {
    timing_definitions: ids(timingDefinitions.timings, "timing_id"),
    timing_aliases: timingAliases.aliases,
    timing_reference_ranges: referenceRanges,
    die_profiles: ids(dieProfiles.die_profiles, "die_id"),
    platform_profiles: ids(platformProfiles.platform_profiles, "platform_id"),
    voltage_profiles: ids(voltageProfiles.voltages, "voltage_id"),
    power_model: powerModel, example_profiles: examples.profiles, files: []
  } as ConfigData;
}
