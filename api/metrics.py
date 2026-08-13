"""
Prometheus metrics for QueryMind.

Exposed at GET /metrics  (no auth — scrape from internal network only).

Custom metrics:
  querymind_agent_calls_total{status, conn_name}
  querymind_agent_latency_seconds{conn_name}
  querymind_tool_calls_total{tool_name, status}
  querymind_llm_tokens_total{token_type}   # prompt | completion
  querymind_active_sessions

Note: When using uvicorn reload=True, this module is re-imported, causing
metric re-registration. We use try/except to handle duplicates gracefully.
"""
from __future__ import annotations

from prometheus_client import Counter, Gauge, Histogram, REGISTRY
from prometheus_fastapi_instrumentator import Instrumentator

# ── Helper to handle metric re-registration during reload ──────────────────

def _get_or_create_metric(metric_class, name, *args, **kwargs):
    """Create metric or return existing one if already registered."""
    try:
        return metric_class(name, *args, **kwargs)
    except ValueError as e:
        if "Duplicated timeseries" in str(e):
            # Already registered; fetch from global registry
            return REGISTRY._names_to_collectors.get(name)
        raise

# ── Custom counters / histograms ──────────────────────────────────────────────

agent_calls = _get_or_create_metric(
    Counter,
    "querymind_agent_calls_total",
    "Total agent invocations",
    ["status", "conn_name"],
)

agent_latency = _get_or_create_metric(
    Histogram,
    "querymind_agent_latency_seconds",
    "End-to-end agent response latency in seconds",
    ["conn_name"],
    buckets=[0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0],
)

tool_calls = _get_or_create_metric(
    Counter,
    "querymind_tool_calls_total",
    "Total individual tool invocations by the agent",
    ["tool_name", "status"],
)

llm_tokens = _get_or_create_metric(
    Counter,
    "querymind_llm_tokens_total",
    "Cumulative LLM tokens consumed",
    ["token_type"],  # prompt | completion
)

active_sessions = _get_or_create_metric(
    Gauge,
    "querymind_active_sessions",
    "Number of distinct sessions that have at least one message",
)


# ── FastAPI integration ───────────────────────────────────────────────────────

def setup_metrics(app) -> None:
    """Instrument FastAPI with default HTTP metrics and expose /metrics endpoint."""
    Instrumentator(
        should_group_status_codes=True,
        should_ignore_untemplated=True,
        excluded_handlers=["/metrics", "/health"],
    ).instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)
