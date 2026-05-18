"""Add default filament density (g/cm³) per material for library estimates."""

from alembic import op
import sqlalchemy as sa

revision = "007_material_default_density"
down_revision = "006_gcode_display_color"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "material_preheat_presets",
        sa.Column("default_density_g_cm3", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("material_preheat_presets", "default_density_g_cm3")
