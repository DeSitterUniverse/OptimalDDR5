from optimalddr5.core.models import MemoryProfile
from optimalddr5.core.power import estimate_power


def test_power_estimate_formula_scales_voltage_squared():
    cfg = {
        "reference_voltage": 1.35,
        "reference_mtps": 6000,
        "effective_voltage_weights": {"VDD": 0.6, "VDDQ": 0.4},
        "base_power_per_dimm_watts": {"16gb": 3.0, "default": 3.0},
        "heat_thresholds_w_per_dimm": {"moderate_min": 3.0, "high_min": 5.0, "extreme_min": 7.0},
    }
    low = estimate_power(MemoryProfile(voltages={"VDD": 1.35, "VDDQ": 1.35}), {"die_id": "default"}, cfg)
    high = estimate_power(MemoryProfile(voltages={"VDD": 1.50, "VDDQ": 1.50}), {"die_id": "default"}, cfg)
    assert high.estimated_power_per_dimm_watts > low.estimated_power_per_dimm_watts


def test_power_uses_voltage_floor_for_missing_weighted_inputs():
    cfg = {
        "reference_voltage": 1.35,
        "reference_mtps": 6000,
        "effective_voltage_weights": {"VDD": 0.6, "VDDQ": 0.4},
        "voltage_floors": {"VDD": 1.10, "VDDQ": 1.10},
        "base_power_per_dimm_watts": {"16gb": 3.0, "default": 3.0},
        "heat_thresholds_w_per_dimm": {"moderate_min": 3.0, "high_min": 5.0, "extreme_min": 7.0},
    }
    estimate = estimate_power(MemoryProfile(voltages={}), {"die_id": "default"}, cfg)
    assert estimate.effective_voltage == 1.1


def test_power_model_is_die_calibrated_and_single_dimm_heat_based():
    cfg = {
        "reference_voltage": 1.35,
        "voltage_exponent": 2.0,
        "capacity_exponent": 0.7,
        "effective_voltage_weights": {"VDD": 0.6, "VDDQ": 0.4},
        "die_power_profiles": {
            "samsung_16g_b_die": {"peak_watts_per_dimm": 8.0, "reference_voltage": 1.362, "reference_capacity_gb_per_dimm": 16},
            "hynix_16g_a_die": {"peak_watts_per_dimm": 3.7, "reference_voltage": 1.4, "reference_capacity_gb_per_dimm": 16},
        },
        "heat_thresholds_w_per_dimm": {"moderate_min": 4.0, "high_min": 6.0, "extreme_min": 8.0},
    }
    samsung = estimate_power(MemoryProfile(voltages={"VDD": 1.37, "VDDQ": 1.35}), {"die_id": "samsung_16g_b_die"}, cfg)
    samsung_low = estimate_power(MemoryProfile(voltages={"VDD": 1.2, "VDDQ": 1.2}), {"die_id": "samsung_16g_b_die"}, cfg)
    hynix = estimate_power(MemoryProfile(voltages={"VDD": 1.4, "VDDQ": 1.4}), {"die_id": "hynix_16g_a_die"}, cfg)
    assert samsung.estimated_power_per_dimm_watts == 8.0
    assert samsung.heat_level == "extreme"
    assert samsung_low.estimated_power_per_dimm_watts < 7.0
    assert hynix.estimated_power_per_dimm_watts == 3.7
    assert hynix.heat_level == "low"
    assert samsung.heat_basis == "single_dimm_peak"
