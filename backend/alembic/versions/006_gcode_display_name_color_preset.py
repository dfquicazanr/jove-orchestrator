"""gcode display name, color preset links, kit color override

Revision ID: 006_gcode_display_color
Revises: 005_materials_kits
Create Date: 2026-05-17
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "006_gcode_display_color"
down_revision: Union[str, None] = "005_materials_kits"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _default_display_name(filename: str) -> str:
    name = filename or "job"
    lower = name.lower()
    for ext in (".gcode.gz", ".gcode.3mf", ".gcode", ".nc"):
        if lower.endswith(ext):
            return name[: -len(ext)]
    if "." in name:
        return name.rsplit(".", 1)[0]
    return name


def upgrade() -> None:
    op.add_column("gcode_files", sa.Column("display_name", sa.String(length=256), nullable=True))
    op.add_column("gcode_files", sa.Column("material_color_preset_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_gcode_files_material_color_preset_id",
        "gcode_files",
        "material_color_presets",
        ["material_color_preset_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.add_column("print_kit_items", sa.Column("material_color_preset_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_print_kit_items_material_color_preset_id",
        "print_kit_items",
        "material_color_presets",
        ["material_color_preset_id"],
        ["id"],
        ondelete="SET NULL",
    )

    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, original_filename FROM gcode_files")).fetchall()
    for row in rows:
        conn.execute(
            sa.text("UPDATE gcode_files SET display_name = :dn WHERE id = :id"),
            {"dn": _default_display_name(row.original_filename), "id": row.id},
        )

    op.alter_column("gcode_files", "display_name", nullable=False)


def downgrade() -> None:
    op.drop_constraint("fk_print_kit_items_material_color_preset_id", "print_kit_items", type_="foreignkey")
    op.drop_column("print_kit_items", "material_color_preset_id")
    op.drop_constraint("fk_gcode_files_material_color_preset_id", "gcode_files", type_="foreignkey")
    op.drop_column("gcode_files", "material_color_preset_id")
    op.drop_column("gcode_files", "display_name")
