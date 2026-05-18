"""material color presets, print kits, queue kit reference

Revision ID: 005_materials_kits
Revises: 004_gcode_meta
Create Date: 2026-05-17
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "005_materials_kits"
down_revision: Union[str, None] = "004_gcode_meta"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "material_color_presets",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("material_preset_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("hex", sa.String(length=7), nullable=True),
        sa.Column("is_default", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("notes", sa.String(length=256), nullable=True),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["material_preset_id"],
            ["material_preheat_presets.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "material_preset_id",
            "name",
            name="uq_material_color_presets_material_name",
        ),
    )
    op.create_index(
        "ix_material_color_presets_material_preset_id",
        "material_color_presets",
        ["material_preset_id"],
    )

    op.create_table(
        "print_kits",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("description", sa.String(length=512), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="uq_print_kits_name"),
    )

    op.create_table(
        "print_kit_items",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("kit_id", sa.Integer(), nullable=False),
        sa.Column("gcode_file_id", sa.Integer(), nullable=False),
        sa.Column("material_preset_id", sa.Integer(), nullable=False),
        sa.Column("quantity", sa.Integer(), server_default="1", nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(["kit_id"], ["print_kits.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["gcode_file_id"], ["gcode_files.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["material_preset_id"],
            ["material_preheat_presets.id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_print_kit_items_kit_id", "print_kit_items", ["kit_id"])

    op.add_column("print_queue_items", sa.Column("print_kit_id", sa.Integer(), nullable=True))
    op.add_column("print_queue_items", sa.Column("kit_run_index", sa.Integer(), nullable=True))
    op.add_column("print_queue_items", sa.Column("material_preset_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_print_queue_items_print_kit_id",
        "print_queue_items",
        "print_kits",
        ["print_kit_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_print_queue_items_material_preset_id",
        "print_queue_items",
        "material_preheat_presets",
        ["material_preset_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_print_queue_items_material_preset_id", "print_queue_items", type_="foreignkey")
    op.drop_constraint("fk_print_queue_items_print_kit_id", "print_queue_items", type_="foreignkey")
    op.drop_column("print_queue_items", "material_preset_id")
    op.drop_column("print_queue_items", "kit_run_index")
    op.drop_column("print_queue_items", "print_kit_id")
    op.drop_table("print_kit_items")
    op.drop_table("print_kits")
    op.drop_table("material_color_presets")
