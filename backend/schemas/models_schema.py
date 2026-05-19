from typing import Literal, Optional

from pydantic import BaseModel, Field


class AddVariantRequest(BaseModel):
    id: str = Field(..., pattern=r"^[a-z0-9_]+$")
    label: str
    provider: str
    model: str
    max_tokens: int = 4096
    api_key: Optional[str] = None   # written to .env only, never stored in DB
    set_active: bool = False


class ToggleActiveRequest(BaseModel):
    active: bool


class VariantDetail(BaseModel):
    id: str
    label: str
    provider: str
    model: str
    max_tokens: int
    base_url: Optional[str] = None
    status: Literal["ready", "no_key"]
    active: bool


class ModelPreset(BaseModel):
    id: str
    label: str
    provider: str
    model: str
    max_tokens: int
    tier: Literal["free", "cheap", "paid"]
    description: str


class TestConnectionResponse(BaseModel):
    status: Literal["ok", "error"]
    latency_ms: Optional[int] = None
    message: Optional[str] = None
