import { describe, expect, it } from "vitest";
import { blankProfile, profileErrors, readNotebook, readProfile } from "./profiles";
import { decodeHwinfo, evaluateStaticProfile, parseHwinfoLog } from "./static-engine";
import { testConfig } from "./test-config";

const config = testConfig();
describe("analysis and profile validation", () => {
  it("preserves blank values and evaluates only reported timings", () => {
    const profile = { ...blankProfile(), timings: { tCL: 30 } };
    const original = structuredClone(profile);
    const result = evaluateStaticProfile(profile, config);
    expect(profile).toEqual(original);
    expect(result.profile.timings).toEqual({ tCL: 30 });
    expect(result.profile.voltages).toEqual({});
    expect(result.latency_estimates.cl_ns).toBe(10);
    expect(result.latency_estimates.trcd_ns).toBeNull();
    expect(result.timing_results.find((row) => row.timing_id === "tRFC")?.classification).toBe("unknown");
    expect(result.summary.die).toContain("Unknown");
  });
  it.each([[1, 1, 48], [2, 1, 48], [2, 2, 96], [4, 2, 96]])("uses channels rather than %s DIMMs", (dimms, channels, bandwidth) => {
    expect(evaluateStaticProfile({ ...blankProfile(), dimm_count: dimms, channel_count: channels }, config).latency_estimates.theoretical_bandwidth_gbps).toBe(bandwidth);
  });
  it.each([{ mtps: 0 }, { mtps: NaN }, { mtps: 6000.5 }, { dimm_count: 0 }, { voltages: { VDD: Infinity } }, { timings: { tCL: -1 } }, { timings: { tCL: 30.5 } }, { die_id: "missing" }, { platform_id: "missing" }, { timings: { madeup: 10 } }])("rejects invalid inputs %j", (patch) => {
    expect(() => evaluateStaticProfile({ ...blankProfile(), ...patch }, config)).toThrow();
  });
  it("round trips old profiles and rejects malformed JSON shapes", () => {
    const legacy = { ...blankProfile(), dimm_count: 1, channel_count: undefined };
    expect(readProfile(JSON.parse(JSON.stringify(legacy)), config).channel_count).toBe(1);
    expect(() => readProfile({ ...legacy, timings: [] }, config)).toThrow();
    expect(() => readProfile({ ...legacy, notes: {} }, config)).toThrow();
    expect(profileErrors({ ...blankProfile(), timings: JSON.parse('{"__proto__":30}') }, config).length).toBeGreaterThan(0);
    expect(readProfile({ ...blankProfile(), timings: { CL: 30 } }, config).timings).toEqual({ tCL: 30 });
    expect(() => readProfile({ ...blankProfile(), timings: { CL: 30, tCL: 36 } }, config)).toThrow("Conflicting");
    expect(() => readProfile({ ...blankProfile(), timings: { tREFIx9: 1000 } }, config)).toThrow("Unrecognized");
  });
  it("restores backups atomically and rejects duplicate entries", () => {
    const draft = blankProfile();
    const entry = { id: "one", saved_at: "2026-10-04T12:00:00Z", profile: draft };
    const backup = { version: 1, draft, saved: [entry] };
    expect(readNotebook(JSON.stringify(backup), config).saved).toHaveLength(1);
    expect(() => readNotebook(JSON.stringify({ ...backup, saved: [entry, entry] }), config)).toThrow();
  });
  it.each(config.example_profiles.map((profile) => [profile.profile_name, profile] as const))("evaluates example %s", (_, profile) => {
    expect(evaluateStaticProfile(profile, config).power_estimate.estimated_total_power_watts).toBeGreaterThan(0);
  });
});

describe("HWiNFO imports", () => {
  it("replaces timings, preserves manual rails/platform/die, and reads high clocks", () => {
    const base = { ...blankProfile(), die_id: "hynix_16g_a_die", timings: { tRCDRD: 30, tREFI: 65535 }, voltages: { VDD: 1.4 }, validation_status: "passed" as const };
    const result = parseHwinfoLog("Memory ----------\nCurrent Memory Clock: 4200 MHz\nCurrent Timing (tCAS-tRCD-tRP-tRAS): 40-50-50-100\nRow: 1\nSDRAM Manufacturer: Samsung\nModule Density: 16384 Mb\n[Intel Extreme Memory Profile (XMP)]\ntCL: 32\n", base);
    expect(result.profile.mtps).toBe(8400);
    expect(result.profile.timings.tCL).toBe(40);
    expect(result.profile.timings.tRCDRD).toBe(50);
    expect(result.profile.timings.tREFI).toBeUndefined();
    expect(result.profile.voltages).toEqual(base.voltages);
    expect(result.profile.platform_id).toBe(base.platform_id);
    expect(result.profile.die_id).toBe(base.die_id);
    expect(result.profile.validation_status).toBe("untested");
    expect(base.validation_status).toBe("passed");
    expect(result.warnings.join(" ")).toContain("does not identify the die revision");
  });
  it("bounds dashed Memory sections and excludes sensor values", () => {
    expect(parseHwinfoLog("---------- Memory ----------\ntCL: 30\n---------- Sensors ----------\ntRFC: 999", blankProfile()).profile.timings).toEqual({ tCL: 30 });
  });
  it("imports supported secondary fields without unknown platform registers", () => {
    const result = parseHwinfoLog("Memory ----------\ntREFI: 50000\ntRFC2: 400\ntRFC_sb: 300\ntCWL: 28\ntWRPRE: 90\nWrite to Write Delay (tWRWR_SD) Same DIMM: 12T\n", blankProfile());
    expect(result.profile.timings).toEqual({ tREFI: 50000, tRFC2: 400, tRFCsb: 300, tCWL: 28, tWRPRE: 90 });
    expect(() => evaluateStaticProfile(result.profile, config)).not.toThrow();
    expect(() => readProfile(parseHwinfoLog("Memory ----------\ntCL: 30.5\n", blankProfile()).profile, config)).toThrow("whole cycle");
  });
  it.each(["CPU: 55 C", "Memory ----------\nNo timings here", "Time,CPU temperature,Memory clock\n1,55,3000"])("rejects invalid report %s", (text) => {
    expect(() => parseHwinfoLog(text, blankProfile())).toThrow();
  });
  it("decodes UTF-16 and UTF-8 BOM reports", () => {
    expect(decodeHwinfo(new Uint8Array([255, 254, 77, 0, 101, 0, 109, 0]))).toBe("Mem");
    expect(decodeHwinfo(new Uint8Array([254, 255, 0, 77, 0, 101, 0, 109]))).toBe("Mem");
    expect(decodeHwinfo(new Uint8Array([239, 187, 191, 77, 101, 109]))).toBe("Mem");
  });
});
