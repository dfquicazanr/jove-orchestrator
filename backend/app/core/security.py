import bcrypt
from jose import JWTError, jwt
from pydantic import BaseModel

from app.config import get_settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(
            password.encode("utf-8"),
            password_hash.encode("utf-8"),
        )
    except ValueError:
        return False


class TokenPayload(BaseModel):
    sub: str
    role: str


def create_access_token(*, username: str, role: str) -> str:
    s = get_settings()
    from datetime import datetime, timedelta, timezone

    expire = datetime.now(timezone.utc) + timedelta(minutes=s.jwt_expire_minutes)
    payload = {"sub": username, "role": role, "exp": expire}
    return jwt.encode(payload, s.jwt_secret_key, algorithm=s.jwt_algorithm)


def decode_access_token(token: str) -> TokenPayload | None:
    s = get_settings()
    try:
        raw = jwt.decode(token, s.jwt_secret_key, algorithms=[s.jwt_algorithm])
        return TokenPayload(sub=raw["sub"], role=raw["role"])
    except JWTError:
        return None
