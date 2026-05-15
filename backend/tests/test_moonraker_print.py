from app.services.moonraker_print import sanitize_gcode_filename


def test_sanitize_gcode_filename_tailscale_style():
    assert sanitize_gcode_filename("part.gcode") == "part.gcode"
    assert sanitize_gcode_filename("../../evil.gcode") == "evil.gcode"
    assert sanitize_gcode_filename("my part").endswith(".gcode")
