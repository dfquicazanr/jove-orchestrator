import pytest

from app.services.gcode_parse import estimate_filament_grams_from_gcode


def test_filament_used_g():
    g = "; filament used [g] = 12.34\n"
    assert estimate_filament_grams_from_gcode(g) == pytest.approx(12.34)


def test_filament_weight_line():
    g = "; filament weight = 5 g\n"
    assert estimate_filament_grams_from_gcode(g) == pytest.approx(5.0)


def test_none_when_missing():
    assert estimate_filament_grams_from_gcode("G1 X0") is None
