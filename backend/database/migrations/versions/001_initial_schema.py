"""initial schema

Revision ID: 001
Revises:
Create Date: 2026-05-18

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sessions",
        sa.Column("session_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("process_id", sa.String(100), nullable=False),
        sa.Column("input_file_name", sa.String(255), nullable=False),
        sa.Column("total_stocks", sa.Integer, nullable=False),
        sa.Column("active_variants", postgresql.JSONB, nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "runs",
        sa.Column("run_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sessions.session_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("model_variant_id", sa.String(100), nullable=False),
        sa.Column("provider_used", sa.String(50), nullable=True),
        sa.Column("model_used", sa.String(100), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("total_stocks", sa.Integer, nullable=False),
        sa.Column("chunk_count", sa.Integer, nullable=True),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_message", sa.Text, nullable=True),
    )
    op.create_index("idx_runs_session_id", "runs", ["session_id"])

    op.create_table(
        "batches",
        sa.Column("batch_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "run_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("runs.run_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sessions.session_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("batch_index", sa.Integer, nullable=False),
        sa.Column("stocks_in_batch", postgresql.JSONB, nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("idx_batches_run_id", "batches", ["run_id"])

    op.create_table(
        "agent_results",
        sa.Column("result_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "batch_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("batches.batch_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "run_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("runs.run_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sessions.session_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("agent_name", sa.String(50), nullable=False),
        sa.Column("ticker", sa.String(20), nullable=False),
        sa.Column("provider_used", sa.String(50), nullable=True),
        sa.Column("model_used", sa.String(100), nullable=True),
        sa.Column("was_fallback", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("web_search_used", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("raw_prompt", sa.Text, nullable=True),
        sa.Column("raw_response", sa.Text, nullable=True),
        sa.Column("parsed_output", postgresql.JSONB, nullable=True),
        sa.Column("tokens_used", sa.Integer, nullable=True),
        sa.Column("latency_ms", sa.Integer, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
    )
    op.create_index("idx_agent_results_run_id", "agent_results", ["run_id"])
    op.create_index("idx_agent_results_ticker", "agent_results", ["ticker"])
    op.create_index("idx_agent_results_run_ticker", "agent_results", ["run_id", "ticker"])

    op.create_table(
        "final_results",
        sa.Column("result_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "run_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("runs.run_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sessions.session_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("ticker", sa.String(20), nullable=False),
        sa.Column("final_score", sa.Numeric(5, 2), nullable=True),
        sa.Column("rank", sa.Integer, nullable=True),
        sa.Column("recommendation", sa.String(20), nullable=True),
        sa.Column("confidence", sa.Numeric(4, 2), nullable=True),
        sa.Column("technical_score", sa.Numeric(5, 2), nullable=True),
        sa.Column("fundamental_score", sa.Numeric(5, 2), nullable=True),
        sa.Column("sentiment_score", sa.Numeric(5, 2), nullable=True),
        sa.Column("risk_score", sa.Numeric(5, 2), nullable=True),  # INVERTED: higher = lower risk
        sa.Column("macro_score", sa.Numeric(5, 2), nullable=True),
        sa.Column(
            "override_applied", sa.Boolean, nullable=False, server_default=sa.text("false")
        ),
        sa.Column("override_reason", sa.Text, nullable=True),
        sa.Column("conflicting_signals", postgresql.JSONB, nullable=True),
        sa.Column("key_signals", postgresql.JSONB, nullable=True),
        sa.Column("ceo_rationale", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
    )
    op.create_index("idx_final_results_run_id", "final_results", ["run_id"])
    op.create_index("idx_final_results_run_rank", "final_results", ["run_id", "rank"])
    op.create_index("idx_final_results_session_ticker", "final_results", ["session_id", "ticker"])

    op.create_table(
        "comparison_results",
        sa.Column("comparison_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sessions.session_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("ticker", sa.String(20), nullable=False),
        sa.Column("variant_results", postgresql.JSONB, nullable=False),
        sa.Column("recommendation_agreement", sa.Boolean, nullable=True),
        sa.Column("max_rank_diff", sa.Integer, nullable=True),
        sa.Column("max_score_diff", sa.Numeric(5, 2), nullable=True),
        sa.Column("consensus_recommendation", sa.String(20), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
    )
    op.create_index("idx_comparison_results_session_id", "comparison_results", ["session_id"])
    op.create_unique_constraint(
        "uq_comparison_session_ticker", "comparison_results", ["session_id", "ticker"]
    )


def downgrade() -> None:
    op.drop_table("comparison_results")
    op.drop_table("final_results")
    op.drop_table("agent_results")
    op.drop_table("batches")
    op.drop_table("runs")
    op.drop_table("sessions")
