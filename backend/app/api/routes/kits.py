from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_db, require_manager, require_viewer_or_manager
from app.services.material_fields import resolve_color_fields
from app.models.gcode_file import GCodeFile
from app.models.material_preheat_preset import MaterialPreheatPreset
from app.models.print_kit import PrintKit, PrintKitItem
from app.models.user import User
from app.schemas.print_kit import PrintKitCreate, PrintKitItemOut, PrintKitOut, PrintKitUpdate

router = APIRouter()


def _kit_item_out(item: PrintKitItem) -> PrintKitItemOut:
    gf = item.gcode_file
    mp = item.material_preset
    cp = item.material_color_preset
    return PrintKitItemOut(
        id=item.id,
        gcode_file_id=item.gcode_file_id,
        gcode_filename=gf.original_filename if gf else "",
        gcode_display_name=gf.display_name if gf else "",
        material_preset_id=item.material_preset_id,
        material_preset_name=mp.name if mp else "",
        material_color_preset_id=item.material_color_preset_id,
        material_color_preset_name=cp.name if cp else None,
        quantity=item.quantity,
        sort_order=item.sort_order,
    )


def _kit_out(kit: PrintKit) -> PrintKitOut:
    return PrintKitOut(
        id=kit.id,
        name=kit.name,
        description=kit.description,
        created_at=kit.created_at,
        updated_at=kit.updated_at,
        items=[_kit_item_out(i) for i in kit.items],
    )


def _load_kit(db: Session, kit_id: int) -> PrintKit | None:
    return (
        db.query(PrintKit)
        .options(
            joinedload(PrintKit.items).joinedload(PrintKitItem.gcode_file),
            joinedload(PrintKit.items).joinedload(PrintKitItem.material_preset),
            joinedload(PrintKit.items).joinedload(PrintKitItem.material_color_preset),
        )
        .filter(PrintKit.id == kit_id)
        .first()
    )


def _resolve_kit_item_row(db: Session, item) -> tuple[int, int | None]:
    gf = db.get(GCodeFile, item.gcode_file_id)
    if gf is None:
        raise HTTPException(status_code=422, detail=f"G-code file {item.gcode_file_id} not found")
    if db.get(MaterialPreheatPreset, item.material_preset_id) is None:
        raise HTTPException(
            status_code=422,
            detail=f"Material preset {item.material_preset_id} not found",
        )
    color_id = item.material_color_preset_id
    if color_id is None:
        return item.material_preset_id, None
    cid, _ = resolve_color_fields(
        db,
        material_preset_id=item.material_preset_id,
        material_color_preset_id=color_id,
    )
    return item.material_preset_id, cid


def _validate_kit_items(db: Session, items: list) -> None:
    for item in items:
        _resolve_kit_item_row(db, item)


@router.get("", response_model=list[PrintKitOut])
def list_kits(
    _: User = Depends(require_viewer_or_manager),
    db: Session = Depends(get_db),
):
    kits = (
        db.query(PrintKit)
        .options(
            joinedload(PrintKit.items).joinedload(PrintKitItem.gcode_file),
            joinedload(PrintKit.items).joinedload(PrintKitItem.material_preset),
            joinedload(PrintKit.items).joinedload(PrintKitItem.material_color_preset),
        )
        .order_by(PrintKit.name.asc())
        .all()
    )
    return [_kit_out(k) for k in kits]


@router.get("/{kit_id}", response_model=PrintKitOut)
def get_kit(
    kit_id: int,
    _: User = Depends(require_viewer_or_manager),
    db: Session = Depends(get_db),
):
    kit = _load_kit(db, kit_id)
    if kit is None:
        raise HTTPException(status_code=404, detail="Kit not found")
    return _kit_out(kit)


@router.post("", response_model=PrintKitOut, status_code=status.HTTP_201_CREATED)
def create_kit(
    body: PrintKitCreate,
    _: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    name = body.name.strip()
    if db.query(PrintKit).filter(PrintKit.name == name).one_or_none():
        raise HTTPException(status_code=400, detail="Kit name already exists")

    _validate_kit_items(db, body.items)

    kit = PrintKit(name=name, description=body.description.strip() if body.description else None)
    db.add(kit)
    db.flush()

    for i, item in enumerate(body.items):
        mat_id, color_id = _resolve_kit_item_row(db, item)
        db.add(
            PrintKitItem(
                kit_id=kit.id,
                gcode_file_id=item.gcode_file_id,
                material_preset_id=mat_id,
                material_color_preset_id=color_id,
                quantity=item.quantity,
                sort_order=item.sort_order if item.sort_order else i,
            )
        )

    db.commit()
    loaded = _load_kit(db, kit.id)
    assert loaded is not None
    return _kit_out(loaded)


@router.put("/{kit_id}", response_model=PrintKitOut)
def update_kit(
    kit_id: int,
    body: PrintKitUpdate,
    _: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    kit = db.get(PrintKit, kit_id)
    if kit is None:
        raise HTTPException(status_code=404, detail="Kit not found")

    if body.name is not None:
        name = body.name.strip()
        existing = db.query(PrintKit).filter(PrintKit.name == name, PrintKit.id != kit_id).one_or_none()
        if existing:
            raise HTTPException(status_code=400, detail="Kit name already exists")
        kit.name = name

    if "description" in body.model_dump(exclude_unset=True):
        kit.description = body.description.strip() if body.description else None

    if body.items is not None:
        _validate_kit_items(db, body.items)
        db.query(PrintKitItem).filter(PrintKitItem.kit_id == kit_id).delete()
        db.flush()
        for i, item in enumerate(body.items):
            mat_id, color_id = _resolve_kit_item_row(db, item)
            db.add(
                PrintKitItem(
                    kit_id=kit_id,
                    gcode_file_id=item.gcode_file_id,
                    material_preset_id=mat_id,
                    material_color_preset_id=color_id,
                    quantity=item.quantity,
                    sort_order=item.sort_order if item.sort_order else i,
                )
            )

    db.add(kit)
    db.commit()
    loaded = _load_kit(db, kit_id)
    assert loaded is not None
    return _kit_out(loaded)


@router.delete("/{kit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_kit(
    kit_id: int,
    _: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    kit = db.get(PrintKit, kit_id)
    if kit is None:
        raise HTTPException(status_code=404, detail="Kit not found")
    db.delete(kit)
    db.commit()
