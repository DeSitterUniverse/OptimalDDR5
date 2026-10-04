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
    "tRFC2": [r"\btRFC2\b.*?(\d+(?:\.\d+)?)"],
    "tRFCsb": [r"\btRFC(?:sb|_sb|pb)\b.*?(\d+(?:\.\d+)?)"],
    "tCWL": [r"\btCWL\b.*?(\d+(?:\.\d+)?)"],
    "tWRPRE": [r"\btWRPRE\b.*?(\d+(?:\.\d+)?)"],
    "tREFI": [r"\btREFI\b.*?(\d+(?:\.\d+)?)"],
    "tRDRDSG": [r"Read to Read Delay \(tRDRD_SG/.*?Same Bank Group:\s*(\d+)T"],
    "tRDRDDG": [r"Read to Read Delay \(tRDRD_DG/.*?Different Bank Group:\s*(\d+)T"],
    "tRDRDSD": [r"Read to Read Delay \(tRDRD_SD\).*?Same DIMM:\s*(\d+)T"],
    "tRDRDDD": [r"Read to Read Delay \(tRDRD_DD\).*?Different DIMM:\s*(\d+)T"],
    "tWRWRSG": [r"Write to Write Delay \(tWRWR_SG/.*?Same Bank Group:\s*(\d+)T"],
    "tWRWRDG": [r"Write to Write Delay \(tWRWR_DG/.*?Different Bank Group:\s*(\d+)T"],
    "tWRRDSG": [r"Write to Read Delay \(tWRRD_SG/.*?Same Bank Group:\s*(\d+)T"],
    "tWRRDDG": [r"Write to Read Delay \(tWRRD_DG/.*?Different Bank Group:\s*(\d+)T"],
    "tRTP": [r"Read to Precharge Delay \(tRTP\):\s*(\d+)T"],
    "tWR": [r"Write Recovery Time \(tWR\):\s*(\d+)T"],
    "tRRDL": [r"RAS# to RAS# Delay \(tRRD_L\):\s*(\d+)T"],
    "tRRDS": [r"RAS# to RAS# Delay \(tRRD_S\):\s*(\d+)T"],
    "tFAW": [r"Four Activate Window \(tFAW\):\s*(\d+)T"],
}

def parse_hwinfo_log(path: str | Path, base_profile: MemoryProfile | None = None) -> MemoryProfile:
    content = Path(path).read_bytes()
    if len(content) > 5 * 1024 * 1024:
        raise ValueError("Import files must be 5 MB or smaller")
    text = content.decode("utf-16" if content.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8-sig", errors="replace")
    memory_text = _memory_section(text)
    base = base_profile.model_copy(deep=True) if base_profile else MemoryProfile(profile_name="Imported HWiNFO memory profile")
    timings = {}
    for timing, patterns in TIMING_PATTERNS.items():
        value = _first_number(memory_text, patterns)
        if value is not None:
            if not value.is_integer():
                raise ValueError(f"{timing} must be a whole cycle count")
            timings[timing] = int(value)
    tuple_match = re.search(
        r"Current Timing\s*\(tCAS-tRCD-tRP-tRAS\):\s*(\d+)-(\d+)-(\d+)-(\d+)",
        memory_text,
        flags=re.IGNORECASE,
    )
    if tuple_match:
        trcd = int(tuple_match.group(2))
        timings.update(
            {
                "tCL": int(tuple_match.group(1)),
                "tRCD": trcd,
                "tRCDRD": timings.get("tRCDRD", trcd),
                "tRCDWR": timings.get("tRCDWR", trcd),
                "tRP": int(tuple_match.group(3)),
                "tRAS": int(tuple_match.group(4)),
            }
        )
    trfc_match = re.search(r"Refresh Cycle Time \(tRFC\):\s*(\d+)T", memory_text, flags=re.IGNORECASE)
    if trfc_match:
        timings["tRFC"] = int(trfc_match.group(1))
    mtps = _first_number(memory_text, [r"\bCurrent Memory Clock\b.*?(\d+(?:\.\d+)?)\s*MHz", r"\bMemory Clock\b.*?(\d+(?:\.\d+)?)\s*MHz"])
    if mtps:
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
    if not timings and not mtps:
        raise ValueError("No current memory timings or memory clock found; use a HWiNFO text report")
    if base.dimm_count == 1:
        base.channel_count = 1
    base.validation_status = "untested"
    base.validation_notes = ""
    base.profile_name = "Imported HWiNFO memory profile"
    base.timings = timings
    return MemoryProfile.model_validate(base.model_dump())


def _memory_section(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    header = re.search(r"(?im)^(?:Memory[ \t]+-{5,}|-{5,}[ \t]*Memory[ \t]*-+)[ \t]*$", text)
    if not header:
        raise ValueError("No Memory section found; export a HWiNFO text report .LOG")
    section = text[header.end():]
    stop = re.search(r"(?im)^(?:Row:[ \t]*\d+|[^\r\n]+[ \t]+-{5,}|-{5,}[ \t]*[^-\r\n]+[ \t]*-+|[ \t]*\[(?:Intel Extreme Memory Profile|AMD EXPO|JEDEC))", section)
    return section[:stop.start()] if stop else section


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
    if "samsung" in normalized and density == 32768:
        return "samsung_32g_m_die"
    if "samsung" in normalized and density == 16384:
        return "samsung_16g_b_die"
    if "hynix" in normalized and density == 24576:
        return "hynix_24g_m_die"
    if "hynix" in normalized and density == 32768:
        return "hynix_32g_m_die"
    if "hynix" in normalized and density == 16384:
        return "hynix_16g_m_die"
    if "micron" in normalized and density == 24576:
        return "micron_24g_b_die"
    if "micron" in normalized and density == 32768:
        return "micron_32g_b_die"
    return None


def _first_text(text: str, patterns: list[str]) -> str | None:
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return match.group(1).strip()
    return None
