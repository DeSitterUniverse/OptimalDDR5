import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { FileUp, Info, Save } from "lucide-react";
import { evaluateProfile, fetchConfig, importHwinfo } from "./lib/api";
import type { ConfigData, DieProfile, Evaluation, MemoryProfile } from "./lib/types";
import "./styles.css";

const timingKeys = [
  "tCL", "tRCDRD", "tRCDWR", "tRCD", "tRP", "tRAS", "tRC", "tRFC", "tRFC2", "tRFCsb", "tREFI",
  "tRRDS", "tRRDL", "tFAW", "tWR", "tWTRS", "tWTRL", "tRTP", "tCWL", "tCKE", "tMOD", "tXP",
  "tXS", "tWRRD", "tWRPRE", "tRDPRE"
];
const baseVoltageKeys = ["VDD", "VDDQ", "VPP"];
const intelVoltageKeys = ["VCCSA", "CPU_VDDQ", "MC_Voltage"];
const amdVoltageKeys = ["SoC", "VDDIO_MEM", "VDDP"];
const displayNames: Record<string, string> = {
  CPU_VDDQ: "CPU_VDDQ / TX_VDDQ",
  VDDIO_MEM: "VDDIO_MEM / CPU I/O",
  MC_Voltage: "MC_Voltage / VDD2",
  SoC: "SoC / IMC support"
};
function App() {
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [profile, setProfile] = useState<MemoryProfile | null>(null);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchConfig()
      .then((cfg) => {
        setConfig(cfg);
        const first = cfg.example_profiles[1] ?? cfg.example_profiles[0];
        setProfile(first);
        return evaluateProfile(first);
      })
      .then(setEvaluation)
      .catch((err) => setError(String(err)));
  }, []);

  useEffect(() => {
    if (!profile) return;
    const handle = setTimeout(() => {
      evaluateProfile(profile).then(setEvaluation).catch((err) => setError(String(err)));
    }, 250);
    return () => clearTimeout(handle);
  }, [profile]);

  if (!config || !profile) return <main className="boot">Loading OptimalDDR5...</main>;

  const analyzedProfile = evaluation?.profile ?? profile;
  const update = (patch: Partial<MemoryProfile>) => setProfile({ ...profile, ...patch });
  const updateTiming = (key: string, value: string) => setProfile({ ...profile, timings: { ...profile.timings, [key]: numberOrUndefined(value) } });
  const updateVoltage = (key: string, value: string) => setProfile({ ...profile, voltages: { ...profile.voltages, [key]: numberOrUndefined(value) } });
  const voltageKeys = visibleVoltageKeys(profile.platform_id);

  return (
    <main className="app">
      <aside className="sidebar">
        <div className="brand">OptimalDDR5</div>
        <a href="#profile">Profile Input</a>
        <a href="#timing-map">Timing Map</a>
        <a href="#latency">Bandwidth & Timings</a>
        <a href="#headroom">Headroom</a>
        <a href="#voltage">Voltage & Heat</a>
      </aside>
      <section className="content">
        <header className="topbar">
          <div>
            <h1>DDR5 timing notebook</h1>
            <p>Cycle math, peer-range comparison, voltage pressure, and platform caveats.</p>
          </div>
          <button onClick={() => evaluation && downloadJson(profile)}><Save size={16} />Save JSON</button>
        </header>
        {error && <div className="error">{error}</div>}

        <section id="profile" className="section two-col">
          <div>
            <h2>Profile Input</h2>
            <div className="form-grid">
              <label>Example profile<select value={profile.profile_name} onChange={(e) => setProfile(config.example_profiles.find((p) => p.profile_name === e.target.value) ?? profile)}>{config.example_profiles.map((item) => <option key={item.profile_name}>{item.profile_name}</option>)}</select></label>
              <label>Profile name<input value={profile.profile_name} onChange={(e) => update({ profile_name: e.target.value })} /></label>
              <label>Platform<select value={profile.platform_id} onChange={(e) => update({ platform_id: e.target.value })}>{Object.entries(config.platform_profiles).map(([id, p]: any) => <option key={id} value={id}>{p.display_name}</option>)}</select></label>
              <label>Die type<select value={profile.die_id} onChange={(e) => update({ die_id: e.target.value })}>{selectableDieEntries(config, profile.die_id).map(([id, p]: any) => <option key={id} value={id}>{p.vendor} {p.generation_or_revision}</option>)}</select></label>
              <label>MT/s<input type="number" value={profile.mtps} onChange={(e) => update({ mtps: Number(e.target.value) })} /></label>
              <label>Capacity GB<input type="number" value={profile.capacity_total_gb} onChange={(e) => update({ capacity_total_gb: Number(e.target.value) })} /></label>
              <label>DIMM count<input type="number" value={profile.dimm_count} onChange={(e) => update({ dimm_count: Number(e.target.value) })} /></label>
              <label>Rank<input value={profile.rank ?? ""} onChange={(e) => update({ rank: e.target.value })} /></label>
              <label>Command rate<input value={profile.command_rate ?? ""} onChange={(e) => update({ command_rate: e.target.value })} /></label>
              <label>UCLK/MCLK<input value={profile.uclk_mclk_mode ?? ""} onChange={(e) => update({ uclk_mclk_mode: e.target.value })} /></label>
            </div>
          </div>
          <div className="import-box">
            <h2>HWiNFO .LOG Import</h2>
            <p>Imports timing and voltage fields found under the Memory section. Missing values stay editable.</p>
            <label className="file-button"><FileUp size={16} />Import .LOG<input type="file" accept=".log,.txt" onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const imported = await importHwinfo(file, profile);
              setProfile(imported.profile);
              setEvaluation(imported.evaluation);
            }} /></label>
            <Summary evaluation={evaluation} />
          </div>
        </section>

        <section className="section">
          <OverclockingResearch die={config.die_profiles[profile.die_id]} profile={profile} />
        </section>

        <section className="section">
          <h2>Voltages</h2>
          <div className="dense-grid">{voltageKeys.map((key) => <label key={key}>{displayNames[key] ?? key}<input type="number" step="0.01" value={profile.voltages[key] ?? ""} onChange={(e) => updateVoltage(key, e.target.value)} /></label>)}</div>
        </section>

        <section className="section">
          <h2>Timings</h2>
          <div className="dense-grid timing-inputs">{timingKeys.map((key) => <TimingInput key={key} timingKey={key} config={config} value={profile.timings[key]} onChange={(value) => updateTiming(key, value)} />)}</div>
        </section>

        <section id="timing-map" className="section">
          <h2>Timing Map</h2>
          <TimingTable evaluation={evaluation} />
        </section>

        <section id="latency" className="section two-col">
          <LatencyPanel evaluation={evaluation} />
          <HeadroomChart evaluation={evaluation} />
        </section>

        <section id="headroom" className="section two-col">
          <div>
            <h2>Adjustment Notes</h2>
            <div className="notes">{platformAdjustmentNotes(analyzedProfile.platform_id).map((n) => <p key={n}>{n}</p>)}</div>
          </div>
          <div>
            <h2>Platform Notes</h2>
            <div className="notes">{evaluation?.platform_notes.map((n) => <p key={n}>{n}</p>)}</div>
          </div>
        </section>

        <section id="voltage" className="section two-col">
          <VoltagePanel evaluation={evaluation} />
          <PowerPanel evaluation={evaluation} />
        </section>
      </section>
    </main>
  );
}

