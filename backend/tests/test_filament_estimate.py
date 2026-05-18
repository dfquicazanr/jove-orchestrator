import pytest

from app.services.filament_estimate import (
    mass_g_from_length_mm,
    reconcile_filament,
)


def test_reconcile_mass_from_length():
    r = reconcile_filament(None, 1000.0, 1.24)
    assert r.mass_grams is not None
    assert r.mass_grams > 0
    assert r.mass_from_density is True
    assert r.length_mm == 1000.0


def test_reconcile_length_from_mass():
    mass = mass_g_from_length_mm(5000.0, 1.24)
    r = reconcile_filament(mass, None, 1.24)
    assert r.length_mm is not None
    assert r.length_from_density is True


def test_no_density_leaves_gaps():
    r = reconcile_filament(None, 1000.0, None)
    assert r.mass_grams is None
    assert r.length_mm == 1000.0
