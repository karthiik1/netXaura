"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-01-01 00:00:00
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None

_CHARSET = {"mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"}


def upgrade() -> None:
    op.create_table(
        "workspaces",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("code", sa.String(6), nullable=False),
        sa.Column("name", sa.String(120), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("code", name="uq_workspace_code"),
        **_CHARSET,
    )
    op.create_index("ix_workspaces_code", "workspaces", ["code"])

    op.create_table(
        "workspace_members",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("workspace_id", sa.String(36), nullable=False),
        sa.Column("device_id", sa.String(36), nullable=False),
        sa.Column("display_name", sa.String(80), nullable=False),
        sa.Column("joined_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("last_seen_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("is_connected", sa.Boolean(), server_default=sa.text("0")),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("workspace_id", "device_id", name="uq_member_device"),
        **_CHARSET,
    )
    op.create_index("ix_members_workspace", "workspace_members", ["workspace_id"])

    op.create_table(
        "tabs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("workspace_id", sa.String(36), nullable=False),
        sa.Column("owner_device_id", sa.String(36), nullable=False),
        sa.Column("type", sa.Enum("code", "rich_text", name="tabtype"), nullable=False),
        sa.Column("title", sa.String(160), nullable=False, server_default="Untitled"),
        # Portable, exactly as models.py declares it: LONGTEXT on MySQL, plain
        # TEXT elsewhere. Naming the dialect type outright made this migration
        # MySQL-only — SQLite cannot render LONGTEXT, so `alembic upgrade head`
        # died here mid-run and left a half-created schema behind.
        sa.Column("content", sa.Text().with_variant(mysql.LONGTEXT(), "mysql"), nullable=False),
        sa.Column("language", sa.String(40), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        **_CHARSET,
    )
    op.create_index("ix_tabs_workspace", "tabs", ["workspace_id"])

    op.create_table(
        "transfer_history",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("workspace_id", sa.String(36), nullable=False),
        sa.Column("sender_device_id", sa.String(36), nullable=False),
        sa.Column("receiver_device_id", sa.String(36), nullable=True),
        sa.Column(
            "transfer_type",
            sa.Enum("selection", "tab", "workspace", name="transfertype"),
            nullable=False,
        ),
        sa.Column("payload_preview", sa.Text(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("pending", "completed", "expired", name="transferstatus"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        **_CHARSET,
    )
    op.create_index("ix_history_workspace", "transfer_history", ["workspace_id"])

    op.create_table(
        "app_settings",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("workspace_id", sa.String(36), nullable=True),
        sa.Column("key", sa.String(60), nullable=False),
        sa.Column("value", sa.String(255), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("workspace_id", "key", name="uq_setting_scope"),
        **_CHARSET,
    )


def downgrade() -> None:
    op.drop_table("app_settings")
    op.drop_index("ix_history_workspace", table_name="transfer_history")
    op.drop_table("transfer_history")
    op.drop_index("ix_tabs_workspace", table_name="tabs")
    op.drop_table("tabs")
    op.drop_index("ix_members_workspace", table_name="workspace_members")
    op.drop_table("workspace_members")
    op.drop_index("ix_workspaces_code", table_name="workspaces")
    op.drop_table("workspaces")
