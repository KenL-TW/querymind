from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Optional

from langchain_community.chat_message_histories import SQLChatMessageHistory
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from sqlalchemy import create_engine, text

logger = logging.getLogger(__name__)

_TABLE_NAME = "qm_chat_messages"


@dataclass
class MessageItem:
    role: str   # "user" | "assistant"
    content: str
    created_at: Optional[str] = None


@dataclass
class SessionInfo:
    session_id: str
    message_count: int
    turn_count: int
    last_active: Optional[str] = None
    title: str = ""
    summary: str = ""
    owner_user_id: Optional[int] = None
    pinned: bool = False
    archived: bool = False


@dataclass
class SessionMetaInfo:
    session_id: str
    title: str = ""
    summary: str = ""
    entities: list = field(default_factory=list)
    owner_user_id: Optional[int] = None
    pinned: bool = False
    archived: bool = False


class SessionMemoryManager:
    """
    Manages per-session conversation history persisted to PostgreSQL.

    Design:
    - All messages are stored permanently (full audit trail).
    - The ReAct prompt receives a **sliding window** of the last `max_window_turns`
      turns (human + assistant pairs) as a formatted string.
    - Older messages remain in DB but are excluded from the active context window,
      preventing context-length blowup on long sessions.
    - Thread-safe: SQLChatMessageHistory uses its own SQLAlchemy engine per call.
    """

    def __init__(self, metadata_db_url: str, max_window_turns: int = 10) -> None:
        self._db_url = metadata_db_url
        self._max_turns = max_window_turns
        # Single shared engine — avoids per-call pool churn under load.
        self._engine = create_engine(
            metadata_db_url,
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=5,
        )

    # ── Context for the ReAct prompt ──────────────────────────────────────────

    def get_history_for_prompt(self, session_id: str) -> str:
        history = self._get_history(session_id)
        all_messages = history.messages
        if not all_messages:
            return "(No previous conversation in this session.)"
        window = all_messages[-(self._max_turns * 2):]
        total = len(all_messages)
        omitted = total - len(window)
        lines: list[str] = []
        if omitted > 0:
            lines.append(f"[... {omitted} earlier messages omitted — showing last {self._max_turns} turns ...]")
        for msg in window:
            role = "User" if msg.type == "human" else "Assistant"
            content = msg.content[:1500] + "…" if len(msg.content) > 1500 else msg.content
            lines.append(f"{role}: {content}")
        return "\n".join(lines)

    def get_messages_for_agent(self, session_id: str) -> list[BaseMessage]:
        history = self._get_history(session_id)
        all_messages = history.messages
        if not all_messages:
            return []
        window = all_messages[-(self._max_turns * 2):]
        result: list[BaseMessage] = []
        for msg in window:
            content = msg.content[:1500] + "…" if len(msg.content) > 1500 else msg.content
            if msg.type == "human":
                result.append(HumanMessage(content=content))
            elif msg.type == "ai":
                result.append(AIMessage(content=content))
        return result

    # ── Persistence ───────────────────────────────────────────────────────────

    def add_turn(
        self,
        session_id: str,
        human_message: str,
        ai_message: str,
        owner_user_id: Optional[int] = None,
    ) -> None:
        """Persist one completed Q&A turn and refresh session meta."""
        history = self._get_history(session_id)
        history.add_user_message(human_message)
        history.add_ai_message(ai_message)
        self.upsert_session_meta(session_id, owner_user_id=owner_user_id)
        logger.debug("Turn persisted", extra={"session_id": session_id})

    def add_partial_human(self, session_id: str, message: str) -> None:
        self._get_history(session_id).add_user_message(message)

    def update_last_ai(self, session_id: str, message: str) -> None:
        self._get_history(session_id).add_ai_message(message)

    # ── Session metadata ──────────────────────────────────────────────────────

    def upsert_session_meta(
        self,
        session_id: str,
        title: Optional[str] = None,
        summary: Optional[str] = None,
        entities: Optional[list] = None,
        owner_user_id: Optional[int] = None,
        pinned: Optional[bool] = None,
        archived: Optional[bool] = None,
    ) -> None:
        """Create or update qm_session_meta for a session. Only non-None params are changed."""
        engine = self._engine
        try:
            with engine.begin() as conn:
                existing = conn.execute(
                    text("SELECT session_id, title, summary, entities, owner_user_id, pinned, archived FROM qm_session_meta WHERE session_id = :sid"),
                    {"sid": session_id},
                ).fetchone()

                now = datetime.now(timezone.utc)

                if existing is None:
                    conn.execute(
                        text("""
                            INSERT INTO qm_session_meta
                                (session_id, title, summary, entities, owner_user_id, pinned, archived, created_at, updated_at)
                            VALUES
                                (:sid, :title, :summary, :entities, :owner, :pinned, :archived, :now, :now)
                        """),
                        {
                            "sid": session_id,
                            "title": title or "",
                            "summary": summary or "",
                            "entities": json.dumps(entities or []),
                            "owner": owner_user_id,
                            "pinned": pinned or False,
                            "archived": archived or False,
                            "now": now,
                        },
                    )
                else:
                    updates: dict = {"sid": session_id, "now": now}
                    set_parts = ["updated_at = :now"]

                    if title is not None:
                        updates["title"] = title
                        set_parts.append("title = :title")
                    if summary is not None:
                        updates["summary"] = summary
                        set_parts.append("summary = :summary")
                    if entities is not None:
                        updates["entities"] = json.dumps(entities)
                        set_parts.append("entities = :entities")
                    if owner_user_id is not None and existing[4] is None:
                        updates["owner"] = owner_user_id
                        set_parts.append("owner_user_id = :owner")
                    if pinned is not None:
                        updates["pinned"] = pinned
                        set_parts.append("pinned = :pinned")
                    if archived is not None:
                        updates["archived"] = archived
                        set_parts.append("archived = :archived")

                    conn.execute(
                        text(f"UPDATE qm_session_meta SET {', '.join(set_parts)} WHERE session_id = :sid"),  # noqa: S608
                        updates,
                    )
        finally:
            pass

    def get_session_meta(self, session_id: str) -> SessionMetaInfo:
        """Return session metadata; creates a blank meta row if missing."""
        engine = self._engine
        try:
            with engine.connect() as conn:
                row = conn.execute(
                    text("SELECT title, summary, entities, owner_user_id, pinned, archived FROM qm_session_meta WHERE session_id = :sid"),
                    {"sid": session_id},
                ).fetchone()
        finally:
            pass

        if row is None:
            return SessionMetaInfo(session_id=session_id)

        try:
            entities = json.loads(row[2] or "[]")
            if not isinstance(entities, list):
                entities = []
        except (ValueError, TypeError):
            entities = []

        return SessionMetaInfo(
            session_id=session_id,
            title=row[0] or "",
            summary=row[1] or "",
            entities=entities,
            owner_user_id=row[3],
            pinned=bool(row[4]),
            archived=bool(row[5]),
        )

    # ── Session listing / management ──────────────────────────────────────────

    def list_sessions(
        self,
        owner_user_id: Optional[int] = None,
        include_archived: bool = False,
        archived_only: bool = False,
        search: Optional[str] = None,
        limit: int = 200,
        include_orphans: bool = True,
    ) -> list[SessionInfo]:
        """
        Return sessions ordered by last activity.

        - Sessions without a qm_session_meta row are 'orphans' and are included
          when include_orphans=True.
        - owner_user_id=None means no ownership filter (show all).
        """
        engine = self._engine
        try:
            with engine.connect() as conn:
                # Build the primary query: sessions WITH meta
                where_parts = []
                params: dict = {"limit": limit}

                if owner_user_id is not None:
                    if include_orphans:
                        where_parts.append("(sm.owner_user_id = :owner OR sm.owner_user_id IS NULL)")
                    else:
                        where_parts.append("sm.owner_user_id = :owner")
                    params["owner"] = owner_user_id

                if archived_only:
                    where_parts.append("sm.archived = TRUE")
                elif not include_archived:
                    where_parts.append("sm.archived = FALSE")

                if search:
                    where_parts.append("(sm.title ILIKE :search OR sm.summary ILIKE :search)")
                    params["search"] = f"%{search}%"

                where_clause = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

                meta_rows = conn.execute(
                    text(f"""
                        SELECT sm.session_id,
                               COALESCE(cnt.cnt, 0) AS message_count,
                               sm.title,
                               sm.summary,
                               sm.owner_user_id,
                               sm.pinned,
                               sm.archived,
                               sm.updated_at
                        FROM qm_session_meta sm
                        LEFT JOIN (
                            SELECT session_id, COUNT(*) AS cnt
                            FROM {_TABLE_NAME}
                            GROUP BY session_id
                        ) cnt ON cnt.session_id = sm.session_id
                        {where_clause}
                        ORDER BY sm.updated_at DESC NULLS LAST
                        LIMIT :limit
                    """),  # noqa: S608
                    params,
                ).fetchall()

                # Collect sessions from meta
                result: list[SessionInfo] = []
                seen: set[str] = set()
                for row in meta_rows:
                    sid = row[0]
                    seen.add(sid)
                    mc = int(row[1])
                    result.append(SessionInfo(
                        session_id=sid,
                        message_count=mc,
                        turn_count=mc // 2,
                        last_active=str(row[7]) if row[7] else None,
                        title=row[2] or "",
                        summary=row[3] or "",
                        owner_user_id=row[4],
                        pinned=bool(row[5]),
                        archived=bool(row[6]),
                    ))

                # Include pure orphans (messages exist but no meta row) when requested
                # and no title/summary search (orphans have no meta to search)
                if include_orphans and not search and (not archived_only):
                    orphan_rows = conn.execute(
                        text(f"""
                            SELECT c.session_id, COUNT(*) AS cnt, MAX(c.id) AS last_id
                            FROM {_TABLE_NAME} c
                            WHERE c.session_id NOT IN (
                                SELECT session_id FROM qm_session_meta
                            )
                            GROUP BY c.session_id
                            ORDER BY last_id DESC
                            LIMIT :limit
                        """),  # noqa: S608
                        {"limit": limit},
                    ).fetchall()
                    for orow in orphan_rows:
                        if orow[0] not in seen:
                            mc = int(orow[1])
                            result.append(SessionInfo(
                                session_id=orow[0],
                                message_count=mc,
                                turn_count=mc // 2,
                            ))

        except Exception:
            logger.exception("list_sessions failed")
            return []
        finally:
            pass

        return result[:limit]

    def session_exists(self, session_id: str) -> bool:
        engine = self._engine
        try:
            with engine.connect() as conn:
                row = conn.execute(
                    text(f"SELECT 1 FROM {_TABLE_NAME} WHERE session_id = :sid LIMIT 1"),  # noqa: S608
                    {"sid": session_id},
                ).fetchone()
                if row:
                    return True
                row2 = conn.execute(
                    text("SELECT 1 FROM qm_session_meta WHERE session_id = :sid LIMIT 1"),
                    {"sid": session_id},
                ).fetchone()
                return row2 is not None
        except Exception:
            return False

    def get_session_messages(self, session_id: str) -> list[MessageItem]:
        history = self._get_history(session_id)
        return [
            MessageItem(
                role="user" if m.type == "human" else "assistant",
                content=m.content,
            )
            for m in history.messages
        ]

    def pop_last_turn(self, session_id: str) -> str | None:
        """Remove the last AI+human message pair from the DB and return the last human message text.

        Used by the regenerate endpoint so the agent can re-answer the same question.
        Returns None if no human message was found in the session.
        """
        with self._engine.begin() as conn:
            rows = conn.execute(
                text(f"SELECT id, message FROM {_TABLE_NAME} WHERE session_id = :sid ORDER BY id"),  # noqa: S608
                {"sid": session_id},
            ).fetchall()

        if not rows:
            return None

        ids_to_delete: list[int] = []
        last_human: str | None = None
        found_ai = False
        found_human = False

        for row_id, msg_json in reversed(rows):
            try:
                msg = json.loads(msg_json)
            except Exception:
                continue
            msg_type = str(msg.get("type", "")).lower()
            if not found_ai and msg_type in ("ai", "aimessage"):
                ids_to_delete.append(row_id)
                found_ai = True
            elif not found_human and msg_type in ("human", "humanmessage"):
                ids_to_delete.append(row_id)
                data = msg.get("data", msg)
                last_human = str(data.get("content", ""))
                found_human = True
            if found_ai and found_human:
                break

        if ids_to_delete:
            with self._engine.begin() as conn:
                for del_id in ids_to_delete:
                    conn.execute(
                        text(f"DELETE FROM {_TABLE_NAME} WHERE id = :id"),  # noqa: S608
                        {"id": del_id},
                    )

        return last_human

    def clear_session(self, session_id: str) -> None:
        self._get_history(session_id).clear()
        logger.info("Session cleared", extra={"session_id": session_id})

    def prune_old_sessions(self, retention_days: int) -> int:
        """Delete sessions (meta + messages) older than retention_days. Pinned sessions are spared."""
        if retention_days <= 0:
            return 0
        cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
        engine = self._engine
        deleted = 0
        try:
            with engine.begin() as conn:
                stale = conn.execute(
                    text("""
                        SELECT session_id FROM qm_session_meta
                        WHERE updated_at < :cutoff AND pinned = FALSE
                    """),
                    {"cutoff": cutoff},
                ).fetchall()
                for row in stale:
                    sid = row[0]
                    conn.execute(
                        text(f"DELETE FROM {_TABLE_NAME} WHERE session_id = :sid"),  # noqa: S608
                        {"sid": sid},
                    )
                    conn.execute(
                        text("DELETE FROM qm_session_meta WHERE session_id = :sid"),
                        {"sid": sid},
                    )
                    deleted += 1
        except Exception:
            logger.exception("prune_old_sessions failed")
        finally:
            pass
        return deleted

    # ── Internal ─────────────────────────────────────────────────────────────

    def _get_history(self, session_id: str) -> SQLChatMessageHistory:
        # Use shared engine via ``connection=`` (the ``connection_string``
        # kwarg was deprecated in LangChain 0.2.2). Reusing the engine avoids
        # creating a new connection pool on every call.
        return SQLChatMessageHistory(
            session_id=session_id,
            connection=self._engine,
            table_name=_TABLE_NAME,
        )

