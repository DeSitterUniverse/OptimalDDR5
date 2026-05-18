from pathlib import Path

from optimalddr5.core.hwinfo_report_log import parse_hwinfo_log
from optimalddr5.core.models import MemoryProfile
from optimalddr5.data.loader import load_database


def test_yaml_config_loading_validation():
    db = load_database()
    assert "tCL" in db["timing_definitions"]
    assert "hynix_16g_a_die" in db["die_profiles"]


def test_hwinfo_memory_section_import(tmp_path: Path):
    sample = tmp_path / "sample.LOG"
    sample.write_text(
        """
---------- Memory ----------
Memory Clock: 3000.0 MHz
Total Memory Size: 32 GBytes
Number Of Memory Modules: 2
CAS Latency: 30
tRCDRD: 38
tRP: 38
tRFC: 500
DRAM VDD: 1.350 V
DRAM VDDQ: 1.350 V
---------- Sensors ----------
CPU Temp: 55 C
""",
        encoding="utf-8",
    )
    profile = parse_hwinfo_log(sample)
    assert profile.mtps == 6000
    assert profile.timings["tCL"] == 30
    assert "VDD" not in profile.voltages


def test_hwinfo_import_parses_current_tertiaries_and_predicts_samsung_die(tmp_path: Path):
    sample = tmp_path / "samsung.LOG"
    sample.write_text(
        """
Memory --------------------------------------------------------------------
 [Current Performance Settings]
  Current Memory Clock:                   3000.0 MHz
  Current Timing (tCAS-tRCD-tRP-tRAS):    36-36-36-72
  Command Rate (CR):                      2T
  Read to Read Delay (tRDRD_SG/TrdrdScL) Same Bank Group: 14T
  Read to Read Delay (tRDRD_DG/TrdrdScDlr) Different Bank Group: 8T
  Write to Write Delay (tWRWR_SG/TwrwrScL) Same Bank Group: 14T
  Write to Write Delay (tWRWR_DG/TwrwrScDlr) Different Bank Group: 8T
  Write to Read Delay (tWRRD_SG/TwrrdScL) Same Bank Group: 64T
  Write to Read Delay (tWRRD_DG/TwrrdScDlr) Different Bank Group: 48T
  Read to Precharge Delay (tRTP):         14T
  Write Recovery Time (tWR):              54T
  RAS# to RAS# Delay (tRRD_L):            8T
  RAS# to RAS# Delay (tRRD_S):            4T
  Row Cycle Time (tRC):                   108T
  Refresh Cycle Time (tRFC):              480T
  Four Activate Window (tFAW):            16T

Row: 1 [BANK 0/Controller0-DIMM1] - 16 GB PC5-44800 DDR5 SDRAM G.Skill F5-5600U3636C16G
  Module Size:                            16 GBytes
  SDRAM Manufacturer:                     Samsung
  Module Density:                         16384 Mb
 [Intel Extreme Memory Profile (XMP)]
""",
        encoding="utf-8",
    )
    profile = parse_hwinfo_log(sample)
    assert profile.die_id == "samsung_16g_early"
    assert profile.command_rate == "2T"
    assert profile.timings["tRDRDSG"] == 14
    assert profile.timings["tWRWRDG"] == 8
    assert profile.timings["tWRRDSG"] == 64


def test_hwinfo_import_preserves_existing_manual_voltages(tmp_path: Path):
    sample = tmp_path / "memory.LOG"
    sample.write_text(
        """
Memory --------------------------------------------------------------------
  Current Memory Clock: 3000.0 MHz
  Current Timing (tCAS-tRCD-tRP-tRAS): 36-36-36-72
  Module VDD Voltage Level: 1.20 V
  Module VDDQ Voltage Level: 1.20 V
""",
        encoding="utf-8",
    )
    base = MemoryProfile(voltages={"VDD": 1.45, "VDDQ": 1.44})
    profile = parse_hwinfo_log(sample, base_profile=base)
    assert profile.voltages["VDD"] == 1.45
    assert profile.voltages["VDDQ"] == 1.44
