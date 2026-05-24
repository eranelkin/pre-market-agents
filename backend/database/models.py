import uuid
from datetime import datetime, timezone
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.database.connection import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Session(Base):
    __tablename__ = "sessions"

    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    process_id: Mapped[str] = mapped_column(sa.String(100), nullable=False)
    input_file_name: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    total_stocks: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    active_variants: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(sa.String(20), nullable=False, default="pending")
    started_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, default=_utcnow
    )
    completed_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)

    runs: Mapped[list["Run"]] = relationship(
        "Run", back_populates="session", cascade="all, delete-orphan"
    )
    comparison_results: Mapped[list["ComparisonResult"]] = relationship(
        "ComparisonResult", back_populates="session", cascade="all, delete-orphan"
    )


class Run(Base):
    __tablename__ = "runs"

    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        sa.ForeignKey("sessions.session_id", ondelete="CASCADE"),
        nullable=False,
    )
    model_variant_id: Mapped[str] = mapped_column(sa.String(100), nullable=False)
    test_mode: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    provider_used: Mapped[str | None] = mapped_column(sa.String(50), nullable=True)
    model_used: Mapped[str | None] = mapped_column(sa.String(100), nullable=True)
    status: Mapped[str] = mapped_column(sa.String(20), nullable=False, default="pending")
    total_stocks: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    chunk_count: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
    started_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, default=_utcnow
    )
    completed_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    error_message: Mapped[str | None] = mapped_column(sa.Text, nullable=True)

    __table_args__ = (sa.Index("idx_runs_session_id", "session_id"),)

    session: Mapped["Session"] = relationship("Session", back_populates="runs")
    batches: Mapped[list["Batch"]] = relationship(
        "Batch", back_populates="run", cascade="all, delete-orphan"
    )
    agent_results: Mapped[list["AgentResult"]] = relationship(
        "AgentResult", back_populates="run", cascade="all, delete-orphan"
    )
    final_results: Mapped[list["FinalResult"]] = relationship(
        "FinalResult", back_populates="run", cascade="all, delete-orphan"
    )


class Batch(Base):
    __tablename__ = "batches"

    batch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        sa.ForeignKey("runs.run_id", ondelete="CASCADE"),
        nullable=False,
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        sa.ForeignKey("sessions.session_id", ondelete="CASCADE"),
        nullable=False,
    )
    batch_index: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    stocks_in_batch: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(sa.String(20), nullable=False, default="pending")
    started_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, default=_utcnow
    )
    completed_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)

    __table_args__ = (sa.Index("idx_batches_run_id", "run_id"),)

    run: Mapped["Run"] = relationship("Run", back_populates="batches")
    agent_results: Mapped[list["AgentResult"]] = relationship(
        "AgentResult", back_populates="batch", cascade="all, delete-orphan"
    )


class AgentResult(Base):
    __tablename__ = "agent_results"

    result_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    batch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        sa.ForeignKey("batches.batch_id", ondelete="CASCADE"),
        nullable=False,
    )
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        sa.ForeignKey("runs.run_id", ondelete="CASCADE"),
        nullable=False,
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        sa.ForeignKey("sessions.session_id", ondelete="CASCADE"),
        nullable=False,
    )
    agent_name: Mapped[str] = mapped_column(sa.String(50), nullable=False)
    parent_agent_name: Mapped[str | None] = mapped_column(sa.String(50), nullable=True)
    ticker: Mapped[str] = mapped_column(sa.String(20), nullable=False)
    provider_used: Mapped[str | None] = mapped_column(sa.String(50), nullable=True)
    model_used: Mapped[str | None] = mapped_column(sa.String(100), nullable=True)
    was_fallback: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    web_search_used: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    raw_prompt: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    raw_response: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    parsed_output: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    tokens_used: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, default=_utcnow
    )

    __table_args__ = (
        sa.Index("idx_agent_results_run_id", "run_id"),
        sa.Index("idx_agent_results_ticker", "ticker"),
        sa.Index("idx_agent_results_run_ticker", "run_id", "ticker"),
    )

    batch: Mapped["Batch"] = relationship("Batch", back_populates="agent_results")
    run: Mapped["Run"] = relationship("Run", back_populates="agent_results")


class FinalResult(Base):
    __tablename__ = "final_results"

    result_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        sa.ForeignKey("runs.run_id", ondelete="CASCADE"),
        nullable=False,
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        sa.ForeignKey("sessions.session_id", ondelete="CASCADE"),
        nullable=False,
    )
    ticker: Mapped[str] = mapped_column(sa.String(20), nullable=False)
    final_score: Mapped[float | None] = mapped_column(sa.Numeric(5, 2), nullable=True)
    rank: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
    recommendation: Mapped[str | None] = mapped_column(sa.String(20), nullable=True)
    confidence: Mapped[float | None] = mapped_column(sa.Numeric(4, 2), nullable=True)
    technical_score: Mapped[float | None] = mapped_column(sa.Numeric(5, 2), nullable=True)
    fundamental_score: Mapped[float | None] = mapped_column(sa.Numeric(5, 2), nullable=True)
    sentiment_score: Mapped[float | None] = mapped_column(sa.Numeric(5, 2), nullable=True)
    # risk_score is INVERTED: higher value = lower risk = better
    risk_score: Mapped[float | None] = mapped_column(sa.Numeric(5, 2), nullable=True)
    macro_score: Mapped[float | None] = mapped_column(sa.Numeric(5, 2), nullable=True)
    override_applied: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    override_reason: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    conflicting_signals: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    key_signals: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    ceo_rationale: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, default=_utcnow
    )

    __table_args__ = (
        sa.Index("idx_final_results_run_id", "run_id"),
        sa.Index("idx_final_results_run_rank", "run_id", "rank"),
        sa.Index("idx_final_results_session_ticker", "session_id", "ticker"),
    )

    run: Mapped["Run"] = relationship("Run", back_populates="final_results")


class ComparisonResult(Base):
    __tablename__ = "comparison_results"

    comparison_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        sa.ForeignKey("sessions.session_id", ondelete="CASCADE"),
        nullable=False,
    )
    ticker: Mapped[str] = mapped_column(sa.String(20), nullable=False)
    # {variant_id: {rank, final_score, recommendation, confidence}}
    variant_results: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    recommendation_agreement: Mapped[bool | None] = mapped_column(sa.Boolean, nullable=True)
    max_rank_diff: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
    max_score_diff: Mapped[float | None] = mapped_column(sa.Numeric(5, 2), nullable=True)
    consensus_recommendation: Mapped[str | None] = mapped_column(sa.String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, default=_utcnow
    )

    __table_args__ = (
        sa.Index("idx_comparison_results_session_id", "session_id"),
        sa.UniqueConstraint("session_id", "ticker", name="uq_comparison_session_ticker"),
    )

    session: Mapped["Session"] = relationship("Session", back_populates="comparison_results")
