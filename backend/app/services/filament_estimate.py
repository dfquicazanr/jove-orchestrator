"""Estimate missing filament mass/length using material density and filament diameter."""

from __future__ import annotations

import math
from dataclasses import dataclass

DEFAULT_FILAMENT_DIAMETER_MM = 1.75


@dataclass(frozen=True)
class FilamentReconcileResult:
    mass_grams: float | None
    length_mm: float | None
    mass_from_density: bool = False
    length_from_density: bool = False

    @property
    def missing_mass_in_file(self) -> bool:
        return self.mass_grams is None

    @property
    def missing_length_in_file(self) -> bool:
        return self.length_mm is None


def _cross_section_mm2(diameter_mm: float) -> float:
    return math.pi * (diameter_mm / 2.0) ** 2


def mass_g_from_length_mm(
    length_mm: float,
    density_g_cm3: float,
    *,
    diameter_mm: float = DEFAULT_FILAMENT_DIAMETER_MM,
) -> float:
    volume_mm3 = _cross_section_mm2(diameter_mm) * length_mm
    return (volume_mm3 / 1000.0) * density_g_cm3


def length_mm_from_mass_g(
    mass_g: float,
    density_g_cm3: float,
    *,
    diameter_mm: float = DEFAULT_FILAMENT_DIAMETER_MM,
) -> float:
    volume_mm3 = (mass_g / density_g_cm3) * 1000.0
    return volume_mm3 / _cross_section_mm2(diameter_mm)


def reconcile_filament(
    mass_grams: float | None,
    length_mm: float | None,
    density_g_cm3: float | None,
    *,
    diameter_mm: float = DEFAULT_FILAMENT_DIAMETER_MM,
) -> FilamentReconcileResult:
    """Fill missing mass or length when density and the other measurement are known."""

    out_mass = mass_grams
    out_length = length_mm
    mass_from_density = False
    length_from_density = False

    if density_g_cm3 is not None and density_g_cm3 > 0:
        if out_mass is None and out_length is not None and out_length > 0:
            out_mass = mass_g_from_length_mm(out_length, density_g_cm3, diameter_mm=diameter_mm)
            mass_from_density = True
        if out_length is None and out_mass is not None and out_mass > 0:
            out_length = length_mm_from_mass_g(out_mass, density_g_cm3, diameter_mm=diameter_mm)
            length_from_density = True

    return FilamentReconcileResult(
        mass_grams=out_mass,
        length_mm=out_length,
        mass_from_density=mass_from_density,
        length_from_density=length_from_density,
    )
