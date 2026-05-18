import pytest

from app.services.gcode_parse import estimate_filament_grams_from_gcode, parse_gcode_metadata


def test_filament_used_g():
    g = "; filament used [g] = 12.34\n"
    assert estimate_filament_grams_from_gcode(g) == pytest.approx(12.34)


def test_filament_weight_line():
    g = "; filament weight = 5 g\n"
    assert estimate_filament_grams_from_gcode(g) == pytest.approx(5.0)


def test_none_when_missing():
    assert estimate_filament_grams_from_gcode("G1 X0") is None


def test_creality_cura_filament_meters_and_fractional_time():
    g = ";FLAVOR:Marlin\n;TIME:3708.97\n;Filament used:6.21m\n"
    meta = parse_gcode_metadata(g)
    assert meta.filament_length_mm == pytest.approx(6210.0)
    assert meta.print_time_seconds == 3709
    assert meta.filament_mass_grams is None


def test_prusa_total_filament_mm_and_estimated_time():
    g = (
        "; total filament used [mm] = 1234.56\n"
        "; estimated printing time (normal mode) = 1h 2m 3s\n"
    )
    meta = parse_gcode_metadata(g)
    assert meta.filament_length_mm == pytest.approx(1234.56)
    assert meta.print_time_seconds == 3723
