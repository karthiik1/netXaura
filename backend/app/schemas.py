"""Pydantic v2 request/response models (§4). Source of truth for the OpenAPI
schema, from which the frontend TS types are generated."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models import TabType, TransferStatus, TransferType


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---- workspaces ------------------------------------------------------------
class WorkspaceCreate(BaseModel):
    name: str | None = Field(default=None, max_length=120)


class WorkspaceCreated(BaseModel):
    workspace_id: str
    code: str


class MemberOut(ORMModel):
    device_id: str
    display_name: str
    is_connected: bool
    joined_at: datetime
    last_seen_at: datetime


class JoinRequest(BaseModel):
    device_id: str = Field(min_length=8, max_length=36)
    display_name: str = Field(min_length=1, max_length=80)
    # Bound on first join; required on later joins while the device is connected.
    auth_token: str | None = Field(default=None, max_length=64)


# ---- tabs ------------------------------------------------------------------
class TabOut(ORMModel):
    id: str
    workspace_id: str
    owner_device_id: str
    type: TabType
    title: str
    content: str
    language: str | None
    created_at: datetime
    updated_at: datetime


class TabCreate(BaseModel):
    owner_device_id: str
    type: TabType = TabType.code
    title: str = "Untitled"
    content: str = ""
    language: str | None = None


class TabUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    language: str | None = None


# ---- join / bootstrap ------------------------------------------------------
class JoinResult(BaseModel):
    member: MemberOut
    members: list[MemberOut]
    tabs: list[TabOut]
    # This member's own token — never present in MemberOut, so joining can't
    # enumerate other members' tokens. The WS connection requires it (§5.1).
    auth_token: str


# ---- transfers -------------------------------------------------------------
class TransferHistoryOut(ORMModel):
    id: int
    sender_device_id: str
    receiver_device_id: str | None
    transfer_type: TransferType
    payload_preview: str
    status: TransferStatus
    created_at: datetime
    completed_at: datetime | None