function OverclockingResearch({ die, profile }: { die?: DieProfile; profile: MemoryProfile }) {
  const limits = die?.overclocking_limits;
  if (!limits) return null;
  const daily = profile.platform_id.includes("am5") ? limits.daily_range_am5_mtps : limits.daily_range_intel_mtps;
  const failedMax = maxAttemptMtps(limits.attempts, "failed");
  const frequency = compareFrequency(profile.mtps, daily, limits.documented_stable_max_mtps, limits.documented_benchmark_max_mtps, failedMax);
  const voltage = compareVoltage(profile.voltages.VDD, profile.voltages.VDDQ, limits.tested_vdd_vddq_range);
  return <div>
    <h2>Die overclocking research</h2>
    <p className="muted">Observed limits are evidence records, not guaranteed settings. A benchmark or boot ceiling is not a stability result.</p>
    <h3>Current OC comparison</h3>
    <div className="metric-list comparison-metrics">
      <div><span>Current frequency</span><strong>{mtps(profile.mtps)}</strong></div>
      <div><span>Current primaries</span><strong>{primaryTimings(profile.timings)}</strong></div>
      <div><span>Frequency assessment</span><strong><span className={`badge ${frequency.tone}`}>{frequency.label}</span></strong></div>
      <div><span>Frequency margin</span><strong>{frequency.detail}</strong></div>
      <div><span>Current VDD / VDDQ</span><strong>{currentVoltage(profile.voltages.VDD, profile.voltages.VDDQ)}</strong></div>
      <div><span>Voltage evidence</span><strong><span className={`badge ${voltage.tone}`}>{voltage.label}</span></strong></div>
    </div>
    <p className="comparison-note">{voltage.detail} Frequency comparisons use the selected platform’s researched daily range, then stable evidence, then limited, benchmark, or boot evidence. They are not safety guarantees.</p>
    <div className="metric-list research-metrics">
      <div><span>Research status</span><strong>{limits.research_status}</strong></div>
      <div><span>Evidence quality</span><strong>{limits.evidence_quality}</strong></div>
      <div><span>Highest retail profile</span><strong>{mtps(limits.retail_profile_max_mtps)}</strong></div>
      <div><span>Documented stable maximum</span><strong>{mtps(limits.documented_stable_max_mtps)}</strong></div>
      <div><span>Non-stable / benchmark maximum</span><strong>{mtps(limits.documented_benchmark_max_mtps)}</strong></div>
      <div><span>Daily target on selected platform</span><strong>{rangeMtps(daily)}</strong></div>
      <div><span>Tested VDD/VDDQ evidence</span><strong>{rangeVolts(limits.tested_vdd_vddq_range)}</strong></div>
      <div><span>Last researched</span><strong>{limits.last_researched}</strong></div>
    </div>
    <div className="notes">
      {limits.limit_basis && <p><strong>Basis:</strong> {limits.limit_basis}</p>}
      {limits.voltage_scaling && <p><strong>Voltage behavior:</strong> {limits.voltage_scaling}</p>}
      {limits.community_consensus && <p><strong>Community consensus:</strong> {limits.community_consensus}</p>}
      {(limits.community_experiences ?? []).map((note: string) => <p key={note}><strong>Owner experience:</strong> {note}</p>)}
      {(limits.caveats ?? []).map((note: string) => <p key={note}>{note}</p>)}
    </div>
    <h3>Recorded attempts</h3>
    <div className="table-wrap attempt-table"><table><thead><tr><th>Result</th><th>MT/s & timings</th><th>VDD / VDDQ</th><th>Platform & capacity</th><th>Validation</th><th>Evidence</th></tr></thead><tbody>{(limits.attempts ?? []).map((attempt, index) => <tr key={`${attempt.source_url}-${index}`}>
      <td><span className={`badge ${attemptTone(attempt.result)}`}>{attemptResultLabel(attempt.result)}</span><small>{attempt.label}</small></td>
      <td><strong>{mtps(attempt.mtps)}</strong><span>{attempt.timings}</span></td>
      <td>{attemptVoltage(attempt.vdd, attempt.vddq)}</td>
      <td>{attempt.platform}<span>{attempt.capacity}</span></td>
      <td>{attempt.stability}<span>{attempt.cooling}</span></td>
      <td><a href={attempt.source_url} target="_blank" rel="noreferrer">{attempt.confidence} confidence</a><small>{attempt.notes}</small></td>
    </tr>)}</tbody></table></div>
    {!!die.sources?.length && <div className="source-links"><strong>Die research sources</strong>{die.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.source_name}</a>)}</div>}
  </div>;
}

