"""DLP / PII masking.

Applies regex-based redaction to query result rows so sensitive values
(emails, phone numbers, national IDs, credit-card numbers, IPs) are not
returned verbatim to the LLM or the end-user.

Behaviour is configured via :class:`Settings`:
  * ``dlp_enabled`` — master switch.  When False, ``mask_rows`` is a no-op.
  * ``dlp_role_exempt`` — comma-separated role names that bypass masking
    (e.g. ``"owner,admin"``).  Empty = no exemptions.
  * ``dlp_extra_patterns_json`` — JSON list of ``{"name":..., "pattern":...,
    "replacement":...}`` to extend the defaults.

A small audit signal is added via the ``mask_rows`` return tuple so the caller
can include the redaction count in audit logs / response headers if desired.
"""
from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass
from typing import Any, Iterable

logger = logging.getLogger(__name__)


@dataclass
class Pattern:
    name: str
    regex: re.Pattern
    replacement: str


def _email_repl(m: re.Match) -> str:
    s = m.group(0)
    local, _, dom = s.partition("@")
    if not local:
        return "***@" + dom
    keep = local[0]
    return f"{keep}***@{dom}"


def _digits_keep_last4(m: re.Match) -> str:
    s = re.sub(r"\D", "", m.group(0))
    if len(s) <= 4:
        return "*" * len(s)
    return "*" * (len(s) - 4) + s[-4:]


DEFAULT_PATTERNS: list[Pattern] = [
    Pattern(
        name="email",
        regex=re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),
        replacement="<<email>>",  # replaced via _email_repl below
    ),
    Pattern(
        # Generic phone number: 7–15 digits possibly with separators or +country.
        name="phone",
        regex=re.compile(r"(?<!\d)(\+?\d{1,3}[-.\s]?)?(\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{3,4}(?!\d)"),
        replacement="<<phone>>",
    ),
    Pattern(
        # Taiwanese national ID: one letter + 9 digits.
        name="tw_id",
        regex=re.compile(r"\b[A-Z][12]\d{8}\b"),
        replacement="<<tw_id>>",
    ),
    Pattern(
        # Credit card: 13–19 digits with optional separators.
        name="credit_card",
        regex=re.compile(r"\b(?:\d[ -]*?){13,19}\b"),
        replacement="<<cc>>",
    ),
    Pattern(
        name="ipv4",
        regex=re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"),
        replacement="<<ip>>",
    ),
]


SENSITIVE_COLUMN_PATTERNS: dict[str, list[str]] = {
    "email": ["email", "e_mail", "mail_address"],
    "phone": ["phone", "mobile", "tel", "telephone", "cell"],
    "customer_id": ["customer_id", "client_id", "user_id", "member_id", "account_id"],
    "address": ["address", "addr", "street", "city", "zipcode", "zip_code", "postal"],
    "name": ["full_name", "first_name", "last_name", "given_name", "family_name"],
    "national_id": ["national_id", "identity", "passport", "ssn", "tax_id", "tw_id"],
    "credit_card": ["credit_card", "card_number", "pan"],
    "ip": ["ip_address", "ipv4", "ipv6"],
}


_DYNAMIC: list[Pattern] | None = None


def _load_extra_patterns() -> list[Pattern]:
    raw = os.environ.get("DLP_EXTRA_PATTERNS_JSON", "").strip()
    if not raw:
        return []
    try:
        items = json.loads(raw)
    except Exception:
        logger.warning("DLP_EXTRA_PATTERNS_JSON parse failed")
        return []
    out: list[Pattern] = []
    for it in items if isinstance(items, list) else []:
        try:
            out.append(Pattern(
                name=str(it["name"]),
                regex=re.compile(it["pattern"]),
                replacement=str(it.get("replacement", "<<redacted>>")),
            ))
        except Exception:
            logger.warning("Invalid DLP pattern: %s", it)
    return out


def _all_patterns() -> list[Pattern]:
    global _DYNAMIC
    if _DYNAMIC is None:
        _DYNAMIC = _load_extra_patterns()
    return DEFAULT_PATTERNS + _DYNAMIC


def _mask_string(value: str) -> tuple[str, int]:
    """Apply all patterns to ``value`` and return (masked, hits)."""
    hits = 0
    out = value
    for p in _all_patterns():
        if p.name == "email":
            out, n = p.regex.subn(_email_repl, out)
        elif p.name in {"phone", "credit_card", "tw_id"}:
            out, n = p.regex.subn(_digits_keep_last4, out)
        else:
            out, n = p.regex.subn(p.replacement, out)
        hits += n
    return out, hits


