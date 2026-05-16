"""farm home assistant singleton settings

Revision ID: 003_farm_ha
Revises: 002_material_preheat
Create Date: 2026-05-15
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "003_farm_ha"
down_revision: Union[str, None] = "002_material_preheat"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "farm_home_assistant_setting",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("base_url", sa.String(length=512), nullable=True),
        sa.Column("token", sa.Text(), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute(
        sa.text(
            "INSERT INTO farm_home_assistant_setting (id, base_url, token) "
            "SELECT 1, NULL, NULL "
            "WHERE NOT EXISTS (SELECT 1 FROM farm_home_assistant_setting WHERE id = 1)"
        )
    )


def downgrade() -> None:
    op.drop_table("farm_home_assistant_setting")
