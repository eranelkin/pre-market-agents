"""add parent_agent_name to agent_results

Revision ID: 003
Revises: 002
Create Date: 2026-05-24

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "agent_results",
        sa.Column("parent_agent_name", sa.String(50), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agent_results", "parent_agent_name")
