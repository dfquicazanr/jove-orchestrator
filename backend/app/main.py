import logging
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import auth as auth_routes
from app.api.routes import gcode as gcode_routes
from app.api.routes import health as health_routes
from app.api.routes import kits as kits_routes
from app.api.routes import printers as printers_routes
from app.api.routes import queue as queue_routes
from app.api.routes import settings as settings_routes
from app.api.routes import users as users_routes
from app.config import get_settings
from app.core.security import hash_password
from app.database import SessionLocal
from app.models.user import User
from app.services.moonraker_watch import moonraker_watch

log = logging.getLogger("jove")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))
    Path(settings.gcode_upload_dir).mkdir(parents=True, exist_ok=True)

    db = SessionLocal()
    try:
        if db.query(User).count() == 0:
            u, p = settings.initial_admin_username, settings.initial_admin_password
            if u and p:
                db.add(
                    User(
                        username=u,
                        password_hash=hash_password(p),
                        role="manager",
                    )
                )
                db.commit()
                log.warning("Created bootstrap manager user %r from INITIAL_ADMIN_* env", u)
    finally:
        db.close()

    if settings.moonraker_watch_enabled:
        await moonraker_watch.start()
        log.info("Moonraker WebSocket status watcher started")

    yield

    if settings.moonraker_watch_enabled:
        await moonraker_watch.stop()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Jove Farm Orchestrator", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def request_id_middleware(request: Request, call_next):
        rid = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        request.state.request_id = rid
        response = await call_next(request)
        response.headers["X-Request-ID"] = rid
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_handler(request: Request, exc: RequestValidationError):
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={"detail": exc.errors(), "type": "validation_error"},
        )

    app.include_router(health_routes.router, tags=["health"])
    app.include_router(auth_routes.router, prefix="/auth", tags=["auth"])
    app.include_router(users_routes.router, prefix="/users", tags=["users"])
    app.include_router(printers_routes.router, prefix="/printers", tags=["printers"])
    app.include_router(gcode_routes.router, prefix="/gcode", tags=["gcode"])
    app.include_router(queue_routes.router, prefix="/queue", tags=["queue"])
    app.include_router(kits_routes.router, prefix="/kits", tags=["kits"])
    app.include_router(settings_routes.router, prefix="/settings", tags=["settings"])

    return app


app = create_app()
