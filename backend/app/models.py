"""SQLAlchemy 2.0 async ORM models (§3).

Portable types: UUID columns use String(36); large content uses Text with a
MySQL LONGTEXT variant; enums use SQLAlchemy Enum (native ENUM on MySQL,
VARCHAR+CHECK on SQLite). Table charset is set to utf8mb4 on MySQL and ignored
elsewhere.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

_MYSQL_ARGS = {"mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"}

# SQLite only auto-increments INTEGER PRIMARY KEY, so BIGINT PKs need a variant.
_AUTO_PK = BigInteger().with_variant(Integer, "sqlite")


def _uuid() -> str:
    return str(uuid.uuid4())


class TabType(str, enum.Enum):
    code = "code"
    rich_text = "rich_text"


class TransferType(str, enum.Enum):
    selection = "selection"
    tab = "tab"
    workspace = "workspace"


class TransferStatus(str, enum.Enum):
    pending = "pending"
    completed = "completed"
    expired = "expired"


class Workspace(Base):
    __tablename__ = "workspaces"
    __table_args__ = _MYSQL_ARGS

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    code: Mapped[str] = mapped_column(String(6), unique=True, index=True)
    name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    members: Mapped[list["WorkspaceMember"]] = relationship(
        back_populates="workspace", cascade="all, delete-orphan"
    )
    tabs: Mapped[list["Tab"]] = relationship(
        back_populates="workspace", cascade="all, delete-orphan"
    )


class WorkspaceMember(Base):
    __tablename__ = "workspace_members"
    __table_args__ = (
        UniqueConstraint("workspace_id", "device_id", name="uq_member_device"),
        _MYSQL_ARGS,
    )

    id: Mapped[int] = mapped_column(_AUTO_PK, primary_key=True, autoincrement=True)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    device_id: Mapped[str] = mapped_column(String(36))
    display_name: Mapped[str] = mapped_column(String(80))
    joined_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
    is_connected: Mapped[bool] = mapped_column(Boolean, default=False)
    # Opaque per-member secret issued on join; required to open the WS (§5.1).
    # LAN-grade only — it stops casual device_id spoofing, not a real attacker.
    auth_token: Mapped[str | None] = mapped_column(String(64), nullable=True)

    workspace: Mapped[Workspace] = relationship(back_populates="members")


class Tab(Base):
    __tablename__ = "tabs"
    __table_args__ = _MYSQL_ARGS

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    owner_device_id: Mapped[str] = mapped_column(String(36))
    type: Mapped[TabType] = mapped_column(Enum(TabType), default=TabType.code)
    title: Mapped[str] = mapped_column(String(160), default="Untitled")
    # Raw text for code tabs; serialized TipTap JSON for rich-text tabs.
    content: Mapped[str] = mapped_column(
        Text().with_variant(LONGTEXT, "mysql"), default=""
    )
    language: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    workspace: Mapped[Workspace] = relationship(back_populates="tabs")


class TransferHistory(Base):
    __tablename__ = "transfer_history"
    __table_args__ = _MYSQL_ARGS

    id: Mapped[int] = mapped_column(_AUTO_PK, primary_key=True, autoincrement=True)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    sender_device_id: Mapped[str] = mapped_column(String(36))
    receiver_device_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    transfer_type: Mapped[TransferType] = mapped_column(Enum(TransferType))
    # Small, non-authoritative preview only — never the full payload (§3).
    payload_preview: Mapped[str] = mapped_column(Text, default="{}")
    status: Mapped[TransferStatus] = mapped_column(
        Enum(TransferStatus), default=TransferStatus.pending
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class AppSetting(Base):
    __tablename__ = "app_settings"
    __table_args__ = (
        UniqueConstraint("workspace_id", "key", name="uq_setting_scope"),
        _MYSQL_ARGS,
    )

    id: Mapped[int] = mapped_column(_AUTO_PK, primary_key=True, autoincrement=True)
    # NULL workspace_id = global default; a non-NULL row overrides per workspace.
    workspace_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True
    )
    key: Mapped[str] = mapped_column(String(60))
    value: Mapped[str] = mapped_column(String(255))
