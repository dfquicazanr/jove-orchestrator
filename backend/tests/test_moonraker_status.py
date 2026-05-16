import pytest

from app.services.moonraker import (
    derive_printer_status_from_moonraker,
    extract_live_heater_temperatures,
    extract_webhooks_summary_from_object_status,
)


def test_extract_live_heater_temperatures_single_extruder_and_bed():
    st = {
        "extruder": {"temperature": 204.77, "target": 210},
        "heater_bed": {"temperature": 59.93, "target": 60},
    }
    ex_a, ex_t, b_a, b_t = extract_live_heater_temperatures(st)
    assert ex_a == pytest.approx(204.77)
    assert ex_t == pytest.approx(210.0)
    assert b_a == pytest.approx(59.93)
    assert b_t == pytest.approx(60.0)


def test_extract_live_heater_temperatures_prefers_extruder0_when_primary_missing():
    st = {
        "extruder0": {"temperature": 190, "target": 0},
        "heater_bed": {"temperature": 21, "target": 0},
    }
    ex_a, ex_t, b_a, b_t = extract_live_heater_temperatures(st)
    assert ex_a == pytest.approx(190.0)
    assert ex_t == pytest.approx(0.0)
    assert b_a == pytest.approx(21.0)
    assert b_t == pytest.approx(0.0)


def test_extract_webhooks_matches_shutdown_fixture():
    data = {
        "result": {
            "status": {
                "webhooks": {"state": "shutdown", "state_message": "MCU lost"},
                "print_stats": {"state": "standby"},
            }
        }
    }
    st = data["result"]["status"]
    wh, msg = extract_webhooks_summary_from_object_status(st)
    assert wh == "shutdown"
    assert "MCU" in (msg or "")


def test_print_stats_standby():
    data = {"result": {"status": {"print_stats": {"state": "standby"}}}}
    assert derive_printer_status_from_moonraker(data) == "ready"


def test_print_stats_printing():
    data = {"result": {"status": {"print_stats": {"state": "printing"}}}}
    assert derive_printer_status_from_moonraker(data) == "printing"


def test_print_stats_paused():
    data = {"result": {"status": {"print_stats": {"state": "paused"}}}}
    assert derive_printer_status_from_moonraker(data) == "paused"


def test_webhooks_ready_fallback():
    data = {"result": {"status": {"webhooks": {"state": "ready"}}}}
    assert derive_printer_status_from_moonraker(data) == "ready"


def test_shutdown_beats_stale_print_stats_standby():
    """Klipper shutdown often leaves print_stats on standby; webhooks must win."""
    data = {
        "result": {
            "status": {
                "webhooks": {"state": "shutdown", "state_message": "Lost communication with MCU"},
                "print_stats": {"state": "standby"},
            }
        }
    }
    assert derive_printer_status_from_moonraker(data) == "offline"


def test_startup_is_offline():
    data = {"result": {"status": {"webhooks": {"state": "startup"}, "print_stats": {"state": "standby"}}}}
    assert derive_printer_status_from_moonraker(data) == "offline"


def test_webhooks_error():
    data = {"result": {"status": {"webhooks": {"state": "error"}}}}
    assert derive_printer_status_from_moonraker(data) == "error"
