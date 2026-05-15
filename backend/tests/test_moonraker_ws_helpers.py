from app.services.moonraker import (
    derive_printer_status_from_status,
    merge_printer_status_objects,
    moonraker_http_to_ws_url,
)


def test_moonraker_http_to_ws_url():
    assert moonraker_http_to_ws_url("http://192.168.0.50:7125") == "ws://192.168.0.50:7125/websocket"
    assert moonraker_http_to_ws_url("https://printer.local:7125/") == "wss://printer.local:7125/websocket"


def test_merge_and_derive_from_notify_delta():
    acc: dict = {}
    merge_printer_status_objects(acc, {"print_stats": {"state": "standby"}})
    assert derive_printer_status_from_status(acc) == "ready"
    merge_printer_status_objects(acc, {"print_stats": {"state": "printing"}})
    assert derive_printer_status_from_status(acc) == "printing"
