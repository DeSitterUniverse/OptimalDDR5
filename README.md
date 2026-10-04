# OptimalDDR5

A browser-based DDR5 timing analyzer and profile notebook. Enter current BIOS settings or import a HWiNFO text report, inspect timing components in nanoseconds, compare saved profiles, and record external stability tests.

## Run the app

Install Node.js 22.13 or newer, then run:

```powershell
cd frontend
npm.cmd ci
npm.cmd run dev
```

Open **http://127.0.0.1:5174/**. Profiles are evaluated in the browser; a Python server is optional.

For a production build, run `npm.cmd run build` and `npm.cmd run preview` from `frontend/`. Serve `frontend/dist/` with a static web server. Relative asset paths support hosting in a subdirectory. Opening `index.html` with `file://` does not support the database fetches.

## Profiles and imports

- The editable draft autosaves locally when its fields are valid. **Save snapshot** retains a separate copy for comparison.
- **Import** accepts HWiNFO `.LOG`/`.TXT` text reports, exported profile JSON, and notebook backups, up to 5 MB. Sensor CSV files are not supported.
- Report imports replace timing fields and preserve the selected platform, die, and manually entered voltages. XMP text does not identify the CPU platform. Manufacturer/density hints do not confirm a die revision.
- Missing timings and voltages remain unknown. Changing a hardware setting resets the external test status; previous test notes remain available for reference.
- **Export profile** saves the current profile. **Export notebook backup** includes the draft and all snapshots. Importing a backup merges snapshots by ID and restores its draft.
- Storage belongs to the browser and site address. Another browser, port, or hostname has a separate notebook. Export a backup before clearing site data. Storage failures leave current edits available for export.

The notebook supports 100 snapshots. Removing one provides an Undo action during the current session.

## Interpretation

Clock MHz = MT/s / 2; cycle ns = 2000 / MT/s. At 6000 MT/s, CL30 is a 10 ns CAS component, not measured system latency. Theoretical bandwidth uses the selected number of populated **64-bit channels**; four DIMMs on a dual-channel CPU still use two channels.

Timing classifications and voltage bands are reference comparisons, not safe limits, stability verdicts, or guaranteed targets. Die ranges at other frequencies are interpolated or scaled and receive reduced confidence. General ranges are community comparisons, not JEDEC minimums.

The power model is an **unvalidated comparative heuristic**. It does not measure watts, estimate temperature, or establish thermal safety. Missing VDD/VDDQ uses 1.10 V assumptions within the model without filling the profile fields. Die coefficients have not been independently validated against measurements.

The app cannot apply BIOS settings or test memory. Use external tools and record conditions. Die research retains retail profiles, reported stability tests, limited/failed attempts, benchmark results, and boot records as separate evidence. The existing 18-die histories have not all been independently reverified; their research dates remain visible.

See [research sources and findings](docs/research-review.md) and [implementation review](docs/app-review.md).

## Database and reference API

Python 3.12 or newer is required for YAML generation, the reference API, and its tests. From the repository root:

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.venv\Scripts\python.exe scripts\build_static_data.py
.venv\Scripts\python.exe -m uvicorn optimalddr5.api.main:app --app-dir src --host 127.0.0.1 --port 8000
```

API documentation: `http://127.0.0.1:8000/docs`. The frontend uses the browser engine rather than this server.

Edit YAML under `config/`, then regenerate browser JSON. `timing_reference_ranges.yaml` contains shared general comparison ranges; die evidence remains in `die_profiles.yaml`. Regenerate fixtures after intentional calculation/database changes:

```powershell
.venv\Scripts\python.exe scripts\build_static_data.py
.venv\Scripts\python.exe scripts\build_engine_fixtures.py
```

## Checks

```powershell
.venv\Scripts\python.exe -m pytest -q
.venv\Scripts\python.exe scripts\build_static_data.py --check
.venv\Scripts\python.exe scripts\build_engine_fixtures.py --check
cd frontend
npm.cmd test
npm.cmd run build
npm.cmd audit
```

CI runs Python tests, generated-data checks, browser/Python calculation comparisons, React workflow tests, and the production build.
