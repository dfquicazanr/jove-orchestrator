import json
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_db, require_manager, require_viewer_or_manager
from app.config import get_settings
from app.models.gcode_file import GCodeFile
from app.models.material_preheat_preset import MaterialPreheatPreset
from app.models.print_kit import PrintKitItem
from app.models.print_queue import PrintQueueItem, PrintQueueStatus
from app.models.user import User
from app.schemas.gcode import GCodeFileOut, GCodeFilePatch, GCodeUploadMetadata
from app.services.gcode_labels import default_display_name
from app.services.filament_estimate import reconcile_filament
from app.services.gcode_parse import parse_gcode_metadata
from app.services.material_fields import resolve_color_fields, resolve_material_fields

router = APIRouter()


def _gcode_file_out(gf: GCodeFile, queue_item_count: int | None = None) -> GCodeFileOut:
    preset = gf.material_preset
    color = gf.material_color_preset
    count = queue_item_count
    if count is None:
        count = len(gf.queue_items) if gf.queue_items is not None else 0
    return GCodeFileOut(
        id=gf.id,
        original_filename=gf.original_filename,
        display_name=gf.display_name,
        filament_mass_grams_estimate=gf.filament_mass_grams_estimate,
        filament_length_mm=gf.filament_length_mm,
        print_time_seconds=gf.print_time_seconds,
        required_material=gf.required_material,
        required_color=gf.required_color,
        material_preset_id=gf.material_preset_id,
        material_preset_name=preset.name if preset else None,
        material_color_preset_id=gf.material_color_preset_id,
        material_color_preset_name=color.name if color else None,
        queue_item_count=count,
        created_at=gf.created_at,
    )


def _material_density(db: Session, material_preset_id: int | None) -> float | None:
    if material_preset_id is None:
        return None
    preset = db.get(MaterialPreheatPreset, material_preset_id)
    if preset is None or preset.default_density_g_cm3 is None:
        return None
    return float(preset.default_density_g_cm3)


def _read_gcode_metadata_from_path(path: Path) -> tuple[str, str | None]:
    size = path.stat().st_size
    with path.open("r", encoding="utf-8", errors="ignore") as f:
        head = f.read(512_000)
        tail = ""
        if size > 65536:
            f.seek(max(0, size - 65536))
            tail = f.read(65536)
    return head, tail or None


def _apply_filament_reconcile(
    gf: GCodeFile,
    db: Session,
    *,
    parsed_mass: float | None,
    parsed_length: float | None,
) -> None:
    density = _material_density(db, gf.material_preset_id)
    reconciled = reconcile_filament(parsed_mass, parsed_length, density)
    gf.filament_mass_grams_estimate = reconciled.mass_grams
    gf.filament_length_mm = reconciled.length_mm


def _reparse_and_reconcile_stored_gcode(gf: GCodeFile, db: Session) -> None:
    path = Path(gf.stored_path)
    if not path.is_file():
        return
    head, tail = _read_gcode_metadata_from_path(path)
    parsed = parse_gcode_metadata(head, tail=tail)
    _apply_filament_reconcile(
        gf,
        db,
        parsed_mass=parsed.filament_mass_grams,
        parsed_length=parsed.filament_length_mm,
    )


def _cascade_gcode_to_kits(db: Session, gf: GCodeFile) -> None:
    """Push library file material/color to every kit line that references this file."""
    if gf.material_preset_id is None:
        return
    db.query(PrintKitItem).filter(PrintKitItem.gcode_file_id == gf.id).update(
        {
            PrintKitItem.material_preset_id: gf.material_preset_id,
            PrintKitItem.material_color_preset_id: gf.material_color_preset_id,
        },
        synchronize_session=False,
    )


def _reload_gcode(db: Session, file_id: int) -> GCodeFile:
    gf = (
        db.query(GCodeFile)
        .options(
            joinedload(GCodeFile.material_preset),
            joinedload(GCodeFile.material_color_preset),
            joinedload(GCodeFile.queue_items),
        )
        .filter(GCodeFile.id == file_id)
        .first()
    )
    assert gf is not None
    return gf


