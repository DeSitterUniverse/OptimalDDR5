# App review and implementation

Reviewed from commit `c9d81b8` on 2026-10-04. The starting checkout was clean. The baseline passed 20 Python tests and a production frontend build.

## Findings addressed

| Area | Finding | Implemented change |
| --- | --- | --- |
| Analysis | Missing fields were filled with plausible timings and rail values. | Missing values stay unknown and are excluded from scoring. Model assumptions remain separate from profile inputs. |
| Identification | Unknown die/platform IDs silently selected the first database entry. | Invalid IDs are rejected; an explicit unconfirmed-die option uses general references. |
| Bandwidth | Every profile assumed dual-channel bandwidth. | Populated channels determine the theoretical ceiling independently of DIMM count. |
| Import | Previous timings contaminated imported profiles; XMP text changed the platform. | Imports replace timings, preserve manual rails/platform/die, and clear previous test status. |
| Parsing | High clocks were ignored, sections were unbounded, and UTF-16 reports were unreadable. | BOM decoding and bounded current Memory sections exclude SPD/sensor values. Unrelated files are rejected. |
| Errors | Invalid values produced non-finite calculations; import/loading failures had poor feedback. | Numeric/schema validation blocks invalid analysis and saving; imports report errors; loading can be retried. |
| Persistence | Profiles disappeared after reload; exported JSON could not be reopened. | Valid drafts autosave, snapshots remain separate, profiles/backups round trip, and storage failures preserve editable/exportable state. |
| Comparison | No baseline workflow or test-history fields. | Snapshot comparison includes timing, bandwidth, and voltage deltas. The test journal records self-reported results and evidence. |
| Timings | Several supported tertiary inputs were missing; glossary access depended on hover. | All configured fields are editable, with search, filters, keyboard-accessible definitions, and visible notes. |
| Evidence | Voltage notes were hidden; power/heat labels implied measurement. | Voltage notes are visible. Power is labeled illustrative with limits and conditional missing-rail assumptions. |
| Usability | Long output and marketing copy obscured tasks. | Plain titles/labels, compact expandable help, collapsed die evidence, blank-result states, and responsive forms. |
| Maintenance | Browser and Python comparisons differed without parity checks. | Shared reference ranges, consistent interpolation/scaling and score rounding, fixtures spanning all 18 dies, and CI. |
| Dependencies | Seven npm advisories included Windows development-server vulnerabilities. | Compatible dependency updates, an audit before publication, and build tooling in dev dependencies. |

## Verification scope

Automated checks cover missing/invalid values, channel-aware bandwidth, import encodings and boundaries, invalid API requests, database generation, saved-profile restoration, snapshot immutability/comparison/removal/undo, test-status invalidation, JSON imports, loading retries, and storage failures. Fixtures cover all configured dies, every example profile, and an unconfirmed single-DIMM profile. They compare formula output, timing classes/reference differences/confidence, scores, voltage bands, and power arithmetic.

Browser checks cover loading an example, saving a baseline, changing frequency, comparing deltas, importing profile JSON, restoring a draft after reload, keyboard access to definitions, and desktop/mobile layout. These establish app behavior, not memory stability or hardware tuning quality.

Local validation passed 40 Python tests, 64 frontend tests (including 25 browser/Python calculation cases), generated-data/fixture checks, and a production build. The npm audit reported zero vulnerabilities. Python tests emitted one upstream Starlette test-client deprecation warning.

## Remaining limits

- Wattage coefficients and load bands lack measured validation and error bounds.
- Die histories contain heterogeneous evidence and old research dates. This review does not claim every record has been independently reverified.
- Frequency scaling/interpolation does not establish new experimental results.
- The app does not detect hardware, read live sensors, apply BIOS settings, or run memory tests.
- Browser storage can be cleared or denied. Exported backups provide portable recovery.
- Full assistive-technology testing and hardware measurements were not performed. Keyboard access, labels, invalid-field feedback, and responsive layout were reviewed.
- The embedded browser did not return a download event during export testing. The exported JSON and filename are covered by an automated test; a completed browser file save was not verified.
