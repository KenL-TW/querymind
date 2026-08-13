from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass

from rank_bm25 import BM25Okapi
from Levenshtein import ratio as lev_ratio

from adapters.storage.base import BaseStorageAdapter
from storage.metadata_db import CodeMetadata

logger = logging.getLogger(__name__)

_THRESHOLD = 0.5
_W_BM25 = 0.50
_W_LEV = 0.35
_W_SUBSTR = 0.15


@dataclass
class ArchiveHit:
    storage_key: str
    score: float
    code: str


class CodeArchive:
    """
    ETL code archive with BM25+ similarity search.

    Score = 50% BM25+(normalised) + 35% Levenshtein + 15% substring
    """

    def __init__(self, storage: BaseStorageAdapter, session_factory) -> None:
        self._storage = storage
        self._Session = session_factory

    # ── Search ────────────────────────────────────────────────────────────────

    def search(self, file_path: str, schema_name: str, table_name: str) -> ArchiveHit | None:
        """Return the best matching archive entry above threshold, or None."""
        with self._Session() as session:
            candidates: list[CodeMetadata] = (
                session.query(CodeMetadata)
                .filter_by(schema_name=schema_name, table_name=table_name, active=True)
                .all()
            )

        if not candidates:
            return None

        query_tokens = _tokenise(file_path)
        corpus = [_tokenise(c.file_path) for c in candidates]

        bm25 = BM25Okapi(corpus)
        bm25_scores_raw = bm25.get_scores(query_tokens)
        max_bm25 = max(bm25_scores_raw) if max(bm25_scores_raw) > 0 else 1.0
        bm25_scores = [s / max_bm25 for s in bm25_scores_raw]

        best_score = -1.0
        best_idx = -1

        for i, candidate in enumerate(candidates):
            lev = lev_ratio(file_path.lower(), candidate.file_path.lower())
            substr = 1.0 if _common_substring(file_path.lower(), candidate.file_path.lower()) else 0.0
            score = _W_BM25 * bm25_scores[i] + _W_LEV * lev + _W_SUBSTR * substr

            if score > best_score:
                best_score = score
                best_idx = i

        if best_score < _THRESHOLD:
            logger.info("No archive hit above threshold", extra={"score": best_score})
            return None

        hit_meta = candidates[best_idx]
        code = self._storage.download(hit_meta.storage_key)
        logger.info("Archive hit", extra={"key": hit_meta.storage_key, "score": best_score})
        return ArchiveHit(storage_key=hit_meta.storage_key, score=best_score, code=code)

    # ── Save ──────────────────────────────────────────────────────────────────

    def save(
        self,
        code: str,
        file_path: str,
        schema_name: str,
        table_name: str,
        description: str = "",
    ) -> str:
        """Archive code and return the storage key."""
        key = f"{schema_name}/{table_name}/{uuid.uuid4().hex[:8]}.py"
        self._storage.upload(key, code)

        with self._Session() as session:
            record = CodeMetadata(
                schema_name=schema_name,
                table_name=table_name,
                file_path=file_path,
                storage_key=key,
                description=description,
            )
            session.add(record)
            session.commit()

        logger.info("Code archived", extra={"key": key})
        return key


# ── Helpers ───────────────────────────────────────────────────────────────────

def _tokenise(text: str) -> list[str]:
    import re
    return re.split(r"[\W_]+", text.lower())


def _common_substring(a: str, b: str, min_len: int = 4) -> bool:
    for length in range(min(len(a), len(b)), min_len - 1, -1):
        for start in range(len(a) - length + 1):
            if a[start : start + length] in b:
                return True
    return False
