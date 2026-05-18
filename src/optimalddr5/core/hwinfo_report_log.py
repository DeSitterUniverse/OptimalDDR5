from __future__ import annotations

import re
from pathlib import Path

from .models import MemoryProfile


TIMING_PATTERNS = {
    "tCL": [r"\bCAS Latency\b.*?(\d+(?:\.\d+)?)", r"\btCL\b.*?(\d+(?:\.\d+)?)"],
    "tRCD": [r"\btRCD\b.*?(\d+(?:\.\d+)?)"],
    "tRCDRD": [r"\btRCDRD\b.*?(\d+(?:\.\d+)?)", r"\btRCD Read\b.*?(\d+(?:\.\d+)?)"],
    "tRCDWR": [r"\btRCDWR\b.*?(\d+(?:\.\d+)?)", r"\btRCD Write\b.*?(\d+(?:\.\d+)?)"],
    "tRP": [r"\btRP\b.*?(\d+(?:\.\d+)?)"],
    "tRAS": [r"\btRAS\b.*?(\d+(?:\.\d+)?)"],
    "tRC": [r"\btRC\b.*?(\d+(?:\.\d+)?)"],
    "tRFC": [r"\btRFC\b.*?(\d+(?:\.\d+)?)"],
    "tREFI": [r"\btREFI\b.*?(\d+(?:\.\d+)?)"],
    "tRDRDSG": [r"Read to Read Delay \(tRDRD_SG/.*?Same Bank Group:\s*(\d+)T"],
    "tRDRDDG": [r"Read to Read Delay \(tRDRD_DG/.*?Different Bank Group:\s*(\d+)T"],
    "tRDRDSD": [r"Read to Read Delay \(tRDRD_SD\).*?Same DIMM:\s*(\d+)T"],
    "tRDRDDD": [r"Read to Read Delay \(tRDRD_DD\).*?Different DIMM:\s*(\d+)T"],
    "tWRWRSG": [r"Write to Write Delay \(tWRWR_SG/.*?Same Bank Group:\s*(\d+)T"],
    "tWRWRDG": [r"Write to Write Delay \(tWRWR_DG/.*?Different Bank Group:\s*(\d+)T"],
    "tWRWRSD": [r"Write to Write Delay \(tWRWR_SD\).*?Same DIMM:\s*(\d+)T"],
    "tWRWRDD": [r"Write to Write Delay \(tWRWR_DD\).*?Different DIMM:\s*(\d+)T"],
    "tWRRDSG": [r"Write to Read Delay \(tWRRD_SG/.*?Same Bank Group:\s*(\d+)T"],
    "tWRRDDG": [r"Write to Read Delay \(tWRRD_DG/.*?Different Bank Group:\s*(\d+)T"],
    "tRTP": [r"Read to Precharge Delay \(tRTP\):\s*(\d+)T"],
    "tWR": [r"Write Recovery Time \(tWR\):\s*(\d+)T"],
    "tRRDL": [r"RAS# to RAS# Delay \(tRRD_L\):\s*(\d+)T"],
    "tRRDS": [r"RAS# to RAS# Delay \(tRRD_S\):\s*(\d+)T"],
    "tFAW": [r"Four Activate Window \(tFAW\):\s*(\d+)T"],
}

def parse_hwinfo_log(path: str | Path, base_profile: MemoryProfile | None = None) -> MemoryProfile:
    text = Path(path).read_text(encoding="utf-8", errors="ignore")
    memory_text = _memory_section(text)
    base = base_profile or MemoryProfile(profile_name="Imported HWiNFO memory profile")
    timings = dict(base.timings)
    for timing, patterns in TIMING_PATTERNS.items():
        value = _first_number(memory_text, patterns)
        if value is not None:
            timings[timing] = int(value)
    tuple_match = re.search(
        r"Current Timing\s*\(tCAS-tRCD-tRP-tRAS\):\s*(\d+)-(\d+)-(\d+)-(\d+)",
        memory_text,
        flags=re.IGNORECASE,
    )
    if tuple_match:
        timings.update(
            {
                "tCL": int(tuple_match.group(1)),
                "tRCD": int(tuple_match.group(2)),
                "tRP": int(tuple_match.group(3)),
                "tRAS": int(tuple_match.group(4)),
            }
        )
    trfc_match = re.search(r"Refresh Cycle Time \(tRFC\):\s*(\d+)T", memory_text, flags=re.IGNORECASE)
    if trfc_match:
        timings["tRFC"] = int(trfc_match.group(1))
    mtps = _first_number(memory_text, [r"\bCurrent Memory Clock\b.*?(\d+(?:\.\d+)?)\s*MHz", r"\bMemory Clock\b.*?(\d+(?:\.\d+)?)\s*MHz", r"\bClock\b.*?(\d+(?:\.\d+)?)\s*MHz"])
    if mtps and mtps < 4000:
        base.mtps = int(round(mtps * 2))
    dimms = _first_number(memory_text, [r"\bNumber Of Memory Modules\b.*?(\d+)"])
    if dimms:
        base.dimm_count = int(dimms)
    capacity = _first_number(memory_text, [r"\bTotal Memory Size\b.*?(\d+)\s*G", r"\bMemory Size\b.*?(\d+)\s*G"])
    if capacity:
        base.capacity_total_gb = int(capacity)
    command_rate = re.search(r"Command Rate \(CR\):\s*([12]T)", memory_text, flags=re.IGNORECASE)
    if command_rate:
        base.command_rate = command_rate.group(1).upper()
    predicted_die = predict_die_id(memory_text)
    if predicted_die:
        base.die_id = predicted_die
    if "Intel Extreme Memory Profile" in memory_text and base.platform_id == "ryzen_am5_zen4":
        base.platform_id = "raptor_lake_ddr5"
    base.profile_name = "Imported HWiNFO memory profile"
    base.timings = timings
    return base


def _memory_section(text: str) -> str:
    hwinfo_header = re.search(r"(?im)^Memory\s+-{5,}\s*$", text)
    if hwinfo_header:
        return text[hwinfo_header.end() :]
    match = re.search(r"(?ims)^-+\s*Memory\s*-+(.*?)(?:^-{5,}\s*\S|\Z)", text)
    if match:
        return match.group(1)
    match = re.search(r"(?ims)\bMemory\b(.*?)(?:\n\s*\n\S|\Z)", text)
    return match.group(1) if match else text


def _first_number(text: str, patterns: list[str]) -> float | None:
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return float(match.group(1))
    return None


def predict_die_id(memory_text: str) -> str | None:
    manufacturer = _first_text(memory_text, [r"SDRAM Manufacturer:\s*([A-Za-z0-9 _-]+)"])
    density = _first_number(memory_text, [r"Module Density:\s*(\d+)\s*Mb"])
    if not manufacturer:
        return None
    normalized = manufacturer.lower()
    if "samsung" in normalized and density == 16384:
        return "samsung_16g_early"
    if "samsung" in normalized:
        return "unknown_samsung_like"
    if "hynix" in normalized and density == 16384:
        return "unknown_hynix_like"
    if "hynix" in normalized:
        return "unknown_hynix_like"
    if "micron" in normalized:
        return "unknown_micron_like"
    return None


def _first_text(text: str, patterns: list[str]) -> str | None:
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return match.group(1).strip()
    return None
