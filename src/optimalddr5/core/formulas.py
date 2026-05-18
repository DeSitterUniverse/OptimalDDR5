from __future__ import annotations


def real_clock_mhz(mtps: int | float) -> float:
    return float(mtps) / 2.0


def cycle_time_ns(mtps: int | float) -> float:
    clock = real_clock_mhz(mtps)
    if clock <= 0:
        raise ValueError("MT/s must be positive")
    return 1000.0 / clock


def timing_ns(cycles: int | float | None, mtps: int | float) -> float | None:
    if cycles is None:
        return None
    return float(cycles) * cycle_time_ns(mtps)


def theoretical_bandwidth_gbps(mtps: int | float, channels: int = 2, bytes_per_channel: int = 8) -> float:
    return float(mtps) * channels * bytes_per_channel / 1000.0


def timing_estimates(timings: dict[str, int | float], mtps: int) -> dict[str, float | None]:
    c = cycle_time_ns(mtps)
    tcl = timings.get("tCL") or timings.get("CL")
    trcdrd = timings.get("tRCDRD") or timings.get("tRCD")
    trp = timings.get("tRP")
    tras = timings.get("tRAS")
    trc = timings.get("tRC")
    trfc = timings.get("tRFC")
    trefi = timings.get("tREFI")
    return {
        "real_clock_mhz": real_clock_mhz(mtps),
        "cycle_time_ns": c,
        "cl_ns": timing_ns(tcl, mtps),
        "trcd_ns": timing_ns(trcdrd, mtps),
        "trp_ns": timing_ns(trp, mtps),
        "tras_ns": timing_ns(tras, mtps),
        "trc_ns": timing_ns(trc, mtps),
        "trfc_ns": timing_ns(trfc, mtps),
        "trefi_interval_ns": timing_ns(trefi, mtps),
        "activate_to_read_ns": timing_ns(trcdrd, mtps),
        "precharge_ns": timing_ns(trp, mtps),
        "theoretical_dual_channel_bandwidth_gbps": theoretical_bandwidth_gbps(mtps),
    }
