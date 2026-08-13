"""Import preview endpoint — accepts CSV/XLSX upload, saves temp file, returns schema."""
from __future__ import annotations

import io
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from api.auth import require_api_key

router = APIRouter(prefix="/v1", tags=["import"])

UPLOAD_DIR = Path("data/uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MAX_BYTES = 20 * 1024 * 1024  # 20 MB


class ColumnInfo(BaseModel):
    name: str
    dtype: str


class ImportPreviewResponse(BaseModel):
    upload_id: str
    file_path: str
    original_name: str
    file_type: str          # "csv" | "xlsx"
    row_count: int
    columns: list[ColumnInfo]
    sample_rows: list[dict]


@router.post("/import/preview", response_model=ImportPreviewResponse)
async def import_preview(
    file: UploadFile = File(...),
    conn_name: str = Form(default="default"),
    role: str = Depends(require_api_key),
) -> ImportPreviewResponse:
    """
    Upload a CSV or XLSX file.  Returns column schema + 5 sample rows
    and saves the file to data/uploads/ for subsequent agent-driven ETL.
    """
    try:
        import pandas as pd
    except ImportError:
        raise HTTPException(500, "pandas not installed")

    name = file.filename or "upload"
    suffix = Path(name).suffix.lower()
    if suffix not in (".csv", ".xlsx", ".xls"):
        raise HTTPException(400, "Only .csv / .xlsx / .xls files are supported")

    raw = await file.read()
    if len(raw) > MAX_BYTES:
        raise HTTPException(413, "File exceeds 20 MB limit")

    uid = uuid.uuid4().hex[:12]
    safe_name = f"{uid}{suffix}"
    dest = UPLOAD_DIR / safe_name
    dest.write_bytes(raw)

    try:
        if suffix == ".csv":
            # Try UTF-8 first, fall back to cp950 (Big5)
            try:
                df = pd.read_csv(io.BytesIO(raw), encoding="utf-8-sig")
            except UnicodeDecodeError:
                df = pd.read_csv(io.BytesIO(raw), encoding="cp950")
            file_type = "csv"
        else:
            df = pd.read_excel(io.BytesIO(raw))
            file_type = "xlsx"
    except Exception as exc:
        dest.unlink(missing_ok=True)
        raise HTTPException(422, f"Cannot parse file: {exc}")

    columns = [
        ColumnInfo(name=str(c), dtype=str(df[c].dtype)) for c in df.columns
    ]
    sample = df.head(5).fillna("").astype(str).to_dict(orient="records")

    return ImportPreviewResponse(
        upload_id=uid,
        file_path=str(dest),
        original_name=name,
        file_type=file_type,
        row_count=len(df),
        columns=columns,
        sample_rows=sample,
    )
