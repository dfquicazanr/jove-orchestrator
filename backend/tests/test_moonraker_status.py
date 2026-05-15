import pytest

from app.services.moonraker import derive_printer_status_from_moonraker


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
