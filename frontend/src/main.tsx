import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { FileUp, Info, Save } from "lucide-react";
import { evaluateProfile, fetchConfig, importHwinfo } from "./lib/api";
import type { ConfigData, Evaluation, MemoryProfile } from "./lib/types";
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
const commonDieIds = new Set([
  "hynix_16g_m_die",
  "hynix_16g_a_die",
  "hynix_24g_m_die",
  "samsung_16g_early",
  "micron_16g_early",
  "jedec_generic"
]);

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
  const entries = Object.entries(config.die_profiles).filter(([id]) => commonDieIds.has(id));
  if (!selectedDieId || entries.some(([id]) => id === selectedDieId)) return entries;
  const selected = config.die_profiles[selectedDieId];
  return selected ? [[selectedDieId, selected], ...entries] : entries;
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
  return typeof value === "number" ? value.toFixed(value > 100 ? 0 : 3).replace(/\.?0+$/, "") : String(value);
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
