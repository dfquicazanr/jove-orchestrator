from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_manager
from app.core.security import hash_password
from app.models.user import User
from app.schemas.auth import UserCreate, UserOut, UserPasswordReset

router = APIRouter()


@router.get("", response_model=list[UserOut])
def list_users(_: User = Depends(require_manager), db: Session = Depends(get_db)):
    return db.query(User).order_by(User.id.asc()).all()


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(body: UserCreate, _: User = Depends(require_manager), db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == body.username).one_or_none():
        raise HTTPException(status_code=400, detail="Username already exists")
    u = User(
        username=body.username,
        password_hash=hash_password(body.password),
        role=body.role,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


@router.patch("/{user_id}/deactivate", response_model=UserOut)
def deactivate_user(
    user_id: int,
    _: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    u = db.get(User, user_id)
    if u is None:
        raise HTTPException(status_code=404, detail="User not found")
    u.is_active = False
    db.commit()
    db.refresh(u)
    return u


@router.patch("/{user_id}/password", response_model=UserOut)
def reset_password(
    user_id: int,
    body: UserPasswordReset,
    _: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    u = db.get(User, user_id)
    if u is None:
        raise HTTPException(status_code=404, detail="User not found")
    u.password_hash = hash_password(body.new_password)
    db.commit()
    db.refresh(u)
    return u
