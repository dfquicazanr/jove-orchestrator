from app.services.material_preheat import DEFAULT_PRESETS


def test_default_preset_count():
    assert len(DEFAULT_PRESETS) >= 4
    names = {n for n, *_ in DEFAULT_PRESETS}
    assert "PLA" in names and "PETG" in names
