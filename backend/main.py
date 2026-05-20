from contextlib import asynccontextmanager
import os

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.routes import compare, health, models, prompts, results, run
from backend.config import settings
from backend.providers.registry import get_provider_registry
from backend.utils.env_manager import read_env_file
from backend.utils.prompt_manager import get_prompt_manager

log = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ────────────────────────────────────────────────────────────────
    log.info("startup_begin", env=settings.app_env)

    # Push .env values into os.environ so key_is_set() and providers see them.
    # pydantic-settings reads .env into Settings fields but does not set os.environ.
    for k, v in read_env_file().items():
        if v and k not in os.environ:
            os.environ[k] = v

    # Register AI providers that have API keys configured
    get_provider_registry().initialize()

    # Load all agent prompt files from disk
    get_prompt_manager().load()

    log.info(
        "startup_complete",
        providers=get_provider_registry().available(),
        prompts=get_prompt_manager().loaded_agents(),
    )
    yield

    # ── Shutdown ───────────────────────────────────────────────────────────────
    log.info("shutdown")


app = FastAPI(
    title="Pre-Market Stock Advisor",
    description=(
        "Parallel multi-agent AI pipeline for daily pre-market stock analysis. "
        "Runs once per day ~30 minutes before market open."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(run.router)
app.include_router(results.router)
app.include_router(compare.router)
app.include_router(models.router)
app.include_router(prompts.router)