@router.get("/files", response_model=list[GCodeFileOut])
def list_gcode_files(
    _: User = Depends(require_viewer_or_manager),
    db: Session = Depends(get_db),
):
    files = (
        db.query(GCodeFile)
        .options(
            joinedload(GCodeFile.material_preset),
            joinedload(GCodeFile.material_color_preset),
        )
        .order_by(GCodeFile.created_at.desc(), GCodeFile.id.desc())
        .all()
    )
    if not files:
        return []

    file_ids = [f.id for f in files]
    count_rows = (
        db.query(PrintQueueItem.gcode_file_id, func.count(PrintQueueItem.id))
        .filter(PrintQueueItem.gcode_file_id.in_(file_ids))
        .group_by(PrintQueueItem.gcode_file_id)
        .all()
    )
    qi_by_file = {fid: int(n) for fid, n in count_rows}

    return [_gcode_file_out(gf, qi_by_file.get(gf.id, 0)) for gf in files]


@router.get("/files/{file_id}", response_model=GCodeFileOut)
def get_gcode_file(
    file_id: int,
    _: User = Depends(require_viewer_or_manager),
    db: Session = Depends(get_db),
):
    if db.get(GCodeFile, file_id) is None:
        raise HTTPException(status_code=404, detail="File not found")
    return _gcode_file_out(_reload_gcode(db, file_id))


@router.patch("/files/{file_id}", response_model=GCodeFileOut)
def patch_gcode_file(
    file_id: int,
    body: GCodeFilePatch,
    _: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    gf = db.get(GCodeFile, file_id)
    if gf is None:
        raise HTTPException(status_code=404, detail="File not found")

    data = body.model_dump(exclude_unset=True)

    if "display_name" in data and data["display_name"] is not None:
        gf.display_name = data["display_name"].strip() or default_display_name(gf.original_filename)

    mat_id = data.get("material_preset_id", gf.material_preset_id) if "material_preset_id" in data else gf.material_preset_id
    mat_name_in = data.get("required_material", gf.required_material) if "required_material" in data else gf.required_material
    if "material_preset_id" in data or "required_material" in data:
        mat_id, mat_name = resolve_material_fields(
            db, material_preset_id=mat_id, required_material=mat_name_in
        )
        gf.material_preset_id = mat_id
        gf.required_material = mat_name

    color_id = (
        data["material_color_preset_id"]
        if "material_color_preset_id" in data
        else gf.material_color_preset_id
    )
    if "material_color_preset_id" in data:
        if color_id is None:
            gf.material_color_preset_id = None
            gf.required_color = None
        else:
            cid, cname = resolve_color_fields(
                db,
                material_preset_id=gf.material_preset_id,
                material_color_preset_id=color_id,
            )
            gf.material_color_preset_id = cid
            gf.required_color = cname

    if "material_preset_id" in data and gf.material_color_preset_id is not None:
        cid, cname = resolve_color_fields(
            db,
            material_preset_id=gf.material_preset_id,
            material_color_preset_id=gf.material_color_preset_id,
        )
        gf.material_color_preset_id = cid
        gf.required_color = cname

    if "material_preset_id" in data:
        _reparse_and_reconcile_stored_gcode(gf, db)

    for k in ("display_name", "material_preset_id", "required_material", "material_color_preset_id", "required_color"):
        data.pop(k, None)

    for k, v in data.items():
        setattr(gf, k, v)

    _cascade_gcode_to_kits(db, gf)
    db.commit()
    return _gcode_file_out(_reload_gcode(db, gf.id))


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

    head, tail = _read_gcode_metadata_from_path(dest_path)
    parsed = parse_gcode_metadata(head, tail=tail)
    preset_id, mat_name = resolve_material_fields(
        db,
        material_preset_id=meta.material_preset_id,
        required_material=meta.required_material,
    )
    color_id, color_name = resolve_color_fields(
        db,
        material_preset_id=preset_id,
        material_color_preset_id=meta.material_color_preset_id,
    )
    orig_name = file.filename or dest_name
    display = (meta.display_name or "").strip() or default_display_name(orig_name)

    gf = GCodeFile(
        stored_path=str(dest_path.resolve()),
        original_filename=orig_name,
        display_name=display,
        uploaded_by_id=user.id,
        filament_mass_grams_estimate=None,
        filament_length_mm=None,
        print_time_seconds=parsed.print_time_seconds,
        required_material=mat_name,
        required_color=color_name,
        material_preset_id=preset_id,
        material_color_preset_id=color_id,
    )
    db.add(gf)
    db.flush()
    _apply_filament_reconcile(
        gf,
        db,
        parsed_mass=parsed.filament_mass_grams,
        parsed_length=parsed.filament_length_mm,
    )

    if meta.enqueue:
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
    return _gcode_file_out(_reload_gcode(db, gf.id))


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
