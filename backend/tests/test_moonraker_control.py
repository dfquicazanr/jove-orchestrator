from app.services.moonraker_control import (
    build_cooldown_script,
    build_home_script,
    build_preheat_script,
)


def test_build_home_script_all():
    assert build_home_script("all") == "G28"


def test_build_home_script_xy():
    assert build_home_script("xy") == "G28 X Y"


def test_build_preheat_script():
    assert build_preheat_script(200, 60) == "M140 S60\nM104 S200"


def test_build_cooldown_script():
    assert build_cooldown_script() == "M104 S0\nM140 S0"
