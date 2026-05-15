"""initial schema

Revision ID: 001_initial
Revises:
Create Date: 2026-05-14
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("username", sa.String(length=64), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_users_username"), "users", ["username"], unique=True)
    op.create_index(op.f("ix_users_role"), "users", ["role"], unique=False)

    op.create_table(
        "printers",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("moonraker_base_url", sa.String(length=512), nullable=False),
        sa.Column("moonraker_api_key", sa.String(length=512), nullable=True),
        sa.Column("ha_power_entity_id", sa.String(length=256), nullable=True),
        sa.Column("loaded_material", sa.String(length=64), nullable=False),
        sa.Column("loaded_color", sa.String(length=128), nullable=False),
        sa.Column("remaining_filament_grams", sa.Float(), nullable=False),
        sa.Column("last_known_status", sa.String(length=64), nullable=False),
        sa.Column("last_moonraker_check_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_moonraker_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_printers_name"), "printers", ["name"], unique=False)
    op.create_index(op.f("ix_printers_last_known_status"), "printers", ["last_known_status"], unique=False)

    op.create_table(
        "gcode_files",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("stored_path", sa.String(length=1024), nullable=False),
        sa.Column("original_filename", sa.String(length=512), nullable=False),
        sa.Column("uploaded_by_id", sa.Integer(), nullable=False),
        sa.Column("filament_mass_grams_estimate", sa.Float(), nullable=True),
        sa.Column("required_material", sa.String(length=64), nullable=True),
        sa.Column("required_color", sa.String(length=128), nullable=True),
        sa.Column("total_copies_requested", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["uploaded_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_gcode_files_uploaded_by_id"), "gcode_files", ["uploaded_by_id"], unique=False)

    op.create_table(
        "print_queue_items",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("gcode_file_id", sa.Integer(), nullable=False),
        sa.Column("copy_index", sa.Integer(), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.Column("assigned_printer_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["assigned_printer_id"], ["printers.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["gcode_file_id"], ["gcode_files.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_print_queue_items_gcode_file_id"), "print_queue_items", ["gcode_file_id"], unique=False)
    op.create_index(op.f("ix_print_queue_items_assigned_printer_id"), "print_queue_items", ["assigned_printer_id"], unique=False)
    op.create_index(op.f("ix_print_queue_items_priority"), "print_queue_items", ["priority"], unique=False)
    op.create_index(op.f("ix_print_queue_items_status"), "print_queue_items", ["status"], unique=False)


def downgrade() -> None:
    op.drop_table("print_queue_items")
    op.drop_table("gcode_files")
    op.drop_table("printers")
    op.drop_table("users")
