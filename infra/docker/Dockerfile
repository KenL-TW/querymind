# ── Stage 1: Build dependencies ───────────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /build

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt


# ── Stage 2: Runtime image ────────────────────────────────────────────────────
FROM python:3.11-slim

LABEL org.opencontainers.image.title="QueryMind" \
      org.opencontainers.image.description="AI-powered database agent"

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# Copy application source
COPY . .

# Non-root user for security
RUN addgroup --system querymind && adduser --system --ingroup querymind querymind
RUN chown -R querymind:querymind /app
USER querymind

# Data directory for local runtime artifacts
RUN mkdir -p /app/data /app/storage

EXPOSE 8101

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8101/health')"

CMD ["python", "main.py"]
