"""material preheat presets

Revision ID: 002_material_preheat
Revises: 001_initial
Create Date: 2026-05-15
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "002_material_preheat"
down_revision: Union[str, None] = "001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

DEFAULTS = [
    ("PLA", 210, 60, 0),
    ("PETG", 240, 80, 1),
    ("ABS", 250, 100, 2),
    ("TPU", 220, 50, 3),
]


def upgrade() -> None:
    op.create_table(
        "material_preheat_presets",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("hotend_c", sa.Float(), nullable=False),
        sa.Column("bed_c", sa.Float(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_material_preheat_presets_name"),
        "material_preheat_presets",
        ["name"],
        unique=True,
    )

    presets = sa.table(
        "material_preheat_presets",
        sa.column("name", sa.String),
        sa.column("hotend_c", sa.Float),
        sa.column("bed_c", sa.Float),
        sa.column("sort_order", sa.Integer),
    )
    op.bulk_insert(
        presets,
        [{"name": n, "hotend_c": h, "bed_c": b, "sort_order": o} for n, h, b, o in DEFAULTS],
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_material_preheat_presets_name"), table_name="material_preheat_presets")
    op.drop_table("material_preheat_presets")
