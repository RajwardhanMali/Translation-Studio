"""optimize tm indexes

Revision ID: 9f1d2c7a3b44
Revises: 08a16d1bb71c
Create Date: 2026-04-05 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "9f1d2c7a3b44"
down_revision: Union[str, Sequence[str], None] = "08a16d1bb71c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


LANGUAGES = ["fr", "es", "de", "it", "pt", "zh", "ja", "ar", "hi", "en"]


def upgrade() -> None:
    # Fast exact-match lookup by language + normalized source text.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_tm_language_source_norm
        ON translation_memory (language, (lower(btrim(source_text))))
        """
    )

    # Language-specific ANN indexes for vector similarity search.
    for lang in LANGUAGES:
        op.execute(
            f"""
            CREATE INDEX IF NOT EXISTS ix_tm_embedding_{lang}
            ON translation_memory
            USING ivfflat (embedding vector_cosine_ops)
            WITH (lists = 100)
            WHERE language = '{lang}' AND embedding IS NOT NULL
            """
        )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_tm_language_source_norm")

    for lang in LANGUAGES:
        op.execute(f"DROP INDEX IF EXISTS ix_tm_embedding_{lang}")
