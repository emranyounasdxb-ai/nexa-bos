from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from nexa_bos_api.api.v1.router import api_v1_router
from nexa_bos_api.core.config import get_settings
from nexa_bos_api.core.errors import register_exception_handlers
from nexa_bos_api.core.logging import configure_logging
from nexa_bos_api.core.middleware import RequestIdMiddleware, SecurityHeadersMiddleware
from nexa_bos_api.db.session import create_engine, create_session_factory


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    engine = create_engine(settings)
    app.state.settings = settings
    app.state.engine = engine
    app.state.session_factory = create_session_factory(engine)
    yield
    await engine.dispose()


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)
    application = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        lifespan=lifespan,
        docs_url=settings.docs_url,
        redoc_url=settings.redoc_url,
        openapi_url=settings.openapi_url,
    )
    register_exception_handlers(application)
    application.add_middleware(
        SecurityHeadersMiddleware,
        enable_hsts=settings.is_production,
    )
    application.add_middleware(RequestIdMiddleware)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.include_router(api_v1_router)
    return application


app = create_app()
