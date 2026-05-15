"""Parse and validate Moonraker base URLs (IPs, LAN names, Tailscale MagicDNS, etc.)."""

from __future__ import annotations

from urllib.parse import urlparse


class MoonrakerUrlError(ValueError):
    pass


def normalize_moonraker_base_url(raw: str) -> str:
    """
    Normalize user input to a Moonraker base URL.

    Accepts ``http://la-porqueriza:8011``, ``la-porqueriza:8011``, IPs, ``.local`` names, etc.
    """
    trimmed = raw.strip()
    if not trimmed:
        raise MoonrakerUrlError("Moonraker base URL is required")

    if trimmed.startswith(("http://", "https://")):
        url = trimmed
    elif "://" in trimmed:
        raise MoonrakerUrlError("Only http:// and https:// are supported for Moonraker")
    else:
        url = f"http://{trimmed}"

    url = url.rstrip("/")
    parsed = urlparse(url)

    if parsed.scheme not in ("http", "https"):
        raise MoonrakerUrlError("Only http:// and https:// are supported for Moonraker")
    if not parsed.hostname:
        raise MoonrakerUrlError("URL must include a hostname or IP address")
    if parsed.username or parsed.password:
        raise MoonrakerUrlError("Do not embed credentials in the URL; use the API key field instead")
    if parsed.port is not None and not (1 <= parsed.port <= 65535):
        raise MoonrakerUrlError("Port must be between 1 and 65535")

    return url


def format_moonraker_connection_error(exc: BaseException, *, base_url: str) -> str:
    """Turn low-level connection errors into actionable messages (incl. Tailscale DNS)."""
    msg = str(exc).strip() or exc.__class__.__name__
    lower = msg.lower()
    host = urlparse(base_url).hostname or base_url

    if "name or service not known" in lower or "nodename nor servname" in lower or "getaddrinfo failed" in lower:
        return (
            f"Cannot resolve hostname “{host}”. "
            "If this is a Tailscale MagicDNS name, the Jove API must run where that DNS works "
            "(same machine as Tailscale, or Docker with Tailscale DNS — see docker-compose.tailscale.yml). "
            "You can also use the printer’s Tailscale IP, e.g. http://100.x.x.x:8011."
        )
    if "temporary failure in name resolution" in lower:
        return (
            f"DNS lookup failed for “{host}”. "
            "Check Tailscale is connected and MagicDNS is enabled, or use the printer’s IP address."
        )
    if "connection refused" in lower:
        return (
            f"Connection refused at {base_url}. "
            "Moonraker may be stopped, the port may be wrong, or a firewall is blocking the Jove API host."
        )
    if "timed out" in lower or "timeout" in lower:
        return (
            f"Timed out connecting to {base_url}. "
            "Check the host is reachable from where the Jove API runs (routing, Tailscale, firewall)."
        )
    if "network is unreachable" in lower:
        return f"Network unreachable for {base_url}. The Jove API host may not have a route to the printer."
    if "certificate" in lower or "ssl" in lower:
        return f"TLS/HTTPS error for {base_url}: {msg}"

    return msg
