Note: This is still under development and research/validation is not done.

# OptimalDDR5

OptimalDDR5 is a DDR5 RAM timing analyzer. It's a practical tuning notebook, timing analyzer and guide for general OC limits: enter or import a DDR5 profile from HWiNFO .LOG report, convert cycles to nanoseconds, compare timings against OC limits, inspect predicted power consumption, and estimate single-DIMM heat risk.

## Features

- DDR5 timing conversion: MT/s, real clock, cycle time, predicted bandwidth, and high-impact timing latency in ns.
- Timing glossary with aliases, BIOS naming notes, and dependency notes such as `tWRPRE`/`tWR` and `tWRRD`/`tWTR`.
- Die/platform/frequency range comparison with tight/moderate/loose/unknown classification.
- Per-die overclock research separating retail profiles, stability-tested ceilings, benchmark/boot records, daily target ranges, and user consensus.
- AMD AM5 and Intel Alder/Raptor/Arrow Lake voltage guidance with low/average/elevated/high bands.
- Die-calibrated voltage-based DIMM peak power and heat estimate.
- Examples spanning Hynix 16Gb/24Gb, Samsung 32Gb, Micron 16Gb D-die, and CXMT 24Gb behavior.
- HWiNFO `.LOG` import for timing/profile values found in the Memory section.
- Editable YAML database under `config/`.

## Architecture

- `frontend/src/lib/static-engine.ts`: browser-side timing evaluation, HWiNFO import parsing, voltage comparison, and power estimation.
- `frontend/public/data/`: compact JSON generated from the editable YAML database for static hosting.
- `config/`: editable timing definitions, die profiles, voltage ranges, platform notes, power coefficients, and examples.
- `frontend/`: React/Vite UI for profile entry, timing inspection, voltage review, and heat output.
- `src/optimalddr5/`: Python reference implementation and validation tests for the same formulas and data model.
- `tests/`: focused tests for formulas, YAML loading, import behavior, evaluator rules, and power estimates.

## Database

Edit YAML files in `config/`:

- `timing_definitions.yaml`: timing definitions, categories, aliases, dependency notes.
- `timing_aliases.yaml`: import and UI aliases mapped to canonical timing names.
- `die_profiles.yaml`: the requested 18-die allowlist, measured and observed overclock limits, community consensus, timing/voltage ranges, and source confidence.
- `platform_profiles.yaml`: AM5/Intel mode notes, quirks, voltage controls.
- `voltage_profiles.yaml`: voltage descriptions and risk ranges.
- `power_model.yaml`: effective voltage weights, die power calibration, capacity scaling, and heat thresholds.
- `example_profiles.yaml`: built-in sample profiles.

Regenerate the static JSON after editing YAML:

```powershell
python scripts\build_static_data.py
```

Restart or reload the app after edits.

## HWiNFO Import

Use the import button and select a `.LOG` file. The parser looks for a Memory section and extracts timing, frequency, capacity, DIMM count, command rate, and likely die hints where present. Manual voltages are preserved because HWiNFO report logs do not reliably contain live memory rail telemetry.

## Source Warning

The database keeps retail/XMP specifications, stability-tested results, benchmark or boot-only records, and owner anecdotes separate. `Not established` is intentional for rare dies without credible consumer evidence. Nothing is guaranteed: CPU IMC quality, board topology, BIOS, DIMM count, rank, PMIC behavior, thermals, and workload can all change what is usable.