function TimingInput({ timingKey, config, value, onChange }: { timingKey: string; config: ConfigData; value?: number; onChange: (value: string) => void }) {
  const definition = config.timing_definitions[timingKey];
  return <label>{formatTimingId(timingKey)}{definition && <InfoTip text={tooltipText(definition)} />}<input type="number" value={value ?? ""} onChange={(e) => onChange(e.target.value)} /></label>;
}

function Summary({ evaluation }: { evaluation: Evaluation | null }) {
  if (!evaluation) return null;
  return <div className="summary">{Object.entries(evaluation.summary).map(([k, v]) => <div key={k}><span>{summaryLabel(k)}</span><strong>{String(v ?? "N/A")}</strong></div>)}</div>;
}

function TimingTable({ evaluation }: { evaluation: Evaluation | null }) {
  return <div className="table-wrap"><table><thead><tr><th>Timing</th><th>Cycles</th><th>ns</th><th>DDR5 floor</th><th>Die rec.</th><th>Headroom</th><th>Class</th><th>Notes</th></tr></thead><tbody>{evaluation?.timing_results.map((r) => <tr key={r.timing_id}><td><strong>{formatTimingId(r.timing_id)}<InfoTip text={tooltipText(r)} /></strong><span>{r.display_name}</span></td><td>{fmt(r.cycles)}</td><td>{fmt(r.ns)}</td><td>{fmt(r.floor_cycles)}</td><td>{fmt(r.recommended_cycles ?? r.target_cycles)}</td><td>{headroomText(r.headroom_cycles)}</td><td><span className={`badge ${className(r.classification)}`}>{r.classification}</span></td><td><small>{(r.notes ?? []).join(" ")}</small></td></tr>)}</tbody></table></div>;
}

