from optimalddr5.core.evaluator import evaluate_profile
from optimalddr5.core.models import Classification, MemoryProfile
from optimalddr5.data.loader import load_database


def test_headroom_classification_against_sample_ranges():
    db = load_database()
    profile = MemoryProfile(
        profile_name="test",
        platform_id="ryzen_am5_zen4",
        die_id="hynix_16g_a_die",
        mtps=6000,
        timings={"tCL": 30, "tRFC": 760},
        voltages={"VDD": 1.35, "VDDQ": 1.35},
    )
    result = evaluate_profile(profile, db)
    by_id = {item.timing_id: item for item in result.timing_results}
    assert by_id["tCL"].classification == Classification.TIGHT
    assert by_id["tRFC"].classification in {Classification.LOOSE, Classification.VERY_LOOSE}


def test_missing_timing_handling():
    db = load_database()
    profile = MemoryProfile(profile_name="missing", timings={"tCL": 30})
    result = evaluate_profile(profile, db)
    by_id = {item.timing_id: item for item in result.timing_results}
    assert by_id["tRCDRD"].cycles is not None
    assert by_id["tRCDRD"].headroom_cycles is not None


def test_samsung_16g_b_die_scores_user_profile_tight_within_two_cycles():
    db = load_database()
    profile = MemoryProfile(
        profile_name="Samsung 16Gb B-die tight example",
        platform_id="raptor_lake_ddr5",
        die_id="samsung_16g_b_die",
        mtps=6000,
        voltages={"VDD": 1.20, "VDDQ": 1.20, "VPP": 1.80, "MC_Voltage": 1.10},
        timings={"tCL": 36, "tRCD": 36, "tRP": 36, "tRAS": 72, "tRFC": 480, "tRRDS": 4, "tRRDL": 8, "tFAW": 16},
    )
    result = evaluate_profile(profile, db)
    by_id = {item.timing_id: item for item in result.timing_results}
    assert by_id["tCL"].classification == Classification.TIGHT
    assert by_id["tCL"].headroom_cycles <= 2
    assert by_id["tRFC"].headroom_cycles <= 2


def test_die_database_contains_only_requested_research_set():
    db = load_database()
    assert set(db["die_profiles"]) == {
        "hynix_16g_m_die",
        "hynix_16g_a_die",
        "hynix_24g_m_die",
        "hynix_24g_a_die",
        "hynix_32g_m_die",
        "samsung_16g_b_die",
        "samsung_16g_d_die",
        "samsung_16g_e_die",
        "samsung_32g_m_die",
        "micron_16g_a_die",
        "micron_16g_b_die",
        "micron_16g_d_die",
        "micron_24g_b_die",
        "micron_32g_b_die",
        "micron_32g_e_die",
        "micron_32g_a_spectek",
        "cxmt_16g",
        "cxmt_24g",
    }


def test_every_die_has_limit_and_community_research_metadata():
    db = load_database()
    for die in db["die_profiles"].values():
        limits = die.overclocking_limits
        assert limits.research_status
        assert limits.evidence_quality
        assert limits.limit_basis
        assert limits.community_consensus
        assert limits.last_researched == "2026-08-12"
        assert limits.attempts
        for attempt in limits.attempts:
            assert attempt.label
            assert attempt.result
            assert attempt.confidence
            assert attempt.source_url.startswith("https://")


def test_established_maxima_are_backed_by_attempts():
    db = load_database()
    for die in db["die_profiles"].values():
        limits = die.overclocking_limits
        attempted_mtps = [attempt.mtps for attempt in limits.attempts if attempt.mtps is not None]
        if limits.documented_stable_max_mtps is not None:
            assert any(
                attempt.mtps == limits.documented_stable_max_mtps and attempt.result == "stable"
                for attempt in limits.attempts
            )
        if limits.documented_benchmark_max_mtps is not None:
            assert limits.documented_benchmark_max_mtps in attempted_mtps


def test_example_profiles_evaluate():
    db = load_database()
    for raw in db["example_profiles"]:
        result = evaluate_profile(MemoryProfile(**raw), db)
        assert result.latency_estimates["cycle_time_ns"] is not None
        assert result.power_estimate.estimated_power_per_dimm_watts > 0


def test_blank_profile_receives_default_voltages_for_power():
    db = load_database()
    result = evaluate_profile(MemoryProfile(profile_name="blank", voltages={}, timings={}), db)
    assert result.profile.voltages["VDD"] >= 1.1
    assert result.profile.voltages["VDDQ"] >= 1.1
    assert result.power_estimate.effective_voltage >= 1.1


def test_voltage_language_uses_platform_ranges():
    db = load_database()
    intel = evaluate_profile(
        MemoryProfile(
            profile_name="intel voltage",
            platform_id="raptor_lake_ddr5",
            voltages={"VDD": 1.45, "VDDQ": 1.45, "VCCSA": 1.32, "CPU_VDDQ": 1.42, "MC_Voltage": 1.48},
            timings={},
        ),
        db,
    )
    intel_by_id = {item.voltage_id: item for item in intel.voltage_results}
    assert intel_by_id["VDD"].risk_level == "average"
    assert intel_by_id["CPU_VDDQ"].risk_level == "average"

    amd = evaluate_profile(
        MemoryProfile(
            profile_name="am5 voltage",
            platform_id="ryzen_am5_zen4",
            voltages={"VDD": 1.50, "VDDQ": 1.50, "SoC": 1.30, "VDDIO_MEM": 1.45, "VDDP": 1.0},
            timings={},
        ),
        db,
    )
    amd_by_id = {item.voltage_id: item for item in amd.voltage_results}
    assert amd_by_id["SoC"].risk_level == "elevated"
    assert amd_by_id["VDD"].risk_level == "elevated"


def test_default_timing_rules_for_tcwl_and_trc():
    db = load_database()
    result = evaluate_profile(
        MemoryProfile(
            profile_name="rules",
            timings={"tCL": 34, "tRAS": 80, "tRP": 40},
            voltages={"VDD": 1.35, "VDDQ": 1.35},
        ),
        db,
    )
    assert result.profile.timings["tCWL"] == 32
    assert result.profile.timings["tRC"] == 120
    by_id = {item.timing_id: item for item in result.timing_results}
    assert "tCL - 2" in " ".join(by_id["tCWL"].notes)
    assert "tRAS + tRP" in " ".join(by_id["tRC"].notes)
