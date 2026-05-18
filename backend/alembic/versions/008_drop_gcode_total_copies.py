"""Drop total_copies_requested from gcode_files (quantities live on kit items only)."""

from alembic import op
import sqlalchemy as sa

revision = "008_drop_gcode_total_copies"
down_revision = "007_material_default_density"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("gcode_files", "total_copies_requested")


def downgrade() -> None:
    op.add_column(
        "gcode_files",
        sa.Column("total_copies_requested", sa.Integer(), nullable=False, server_default="1"),
    )
    op.alter_column("gcode_files", "total_copies_requested", server_default=None)
