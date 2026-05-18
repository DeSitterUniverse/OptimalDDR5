from optimalddr5.core.formulas import cycle_time_ns, real_clock_mhz, timing_ns


def test_real_clock_and_cycle_time():
    assert real_clock_mhz(6000) == 3000
    assert round(cycle_time_ns(6000), 6) == round(1000 / 3000, 6)


def test_timing_ns_conversion():
    assert round(timing_ns(30, 6000), 3) == 10.0