def mask_value(value: Any) -> tuple[Any, int]:
    """Mask a single field value. Returns (masked_value, hits)."""
    if value is None:
        return None, 0
    if isinstance(value, str):
        return _mask_string(value)
    if isinstance(value, (int, float, bool)):
        return value, 0
    if isinstance(value, dict):
        new = {}
        total = 0
        for k, v in value.items():
            nv, n = mask_value(v)
            new[k] = nv
            total += n
        return new, total
    if isinstance(value, (list, tuple)):
        new_list = []
        total = 0
        for v in value:
            nv, n = mask_value(v)
            new_list.append(nv)
            total += n
        return (type(value)(new_list), total) if isinstance(value, tuple) else (new_list, total)
    # Fallback: stringify, mask, return as string.
    s, n = _mask_string(str(value))
    return s, n


def classify_value(value: Any) -> list[str]:
    """Return DLP pattern names that match a value without mutating it."""
    if value is None:
        return []
    if isinstance(value, (dict, list, tuple)):
        return []
    text = str(value)
    hits: list[str] = []
    for pattern in _all_patterns():
        if pattern.regex.search(text):
            hits.append(pattern.name)
    return hits


def classify_column_name(column_name: str) -> list[str]:
    """Return sensitive categories suggested by a schema column name."""
    normalized = re.sub(r"[^a-z0-9]+", "_", str(column_name or "").lower()).strip("_")
    if not normalized:
        return []
    hits: list[str] = []
    for category, needles in SENSITIVE_COLUMN_PATTERNS.items():
        if any(normalized == needle or normalized.endswith(f"_{needle}") or needle in normalized for needle in needles):
            hits.append(category)
    return sorted(set(hits))


def summarize_redactions(rows: Iterable[dict]) -> dict[str, Any]:
    """Inspect rows and summarize which columns contain sensitive values."""
    by_column: dict[str, set[str]] = {}
    total = 0
    for row in rows:
        if not isinstance(row, dict):
            continue
        for column, value in row.items():
            hits = classify_value(value)
            if hits:
                total += len(hits)
                by_column.setdefault(str(column), set()).update(hits)
    return {
        "total_redactions": total,
        "columns": [
            {"column": column, "patterns": sorted(patterns)}
            for column, patterns in sorted(by_column.items())
        ],
    }


def mask_rows(rows: Iterable[dict], *, enabled: bool, role_exempt: set[str] | None = None,
              role_name: str | None = None) -> tuple[list[dict], int]:
    """Mask a list of result rows in-place-like (returns new list).

    Returns (masked_rows, total_redactions).  When ``enabled`` is False or the
    caller's role is in ``role_exempt``, the original rows are returned with
    ``total_redactions=0``.
    """
    if not enabled:
        return list(rows), 0
    if role_exempt and role_name and role_name.lower() in {r.lower() for r in role_exempt}:
        return list(rows), 0
    out: list[dict] = []
    total = 0
    for r in rows:
        if isinstance(r, dict):
            new_r: dict = {}
            for k, v in r.items():
                nv, n = mask_value(v)
                new_r[k] = nv
                total += n
            out.append(new_r)
        else:
            out.append(r)
    return out, total


def mask_rows_with_report(
    rows: Iterable[dict],
    *,
    enabled: bool,
    role_exempt: set[str] | None = None,
    role_name: str | None = None,
) -> tuple[list[dict], dict[str, Any]]:
    """Mask rows and return a UI/audit friendly DLP report."""
    original = list(rows)
    if not enabled:
        return original, {
            "enabled": False,
            "applied": False,
            "total_redactions": 0,
            "columns": [],
            "reason": "disabled",
        }
    if role_exempt and role_name and role_name.lower() in {r.lower() for r in role_exempt}:
        return original, {
            "enabled": True,
            "applied": False,
            "total_redactions": 0,
            "columns": [],
            "reason": "role_exempt",
        }

    summary = summarize_redactions(original)
    masked, total = mask_rows(
        original,
        enabled=True,
        role_exempt=None,
        role_name=role_name,
    )
    summary["total_redactions"] = total
    return masked, {
        "enabled": True,
        "applied": total > 0,
        "total_redactions": total,
        "columns": summary["columns"],
        "reason": "matched_patterns" if total else "no_match",
    }
