import { useEffect, useMemo, useRef, useState } from "react";
import { FileUp, Info, Save, Download, Plus, Search, Cpu } from "lucide-react";
import { fetchConfig } from "./lib/api";
import { evaluateStaticProfile, importHwinfoStatic } from "./lib/static-engine";
import { blankProfile, downloadJson, loadNotebook, MAX_IMPORT_BYTES, profileErrors, readNotebook, readProfile, STORAGE_KEY } from "./lib/profiles";
import type { SavedProfile } from "./lib/profiles";
import type { ConfigData, DieProfile, Evaluation, MemoryProfile } from "./lib/types";

const displayNames: Record<string, string> = { CPU_VDDQ: "CPU VDDQ / TX VDDQ", VDDIO_MEM: "VDDIO MEM / CPU I/O", MC_Voltage: "MC voltage / VDD2", SoC: "SoC" };

export default function App() {
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [profile, setProfile] = useState<MemoryProfile | null>(null);
  const [saved, setSaved] = useState<SavedProfile[]>([]);
  const [deleted, setDeleted] = useState<SavedProfile | null>(null);
  const [baselineId, setBaselineId] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState("");
  const [canPersist, setCanPersist] = useState(false);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [showMissing, setShowMissing] = useState(true);
  const importRef = useRef<HTMLInputElement>(null);
  const revision = useRef(0);

  useEffect(() => {
    let active = true;
    setError("");
    fetchConfig().then((cfg) => {
      if (!active) return;
      const restored = loadNotebook(cfg);
      setConfig(cfg); setProfile(restored.notebook.draft); setSaved(restored.notebook.saved);
      setNotice(restored.notice); setCanPersist(restored.canPersist);
      if (!restored.canPersist) setStorageError(restored.notice);
    }).catch((err) => { if (active) setError(errorMessage(err)); });
    return () => { active = false; };
  }, [retry]);

  const errors = useMemo(() => config && profile ? profileErrors(profile, config) : [], [profile, config]);
  const evaluation = useMemo(() => config && profile && !errors.length ? evaluateStaticProfile(profile, config) : null, [profile, config, errors]);
  const baseline = saved.find((entry) => entry.id === baselineId)?.profile;
  const baselineEvaluation = useMemo(() => config && baseline ? evaluateStaticProfile(baseline, config) : null, [baseline, config]);

  useEffect(() => {
    if (!profile || !config || errors.length || !canPersist) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, draft: profile, saved }));
      setStorageError("");
    } catch {
      setStorageError("Local saving failed. Your edits are still here; export a notebook backup to keep them.");
      setCanPersist(false);
    }
  }, [profile, saved, config, errors.length, canPersist]);

  if (!config || !profile) return <main className="boot"><div><Cpu size={36} /><h1>OptimalDDR5</h1>{error ? <><p role="alert">{error}</p><button onClick={() => setRetry(retry + 1)}>Retry loading database</button></> : <p role="status">Loading timing database…</p>}</div></main>;

  const replaceProfile = (next: MemoryProfile) => { revision.current++; setProfile(structuredClone(next)); setError(""); };
  const update = (patch: Partial<MemoryProfile>, hardware = true) => {
    replaceProfile({ ...profile, ...patch, ...(hardware ? { validation_status: "untested" } : {}) });
  };
  const updateTiming = (key: string, value: string) => update({ timings: { ...profile.timings, [key]: numberOrUndefined(value) } });
  const updateVoltage = (key: string, value: string) => update({ voltages: { ...profile.voltages, [key]: numberOrUndefined(value) } });
  const saveSnapshot = () => {
    if (errors.length) return;
    if (saved.length >= 100) { setError("The notebook holds 100 snapshots. Export a backup and remove an old snapshot before saving another."); return; }
    revision.current++;
    setSaved([...saved, { id: crypto.randomUUID(), saved_at: new Date().toISOString(), profile: structuredClone(profile) }]);
    setNotice(`Saved a snapshot of ${profile.profile_name}.`);
  };
  const importFile = async (file: File) => {
    const startedAt = revision.current;
    setBusy(true); setError("");
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error("Import files must be 5 MB or smaller.");
      if (/\.json$/i.test(file.name)) {
        const text = await file.text();
        const raw = JSON.parse(text);
        if (startedAt !== revision.current) throw new Error("Your profile changed during import. Choose the file again to apply it to the current profile.");
        if (raw?.version === 1 && raw?.saved) {
          const notebook = readNotebook(text, config);
          const merged = new Map(saved.map((entry) => [entry.id, entry]));
          notebook.saved.forEach((entry) => { if (!merged.has(entry.id)) merged.set(entry.id, entry); });
          if (merged.size > 100) throw new Error("Combined notebook exceeds 100 snapshots. Remove a few snapshots first.");
          setSaved([...merged.values()]); replaceProfile(notebook.draft);
          setNotice("Imported notebook backup and merged saved snapshots.");
        } else {
          replaceProfile(readProfile(raw, config)); setNotice(`Opened ${file.name}.`);
        }
      } else {
        const imported = await importHwinfoStatic(file, profile, config);
        if (startedAt !== revision.current) throw new Error("Your profile changed during import. Choose the file again to apply it to the current profile.");
        replaceProfile(imported.profile); setNotice(imported.warnings.join(" "));
      }
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };
  const visibleTimings = Object.entries(config.timing_definitions).filter(([id, def]) => {
    const terms = [id, def.display_name, def.definition, ...(def.aliases ?? []), ...(def.bios_aliases ?? [])].join(" ").toLowerCase();
    return (category === "all" || category === def.category) && terms.includes(search.toLowerCase()) && (showMissing || profile.timings[id] != null);
  });
  const voltageKeys = Object.entries(config.voltage_profiles).filter(([, def]) => def.platform_scope.includes("all") || def.platform_scope.includes(profile.platform_id)).map(([id]) => id);
  const entered = evaluation?.timing_results.filter((row) => row.cycles !== null).length ?? 0;

  return <div className="app">
    <a className="skip-link" href="#main-content">Skip to profile</a>
    <aside className="sidebar">
      <div className="brand"><Cpu size={22} />OptimalDDR5</div>
      <nav aria-label="Sections">
        <a href="#profile">Profile</a><a href="#timings">Timings</a><a href="#voltage">Voltage & power</a>
        <a href="#compare">Compare snapshots</a><a href="#research">Die research</a><a href="#validation">Test journal</a><a href="#guide">Guide</a>
      </nav>

    </aside>
    <main className="content" id="main-content">
      <header className="topbar"><div><h1>DDR5 timing analyzer</h1></div>
        <div className="toolbar"><button onClick={() => importRef.current?.click()} disabled={busy}><FileUp size={16} />{busy ? "Importing…" : "Import"}</button>
          <button onClick={() => downloadJson(profile, profile.profile_name)} disabled={!!errors.length}><Download size={16} />Export profile</button>
          <button className="primary-button" onClick={saveSnapshot} disabled={!!errors.length || busy}><Save size={16} />Save snapshot</button>
          <input ref={importRef} className="visually-hidden" tabIndex={-1} aria-label="Import profile or HWiNFO report" type="file" accept=".json,.log,.txt" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importFile(file); }} />
        </div>
      </header>
      <div className="status-line"><span className="status-dot" /><span>{canPersist && !errors.length ? "Draft saved locally" : "Draft in memory"}</span><span>·</span><span>{saved.length} saved {saved.length === 1 ? "snapshot" : "snapshots"}</span><span>·</span><span>External tests: {profile.validation_status ?? "untested"}</span></div>
      {notice && <p className="notice" role="status">{notice}</p>}
      {error && <div className="error" role="alert">{error}</div>}
      {storageError && <div className="error" role="alert">{storageError} <button onClick={() => downloadJson({ version: 1, draft: profile, saved }, "optimalddr5-notebook")} disabled={!!errors.length}>Export backup</button><button onClick={() => setCanPersist(true)} disabled={!!errors.length}>Save current notebook locally</button></div>}
      {!!errors.length && <div className="error" role="alert"><strong>Fix these fields to resume analysis and saving:</strong><ul>{errors.map((message) => <li key={message}>{message}</li>)}</ul></div>}
      <section className="hero-metrics" aria-label="Timing overview">
        <Metric label="Memory clock" value={fmt(evaluation?.latency_estimates.real_clock_mhz)} unit="MHz" note="Data rate ÷ 2" />
        <Metric label="CAS component" value={fmt(evaluation?.latency_estimates.cl_ns)} unit="ns" note="tCL × cycle time" />
        <Metric label="Theoretical bandwidth" value={fmt(evaluation?.latency_estimates.theoretical_bandwidth_gbps)} unit="GB/s" note={`${profile.channel_count ?? 2} × 64-bit populated channels`} />
        <Metric label="Entered timings" value={evaluation ? `${entered} / ${Object.keys(config.timing_definitions).length}` : "—"} note="Blank fields are excluded" />
      </section>

      <section id="profile" className="section">
        <div className="section-heading"><div><h2>Profile</h2></div><button onClick={() => { replaceProfile(blankProfile(profile.platform_id)); setNotice("Started a blank profile. Saved snapshots remain in your notebook."); }}><Plus size={16} />New profile</button></div>
        <div className="workspace-controls">
          <label>Load an example<select value="" onChange={(event) => { const example = config.example_profiles[Number(event.target.value)]; if (example) { replaceProfile({ ...example, channel_count: Math.min(2, example.dimm_count), validation_status: "untested" }); setNotice("Loaded an illustrative example. Replace its fields with your actual reported settings."); } }}><option value="" disabled>Choose a sample setup…</option>{config.example_profiles.map((item, i) => <option value={i} key={item.profile_name}>{item.profile_name}</option>)}</select></label>
          <label>Open a saved snapshot<select value="" onChange={(event) => { const entry = saved.find((item) => item.id === event.target.value); if (entry) { replaceProfile(entry.profile); setNotice("Opened a snapshot as the editable draft. The saved snapshot is unchanged."); } }}><option value="" disabled>{saved.length ? "Choose a snapshot…" : "Save your first snapshot"}</option>{saved.map((entry) => <option value={entry.id} key={entry.id}>{entry.profile.profile_name} · {new Date(entry.saved_at).toLocaleString()}</option>)}</select></label>
        </div>
        <p className="muted">Import HWiNFO .LOG/.TXT reports, profile JSON, or notebook backups. Maximum file size: 5 MB.</p>
        <div className="form-grid">
          <label>Profile name<input value={profile.profile_name} aria-invalid={!profile.profile_name.trim()} onChange={(e) => update({ profile_name: e.target.value }, false)} /></label>
          <label>Platform<select value={profile.platform_id} onChange={(e) => update({ platform_id: e.target.value })}>{Object.entries(config.platform_profiles).map(([id, def]) => <option key={id} value={id}>{def.display_name}</option>)}</select></label>
          <label>Die type<select value={profile.die_id} onChange={(e) => update({ die_id: e.target.value })}><option value="unknown">Unknown / unconfirmed</option>{Object.entries(config.die_profiles).map(([id, def]) => <option key={id} value={id}>{def.vendor} {def.generation_or_revision}</option>)}</select></label>
          <NumberField label="Data rate (MT/s)" value={profile.mtps} min={1000} max={20000} onChange={(value) => update({ mtps: value })} />
          <NumberField label="Total capacity (GB)" value={profile.capacity_total_gb} min={1} max={2048} onChange={(value) => update({ capacity_total_gb: value })} />
          <NumberField label="DIMM count" value={profile.dimm_count} min={1} max={4} onChange={(value) => update({ dimm_count: value, channel_count: value === 1 ? 1 : profile.channel_count })} />
          <label>Populated 64-bit channels<select value={profile.channel_count ?? 2} aria-invalid={(profile.channel_count ?? 2) > profile.dimm_count} onChange={(e) => update({ channel_count: Number(e.target.value) })}><option value={1}>1 channel</option><option value={2}>2 channels</option></select><small>Two DDR5 subchannels total 64 bits per module.</small></label>
          <label>Rank per DIMM<select value={profile.rank ?? ""} onChange={(e) => update({ rank: e.target.value })}><option value="">Unknown</option><option value="single-rank">Single rank</option><option value="dual-rank">Dual rank</option>{profile.rank && !["single-rank", "dual-rank"].includes(profile.rank) && <option>{profile.rank}</option>}</select></label>
          <label>Command rate<input placeholder="e.g. 2T" value={profile.command_rate ?? ""} onChange={(e) => update({ command_rate: e.target.value })} /></label>
          <label>UCLK/MCLK or Gear mode<input placeholder="Verify after training" value={profile.uclk_mclk_mode ?? ""} onChange={(e) => update({ uclk_mclk_mode: e.target.value })} /></label>
          <label>BIOS version<input placeholder="Optional" value={profile.bios_version ?? ""} onChange={(e) => update({ bios_version: e.target.value })} /></label>
        </div>
        <label className="notes-field">Hardware & tuning notes<textarea rows={3} placeholder="CPU, motherboard, kit part number, cooling, and what changed…" value={profile.notes ?? ""} onChange={(e) => update({ notes: e.target.value }, false)} /></label>
      </section>

      <section id="timings" className="section">
        <div className="section-heading"><div><h2>Timings</h2></div><span className="count">{entered} reported</span></div>
        <p>Ranges are comparison references, not guaranteed tuning targets.</p>
        <div className="filter-row"><label className="search"><Search size={16} /><span className="visually-hidden">Search timings</span><input placeholder="Search a timing, alias, or definition…" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
          <label>Category<select value={category} onChange={(e) => setCategory(e.target.value)}><option value="all">All timings</option>{[...new Set(Object.values(config.timing_definitions).map((def) => def.category))].map((key) => <option key={key}>{key}</option>)}</select></label>
          <label className="checkbox"><input type="checkbox" checked={showMissing} onChange={(e) => setShowMissing(e.target.checked)} />Show blank fields</label>
        </div>
        <div className="dense-grid timing-inputs">{visibleTimings.map(([id]) => <TimingInput key={id} timingKey={id} config={config} value={profile.timings[id]} onChange={(value) => updateTiming(id, value)} />)}</div>
        {!visibleTimings.length && <p className="empty-state">No timings match. Clear the search or enable blank fields.</p>}
        <TimingTable evaluation={evaluation} visibleIds={visibleTimings.map(([id]) => id)} />
        <div className="two-col analysis-panels"><LatencyPanel evaluation={evaluation} /><HeadroomChart evaluation={evaluation} /></div>
        {!!evaluation?.recommendations.length && <div className="notes"><h3>Analysis notes</h3>{evaluation.recommendations.map((item) => <p key={item}>{item}</p>)}</div>}
      </section>

      <section id="voltage" className="section">
        <h2>Voltages & power</h2>
        <div className="dense-grid voltage-inputs">{voltageKeys.map((key) => <label key={key}>{displayNames[key] ?? key} (V)<input type="number" min="0.01" max="5" step="0.01" placeholder="Unknown" value={profile.voltages[key] ?? ""} aria-invalid={profile.voltages[key] != null && (!Number.isFinite(profile.voltages[key]) || profile.voltages[key]! <= 0 || profile.voltages[key]! > 5)} onChange={(e) => updateVoltage(key, e.target.value)} /></label>)}</div>
        <div className="two-col analysis-panels"><VoltagePanel evaluation={evaluation} /><PowerPanel evaluation={evaluation} /></div>
        <details><summary>Platform controls and caveats</summary><div className="notes">{[...platformAdjustmentNotes(profile.platform_id), ...(evaluation?.platform_notes ?? [])].map((item) => <p key={item}>{item}</p>)}</div></details>
      </section>

      <section id="compare" className="section">
        <div className="section-heading"><div><h2>Compare snapshots</h2></div><button disabled={!!errors.length} onClick={() => downloadJson({ version: 1, draft: profile, saved }, "optimalddr5-notebook")}><Download size={16} />Export notebook backup</button></div>
        {!saved.length ? <p className="empty-state">Save a snapshot to compare it with the current profile.</p> : <>
          <label>Compare current draft with<select value={baselineId} onChange={(e) => setBaselineId(e.target.value)}><option value="">Choose a baseline…</option>{saved.map((entry) => <option value={entry.id} key={entry.id}>{entry.profile.profile_name} · {new Date(entry.saved_at).toLocaleString()}</option>)}</select></label>
          <Comparison current={evaluation} baseline={baselineEvaluation} />
          <details><summary>Manage {saved.length} saved snapshots</summary><ul className="snapshot-list">{saved.map((entry) => <li key={entry.id}><div><strong>{entry.profile.profile_name}</strong><small>{entry.profile.mtps} MT/s · {new Date(entry.saved_at).toLocaleString()} · External tests: {entry.profile.validation_status ?? "untested"}</small></div><button aria-label={`Remove snapshot ${entry.profile.profile_name}`} onClick={() => { revision.current++; setDeleted(entry); setSaved(saved.filter((item) => item.id !== entry.id)); if (baselineId === entry.id) setBaselineId(""); }}>Remove</button></li>)}</ul></details>
        </>}
        {deleted && <p className="notice">Removed {deleted.profile.profile_name}. <button onClick={() => { if (saved.length >= 100) { setError("Remove a snapshot before restoring this one."); return; } revision.current++; setSaved([...saved, deleted]); setDeleted(null); }}>Undo removal</button></p>}
      </section>

      <section id="research" className="section"><h2>Die research</h2>{profile.die_id === "unknown" ? <p className="empty-state">Select a confirmed die to view recorded overclock attempts.</p> : <details><summary>View {config.die_profiles[profile.die_id]?.vendor} {config.die_profiles[profile.die_id]?.generation_or_revision} evidence and recorded attempts</summary><OverclockingResearch die={config.die_profiles[profile.die_id]} profile={profile} /></details>}</section>

      <section id="validation" className="section"><h2>Test journal</h2><p>Record external test results. Changing a setting resets the test status and retains previous notes.</p>
        <div className="two-col journal"><label>External test status<select value={profile.validation_status ?? "untested"} onChange={(e) => update({ validation_status: e.target.value as MemoryProfile["validation_status"] }, false)}><option value="untested">Untested</option><option value="testing">Testing in progress</option><option value="passed">Passed recorded tests</option><option value="failed">Errors / failed tests</option></select><small>Self-reported; passing tests does not guarantee every workload.</small></label>
          <label>Test evidence<textarea rows={5} value={profile.validation_notes ?? ""} placeholder="Tool and version, date, duration/passes, errors, DIMM temperature, workload results, and BIOS settings tested…" onChange={(e) => update({ validation_notes: e.target.value }, false)} /></label></div>
      </section>
      <Guide />

    </main>
  </div>;
}

