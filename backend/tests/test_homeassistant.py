import pytest

from app.services.homeassistant import parse_entity_power_on


@pytest.mark.parametrize(
    ("state", "expected"),
    [
        ("on", True),
        ("OFF", False),
        ("unavailable", None),
        ("unknown", None),
        (None, None),
        ("open", True),
        ("closed", False),
    ],
)
def test_parse_entity_power_on(state: str | None, expected: bool | None) -> None:
    assert parse_entity_power_on(state) == expected
