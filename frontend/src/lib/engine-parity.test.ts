import { expect, it } from "vitest";
import { evaluateStaticProfile } from "./static-engine";
import { testConfig } from "./test-config";
import { readProfile } from "./profiles";
import fixtures from "./engine-fixtures.json";

const config = testConfig();
const fields = ["timing_id", "cycles", "ns", "classification", "headroom_score", "target_cycles", "floor_cycles", "recommended_cycles", "headroom_cycles", "source_confidence"];
it.each(fixtures.map((item) => [item.input.profile_name, item] as const))("matches Python calculations: %s", (_, fixture) => {
  const result = evaluateStaticProfile(readProfile(fixture.input, config), config);
  const projection = {
    timing_results: result.timing_results.map((row) => Object.fromEntries(fields.map((key) => [key, row[key]]))),
    latency_estimates: result.latency_estimates,
    category_headroom: result.category_headroom,
    overall_headroom_score: result.overall_headroom_score,
    voltage_results: result.voltage_results.map((row) => Object.fromEntries(["voltage_id", "value", "classification", "risk_level"].map((key) => [key, row[key]]))),
    power_estimate: Object.fromEntries(Object.entries(result.power_estimate).filter(([key]) => key !== "notes"))
  };
  // Python and JavaScript can differ in their last floating-point bit.
  expect(JSON.parse(JSON.stringify(projection, (_, value) => typeof value === "number" ? Number(value.toFixed(6)) : value)))
    .toEqual(JSON.parse(JSON.stringify(fixture.expected, (_, value) => typeof value === "number" ? Number(value.toFixed(6)) : value)));
});
