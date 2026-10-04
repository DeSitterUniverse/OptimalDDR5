# OptimalDDR5 research and usability review

Reviewed 2026-10-04 against the existing README, timing/alias, die, platform, voltage and power YAML schemas, and both calculation implementations. This document records findings from that review; implementation status is tracked in the accompanying commits. External evidence below comes from manufacturers, a diagnostic-tool vendor and web standards bodies. This review does not independently validate the database's 18 die-specific tuning histories or measure DIMM power, temperature, performance or stability.

## 1. Explain data rate, clock and timing-derived latency

DDR transfers data on both clock edges. Use **MT/s** for effective data rate and **MHz** for memory clock. Kingston explains this distinction in its [MT/s versus MHz guide](https://www.kingston.com/en/blog/pc-performance/mts-vs-mhz).

The current formulas are appropriate: clock MHz = MT/s / 2; cycle ns = 2000 / MT/s; timing ns = cycles × cycle ns. Thus DDR5-6000 has a 3000 MHz clock and CL30 corresponds to 10 ns. These are arithmetic conversions, not measurements. Label CAS output as **CAS timing**, and explain that CPU-observed memory latency also depends on controller scheduling, other timings and the access pattern. Preserve missing timings as missing rather than making an imported profile appear complete through example defaults.

Recommendation: put MT/s and the conversion near the speed input, keep units on every result, and distinguish illustrative examples from the user's actual settings. Reject non-finite, non-positive speed values before calculating.

## 2. Separate bandwidth assumptions from DIMM count

A conventional DDR5 module has two 32-bit subchannels but still has a total 64-bit data width. This is explicit in Kingston's [DDR5 technical overview, page 2](https://media.kingston.com/kingston/articles/MKF_954-DDR5-Collateral_us.pdf). This document also gives nominal VDD/VDDQ/VPP values of 1.1/1.1/1.8 V; these nominal values do not establish overclocking limits.

Kingston's [memory population rules](https://www.kingston.com/en/memory/memory-population-rules) explain that mainstream dual-channel systems can have two sockets per channel: four DIMMs do not provide quad-channel bandwidth. Follow the motherboard's slot-population instructions.

The app originally always calculated MT/s × 2 × 8 / 1000 and labeled it "Predicted bandwidth", even for a single DIMM. Recommendation: ask for active **64-bit CPU memory channels**, or explicitly label the result as a dual-channel theoretical ceiling. For standard modules, DDR5-6000 is 48 GB/s per populated 64-bit channel or 96 GB/s across two channels. This is a decimal transfer ceiling; it does not predict a benchmark. Do not multiply again for DDR's two edges, DDR5 subchannels, additional ranks or two DIMMs sharing one channel. If channel population is unknown, state the assumption.

## 3. Keep platform comparisons and certification contextual

Intel describes XMP profiles as combinations of speed, timing and voltage, and certification as testing on particular motherboards and processors. Its [XMP documentation](https://www.intel.com/content/www/us/en/gaming/extreme-memory-profile-xmp.html) also explains BIOS configuration and operation outside specifications. AMD describes EXPO as memory overclocking and provides a compatibility list in its [EXPO documentation](https://www.amd.com/en/products/processors/technologies/expo.html).

For a concrete topology example, AMD's [Ryzen 7 7700 specification](https://www.amd.com/en/products/processors/desktops/ryzen/7000-series/amd-ryzen-7-7700.html) lists two memory channels, DDR5-5200 for two single- or dual-rank DIMMs, and DDR5-3600 for four DIMMs. These figures apply to that CPU, not all AM5 processors.

Recommendation: call stored "daily"/voltage bands **reference ranges**, show their source and confidence, and retain "not established" when evidence is absent. A value inside a range means only that it matches a database comparison. It is not a safety or stability verdict. Do not promote a die-level record into a guarantee for the selected CPU, motherboard, BIOS, capacity or cooling. A platform selector lacks enough information to enforce CPU-model-specific limits. Reference the manufacturer's specification, motherboard manual and QVL in the user's workflow.

## 4. Present power as an unvalidated comparative model

Micron explains that its [DRAM power-calculation tools](https://www.micron.com/sales-support/design-tools/dram-power-calculator) model system conditions and memory-access schemes. That supports recording workload assumptions rather than asserting a single universal DIMM wattage.

The reviewed power YAML has voltage/capacity exponents, voltage weights, per-die watt coefficients and arbitrary watt bands. Its entries use "calibration" language but do not attach measurement procedures, workloads, sources or errors. The implementation does not model traffic, clock-dependent activity, refresh mode, rank arrangement, PMIC efficiency, ambient temperature, heat spreaders or airflow. Some coefficients are already marked provisional.

Recommendation: display **illustrative power estimate** and **estimated power-load band**, not measured peak watts or thermal risk. Explain that watts alone cannot determine DIMM temperature, stability or a safe voltage. Report unknown/assumed rails explicitly. Adding more numerical precision cannot remedy absent calibration; use modest precision. Retain model coefficients as estimates until reproducible measurements justify stronger claims. A future calibration record should include module part number, IC identification, capacity/ranks, speed/rails, workload, measurement point/instrument, ambient/cooling and repeated-run uncertainty.

## 5. Keep refresh-temperature guidance IC-specific

The manufacturer-authored [Micron 16Gb DDR5 Rev D addendum, Rev. F April 2024, page 6](https://mm.digikey.com/Volume0/opasdata/d220001/medias/docus/7969/16gb-ddr5-sdram-dierevd.pdf), hosted by DigiKey, specifies 8192 normal-mode refreshes per 32 ms through 85°C and per 16 ms above 85°C through 95°C: tREFI is approximately 3.9 µs or 1.95 µs respectively. The relevant quantity is component case temperature under that part's operating conditions. Those specifications do not establish an overclocked retail module's stability temperature.

Recommendation: retain the existing high-tREFI warning, explain that extending refresh intervals reduces retention margin, and avoid a universal "safe tREFI", DDR4-derived 7.8 µs baseline or OC temperature cutoff. Convert cycles using the entered data rate but keep refresh mode and IC provenance visible. A low estimated power band must not suppress this warning.

## 6. Make validation a useful notebook workflow

PassMark's [MemTest86 user guide](https://www.memtest86.com/downloads/MemTest86_User_Guide_UEFI.pdf) explains that the diagnostic implicitly exercises the CPU, caches and motherboard as well as memory. Its [troubleshooting guidance](https://www.memtest86.com/troubleshooting.htm) describes differences across test configurations and passes and recommends trying standard timings when aggressive settings fail.

Recommendation: allow profiles to record CPU/board/BIOS, test name/version, configuration, duration or coverage, error count, observed temperatures/cooling and result notes. Save and export the evidence alongside settings. Describe a completed zero-error run as evidence for that configuration and run; a boot, benchmark or classification is not a stability test. A practical help checklist can cover saving a known-good profile, changing one variable, running an independent diagnostic plus relevant workloads, recording errors/temperatures, and restoring defaults when errors appear. This checklist is an app-workflow recommendation, not a manufacturer-defined universal certification protocol.

## 7. Make saving and form feedback resilient

The [WHATWG Web Storage specification](https://html.spec.whatwg.org/multipage/webstorage.html) permits storage access to throw `SecurityError` and writes to fail with `QuotaExceededError`, including when storage is disabled. Browser storage is scoped to an origin.

Recommendation: guard reads and writes, validate persisted/imported JSON and schema versions, keep the editor functional on storage failures, and offer file export/import as a portable backup. A failed save must show a clear notice instead of silently claiming persistence. Profile import should validate before replacing the current work and make absent fields and inferred values visible.

W3C's [form-label guidance](https://www.w3.org/WAI/tutorials/forms/labels/) calls for programmatically associated labels. Its [validation guidance](https://www.w3.org/WAI/tutorials/forms/validation/) explains input constraints, and [notification guidance](https://www.w3.org/WAI/tutorials/forms/notifications/) covers accessible success/error feedback.

Recommendation: provide units and blank-field instructions, associate errors with their fields, announce import/save failures, retain visible keyboard focus, and never encode comparison meaning through color alone. Group common timings before advanced controls; let users search glossary/analysis rows and see why a result is unknown. Verify keyboard use, narrow screens and 200% zoom with real UI checks before making an accessibility-conformance claim.
