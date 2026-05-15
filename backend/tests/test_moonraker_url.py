import pytest

from app.services.moonraker_url import (
    MoonrakerUrlError,
    format_moonraker_connection_error,
    normalize_moonraker_base_url,
)


def test_normalize_tailscale_hostname():
    assert normalize_moonraker_base_url("la-porqueriza:8011") == "http://la-porqueriza:8011"
    assert normalize_moonraker_base_url("http://la-porqueriza:8011/") == "http://la-porqueriza:8011"


def test_normalize_lan_ip():
    assert normalize_moonraker_base_url("192.168.0.50:8011") == "http://192.168.0.50:8011"


def test_reject_non_http_scheme():
    with pytest.raises(MoonrakerUrlError):
        normalize_moonraker_base_url("ftp://la-porqueriza:8011")


def test_dns_error_message_mentions_tailscale():
    err = format_moonraker_connection_error(
        OSError("[Errno -2] Name or service not known"),
        base_url="http://la-porqueriza:8011",
    )
    assert "la-porqueriza" in err
    assert "Tailscale" in err
