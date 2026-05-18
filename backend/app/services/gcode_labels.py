"""Display names and color/material resolution for G-code library rows."""


def default_display_name(filename: str) -> str:
    name = (filename or "job").strip() or "job"
    lower = name.lower()
    for ext in (".gcode.gz", ".gcode.3mf", ".gcode", ".nc"):
        if lower.endswith(ext):
            return name[: -len(ext)]
    if "." in name:
        return name.rsplit(".", 1)[0]
    return name