function LatencyPanel({ evaluation }: { evaluation: Evaluation | null }) {
  const data = evaluation?.latency_estimates ?? {};
  const items = [
    ["Predicted bandwidth", data.theoretical_dual_channel_bandwidth_gbps, "GB/s"],
    ["Cycle time", data.cycle_time_ns, "ns"],
    ["tCL", data.cl_ns, "ns"],
    ["tRCD_RD", data.trcd_ns, "ns"],
    ["tRP", data.trp_ns, "ns"],
    ["tRAS", data.tras_ns, "ns"],
    ["tRC", data.trc_ns, "ns"],
    ["tRFC", data.trfc_ns, "ns"]
  ];
  return <div><h2>Bandwidth & Timing ns</h2><div className="metric-list">{items.map(([label, value, unit]) => <div key={label as string}><span>{label}</span><strong>{fmt(value as number)} {unit}</strong></div>)}</div></div>;
}

function HeadroomChart({ evaluation }: { evaluation: Evaluation | null }) {
  const scores = categoryCycleHeadroom(evaluation);
  const max = Math.max(1, ...Object.values(scores));
  return <div><h2>Headroom Dashboard</h2><div className="bar-chart">{Object.entries(scores).map(([category, value]) => {
    const cycles = Math.round(value);
    return <div className="bar-row" key={category}><span>{category}</span><div><i style={{ width: `${Math.min(100, (value / max) * 100)}%` }} /></div><strong>{cycles} cyc</strong></div>;
  })}</div></div>;
}

function VoltagePanel({ evaluation }: { evaluation: Evaluation | null }) {
  return <div><h2>Voltage Guidance</h2><div className="mini-table">{evaluation?.voltage_results.map((v) => <div key={v.voltage_id}><strong>{displayNames[v.voltage_id] ?? v.display_name}</strong><span>{fmt(v.value)} V</span><span className={`badge ${className(v.risk_level)}`}>{v.risk_level}</span></div>)}</div></div>;
}

function PowerPanel({ evaluation }: { evaluation: Evaluation | null }) {
  const p = evaluation?.power_estimate;
  return <div><h2>Power & Heat</h2><div className="metric-list"><div><span>Effective voltage</span><strong>{fmt(p?.effective_voltage)} V</strong></div><div><span>Peak per DIMM</span><strong>{fmt(p?.estimated_power_per_dimm_watts)} W</strong></div><div><span>Kit estimate</span><strong>{fmt(p?.estimated_total_power_watts)} W</strong></div><div><span>Heat basis</span><strong>1 DIMM</strong></div><div><span>Heat</span><strong><span className={`badge ${className(p?.heat_level)}`}>{p?.heat_level ?? "N/A"}</span></strong></div></div><p className="muted">{(p?.notes ?? []).join(" ")}</p></div>;
}

function categoryCycleHeadroom(evaluation: Evaluation | null) {
  const buckets: Record<string, number[]> = {};
  for (const row of evaluation?.timing_results ?? []) {
    if (typeof row.headroom_cycles !== "number") continue;
    if (!buckets[row.category]) buckets[row.category] = [];
    buckets[row.category].push(row.headroom_cycles);
  }
  return Object.fromEntries(Object.entries(buckets).map(([key, values]) => [key, values.reduce((a, b) => a + b, 0) / values.length]));
}

function tooltipText(item: any) {
  return [item.display_name, item.definition, item.performance_relevance, item.stability_relevance, ...(item.dependency_notes ?? []), ...(item.platform_notes ?? [])].filter(Boolean).join("\n");
}

function InfoTip({ text }: { text: string }) {
  return <span className="tip" tabIndex={0}><Info size={12} /><span className="tip-card">{text || "N/A"}</span></span>;
}

