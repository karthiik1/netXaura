"""add workspace_members.auth_token

Revision ID: 0002_member_auth_token
Revises: 0001_initial
Create Date: 2026-07-14 00:00:00
"""

import sqlalchemy as sa
from alembic import op

revision = "0002_member_auth_token"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "workspace_members",
        sa.Column("auth_token", sa.String(64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("workspace_members", "auth_token")
