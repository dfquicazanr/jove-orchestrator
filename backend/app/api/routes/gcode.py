import json
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_manager
from app.config import get_settings
from app.models.gcode_file import GCodeFile
from app.models.print_queue import PrintQueueItem, PrintQueueStatus
from app.models.user import User
from app.schemas.gcode import GCodeFileOut, GCodeUploadMetadata
from app.services.gcode_parse import estimate_filament_grams_from_gcode

router = APIRouter()


@router.post("/upload", response_model=GCodeFileOut, status_code=status.HTTP_201_CREATED)
async def upload_gcode(
    file: UploadFile = File(...),
    metadata_json: str = Form("{}"),
    db: Session = Depends(get_db),
    user: User = Depends(require_manager),
):
    settings = get_settings()
    max_bytes = settings.gcode_max_upload_mb * 1024 * 1024
    try:
        meta = GCodeUploadMetadata.model_validate(json.loads(metadata_json) or {})
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"Invalid metadata: {e}") from e

    suffix = Path(file.filename or "job.gcode").suffix or ".gcode"
    dest_name = f"{uuid4().hex}{suffix}"
    dest_dir = Path(settings.gcode_upload_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / dest_name

    size = 0
    try:
        with dest_path.open("wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > max_bytes:
                    raise HTTPException(status_code=413, detail="File too large")
                out.write(chunk)
    except HTTPException:
        if dest_path.exists():
            dest_path.unlink(missing_ok=True)
        raise

    with dest_path.open("r", encoding="utf-8", errors="ignore") as f:
        head = f.read(512_000)
    est = estimate_filament_grams_from_gcode(head)

    gf = GCodeFile(
        stored_path=str(dest_path.resolve()),
        original_filename=file.filename or dest_name,
        uploaded_by_id=user.id,
        filament_mass_grams_estimate=est,
        required_material=meta.required_material,
        required_color=meta.required_color,
        total_copies_requested=meta.copies,
    )
    db.add(gf)
    db.flush()

    for i in range(meta.copies):
        db.add(
            PrintQueueItem(
                gcode_file_id=gf.id,
                copy_index=i,
                priority=0,
                status=PrintQueueStatus.draft.value,
            )
        )
    db.commit()
    db.refresh(gf)
    return gf


@router.delete("/files/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_gcode_file(
    file_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_manager),
):
    gf = db.get(GCodeFile, file_id)
    if gf is None:
        raise HTTPException(status_code=404, detail="File not found")
    path = Path(gf.stored_path)
    db.delete(gf)
    db.commit()
    if path.exists():
        try:
            path.unlink()
        except OSError:
            pass
    return None