function formatTimingId(id: string) {
  return id
    .replace("tRCDRD", "tRCD_RD")
    .replace("tRCDWR", "tRCD_WR")
    .replace("tRFCsb", "tRFC_sb")
    .replace("tWTRS", "tWTR_S")
    .replace("tWTRL", "tWTR_L")
    .replace("tRRDS", "tRRD_S")
    .replace("tRRDL", "tRRD_L")
    .replace("tWRRDSG", "tWRRD_SG")
    .replace("tWRRDDG", "tWRRD_DG")
    .replace("tWRWRSG", "tWRWR_SG")
    .replace("tWRWRDG", "tWRWR_DG")
    .replace("tRDRDSG", "tRDRD_SG")
    .replace("tRDRDDG", "tRDRD_DG")
    .replace("tRDRDSD", "tRDRD_SD")
    .replace("tRDRDDD", "tRDRD_DD");
}

function headroomText(value: any) {
  if (value === null || value === undefined || Number.isNaN(value)) return "range needed";
  return `${fmt(value)} cycles`;
}

function platformAdjustmentNotes(platformId: string) {
  if (platformId.includes("alder") || platformId.includes("raptor") || platformId.includes("arrow")) {
    return [
      "Intel boards often expose the lever, not the final field. tWRPRE or tWTP may move final tWR; tWRRD-style controls may move final tWTRS and tWTRL.",
      "Score the final tWR, tWTRS, and tWTRL values after reboot. The board control name can differ; the final reported timing is what matters."
    ];
  }
  return [
    "AM5 BIOSes more often expose direct tWR, tWTRS, and tWTRL fields. Use the direct field when present.",
    "For UCLK/MCLK changes, compare the final reported timings after training. Do not assume an Intel tWRRD-style value maps one-to-one."
  ];
}

function visibleVoltageKeys(platformId: string) {
  if (platformId.includes("alder") || platformId.includes("raptor") || platformId.includes("arrow")) return [...baseVoltageKeys, ...intelVoltageKeys];
  if (platformId.includes("am5")) return [...baseVoltageKeys, ...amdVoltageKeys];
  return baseVoltageKeys;
}

function selectableDieEntries(config: ConfigData, selectedDieId: string) {
  const entries = Object.entries(config.die_profiles);
  if (!selectedDieId || entries.some(([id]) => id === selectedDieId)) return entries;
  const selected = config.die_profiles[selectedDieId];
  return selected ? [[selectedDieId, selected], ...entries] : entries;
}

function mtps(value?: number) {
  return value ? `${value.toLocaleString()} MT/s` : "Not established";
}

function rangeMtps(value?: [number, number]) {
  return value ? `${value[0].toLocaleString()}-${value[1].toLocaleString()} MT/s` : "Not established";
}

function rangeVolts(value?: [number, number]) {
  return value ? `${value[0].toFixed(2)}-${value[1].toFixed(2)} V` : "Not established";
}

function compareFrequency(current: number, daily?: [number, number], stable?: number, benchmark?: number, failedMax?: number) {
  if (daily && current < daily[0]) return { tone: "gray", label: "Below researched daily range", detail: `${(daily[0] - current).toLocaleString()} MT/s below its lower bound` };
  if (daily && current <= daily[1]) return { tone: "green", label: "Within researched daily range", detail: `${(daily[1] - current).toLocaleString()} MT/s below its upper bound` };
  if (stable && current <= stable) return { tone: "yellow", label: "Above typical daily; within stable evidence", detail: `${(stable - current).toLocaleString()} MT/s below the documented stable maximum` };
  if (stable && current > stable && benchmark && current <= benchmark) return { tone: "orange", label: "Beyond stable evidence", detail: `${(current - stable).toLocaleString()} MT/s above stable; only limited, benchmark, or boot evidence reaches this range` };
  if (!stable && benchmark && current <= benchmark) return { tone: "orange", label: "No stable ceiling; within non-stable evidence", detail: `${(benchmark - current).toLocaleString()} MT/s below the highest limited, benchmark, or boot result` };
  const successfulMax = benchmark ?? stable;
  if (successfulMax && current > successfulMax && failedMax && current <= failedMax) return { tone: "red", label: "In recorded failure territory", detail: `${(current - successfulMax).toLocaleString()} MT/s above the highest successful result; failed attempts extend to ${failedMax.toLocaleString()} MT/s` };
  if (benchmark && current > benchmark) return { tone: "red", label: "Beyond highest successful evidence", detail: `${(current - benchmark).toLocaleString()} MT/s above the non-stable/benchmark maximum` };
  if (stable && current > stable) return { tone: "red", label: "Beyond documented stable evidence", detail: `${(current - stable).toLocaleString()} MT/s above the documented stable maximum` };
  return { tone: "gray", label: "No die-specific maximum established", detail: daily ? `${(current - daily[1]).toLocaleString()} MT/s above the researched daily range` : "No defensible frequency margin can be calculated" };
}

