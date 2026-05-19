"""Unit tests for moonraker watch HTTP vs WebSocket promotion logic."""

from app.services.moonraker_watch import PrinterLiveUpdate


def test_live_update_sse_includes_ws_live_flag():
    u = PrinterLiveUpdate(
        printer_id=1,
        last_known_status="ready",
        last_moonraker_error=None,
        connected=True,
        moonraker_ws_connected=True,
    )
    payload = u.to_json()
    assert '"ws_live": true' in payload

    u2 = PrinterLiveUpdate(
        printer_id=2,
        last_known_status="ready",
        last_moonraker_error=None,
        connected=True,
        moonraker_ws_connected=False,
    )
    assert '"ws_live": false' in u2.to_json()