function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
function Metric({ label, value, unit, note }: { label: string; value: string; unit?: string; note: string }) {
  return <div className="metric-card"><span>{label}</span><strong>{value} {value !== "N/A" && <small>{unit}</small>}</strong><p>{note}</p></div>;
}
function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <label>{label}<input type="number" min={min} max={max} step={1} value={Number.isNaN(value) ? "" : value} aria-invalid={!Number.isInteger(value) || value < min || value > max} onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))} /></label>;
}
function Comparison({ current, baseline }: { current: Evaluation | null; baseline: Evaluation | null }) {
  if (!baseline) return null;
  if (!current) return <p className="empty-state">Correct the draft fields to compare results.</p>;
  const rows: Array<[string, number | null | undefined, number | null | undefined, string]> = [
    ["Data rate", baseline.profile.mtps, current.profile.mtps, "MT/s"],
    ["Theoretical bandwidth", baseline.latency_estimates.theoretical_bandwidth_gbps, current.latency_estimates.theoretical_bandwidth_gbps, "GB/s"],
    ...current.timing_results.filter((row) => row.cycles !== null || baseline.profile.timings[row.timing_id] != null).map((row) => [row.timing_id, baseline.latency_estimates.cycle_time_ns! * (baseline.profile.timings[row.timing_id] ?? NaN), row.ns, "ns"] as [string, number, number | null, string]),
    ...Object.keys({ ...baseline.profile.voltages, ...current.profile.voltages }).filter((key) => baseline.profile.voltages[key] != null || current.profile.voltages[key] != null).map((key) => [key, baseline.profile.voltages[key], current.profile.voltages[key], "V"] as [string, number | undefined, number | undefined, string])
  ];
  return <><p className="muted">Baseline: {baseline.profile.profile_name}. Delta = current − baseline.</p>{(baseline.profile.platform_id !== current.profile.platform_id || baseline.profile.channel_count !== current.profile.channel_count) && <p className="muted">Platform or channel configuration differs.</p>}<div className="table-wrap comparison-table"><table><caption>Current draft versus saved baseline</caption><thead><tr><th scope="col">Metric</th><th scope="col">Baseline</th><th scope="col">Current</th><th scope="col">Delta</th></tr></thead><tbody>{rows.map(([label, before, after, unit]) => <tr key={label}><th scope="row">{label}</th><td>{fmt(before)} {unit}</td><td>{fmt(after)} {unit}</td><td>{typeof before === "number" && Number.isFinite(before) && typeof after === "number" && Number.isFinite(after) ? `${after - before > 0 ? "+" : ""}${fmt(after - before)} ${unit}` : "Not comparable"}</td></tr>)}</tbody></table></div></>;
}
function Guide() {
  return <section id="guide" className="section"><details><summary>Help & calculation notes</summary>
    <ul className="guide-steps">
      <li><strong>Profiles:</strong> The current draft autosaves in this browser. Saved snapshots are separate. Export a notebook backup before clearing browser data. Report imports replace timings and preserve the selected platform, die, and manual voltages.</li>
      <li><strong>Timing math:</strong> Clock MHz = MT/s ÷ 2; cycle ns = 2000 ÷ MT/s. At 6000 MT/s, the clock is 3000 MHz, the cycle is 0.333 ns, and CL30 = 10 ns. These are timing components, not measured system latency.</li>
      <li><strong>Bandwidth:</strong> MT/s × 8 bytes × populated 64-bit channels ÷ 1000 gives the theoretical GB/s ceiling. Four DIMMs on a dual-channel CPU still use two channels.</li>
      <li><strong>Comparison ranges:</strong> Timing and voltage bands are references, not safe limits or stability results. A manufacturer's XMP/EXPO qualification applies to specified hardware. Higher tREFI refreshes less often; IC, temperature, and refresh mode affect reliability.</li>
      <li><strong>Power:</strong> Wattage and load bands come from an unvalidated comparative model, not sensor measurements. Missing VDD/VDDQ uses 1.10 V assumptions. The model does not estimate temperature and has no validated error bounds.</li>
      <li><strong>Testing:</strong> Save a baseline, change one setting, verify trained values, and record external stress tests and workload results. Include tool version, duration, errors, temperatures, and BIOS settings. Passing tests does not guarantee every workload. The app does not apply BIOS settings or run memory tests.</li>
    </ul>
    <div className="source-links"><a href="https://www.kingston.com/en/blog/pc-performance/mts-vs-mhz" target="_blank" rel="noreferrer">Kingston: units</a><a href="https://www.intel.com/content/www/us/en/gaming/extreme-memory-profile-xmp.html" target="_blank" rel="noreferrer">Intel: XMP</a><a href="https://www.amd.com/en/products/processors/technologies/expo.html" target="_blank" rel="noreferrer">AMD: EXPO</a><a href="https://www.memtest86.com/troubleshooting.htm" target="_blank" rel="noreferrer">MemTest86: errors</a></div>
  </details></section>;
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
    <div className="table-wrap attempt-table"><table><thead><tr><th scope="col">Result</th><th scope="col">MT/s & timings</th><th scope="col">VDD / VDDQ</th><th scope="col">Platform & capacity</th><th scope="col">Validation</th><th scope="col">Evidence</th></tr></thead><tbody>{(limits.attempts ?? []).map((attempt, index) => <tr key={`${attempt.source_url}-${index}`}>
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
  return <label><span>{formatTimingId(timingKey)}{definition && <InfoTip text={tooltipText(definition)} />}</span><input aria-label={formatTimingId(timingKey)} type="number" min={0} max={1000000} step={1} placeholder="Unknown" value={value ?? ""} aria-invalid={value != null && (!Number.isInteger(value) || value < 0 || value > 1000000)} onChange={(e) => onChange(e.target.value)} /></label>;
}

function Summary({ evaluation }: { evaluation: Evaluation | null }) {
  if (!evaluation) return null;
  return <div className="summary">{Object.entries(evaluation.summary).map(([k, v]) => <div key={k}><span>{summaryLabel(k)}</span><strong>{String(v ?? "N/A")}</strong></div>)}</div>;
}

function TimingTable({ evaluation, visibleIds }: { evaluation: Evaluation | null; visibleIds: string[] }) {
  if (!evaluation?.timing_results.some((row) => visibleIds.includes(row.timing_id) && row.cycles !== null)) return <p className="empty-state">Enter a timing above to see its nanoseconds and reference comparison.</p>;
  return <div className="table-wrap"><table><caption>Timing calculations and reference comparisons</caption><thead><tr><th scope="col">Timing</th><th scope="col">Cycles</th><th scope="col">ns</th><th scope="col">Community ref.</th><th scope="col">Die / ref. target</th><th scope="col">Ref. difference</th><th scope="col">Comparison</th><th scope="col">Notes</th></tr></thead><tbody>{evaluation?.timing_results.filter((r) => visibleIds.includes(r.timing_id) && r.cycles !== null).map((r) => <tr key={r.timing_id}><td><strong>{formatTimingId(r.timing_id)}<InfoTip text={tooltipText(r)} /></strong><span>{r.display_name}</span></td><td>{fmt(r.cycles)}</td><td>{fmt(r.ns)}</td><td>{fmt(r.floor_cycles)}</td><td>{fmt(r.recommended_cycles ?? r.target_cycles)}</td><td>{headroomText(r.headroom_cycles)}</td><td><span className={`badge ${className(r.classification)}`}>{r.classification.replaceAll("_", " ")}</span><small>{r.source_confidence} confidence</small></td><td><small>{(r.notes ?? []).join(" ")}</small></td></tr>)}</tbody></table></div>;
}

function LatencyPanel({ evaluation }: { evaluation: Evaluation | null }) {
  const data = evaluation?.latency_estimates ?? {};
  const items = [
    ["Theoretical bandwidth", data.theoretical_bandwidth_gbps, "GB/s"],
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
  return <div><h3>Reference differences by category</h3><p className="muted">Mean cycle difference; category scales differ.</p><div className="bar-chart">{Object.entries(scores).map(([category, value]) => {
    const cycles = Math.round(value);
    return <div className="bar-row" key={category}><span>{category}</span><div><i style={{ width: `${Math.min(100, (value / max) * 100)}%` }} /></div><strong>{cycles} cyc</strong></div>;
  })}</div></div>;
}

function VoltagePanel({ evaluation }: { evaluation: Evaluation | null }) {
  return <div><h3>Voltage comparison bands</h3><div className="mini-table">{evaluation?.voltage_results.map((v) => <div key={v.voltage_id}><strong>{displayNames[v.voltage_id] ?? v.display_name}</strong><span>{fmt(v.value)} V</span><span className={`badge ${className(v.risk_level)}`}>{v.risk_level}</span><p>{(v.notes ?? []).join(" ")}</p></div>)}</div></div>;
}

function PowerPanel({ evaluation }: { evaluation: Evaluation | null }) {
  const p = evaluation?.power_estimate;
  return <div><h3>Illustrative power model</h3><div className="metric-list"><div><span>Effective voltage</span><strong>{fmt(p?.effective_voltage)} V</strong></div><div><span>Estimate per DIMM</span><strong>{fmt(p?.estimated_power_per_dimm_watts)} W</strong></div><div><span>Kit estimate</span><strong>{fmt(p?.estimated_total_power_watts)} W</strong></div><div><span>Load-band basis</span><strong>1 DIMM</strong></div><div><span>Estimated load band</span><strong><span className={`badge ${className(p?.heat_level)}`}>{p?.heat_level ?? "N/A"}</span></strong></div></div><p className="muted">{(p?.notes ?? []).join(" ")}</p></div>;
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
  return <span className="tip" tabIndex={0} role="img" aria-label={text}><Info size={12} /><span className="tip-card" aria-hidden="true">{text || "N/A"}</span></span>;
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
  if (value === null || value === undefined || (typeof value === "number" && !Number.isFinite(value))) return "Not entered / no range";
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
  if (successfulMax && current > successfulMax && failedMax && current <= failedMax) return { tone: "red", label: "Above successful records", detail: `${(current - successfulMax).toLocaleString()} MT/s above the highest successful result; failures in other setups were recorded up to ${failedMax.toLocaleString()} MT/s` };
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
  if (value === null || value === undefined || (typeof value === "number" && !Number.isFinite(value))) return "N/A";
  if (typeof value !== "number") return String(value);
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
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