function maxAttemptMtps(attempts: DieProfile["overclocking_limits"]["attempts"], result: string) {
  const values = (attempts ?? []).filter((attempt) => attempt.result === result && attempt.mtps !== undefined).map((attempt) => attempt.mtps as number);
  return values.length ? Math.max(...values) : undefined;
}

function compareVoltage(vdd?: number, vddq?: number, evidence?: [number, number]) {
  if (!evidence) return { tone: "gray", label: "No die-specific range", detail: "No verified die-specific VDD/VDDQ range is available." };
  const values = [vdd, vddq].filter((value): value is number => typeof value === "number");
  if (!values.length) return { tone: "gray", label: "Voltage not entered", detail: `Recorded attempts span ${rangeVolts(evidence)}.` };
  const high = Math.max(...values);
  const low = Math.min(...values);
  if (high > evidence[1]) return { tone: "red", label: "Above recorded voltage evidence", detail: `At least one entered rail is ${(high - evidence[1]).toFixed(2)} V above the highest recorded VDD/VDDQ evidence.` };
  if (low < evidence[0]) return { tone: "yellow", label: "Below recorded evidence range", detail: "Lower voltage may be efficient, but the recorded attempts do not establish stability here." };
  return { tone: "green", label: "Within recorded voltage evidence", detail: `Entered VDD/VDDQ falls within the ${rangeVolts(evidence)} evidence span.` };
}

function primaryTimings(timings: Record<string, number | undefined>) {
  const rcd = timings.tRCDRD ?? timings.tRCD;
  const values = [timings.tCL, rcd, timings.tRP, timings.tRAS];
  return values.some((value) => value === undefined) ? "Incomplete" : values.join("-");
}

function currentVoltage(vdd?: number, vddq?: number) {
  return `${vdd?.toFixed(2) ?? "N/A"} / ${vddq?.toFixed(2) ?? "N/A"} V`;
}

function attemptVoltage(vdd?: number, vddq?: number) {
  if (vdd === undefined && vddq === undefined) return "Not reported";
  return `${vdd?.toFixed(2) ?? "N/R"} / ${vddq?.toFixed(2) ?? "N/R"} V`;
}

function attemptTone(result: string) {
  if (result === "stable") return "green";
  if (result === "limited_stability" || result === "retail_profile") return "yellow";
  if (result === "benchmark" || result === "boot_only" || result === "inferred_demonstration") return "orange";
  if (result === "failed") return "red";
  return "gray";
}

function attemptResultLabel(result: string) {
  return result.replaceAll("_", " ");
}

function summaryLabel(key: string) {
  if (key === "mtps") return "MT/s";
  if (key === "dimm_count") return "DIMMs";
  if (key === "capacity_total_gb") return "Capacity GB";
  if (key === "uclk_mclk_mode") return "UCLK/MCLK";
  if (key === "command_rate") return "Command rate";
  return key.replaceAll("_", " ");
}

function numberOrUndefined(value: string) {
  return value === "" ? undefined : Number(value);
}

function fmt(value: any) {
  if (value === null || value === undefined || Number.isNaN(value)) return "N/A";
  if (typeof value !== "number") return String(value);
  const fixed = value.toFixed(value > 100 ? 0 : 3);
  return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
}

function className(value?: string) {
  if (!value) return "gray";
  if (value.includes("tight") || value === "low") return "green";
  if (value.includes("moderate") || value === "average") return "yellow";
  if (value.includes("very") || value === "extreme") return "red";
  if (value === "high") return "red";
  if (value.includes("loose") || value === "elevated") return "orange";
  return "gray";
}

function downloadJson(profile: MemoryProfile) {
  const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${profile.profile_name.replace(/\W+/g, "_").toLowerCase()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

createRoot(document.getElementById("root")!).render(<App />);
