"""gcode library metadata: print time, filament length, material preset

Revision ID: 004_gcode_meta
Revises: 003_farm_ha
Create Date: 2026-05-17
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "004_gcode_meta"
down_revision: Union[str, None] = "003_farm_ha"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("gcode_files", sa.Column("filament_length_mm", sa.Float(), nullable=True))
    op.add_column("gcode_files", sa.Column("print_time_seconds", sa.Integer(), nullable=True))
    op.add_column("gcode_files", sa.Column("material_preset_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_gcode_files_material_preset_id",
        "gcode_files",
        "material_preheat_presets",
        ["material_preset_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_gcode_files_material_preset_id", "gcode_files", type_="foreignkey")
    op.drop_column("gcode_files", "material_preset_id")
    op.drop_column("gcode_files", "print_time_seconds")
    op.drop_column("gcode_files", "filament_length_mm")
